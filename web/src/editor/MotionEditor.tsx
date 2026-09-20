import { usePanelWidth } from "./usePanelWidth";
import { createClientRequestId } from "../requestId";
import { readStringSetting, writeStringSetting } from "../storage";
import { FootagePanel } from "./FootagePanel";
import { TimelineTrack } from "./TimelineTrack";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowCounterClockwise,
  ArrowClockwise,
  ChatCircle,
  SlidersHorizontal,
  Images,
  SquaresFour,
  SpeakerHigh,
  VideoCamera,
  Palette,
  ClockCounterClockwise,
  DownloadSimple,
  Plus,
  TextT,
  Scissors,
  Copy,
  Trash,
  Play,
  Pause,
  CaretDown,
  CaretUp,
  X,
  UploadSimple,
  Check,
  FloppyDisk,
  ArrowsHorizontal,
  ArrowUp,
  ArrowDown,
} from "@phosphor-icons/react";
import {
  validateDocument,
  emptyDocument,
  newElement,
  applyCommand,
  sceneSchedule,
  documentDuration,
  type EditorCommand,
  type EditorElement,
} from "../../../runtime/editor/model.mjs";
import { compileHTML } from "../../../runtime/editor/compile.mjs";
import { styles, templateScene } from "../../../runtime/editor/catalog.mjs";
import gsapUrl from "../../../runtime/editorial/vendor/gsap-3.14.2.min.js?url";
import sansCss from "@fontsource-variable/noto-sans-sc/index.css?inline";
import serifCss from "@fontsource-variable/noto-serif-sc/index.css?inline";
import monoCss from "@fontsource/fragment-mono/400.css?inline";
const fontCss = sansCss + serifCss + monoCss;
import {
  editorApi,
  type Composition,
  type EditorLibrary,
  type BrandKit,
} from "./api";
import { api } from "../api";
import type { ProjectDetail, AgentMedia, AssetLibraryItem } from "../types";
import { RenderPanel as PersistentRenderPanel } from "../components/HyperFramesWorkspace";
import "./editor.css";

type Pane =
  | "chat"
  | "edit"
  | "media"
  | "templates"
  | "audio"
  | "brand"
  | "versions"
  | "export"
  | "footage";
const tools = [
  { id: "chat", label: "AI 对话", icon: ChatCircle },
  { id: "edit", label: "编辑", icon: SlidersHorizontal },
  { id: "media", label: "素材", icon: Images },
  { id: "footage", label: "AI 视频", icon: VideoCamera },
  { id: "templates", label: "模板", icon: SquaresFour },
  { id: "audio", label: "声音", icon: SpeakerHigh },
  { id: "brand", label: "品牌", icon: Palette },
  { id: "versions", label: "版本", icon: ClockCounterClockwise },
] as const;
const uid = () => createClientRequestId();
const message = (e: unknown) =>
  e instanceof Error ? e.message : "操作未完成，请重试";
const number = (value: number) => Math.round(value * 100) / 100;
const timeLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
export function MotionEditor({
  project,
  chat,
  legacy,
  onBack,
  onRename,
  onRefresh,
  onCompose,
  onTarget,
}: {
  project: ProjectDetail;
  chat: ReactNode;
  legacy: ReactNode;
  onBack: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCompose: (text: string) => void;
  onTarget: (
    target: {
      sceneId: string;
      sceneName: string;
      elementId?: string;
      elementName?: string;
      revision: number;
    } | null,
  ) => void;
}) {
  const [composition, setComposition] = useState<Composition | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [pane, setPane] = useState<Pane>("chat"),
    [panelOpen, setPanelOpen] = useState(true),
    [legacyOpen, setLegacyOpen] = useState(
      () => readStringSetting("yingya-editor-view", "timeline") === "legacy",
    );
  useEffect(() => {
    writeStringSetting(
      "yingya-editor-view",
      legacyOpen ? "legacy" : "timeline",
    );
  }, [legacyOpen]);
  const panelLayout = usePanelWidth(pane === "chat" ? "chat" : "tools");
  const [resizingPanel, setResizingPanel] = useState(false);
  const panelDrag = useRef<{ x: number; width: number } | null>(null);
  const [library, setLibrary] = useState<EditorLibrary>({
    brands: [],
    templates: [],
  });
  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await editorApi.library(project.id));
    } catch (e) {
      setError(message(e));
    }
  }, [project.id]);
  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);
  const [sceneId, setSceneId] = useState(""),
    [elementId, setElementId] = useState(""),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [zoom, setZoom] = useState(68),
    [collapsed, setCollapsed] = useState(false),
    [snapping, setSnapping] = useState(true),
    [safeArea, setSafeArea] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<AssetLibraryItem[]>([]),
    [mediaScope, setMediaScope] = useState<"project" | "library">("project");
  useEffect(() => {
    if (pane === "media" || pane === "audio")
      void api
        .listAssetLibrary()
        .then((value) => setLibraryAssets(value.assets))
        .catch((e) => setError(message(e)));
  }, [pane]);
  const [media, setMedia] = useState<AgentMedia>({ scenes: [], assets: [] }),
    [search, setSearch] = useState(""),
    [exportVersion, setExportVersion] = useState(""),
    [title, setTitle] = useState(project.title);
  const [previewDuration, setPreviewDuration] = useState(0);
  const previewVersion = project.manifest.versions.find(
    (v) => v.id === project.manifest.currentDraft,
  );
  const previewPath =
    project.renderJobs.find(
      (job) =>
        job.versionId === previewVersion?.id &&
        job.status === "completed" &&
        job.outputPath,
    )?.outputPath ??
    (previewVersion?.id.startsWith("editor-")
      ? undefined
      : previewVersion?.videoPath);
  const fallbackSource =
    !composition && previewPath && /\.(mp4|webm|mov)$/i.test(previewPath)
      ? api.fileUrl(project.id, previewPath)
      : undefined;
  const videoRef = useRef<HTMLVideoElement>(null);
  const readRequest = useRef<AbortController | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null),
    stageRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    stateRef = useRef(composition),
    busyRef = useRef(false),
    commandsRef = useRef(Promise.resolve()),
    pendingRef = useRef(0),
    timeRef = useRef(0),
    [size, setSize] = useState({ width: 800, height: 500 });
  const running =
    Boolean(project.activeTurnId) ||
    project.renderJobs.some((j) => ["queued", "running"].includes(j.status));
  const doc = composition?.document,
    scenes = useMemo(() => (doc ? sceneSchedule(doc) : []), [doc]),
    duration = doc ? documentDuration(doc) : previewDuration,
    scene = doc?.scenes.find((s) => s.id === sceneId) ?? doc?.scenes[0],
    element = scene?.elements.find((e) => e.id === elementId);
  useEffect(() => {
    onTarget(
      !legacyOpen && scene && composition
        ? {
            sceneId: scene.id,
            sceneName: scene.name,
            ...(element
              ? { elementId: element.id, elementName: element.name }
              : {}),
            revision: composition.revision,
          }
        : null,
    );
  }, [
    onTarget,
    legacyOpen,
    scene?.id,
    scene?.name,
    element?.id,
    element?.name,
    composition?.revision,
  ]);
  stateRef.current = composition;
  timeRef.current = time;
  const refresh = useCallback(async () => {
    if (readRequest.current) return;
    const controller = new AbortController();
    readRequest.current = controller;
    try {
      const next = await editorApi.get(project.id, controller.signal);
      if (
        !busyRef.current &&
        !controller.signal.aborted &&
        (!stateRef.current ||
          (next && next.revision >= stateRef.current.revision))
      ) {
        const first = !stateRef.current;
        stateRef.current = next;
        setComposition(next);
        if (next && first)
          setTime(Math.min(0.7, documentDuration(next.document) / 2));
        setError("");
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof DOMException && e.name === "TimeoutError"
            ? "工程读取超时，请重试；已有视频仍可播放。"
            : message(e),
        );
    } finally {
      if (readRequest.current === controller) readRequest.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [project.id]);
  useEffect(
    () => () => {
      readRequest.current?.abort();
      readRequest.current = null;
    },
    [project.id],
  );
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, refresh]);
  useEffect(() => {
    void refresh();
    void api
      .getProjectMedia(project.id)
      .then(setMedia)
      .catch((e) => setError(message(e)));
  }, [project.id, project.updatedAt, refresh]);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const resize = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, [loading, legacyOpen]);
  const seek = useCallback(
    (value: number, play = false) => {
      const t = Math.max(0, Math.min(duration, value));
      setTime(t);
      setPlaying(play);
      if (videoRef.current) {
        videoRef.current.currentTime = t;
        if (play)
          void videoRef.current.play().catch(() => {
            setPlaying(false);
            setError("视频暂时无法播放，请重新加载视频。");
          });
        else videoRef.current.pause();
      }
      frameRef.current?.contentWindow?.postMessage(
        { type: "yingya-editor-seek", time: t, playing: play },
        "*",
      );
    },
    [duration],
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "yingya-editor-ready") seek(timeRef.current);
      if (data?.type === "yingya-editor-time" && Number.isFinite(data.time)) {
        setTime(data.time);
        setPlaying(Boolean(data.playing));
      }
      if (data?.type === "yingya-editor-select") {
        setSceneId(data.sceneId);
        setElementId(data.elementId);
        setPane("edit");
        setPanelOpen(true);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [seek]);
  const run = useCallback(
    (command: EditorCommand) => {
      if (running || (busyRef.current && !pendingRef.current))
        return Promise.resolve();
      pendingRef.current += 1;
      busyRef.current = true;
      setSaving(true);
      const task = commandsRef.current
        .then(async () => {
          const state = stateRef.current;
          if (!state) return;
          setError("");
          setPlaying(false);
          try {
            if (command.type !== "undo" && command.type !== "redo") {
              const optimistic = {
                ...state,
                document: applyCommand(state.document, command),
              };
              stateRef.current = optimistic;
              setComposition(optimistic);
            }
            const next = await editorApi.command(
              project.id,
              state.revision,
              command,
            );
            stateRef.current = next;
            setComposition(next);
          } catch (e) {
            // Re-read after ambiguous network failures before processing another edit.
            const current = await editorApi.get(project.id).catch(() => state);
            stateRef.current = current;
            setComposition(current);
            setError(message(e));
          }
        })
        .finally(() => {
          pendingRef.current -= 1;
          busyRef.current = pendingRef.current > 0;
          setSaving(busyRef.current);
        });
      commandsRef.current = task;
      return task;
    },
    [project.id, running],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (legacyOpen) return;
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable=true],[role="separator"]',
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void run({ type: e.shiftKey ? "redo" : "undo" });
      }
      if (
        e.code === "Space" &&
        !(e.target as HTMLElement).closest("button,a,summary")
      ) {
        e.preventDefault();
        seek(timeRef.current, !playing);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && scene && element) {
        e.preventDefault();
        void run({
          type: "element.remove",
          sceneId: scene.id,
          elementId: element.id,
        });
      }
      if (
        element &&
        scene &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const delta = e.shiftKey ? 10 : 1;
        void run({
          type: "element.update",
          sceneId: scene.id,
          elementId: element.id,
          patch: {
            x:
              element.x +
              (e.key === "ArrowRight"
                ? delta
                : e.key === "ArrowLeft"
                  ? -delta
                  : 0),
            y:
              element.y +
              (e.key === "ArrowDown"
                ? delta
                : e.key === "ArrowUp"
                  ? -delta
                  : 0),
          },
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [run, seek, playing, scene, element, legacyOpen]);
  async function initialize(styleId?: string) {
    if (busyRef.current || running) return;
    busyRef.current = true;
    setSaving(true);
    setError("");
    try {
      const document = emptyDocument(project.aspectRatio);
      if (styleId)
        document.scenes.push(templateScene(styleId, uid(), document));
      const next = await editorApi.init(project.id, document);
      setComposition(next);
      setSceneId(document.scenes[0]?.id ?? "");
      setTime(document.scenes.length ? 0.7 : 0);
      setPane("edit");
    } catch (e) {
      setError(message(e));
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }
  function addScene(styleId?: string) {
    if (!doc) {
      void initialize(styleId);
      return;
    }
    const id = uid();
    const next = styleId
      ? templateScene(styleId, id, doc)
      : {
          id,
          name: "空白镜头",
          duration: 3,
          background: "#ffffff",
          elements: [],
        };
    void run({
      type: "scene.add",
      index: scene ? doc.scenes.indexOf(scene) + 1 : doc.scenes.length,
      scene: next,
    });
    setSceneId(id);
    setElementId("");
    setTime(
      (scene
        ? scenes.find((s) => s.id === scene.id)!.start + scene.duration
        : duration) + Math.min(0.7, next.duration / 2),
    );
  }
  function updateElement(patch: Partial<EditorElement>) {
    if (scene && element)
      void run({
        type: "element.update",
        sceneId: scene.id,
        elementId: element.id,
        patch,
      });
  }
  function addShape() {
    if (!doc || !scene) return;
    const el = {
      ...newElement(uid(), "shape", scene, doc),
      name: "图形",
      fill: "#006bd6",
      width: doc.width * 0.25,
      height: doc.height * 0.25,
      radius: 12,
    };
    void run({ type: "element.add", sceneId: scene.id, element: el });
    setElementId(el.id);
    setPane("edit");
    setPanelOpen(true);
  }
  function downloadDocument() {
    if (!doc) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.title}.yingya.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importDocument(file: File) {
    try {
      if (file.size > 2_000_000) throw Error("工程 JSON 不能超过 2 MB");
      const document = validateDocument(JSON.parse(await file.text()));
      if (!composition) {
        setComposition(await editorApi.init(project.id, document));
      } else await run({ type: "document.replace", document });
      setSceneId(document.scenes[0]?.id ?? "");
      setElementId("");
      setTime(0.7);
    } catch (e) {
      setError(message(e));
    }
  }
  function addText() {
    if (!doc || !scene) return;
    const el = newElement(uid(), "text", scene, doc);
    void run({ type: "element.add", sceneId: scene.id, element: el });
    setElementId(el.id);
    setPane("edit");
    setPanelOpen(true);
  }
  async function addMedia(asset: AgentMedia["assets"][number]) {
    if (!doc || !scene) return;
    const kind = asset.mediaType?.startsWith("audio/")
      ? "audio"
      : asset.mediaType?.startsWith("video/")
        ? "video"
        : asset.mediaType?.startsWith("image/")
          ? "image"
          : null;
    if (!kind) {
      setError("文档可加入 AI 对话，画布支持图片、视频和音频。");
      return;
    }
    try {
      const measured =
        kind === "video" || kind === "audio"
          ? await mediaDuration(
              api.fileUrl(project.id, asset.hyperframesPath),
              kind,
            )
          : null;
      const el = {
        ...newElement(uid(), kind, scene, doc),
        name: asset.name,
        source: asset.hyperframesPath,
        sourceDuration: measured,
        duration: Math.min(scene.duration, measured ?? scene.duration),
        x: 0,
        y: 0,
        width: doc.width,
        height: doc.height,
        animation: "none" as const,
      };
      await run({ type: "element.add", sceneId: scene.id, element: el });
      setElementId(el.id);
      setPane("edit");
    } catch (e) {
      setError(message(e));
    }
  }
  async function importAsset(asset: AssetLibraryItem) {
    try {
      const uploaded = await api.importLibraryAsset(asset.id, project.id);
      const latest = await api.getProjectMedia(project.id);
      setMedia(latest);
      const imported = latest.assets.find(
        (item) => item.hyperframesPath === uploaded.path,
      );
      if (imported) await addMedia(imported);
      else {
        setMediaScope("project");
        setError("素材已导入，请从项目素材中选择。");
      }
    } catch (e) {
      setError(message(e));
    }
  }
  async function upload(files: File[]) {
    setError("");
    try {
      for (const file of files) await api.uploadAsset(project.id, file);
      setMedia(await api.getProjectMedia(project.id));
      setPane("media");
      setPanelOpen(true);
    } catch (e) {
      setError(message(e));
    }
  }
  async function checkpoint() {
    await commandsRef.current;
    const current = stateRef.current;
    if (!current || busyRef.current || running) return;
    setSaving(true);
    busyRef.current = true;
    setError("");
    try {
      const version = await editorApi.checkpoint(project.id, current.revision);
      setExportVersion(version.versionId);
      await onRefresh();
      setPane("export");
      setPanelOpen(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }
  async function restore(versionId: string) {
    if (!composition || busyRef.current) return;
    setSaving(true);
    busyRef.current = true;
    try {
      setComposition(
        await editorApi.restore(project.id, composition.revision, versionId),
      );
      await onRefresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
      busyRef.current = false;
    }
  }
  const html = useMemo(
    () =>
      doc
        ? compileHTML(doc, {
            interactive: true,
            assetUrl: (p) =>
              new URL(api.fileUrl(project.id, p), location.origin).href,
            gsapUrl: new URL(gsapUrl, location.origin).href,
            fontCss,
          })
        : "",
    [doc, project.id],
  );
  const scale = doc
    ? Math.max(
        0.05,
        Math.min(
          (size.width - 48) / doc.width,
          (size.height - 48) / doc.height,
        ),
      )
    : 1;
  const activeScene =
      scenes.find((s) => time >= s.start && time < s.start + s.duration) ??
      scenes.at(-1),
    visibleSelection =
      element &&
      activeScene &&
      scene?.id === activeScene?.id &&
      time >= activeScene.start + element.start &&
      time < activeScene.start + element.start + element.duration;
  function dragElement(
    event: ReactPointerEvent<HTMLButtonElement>,
    resize = false,
  ) {
    if (!element || !scene || saving || running) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX,
      startY = event.clientY,
      original = { ...element },
      parent = target.closest(".editor-selection") as HTMLElement;
    let patch: Partial<EditorElement> = {};
    const move = (e: PointerEvent) => {
      let dx = (e.clientX - startX) / scale,
        dy = (e.clientY - startY) / scale;
      if (snapping) {
        dx = Math.round(dx / 8) * 8;
        dy = Math.round(dy / 8) * 8;
      }
      patch = resize
        ? {
            width: Math.max(8, original.width + dx),
            height: Math.max(8, original.height + dy),
          }
        : { x: original.x + dx, y: original.y + dy };
      Object.assign(
        parent.style,
        resize
          ? {
              width: `${patch.width! * scale}px`,
              height: `${patch.height! * scale}px`,
            }
          : { left: `${patch.x! * scale}px`, top: `${patch.y! * scale}px` },
      );
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", cancel);
      if (Object.keys(patch).length) updateElement(patch);
    };
    const cancel = () => {
      Object.assign(parent.style, {
        left: `${original.x * scale}px`,
        top: `${original.y * scale}px`,
        width: `${original.width * scale}px`,
        height: `${original.height * scale}px`,
      });
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", cancel);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", cancel);
  }
  const version = project.manifest.versions.find(
    (v) => v.id === (exportVersion || project.manifest.currentDraft),
  );
  if (legacyOpen)
    return (
      <div className="editor-legacy">
        <button className="editor-return" onClick={() => setLegacyOpen(false)}>
          <ArrowLeft />
          返回时间线编辑器
        </button>
        {legacy}
      </div>
    );
  return (
    <div
      className={`motion-editor ${panelOpen ? "" : "is-panel-collapsed"} ${resizingPanel ? "is-resizing-panel" : ""}`}
      style={
        {
          "--editor-panel-width": `${panelLayout.width}px`,
        } as import("react").CSSProperties
      }
    >
      <header className="editor-header">
        <button
          className="editor-brand"
          onClick={onBack}
          aria-label="返回所有项目"
        >
          <img src="/brand/yingya-ghost.png" alt="" />
          <b>映芽</b>
        </button>
        <span className="editor-header-separator" />
        <input
          aria-label="项目名称"
          className="editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== project.title)
              void onRename(project.id, title.trim()).catch((e) =>
                setError(message(e)),
              );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setTitle(project.title);
              e.currentTarget.blur();
            }
          }}
        />
        <span className="editor-save-state" role="status">
          {saving ? (
            "正在保存…"
          ) : composition ? (
            <>
              <Check />
              已保存
            </>
          ) : (
            project.statusLabel
          )}
        </span>
        <div className="editor-history-actions">
          <button
            aria-label="撤销"
            title="撤销 ⌘/Ctrl Z"
            disabled={!composition?.canUndo || saving || running}
            onClick={() => void run({ type: "undo" })}
          >
            <ArrowCounterClockwise />
          </button>
          <button
            aria-label="重做"
            title="重做 ⌘/Ctrl Shift Z"
            disabled={!composition?.canRedo || saving || running}
            onClick={() => void run({ type: "redo" })}
          >
            <ArrowClockwise />
          </button>
        </div>
        <button
          onClick={() => {
            setPane("versions");
            setPanelOpen(true);
          }}
          className="editor-version-button"
        >
          <ClockCounterClockwise />
          版本
        </button>
        <button
          className="primary-button"
          disabled={saving || running}
          onClick={() =>
            doc?.scenes.length
              ? void checkpoint()
              : (setPane("export"), setPanelOpen(true))
          }
        >
          <DownloadSimple />
          导出 / 分享
        </button>
      </header>
      <nav className="editor-rail" aria-label="制作工具">
        {tools.map((tool) => (
          <button
            key={tool.id}
            aria-pressed={pane === tool.id && panelOpen}
            onClick={() => {
              setPanelOpen(pane === tool.id ? !panelOpen : true);
              setPane(tool.id);
            }}
          >
            <tool.icon size={22} />
            <span>{tool.label}</span>
          </button>
        ))}
      </nav>
      <aside
        className="editor-panel"
        hidden={!panelOpen}
        aria-label={tools.find((t) => t.id === pane)?.label ?? "导出"}
      >
        <header>
          <h2>{tools.find((t) => t.id === pane)?.label ?? "导出与分享"}</h2>
          <button aria-label="折叠工具面板" onClick={() => setPanelOpen(false)}>
            <X />
          </button>
        </header>
        <div
          className={`editor-panel-content ${pane === "chat" ? "editor-chat" : ""}`}
        >
          <div hidden={pane !== "chat"} className="editor-chat-slot">
            {chat}
          </div>
          {pane === "edit" ? (
            <>
              {!composition ? (
                <div className="editor-empty">
                  <SlidersHorizontal />
                  <h3>从一个镜头开始</h3>
                  <p>添加文字、图片或视频，在画布上直接调整。</p>
                  <button
                    disabled={saving || running}
                    onClick={() => void initialize("minimal-product")}
                  >
                    添加可编辑镜头
                  </button>
                  {project.manifest.versions.length ? (
                    <button onClick={() => setLegacyOpen(true)}>
                      查看原有作品
                    </button>
                  ) : null}
                </div>
              ) : !scene ? (
                <div className="editor-empty">
                  <p>时间线还是空的。</p>
                  <button onClick={() => addScene()}>添加空白镜头</button>
                </div>
              ) : (
                <>
                  <label className="editor-field">
                    镜头名称
                    <CommitInput
                      key={scene.id + "name"}
                      value={scene.name}
                      onCommit={(name) =>
                        void run({
                          type: "scene.update",
                          sceneId: scene.id,
                          patch: { name },
                        })
                      }
                    />
                  </label>
                  <div className="editor-field-grid">
                    <NumberField
                      label="镜头时长（秒）"
                      value={scene.duration}
                      min={0.1}
                      max={3600}
                      onCommit={(duration) =>
                        void run({
                          type: "scene.update",
                          sceneId: scene.id,
                          patch: { duration },
                        })
                      }
                    />
                    <label className="editor-field">
                      背景
                      <input
                        type="color"
                        aria-label="镜头背景"
                        value={scene.background}
                        onChange={(e) =>
                          void run({
                            type: "scene.update",
                            sceneId: scene.id,
                            patch: { background: e.target.value },
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="editor-section-title">
                    <h3>图层</h3>
                    <button aria-label="添加文字" onClick={addText}>
                      <TextT />
                    </button>
                  </div>
                  <div className="editor-layer-list">
                    {scene.elements.map((el) => (
                      <button
                        key={el.id}
                        aria-pressed={elementId === el.id}
                        onClick={() => {
                          setElementId(el.id);
                          const s = scenes.find((s) => s.id === scene.id)!;
                          seek(
                            s.start + el.start + Math.min(0.7, el.duration / 2),
                          );
                        }}
                      >
                        <span>{el.name || el.kind}</span>
                        <small>{timeLabel(el.start)}</small>
                      </button>
                    ))}
                  </div>
                  {element ? (
                    <>
                      <div className="editor-section-title">
                        <h3>选中元素</h3>
                        <button
                          aria-label="删除选中元素"
                          onClick={() =>
                            void run({
                              type: "element.remove",
                              sceneId: scene.id,
                              elementId: element.id,
                            })
                          }
                        >
                          <Trash />
                        </button>
                      </div>
                      <div className="editor-field-grid">
                        <label className="editor-field">
                          所在轨道
                          <select
                            value={element.trackId}
                            onChange={(e) =>
                              updateElement({ trackId: e.target.value })
                            }
                          >
                            {doc?.tracks
                              .filter(
                                (track) =>
                                  track.kind ===
                                  (element.kind === "audio"
                                    ? "audio"
                                    : element.kind === "text"
                                      ? "text"
                                      : "visual"),
                              )
                              .map((track) => (
                                <option
                                  key={track.id}
                                  value={track.id}
                                  disabled={track.locked}
                                >
                                  {track.name}
                                  {track.locked ? " · 已锁定" : ""}
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="editor-field">
                          <span>图层顺序</span>
                          <div className="editor-brand-actions">
                            <button
                              aria-label="图层移到最前"
                              onClick={() =>
                                void run({
                                  type: "element.move",
                                  sceneId: scene.id,
                                  elementId: element.id,
                                  index: scene.elements.length - 1,
                                })
                              }
                            >
                              置顶
                            </button>
                            <button
                              aria-label="图层移到最后"
                              onClick={() =>
                                void run({
                                  type: "element.move",
                                  sceneId: scene.id,
                                  elementId: element.id,
                                  index: 0,
                                })
                              }
                            >
                              置底
                            </button>
                          </div>
                        </div>
                      </div>
                      {element.kind === "text" ? (
                        <>
                          <label className="editor-field">
                            文字内容
                            <CommitInput
                              key={element.id + "text"}
                              multiline
                              value={element.text}
                              onCommit={(text) => updateElement({ text })}
                            />
                          </label>
                          <div className="editor-field-grid">
                            <NumberField
                              label="字号"
                              value={element.fontSize}
                              min={8}
                              max={600}
                              onCommit={(fontSize) =>
                                updateElement({ fontSize })
                              }
                            />
                            <label className="editor-field">
                              字体
                              <select
                                value={element.font}
                                onChange={(e) =>
                                  updateElement({
                                    font: e.target
                                      .value as EditorElement["font"],
                                  })
                                }
                              >
                                <option value="sans">无衬线</option>
                                <option value="serif">衬线</option>
                                <option value="mono">等宽</option>
                              </select>
                            </label>
                            <label className="editor-field">
                              字重
                              <select
                                value={element.fontWeight}
                                onChange={(e) =>
                                  updateElement({
                                    fontWeight: Number(e.target.value),
                                  })
                                }
                              >
                                {[400, 500, 600, 700, 800, 900].map((w) => (
                                  <option key={w} value={w}>
                                    {w}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="editor-field">
                              对齐
                              <select
                                value={element.align}
                                onChange={(e) =>
                                  updateElement({
                                    align: e.target
                                      .value as EditorElement["align"],
                                  })
                                }
                              >
                                <option value="left">左对齐</option>
                                <option value="center">居中</option>
                                <option value="right">右对齐</option>
                              </select>
                            </label>
                          </div>
                        </>
                      ) : null}
                      <div className="editor-field-grid">
                        {(
                          [
                            "x",
                            "y",
                            "width",
                            "height",
                            "rotation",
                            "opacity",
                          ] as const
                        ).map((key) => (
                          <NumberField
                            key={element.id + key}
                            label={
                              {
                                x: "横向位置",
                                y: "纵向位置",
                                width: "宽度",
                                height: "高度",
                                rotation: "旋转",
                                opacity: "不透明度",
                              }[key]
                            }
                            value={element[key]}
                            min={
                              key === "opacity"
                                ? 0
                                : key === "width" || key === "height"
                                  ? 1
                                  : -8192
                            }
                            max={key === "opacity" ? 1 : 8192}
                            onCommit={(value) =>
                              updateElement({ [key]: value })
                            }
                          />
                        ))}
                        <label className="editor-field">
                          {element.kind === "shape" ? "填色" : "文字颜色"}
                          <input
                            type="color"
                            value={
                              element.kind === "shape"
                                ? element.fill
                                : element.color
                            }
                            onChange={(e) =>
                              updateElement(
                                element.kind === "shape"
                                  ? { fill: e.target.value }
                                  : { color: e.target.value },
                              )
                            }
                          />
                        </label>
                        <NumberField
                          label="圆角"
                          value={element.radius}
                          min={0}
                          max={4096}
                          onCommit={(radius) => updateElement({ radius })}
                        />
                      </div>
                      <div className="editor-field-grid">
                        <NumberField
                          label="开始（秒）"
                          value={element.start}
                          min={0}
                          max={scene.duration}
                          onCommit={(start) => updateElement({ start })}
                        />
                        <NumberField
                          label="持续（秒）"
                          value={element.duration}
                          min={0.05}
                          max={scene.duration}
                          onCommit={(duration) => updateElement({ duration })}
                        />
                      </div>
                      {["video", "audio"].includes(element.kind) ? (
                        <div className="editor-field-grid">
                          <NumberField
                            label="素材入点（秒）"
                            value={element.sourceIn}
                            min={0}
                            max={element.sourceDuration ?? 0}
                            onCommit={(sourceIn) => updateElement({ sourceIn })}
                          />
                          <NumberField
                            label="音量"
                            value={element.volume}
                            min={0}
                            max={1}
                            onCommit={(volume) => updateElement({ volume })}
                          />
                        </div>
                      ) : null}
                      {["video", "image"].includes(element.kind) ? (
                        <label className="editor-field">
                          画面适配
                          <select
                            value={element.fit}
                            onChange={(e) =>
                              updateElement({
                                fit: e.target.value as EditorElement["fit"],
                              })
                            }
                          >
                            <option value="contain">完整显示</option>
                            <option value="cover">填满画布</option>
                          </select>
                        </label>
                      ) : null}
                      <label className="editor-field">
                        入场动画
                        <select
                          value={element.animation}
                          onChange={(e) =>
                            updateElement({
                              animation: e.target
                                .value as EditorElement["animation"],
                            })
                          }
                        >
                          <option value="none">无动画</option>
                          <option value="fade">淡入</option>
                          <option value="rise">上移淡入</option>
                          <option value="scale">缩放出现</option>
                        </select>
                      </label>
                      <button
                        onClick={() => {
                          setPane("chat");
                          onCompose(
                            `请调整「${scene.name}」中的「${element.name}」：`,
                          );
                        }}
                      >
                        让 AI 调整这个元素
                      </button>
                    </>
                  ) : (
                    <p className="editor-hint">
                      点选画布或图层，调整文字、尺寸与时间。
                    </p>
                  )}
                </>
              )}
            </>
          ) : null}
          {pane === "media" || pane === "audio" ? (
            <>
              <div
                className="editor-media-tabs"
                role="group"
                aria-label="素材来源"
              >
                <button
                  aria-pressed={mediaScope === "project"}
                  onClick={() => setMediaScope("project")}
                >
                  项目素材
                </button>
                <button
                  aria-pressed={mediaScope === "library"}
                  onClick={() => setMediaScope("library")}
                >
                  素材库
                </button>
              </div>
              <button
                className="editor-upload"
                onClick={() => fileRef.current?.click()}
              >
                <UploadSimple />
                上传图片、视频或音频
              </button>
              <input
                className="editor-search"
                aria-label="搜索项目素材"
                placeholder="搜索项目素材"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="editor-media-grid">
                {mediaScope === "library"
                  ? libraryAssets
                      .filter(
                        (a) =>
                          (pane !== "audio" || a.category === "audio") &&
                          (a.sourceName ?? a.prompt ?? "")
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((asset) => (
                        <button
                          key={asset.id}
                          disabled={!scene || saving || running}
                          onClick={() => void importAsset(asset)}
                        >
                          {asset.category === "image" ? (
                            <img src={asset.url} alt="" />
                          ) : asset.category === "video" ? (
                            <video src={asset.url} muted preload="metadata" />
                          ) : (
                            <SpeakerHigh size={32} />
                          )}
                          <span>
                            {asset.sourceName ?? asset.prompt ?? "素材"}
                          </span>
                          <small>导入并插入</small>
                        </button>
                      ))
                  : media.assets
                      .filter(
                        (a) =>
                          (pane !== "audio" ||
                            a.mediaType?.startsWith("audio/")) &&
                          a.name.toLowerCase().includes(search.toLowerCase()),
                      )
                      .map((asset) => (
                        <button
                          key={asset.id}
                          disabled={!scene || saving || running}
                          onClick={() => void addMedia(asset)}
                          title={
                            !scene ? "先添加一个镜头" : `插入 ${asset.name}`
                          }
                        >
                          {asset.mediaType?.startsWith("image/") ? (
                            <img
                              src={api.fileUrl(
                                project.id,
                                asset.hyperframesPath,
                              )}
                              alt=""
                            />
                          ) : asset.mediaType?.startsWith("video/") ? (
                            <video
                              src={api.fileUrl(
                                project.id,
                                asset.hyperframesPath,
                              )}
                              muted
                              preload="metadata"
                            />
                          ) : (
                            <SpeakerHigh size={32} />
                          )}
                          <span>{asset.name}</span>
                          <small>插入当前镜头</small>
                        </button>
                      ))}
              </div>
              {!media.assets.length ? (
                <p className="editor-hint">
                  上传素材后可插入镜头，也可以在 AI 对话中描述要生成的画面。
                </p>
              ) : null}
              <button
                onClick={() => {
                  setPane("chat");
                  onCompose(
                    pane === "audio"
                      ? "请为当前视频制作旁白或背景音乐："
                      : "请为当前镜头生成一段素材：",
                  );
                }}
              >
                用 AI 制作{pane === "audio" ? "声音" : "素材"}
              </button>
            </>
          ) : null}
          {pane === "templates" ? (
            <>
              {scene && composition ? (
                <button
                  disabled={saving || running}
                  onClick={() =>
                    void editorApi
                      .saveTemplate(
                        project.id,
                        composition.revision,
                        scene.id,
                        scene.name,
                      )
                      .then(loadLibrary)
                      .catch((e) => setError(message(e)))
                  }
                >
                  <FloppyDisk />
                  将当前镜头存为模板
                </button>
              ) : null}
              {library.templates.length ? (
                <div className="editor-saved-templates">
                  <h3>我的模板</h3>
                  {library.templates.map((item) => (
                    <article key={item.id}>
                      <b>{item.name}</b>
                      <button
                        disabled={!doc || saving || running}
                        onClick={() =>
                          void editorApi
                            .loadTemplate(project.id, item.id)
                            .then((result) => run(result.command))
                            .catch((e) => setError(message(e)))
                        }
                      >
                        插入镜头
                      </button>
                      <button
                        aria-label={`删除模板 ${item.name}`}
                        onClick={() =>
                          void editorApi
                            .removeLibraryItem(project.id, "templates", item)
                            .then(loadLibrary)
                            .catch((e) => setError(message(e)))
                        }
                      >
                        <Trash />
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
              <input
                className="editor-search"
                aria-label="搜索模板"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索风格或模板"
              />
              <div className="editor-template-grid">
                {styles
                  .filter((s) => `${s.name}${s.category}`.includes(search))
                  .map((style) => (
                    <button
                      key={style.id}
                      disabled={saving || running}
                      onClick={() => addScene(style.id)}
                    >
                      <img
                        src={`/editor-styles/${style.id}.png`}
                        alt={`${style.name}镜头预览`}
                      />
                      <b>{style.name}</b>
                      <small>{style.description}</small>
                      <span>
                        <Plus />
                        插入镜头
                      </span>
                    </button>
                  ))}
              </div>
            </>
          ) : null}
          {pane === "footage" ? (
            <FootagePanel
              projectId={project.id}
              assets={media.assets}
              canInsert={Boolean(scene) && !saving && !running}
              onInsert={addMedia}
            />
          ) : null}
          {pane === "brand" ? (
            <BrandPanel
              assets={media.assets}
              projectId={project.id}
              brands={library.brands}
              onRefresh={loadLibrary}
              onError={setError}
              disabled={!doc || saving || running}
              onApply={(brand) => {
                void (async () => {
                  const loaded =
                    brand.logoPath && brand.logoSource === undefined
                      ? (await editorApi.loadBrand(project.id, brand.id)).brand
                      : brand;
                  await run({
                    type: "brand.apply",
                    brand: { ...brand, logoSource: loaded.logoSource },
                  });
                })().catch((e) => setError(message(e)));
              }}
            />
          ) : null}
          {pane === "versions" ? (
            <>
              <p className="editor-hint">
                保存的版本可独立导出。恢复后仍能撤销。
              </p>
              <button
                disabled={!doc?.scenes.length || saving || running}
                onClick={() => void checkpoint()}
              >
                <FloppyDisk />
                保存当前版本
              </button>
              <div className="editor-version-list">
                {[...project.manifest.versions].reverse().map((v) => (
                  <article key={v.id}>
                    <b>{v.label}</b>
                    <small>
                      {new Date(v.createdAt).toLocaleString("zh-CN")}
                    </small>
                    <div>
                      {v.id.startsWith("editor-") ? (
                        <button
                          disabled={!composition || saving || running}
                          onClick={() => void restore(v.id)}
                        >
                          恢复
                        </button>
                      ) : (
                        <button onClick={() => setLegacyOpen(true)}>
                          查看原版
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setExportVersion(v.id);
                          setPane("export");
                        }}
                      >
                        导出 / 分享
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <button onClick={() => setLegacyOpen(true)}>
                打开原有作品与制作记录
              </button>
            </>
          ) : null}
          {pane === "export" ? (
            version ? (
              <PersistentRenderPanel
                project={project}
                version={version}
                videoPath={
                  project.renderJobs.find(
                    (job) =>
                      job.versionId === version.id &&
                      job.status === "completed",
                  )?.outputPath ??
                  (version.id.startsWith("editor-")
                    ? undefined
                    : version.videoPath)
                }
                exportRequest={1}
                onRefresh={onRefresh}
                onGeneratePreview={() => {
                  setPane("chat");
                  onCompose("请生成当前版本的预览视频。");
                }}
                generationDisabled={running}
              />
            ) : (
              <div className="editor-empty">
                <DownloadSimple />
                <h3>先完成一个镜头</h3>
                <p>保存版本后可以导出 MP4，并为成片创建分享链接。</p>
              </div>
            )
          ) : null}
        </div>
        <div
          className="editor-panel-resizer"
          role="separator"
          aria-label="调整工具面板宽度"
          aria-orientation="vertical"
          aria-valuemin={panelLayout.min}
          aria-valuemax={panelLayout.max}
          aria-valuenow={Math.round(panelLayout.width)}
          tabIndex={panelOpen ? 0 : -1}
          title="拖动调整宽度，双击恢复默认；方向键可微调"
          onDoubleClick={panelLayout.reset}
          onKeyDown={(event) => {
            let next: number | undefined;
            if (event.key === "ArrowLeft")
              next = panelLayout.width - (event.shiftKey ? 64 : 16);
            if (event.key === "ArrowRight")
              next = panelLayout.width + (event.shiftKey ? 64 : 16);
            if (event.key === "Home") next = panelLayout.min;
            if (event.key === "End") next = panelLayout.max;
            if (event.key === "Enter") {
              event.preventDefault();
              panelLayout.reset();
            }
            if (next !== undefined) {
              event.preventDefault();
              panelLayout.change(next);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            panelDrag.current = { x: event.clientX, width: panelLayout.width };
            setResizingPanel(true);
          }}
          onPointerMove={(event) => {
            if (panelDrag.current)
              panelLayout.change(
                panelDrag.current.width + event.clientX - panelDrag.current.x,
                false,
              );
          }}
          onPointerUp={(event) => {
            if (!panelDrag.current) return;
            panelLayout.change(
              panelDrag.current.width + event.clientX - panelDrag.current.x,
            );
            panelDrag.current = null;
            setResizingPanel(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            panelDrag.current = null;
            setResizingPanel(false);
          }}
          onPointerCancel={() => {
            if (panelDrag.current)
              panelLayout.change(panelDrag.current.width, false);
            panelDrag.current = null;
            setResizingPanel(false);
          }}
        />
      </aside>
      <main className="editor-main">
        <div className="editor-canvas-toolbar">
          {doc ? (
            <select
              aria-label="工程画幅"
              disabled={saving || running}
              value={
                doc.width === doc.height
                  ? "1:1"
                  : doc.width > doc.height
                    ? "16:9"
                    : "9:16"
              }
              onChange={(e) => {
                const size = emptyDocument(e.target.value);
                void run({
                  type: "document.resize",
                  width: size.width,
                  height: size.height,
                });
              }}
            >
              <option value="16:9">16:9 横屏</option>
              <option value="9:16">9:16 竖屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          ) : (
            <span>{project.aspectRatio}</span>
          )}
          <button
            disabled={!doc?.scenes.length}
            aria-pressed={safeArea}
            onClick={() => setSafeArea(!safeArea)}
          >
            安全区
          </button>
          <span>
            {composition ? `修订 ${composition.revision}` : "作品画布"}
          </span>
        </div>
        {error ? (
          <div className="editor-error" role="alert">
            <span>{error}</span>
            <button onClick={() => void refresh()}>重新读取</button>
            <button aria-label="关闭错误提示" onClick={() => setError("")}>
              <X />
            </button>
          </div>
        ) : null}
        <div
          className="editor-stage"
          ref={stageRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          {fallbackSource ? (
            <div className="editor-saved-preview">
              <video
                key={fallbackSource}
                ref={videoRef}
                src={fallbackSource}
                controls
                playsInline
                preload="metadata"
                aria-label="已有作品预览"
                onLoadedMetadata={(event) => {
                  const n = event.currentTarget.duration;
                  if (Number.isFinite(n)) setPreviewDuration(n);
                }}
                onTimeUpdate={(event) =>
                  setTime(event.currentTarget.currentTime)
                }
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() =>
                  setError("这个版本的视频暂时无法读取，可重试或打开原有作品。")
                }
              />
              <div>
                <span>
                  {loading
                    ? "正在读取工程，先预览已保存的视频"
                    : "已保存的视频；可在对话中继续修改"}
                </span>
                <button onClick={() => setLegacyOpen(true)}>
                  原有作品与工具
                </button>
                <button onClick={() => videoRef.current?.load()}>
                  重新加载视频
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="editor-loading" role="status">
              <p>正在打开工程…</p>
              <button
                onClick={() => {
                  readRequest.current?.abort();
                  readRequest.current = null;
                  void refresh();
                }}
              >
                重新读取工程
              </button>
            </div>
          ) : doc?.scenes.length ? (
            <div
              className="editor-frame-shell"
              style={{ width: doc.width * scale, height: doc.height * scale }}
            >
              <iframe
                title="实时作品画布"
                ref={frameRef}
                sandbox="allow-scripts allow-same-origin"
                srcDoc={html}
                style={{
                  width: doc.width,
                  height: doc.height,
                  transform: `scale(${scale})`,
                }}
              />
              {safeArea ? (
                <div className="editor-safe-area" aria-label="字幕安全区" />
              ) : null}
              {visibleSelection && element ? (
                <div
                  className="editor-selection"
                  style={{
                    left: element.x * scale,
                    top: element.y * scale,
                    width: element.width * scale,
                    height: element.height * scale,
                    transform: `rotate(${element.rotation}deg)`,
                  }}
                >
                  <button
                    aria-label="拖动选中元素，或用方向键移动"
                    className="editor-drag-handle"
                    onPointerDown={(e) => dragElement(e)}
                  />
                  <button
                    aria-label="拖动调整元素尺寸"
                    className="editor-resize-handle"
                    onPointerDown={(e) => dragElement(e, true)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className="editor-canvas-empty"
              style={{
                width: Math.max(
                  200,
                  Math.min(size.width - 48, ((size.height - 48) * 16) / 9),
                ),
                aspectRatio: "16 / 9",
              }}
            >
              <img src="/brand/yingya-ghost.png" alt="" />
              <h2>{running ? "正在把想法变成画面" : "给你的想法，一个画面"}</h2>
              <p>
                {running
                  ? "制作进展会同步到对话与画布。"
                  : "从一个模板开始，或把素材拖到这里。"}
              </p>
              <div>
                <button
                  disabled={saving || running}
                  onClick={() => addScene("minimal-product")}
                >
                  <Plus />
                  添加镜头
                </button>
                <button
                  onClick={() => {
                    setPane("templates");
                    setPanelOpen(true);
                  }}
                >
                  浏览模板
                </button>
                {project.manifest.versions.length ? (
                  <button onClick={() => setLegacyOpen(true)}>
                    查看已有作品
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="editor-playback">
          <button
            aria-label={playing ? "暂停" : "播放"}
            disabled={!duration}
            onClick={() => seek(time >= duration ? 0 : time, !playing)}
          >
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <time>
            {timeLabel(time)} <span>/ {timeLabel(duration)}</span>
          </time>
          <input
            type="range"
            aria-label="播放位置"
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(time, duration)}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
          >
            {collapsed ? <CaretUp /> : <CaretDown />}
            <span>时间线</span>
          </button>
        </div>
        <section
          className={`editor-timeline ${collapsed ? "is-collapsed" : ""}`}
          aria-label="视频时间线"
        >
          <div className="editor-timeline-toolbar">
            <button disabled={saving || running} onClick={() => addScene()}>
              <Plus />
              镜头
            </button>
            <button disabled={!scene || saving || running} onClick={addText}>
              <TextT />
              文字
            </button>
            <button
              disabled={!scene || saving || running}
              onClick={() => {
                if (!scene) return;
                const scheduled = scenes.find((s) => s.id === scene.id)!;
                void run({
                  type: "scene.split",
                  sceneId: scene.id,
                  at: time - scheduled.start,
                  newSceneId: uid(),
                });
              }}
              title="在播放头处切分当前镜头"
            >
              <Scissors />
              切分
            </button>
            <button
              disabled={!scene || saving || running}
              aria-label="复制选中镜头"
              onClick={() => {
                if (!doc || !scene) return;
                const id = uid();
                void run({
                  type: "scene.add",
                  index: doc.scenes.indexOf(scene) + 1,
                  scene: {
                    ...structuredClone(scene),
                    id,
                    name: scene.name + " · 副本",
                    elements: scene.elements.map((e, i) => ({
                      ...e,
                      id: `${id}-${i}`,
                    })),
                  },
                });
              }}
            >
              <Copy />
            </button>
            <button
              disabled={!scene || saving || running}
              aria-label="删除选中镜头"
              onClick={() =>
                scene && void run({ type: "scene.remove", sceneId: scene.id })
              }
            >
              <Trash />
            </button>
            <details className="editor-add-menu">
              <summary>添加与导入</summary>
              <div>
                <button
                  disabled={!scene || saving || running}
                  onClick={addShape}
                >
                  添加图形
                </button>
                <label>
                  新轨道
                  <select
                    defaultValue=""
                    aria-label="添加轨道"
                    disabled={!doc || saving || running}
                    onChange={(e) => {
                      const kind = e.target.value as
                        "visual" | "text" | "audio";
                      if (kind)
                        void run({
                          type: "track.add",
                          track: {
                            id: uid(),
                            name: {
                              visual: "画面",
                              text: "文字",
                              audio: "声音",
                            }[kind],
                            kind,
                            muted: false,
                            locked: false,
                          },
                        });
                      e.target.value = "";
                    }}
                  >
                    <option value="">选择类型</option>
                    <option value="visual">画面</option>
                    <option value="text">文字</option>
                    <option value="audio">声音</option>
                  </select>
                </label>
                <label className="editor-json-import">
                  导入工程 JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={saving || running}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importDocument(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button disabled={!doc} onClick={downloadDocument}>
                  下载工程 JSON
                </button>
              </div>
            </details>
            <button
              aria-pressed={snapping}
              onClick={() => setSnapping(!snapping)}
            >
              吸附
            </button>
            <label className="editor-zoom">
              <ArrowsHorizontal />
              <input
                type="range"
                min={24}
                max={160}
                value={zoom}
                aria-label="时间线缩放"
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
          </div>
          {!collapsed ? (
            <div className="editor-timeline-scroll">
              <div
                className="editor-timeline-content"
                style={{ width: Math.max(600, duration * zoom + 150) }}
              >
                <div className="editor-ruler">
                  <span>时间</span>
                  {Array.from(
                    {
                      length: Math.min(
                        181,
                        Math.ceil(
                          duration / Math.max(1, Math.ceil(duration / 180)),
                        ) + 1,
                      ),
                    },
                    (_, i) => i * Math.max(1, Math.ceil(duration / 180)),
                  ).map((t) => (
                    <button
                      key={t}
                      style={{ left: 120 + t * zoom }}
                      onClick={() => seek(t)}
                    >
                      {timeLabel(t)}
                    </button>
                  ))}
                </div>
                <div className="editor-scene-row">
                  <b>{fallbackSource ? "已保存视频" : "镜头"}</b>
                  {fallbackSource && previewDuration > 0 ? (
                    <div className="editor-scene-clip" style={{ left: 120, width: Math.max(12, previewDuration * zoom - 4) }}>
                      <button onClick={() => seek(0)}>已保存版本 · 视频预览</button>
                    </div>
                  ) : null}
                  {scenes.map((s, i) => (
                    <div
                      key={s.id}
                      className={`editor-scene-clip ${scene?.id === s.id ? "is-selected" : ""}`}
                      style={{
                        left: 120 + s.start * zoom,
                        width: Math.max(12, s.duration * zoom - 4),
                      }}
                      draggable={!saving && !running}
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/x-yingya-scene",
                          s.id,
                        )
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData(
                          "application/x-yingya-scene",
                        );
                        if (id)
                          void run({
                            type: "scene.move",
                            sceneId: id,
                            index: i,
                          });
                      }}
                    >
                      <button
                        onClick={() => {
                          setSceneId(s.id);
                          setElementId("");
                          seek(s.start + Math.min(0.7, s.duration / 2));
                        }}
                      >
                        {String(i + 1).padStart(2, "0")} · {s.name}
                      </button>
                      <div>
                        <button
                          aria-label={`前移 ${s.name}`}
                          disabled={i === 0}
                          onClick={() =>
                            void run({
                              type: "scene.move",
                              sceneId: s.id,
                              index: i - 1,
                            })
                          }
                        >
                          <ArrowUp />
                        </button>
                        <button
                          aria-label={`后移 ${s.name}`}
                          disabled={i === scenes.length - 1}
                          onClick={() =>
                            void run({
                              type: "scene.move",
                              sceneId: s.id,
                              index: i + 1,
                            })
                          }
                        >
                          <ArrowDown />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {doc?.tracks.map((track) => (
                  <TimelineTrack
                    key={track.id}
                    track={track}
                    scenes={scenes}
                    zoom={zoom}
                    snapping={snapping}
                    selected={elementId}
                    disabled={saving || running}
                    onCommand={(command) => void run(command)}
                    onSelect={(s, el) => {
                      setSceneId(s.id);
                      setElementId(el.id);
                      setPane("edit");
                      setPanelOpen(true);
                      seek(s.start + el.start + Math.min(0.7, el.duration / 2));
                    }}
                  />
                ))}
                <div
                  className="editor-playhead"
                  style={{ left: 120 + time * zoom }}
                />
              </div>
            </div>
          ) : null}
        </section>
      </main>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void upload(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
function CommitInput({
  value,
  onCommit,
  multiline = false,
}: {
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (draft !== value) onCommit(draft);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(value);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? (
    <textarea aria-label="文字内容" rows={4} {...props} />
  ) : (
    <input {...props} />
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(number(value)));
  useEffect(() => setDraft(String(number(value))), [value]);
  return (
    <label className="editor-field">
      {label}
      <input
        type="number"
        step="any"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (
            draft !== "" &&
            Number.isFinite(next) &&
            next >= min &&
            next <= max
          ) {
            if (next !== value) onCommit(next);
          } else setDraft(String(number(value)));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function BrandPanel({
  assets,
  projectId,
  brands,
  onRefresh,
  onError,
  disabled,
  onApply,
}: {
  assets: AgentMedia["assets"];
  projectId: string;
  brands: BrandKit[];
  onRefresh: () => Promise<void>;
  onError: (error: string) => void;
  disabled: boolean;
  onApply: (brand: BrandKit) => void;
}) {
  const [brand, setBrand] = useState<BrandKit>(() => ({
      id: uid(),
      revision: 0,
      name: "我的品牌",
      foreground: "#24262b",
      background: "#ffffff",
      accent: "#006bd6",
      font: "sans",
    })),
    [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const result = await editorApi.saveBrand(projectId, brand);
      setBrand(result.brand);
      await onRefresh();
    } catch (e) {
      onError(message(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <p className="editor-hint">
        保存品牌标识、配色与字体，在不同项目中重复使用。
      </p>
      <label className="editor-field">
        选择品牌
        <select
          value={brands.some((b) => b.id === brand.id) ? brand.id : ""}
          onChange={(e) => {
            const selected = brands.find((b) => b.id === e.target.value);
            setBrand(
              selected ?? { ...brand, id: uid(), revision: 0, name: "新品牌" },
            );
          }}
        >
          <option value="">新建品牌</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="editor-field">
        品牌名称
        <input
          value={brand.name}
          onChange={(e) => setBrand({ ...brand, name: e.target.value })}
        />
      </label>
      <div className="editor-field-grid">
        {(["foreground", "background", "accent"] as const).map((key) => (
          <label key={key} className="editor-field">
            {
              {
                foreground: "文字颜色",
                background: "背景颜色",
                accent: "强调色",
              }[key]
            }
            <input
              type="color"
              value={brand[key]}
              onChange={(e) => setBrand({ ...brand, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="editor-field">
        品牌字体
        <select
          value={brand.font}
          onChange={(e) =>
            setBrand({ ...brand, font: e.target.value as BrandKit["font"] })
          }
        >
          <option value="sans">无衬线</option>
          <option value="serif">衬线</option>
          <option value="mono">等宽</option>
        </select>
      </label>
      <label className="editor-field">
        品牌标识
        <select
          value={brand.logoSource ?? (brand.logoPath ? "__saved__" : "")}
          onChange={(e) =>
            setBrand({
              ...brand,
              logoSource:
                e.target.value === "__saved__" ? undefined : e.target.value,
            })
          }
        >
          <option value="">无标识</option>
          {brand.logoPath && (
            <option value="__saved__">已保存的品牌标识</option>
          )}
          {assets
            .filter((asset) =>
              /\.(png|jpe?g|webp)$/i.test(asset.hyperframesPath),
            )
            .map((asset) => (
              <option key={asset.id} value={asset.hyperframesPath}>
                {asset.name}
              </option>
            ))}
        </select>
        <small>在素材面板上传标识后，可保存到品牌库。</small>
      </label>
      <div className="editor-brand-actions">
        <button
          disabled={saving || !brand.name.trim()}
          onClick={() => void save()}
        >
          <FloppyDisk />
          {saving ? "保存中…" : "保存品牌"}
        </button>
        <button
          disabled={disabled || !brand.name.trim()}
          className="primary-button"
          onClick={() => onApply(brand)}
        >
          <Palette />
          应用到工程
        </button>
        {brand.revision ? (
          <button
            aria-label="删除当前品牌"
            disabled={saving}
            onClick={() =>
              void editorApi
                .removeLibraryItem(projectId, "brands", brand)
                .then(async () => {
                  setBrand({ ...brand, id: uid(), revision: 0 });
                  await onRefresh();
                })
                .catch((e) => onError(message(e)))
            }
          >
            <Trash />
          </button>
        ) : null}
      </div>
    </>
  );
}
async function mediaDuration(
  url: string,
  kind: "video" | "audio",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const media = document.createElement(kind),
      timer = window.setTimeout(() => finish(Error("素材信息读取超时")), 15000);
    const finish = (result: number | Error) => {
      window.clearTimeout(timer);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      media.load();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () =>
      finish(
        Number.isFinite(media.duration) && media.duration > 0
          ? media.duration
          : Error("素材时长无法读取"),
      );
    media.onerror = () => finish(Error("无法读取这个音视频文件"));
    media.src = url;
  });
}
