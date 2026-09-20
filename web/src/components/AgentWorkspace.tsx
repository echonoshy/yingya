import { FeedbackResults } from "./FeedbackResults";
import { parseTimeRange } from "../feedback/timeRange";
import { readAnnotationDraft, type AnnotationDraft } from "../feedback/annotationDraft";
import type { PlanReceipt } from "../explanationPlan";

import { ProductStoryboard } from "./ProductStoryboard";
import {
  sceneRevisionContext,
  sceneRevisionPrefix,
  sceneRevisionPrompt,
  sceneRevisionLabel,
  sceneRevisionSchema,
  type SceneRevision,
} from "../sceneRevision";
import { flushSync } from "react-dom";
import { AssetRoleSelect } from "./AssetRoleSelect";
import { useWorkbench } from "../hooks/useWorkbench";
import {
  assetRoleLabels,
  fileRoleKey,
  materialOnlyPrompt,
  regeneratePreviewPrompt,
  sceneAtTime,
  sceneStart,
  sourceClip,
  sourceFilePath,
  selectedProjectVersion,
} from "../workbench";
import { useAutosizeTextarea } from "../hooks/useAutosizeTextarea";
import { createClientRequestId } from "../requestId";
import { ComposerForm } from "./ComposerForm";
import { SelectionIndicator } from "./SelectionIndicator";
import { ArtifactList } from "./ArtifactList";
import { AssetPicker } from "./AssetPicker";
import { PlanDocument } from "./PlanDocument";
import { filePreviewKind } from "../projectFiles";
import {
  useFeedbackDraft,
  type FeedbackDraft,
} from "../hooks/useFeedbackDraft";
import {
  captureFeedbackFrame,
  captureFrame,
  type CapturedFrame,
} from "../feedback/captureFrame";
import { VideoAnnotationEditor } from "./VideoAnnotationEditor";
import { FeedbackCard } from "./FeedbackCard";
import {
  submissionAttempt,
  saveSubmission,
  type SubmissionAttempt,
} from "../feedback/submission";
import { useMotionPresence } from "../hooks/useMotionPresence";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CaretLeft,
  BoundingBox,
  Clock,
  Check,
  CheckCircle,
  CircleNotch,
  Code,
  DownloadSimple,
  Eye,
  File,
  FileAudio,
  FileText,
  FolderSimple,
  PencilSimple,
  Plus,
  Queue,
  Stop,
  Terminal,
  VideoCamera,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useDraftFiles } from "../hooks/useDraftFiles";
import { z } from "zod";
import { useSavedState } from "../hooks/useSavedState";
import { assetLibraryItemSchema, assetRoleSchema } from "../schemas";
import { workflowState } from "../projectState";
import { AudioLibrary } from "./AudioLibrary";
import { VersionComparison } from "./VersionComparison";
import { api } from "../api";
import type {
  AgentEvent,
  AgentMedia,
  AgentMessage,
  Artifact,
  AssetFolder,
  AssetLibraryItem,
  CodexModel,
  ModelSelection,
  ProjectDetail,
} from "../types";
import { buildTimeline, type TimelineActivity } from "./eventTimeline";
import { ModelSelector } from "./ModelSelector";
import { ComposerMoreMenu } from "./ComposerMoreMenu";
import { useAgentEvents } from "../hooks/useAgentEvents";
import { useTimelineScroll } from "../hooks/useTimelineScroll";
import { animateElement } from "./motion";
import {
  readNumberSetting,
  readStringSetting,
  writeNumberSetting,
  writeStringSetting,
} from "../storage";
import type { AgentConnectionState } from "../hooks/useAgentEvents";
import {
  RenderPanel as PersistentRenderPanel,
} from "./RenderPanel";

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
type ConversationEntry =
  | { kind: "message"; item: AgentMessage; createdAt: number }
  | { kind: "activity"; item: TimelineActivity; createdAt: number };
type CanvasTab = "preview" | "plan" | "assets" | "artifacts";

export function AgentWorkspace({
  project,
  models,
  selection,
  onSelection,
  onVoice,
  onProject,
  onRename,
  onBack,
}: {
  project: ProjectDetail;
  models: CodexModel[];
  selection: ModelSelection;
  onSelection: (value: ModelSelection) => void;
  onVoice: (voiceId: string) => void | Promise<void>;
  onProject: (value: ProjectDetail) => void;
  onRename: (id: string, title: string) => Promise<void>;
  onBack: () => void;
}) {
  const [text, setText, textSaved] = useSavedState(
    `yingya-draft-text:${project.id}`,
    z.string(),
    "",
  );
  const [files, setFiles, fileDraftStatus] = useDraftFiles(project.id);
  const [contexts, setContexts] = useSavedState(
    `yingya-draft-context:${project.id}`,
    z.array(z.string()),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"thread" | "canvas">("thread");
  const [canvasTab, setCanvasTab] = useState<CanvasTab>(() =>
    project.manifest.versions.length ? savedCanvasTab(project.id) : "plan",
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(composerRef, text);
  const [showRequirementsHint, setShowRequirementsHint] = useState(false);
  function describeRequirements() {
    flushSync(() => {
      setMobilePanel("thread");
      setShowRequirementsHint(true);
    });
    composerRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
    composerRef.current?.focus({ preventScroll: true });
  }
  const feedbackDraft = useFeedbackDraft(project.id);
  const [recoveredAnnotation, setRecoveredAnnotation] = useState<AnnotationDraft | null>(null);
  useEffect(() => {
    let disposed = false;
    void readAnnotationDraft(project.id).then(value => { if (!disposed) setRecoveredAnnotation(value); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [project.id]);
  const videoDurations = useRef(new Map<string, number>());
  const [feedbackCaptureBusy, setFeedbackCaptureBusy] = useState(false);
  const [feedbackAnnotation, setFeedbackAnnotation] = useState<{
    frame: CapturedFrame;
    initial: FeedbackDraft;
  } | null>(null);
  const feedbackNotesIncomplete = feedbackDraft.items.some(
    (item) => !item.note.trim(),
  );
  function focusFeedback(id: string) {
    setMobilePanel("thread");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(
          `[data-feedback-id="${id}"] textarea`,
        )
        ?.focus(),
    );
  }
  function addFeedback(item: FeedbackDraft) {
    if (
      !feedbackDraft.items.some((value) => value.id === item.id) &&
      feedbackDraft.items.length >= 8
    )
      throw new Error("每条消息最多包含 8 条修改意见");
    clearSubmissionFeedback();
    feedbackDraft.update((items) =>
      items.some((value) => value.id === item.id)
        ? items.map((value) => (value.id === item.id ? item : value))
        : [...items, item],
    );
    focusFeedback(item.id);
  }
  async function annotateFeedback(item: FeedbackDraft) {
    if (feedbackCaptureBusy || busy) return;
    setFeedbackCaptureBusy(true);
    setError("");
    try {
      const frame = await captureFeedbackFrame(
        api.fileUrl(project.id, item.videoPath),
        item.timeSeconds,
      );
      setFeedbackAnnotation({ frame, initial: item });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "无法截取画面，文字意见已保留",
      );
    } finally {
      setFeedbackCaptureBusy(false);
    }
  }
  const rangeDraftRef = useRef<{ key: string; draft: FeedbackDraft } | null>(null);
  const attemptRef = useRef<SubmissionAttempt | null>(null);
  const previewAttemptRef = useRef<SubmissionAttempt | null>(null);
  const [sendStage, setSendStage] = useState<
    "idle" | "uploading" | "sending" | "sent" | "failed"
  >("idle");
  const [sendResult, setSendResult] = useState<{
    label: string;
    turnId: string;
    queued: boolean;
  } | null>(null);
  const [assetFeedback, setAssetFeedback] = useState("");
  const [submissionSyncFailed, setSubmissionSyncFailed] = useState(false);
  useEffect(() => {
    if (!assetFeedback) return;
    const timer = window.setTimeout(() => setAssetFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [assetFeedback]);
  const [confirming, setConfirming] = useState(false);
  const sendingRef = useRef(false);
  const [exportRequest, setExportRequest] = useState(0);
  const [artifactPreview, setArtifactPreview] = useState<{
    artifact: Artifact;
    content: string;
    loading: boolean;
    error: string;
  } | null>(null);
  const [threadWidth, setThreadWidth] = useState(() =>
    savedWidth("yingya-review-thread-width", Math.round(window.innerWidth / 3)),
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const maxThreadWidth = Math.max(320, Math.min(560, viewportWidth - 480));
  const visibleThreadWidth = Math.min(
    maxThreadWidth,
    Math.max(320, threadWidth),
  );
  const [libraryAssets, setLibraryAssets] = useState<AssetLibraryItem[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<AssetFolder[]>([]);
  const [selectedAssets, setSelectedAssets] = useSavedState(
    `yingya-draft-assets:${project.id}`,
    z.array(assetLibraryItemSchema),
    [],
  );
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetRoles, setAssetRoles] = useSavedState(
    `yingya-draft-asset-roles:${project.id}`,
    z.record(z.string(), assetRoleSchema),
    {},
  );
  const [selectedVersionId, setSelectedVersionId] = useState(() =>
    savedVersionId(project),
  );
  const selectedVersion = selectedProjectVersion(project, selectedVersionId);
  const oldVersion = Boolean(
    selectedVersion &&
    project.manifest.currentDraft &&
    selectedVersion.id !== project.manifest.currentDraft,
  );
  const selectVersion = useCallback(
    (id: string) => {
      setSelectedVersionId(id);
      setError((current) =>
        current.includes("旧版本") || current.startsWith("请先切到当前版本")
          ? ""
          : current,
      );
      writeStringSetting(`yingya-version:${project.id}`, id);
    },
    [project.id],
  );
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [dismissedCheckpoint, setDismissedCheckpoint] = useState("");
  const refreshGeneration = useRef(0);
  useEffect(
    () => () => {
      refreshGeneration.current++;
    },
    [project.id],
  );
  const running = Boolean(project.activeTurnId);
  const state = workflowState(project);
  const [removingQueued, setRemovingQueued] = useState("");
  async function removeQueued(id: string) {
    setRemovingQueued(id);
    setError("");
    try {
      await api.removeQueued(project.id, id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "撤回失败，请重试");
    } finally {
      setRemovingQueued("");
    }
  }
  const [executingQueued, setExecutingQueued] = useState("");
  const executingQueuedRef = useRef(false);
  async function executeQueued(id: string) {
    if (executingQueuedRef.current) return;
    executingQueuedRef.current = true;
    setExecutingQueued(id);
    setError("");
    try {
      await api.executeQueued(project.id, id);
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "立即执行失败，请重试",
      );
    } finally {
      executingQueuedRef.current = false;
      setExecutingQueued("");
    }
  }
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const detail = await api.getProject(project.id);
      if (generation !== refreshGeneration.current) return;
      setSubmissionSyncFailed(false);
      onProject(detail);
    } catch (reason) {
      if (generation === refreshGeneration.current) throw reason;
    }
  }, [onProject, project.id]);
  const { events, connectionState, syncFailed, stalled, resync } =
    useAgentEvents(project.id, refresh, running);
  const assistantTexts = useMemo(
    () =>
      new Set(
        project.messages
          .filter((message) => message.role === "assistant")
          .map((message) => message.text.trim()),
      ),
    [project.messages],
  );
  const activities = useMemo(
    () => buildTimeline(events, assistantTexts, project),
    [events, assistantTexts, project.status, project.activeTurnId],
  );
  const conversation = useMemo<ConversationEntry[]>(
    () =>
      [
        ...project.messages.map((item) => ({
          kind: "message" as const,
          item,
          createdAt: item.createdAt,
        })),
        ...activities.map((item) => ({
          kind: "activity" as const,
          item,
          createdAt: item.createdAt,
        })),
      ].sort((left, right) => left.createdAt - right.createdAt),
    [activities, project.messages],
  );
  const waitingInputMessage = useMemo(
    () =>
      project.status === "waiting_input"
        ? [...project.messages]
            .reverse()
            .find((message) => message.role === "assistant")
        : undefined,
    [project.messages, project.status],
  );
  const waitingInputChoices = useMemo(
    () => extractInputChoices(waitingInputMessage?.text ?? ""),
    [waitingInputMessage?.text],
  );
  const timelineRevision = useMemo(
    () =>
      JSON.stringify([
        conversation.map((entry) =>
          entry.kind === "message"
            ? [entry.item.id, entry.item.text, entry.item.status]
            : [entry.item.id, entry.item.summary, entry.item.status],
        ),
        project.manifest.checkpoint?.id,
        project.queue.map((turn) => turn.id),
        project.status,
      ]),
    [
      conversation,
      project.manifest.checkpoint?.id,
      project.queue,
      project.status,
    ],
  );
  const { timelineRef, contentRef, onScroll, hasNewContent, scrollToLatest } =
    useTimelineScroll(timelineRevision);
  useEffect(() => {
    void Promise.all([api.listAssetLibrary(), api.listAssetFolders()])
      .then(([library, folders]) => {
        setLibraryAssets(library.assets);
        setLibraryFolders(folders);
      })
      .catch(() => undefined);
  }, [project.id]);
  function selectCanvasTab(tab: CanvasTab) {
    setArtifactPreview(null);
    setCanvasTab(tab);
    writeStringSetting(`yingya-canvas-tab:${project.id}`, tab);
  }

  function clearSubmissionFeedback() {
    setAssetFeedback("");
    if (sendingRef.current || (sendStage !== "sent" && sendStage !== "failed"))
      return;
    setSendStage("idle");
    setSendResult(null);
    setError("");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      (!text.trim() &&
        !files.length &&
        !selectedAssets.length &&
        !feedbackDraft.items.length) ||
      busy ||
      feedbackNotesIncomplete ||
      feedbackCaptureBusy ||
      sendingRef.current ||
      fileDraftStatus === "loading" ||
      feedbackDraft.status === "loading"
    )
      return;

    sendingRef.current = true;
    setBusy(true);
    setError("");
    setAssetFeedback("");
    setSubmissionSyncFailed(false);
    setSendStage(
      files.length ||
        selectedAssets.length ||
        feedbackDraft.items.some(
          (item) => item.kind === "video-frame" && !item.asset,
        )
        ? "uploading"
        : "sending",
    );
    try {
      const range = parseTimeRange(text);
      const rangeKey = `${selectedVersion?.id}:${text}`;
      if (range && selectedVersion && rangeDraftRef.current?.key !== rangeKey) rangeDraftRef.current = { key: rangeKey, draft: { id: createClientRequestId(), kind: "video-range", versionId: selectedVersion.id, videoPath: selectedVersion.videoPath, timeSeconds: range.start, endSeconds: range.end, note: text.trim(), createdAt: Date.now() } };
      const submittedFeedback: FeedbackDraft[] = feedbackDraft.items.length || !range || !selectedVersion ? feedbackDraft.items : [rangeDraftRef.current!.draft];
      for (const item of submittedFeedback) {
        const duration = videoDurations.current.get(item.videoPath);
        if (duration !== undefined && (item.timeSeconds > duration || (item.kind === "video-range" && item.endSeconds > duration))) throw new Error("反馈时间超出所选视频时长，请调整范围后重试。文字已保留。");
      }
      const signature = JSON.stringify({
        text,
        contexts,
        baseVersionId: project.manifest.currentDraft ?? null,
        assetRoles,
        interrupt: false,
        selection,
        files: files.map((f) => [f.name, f.size, f.lastModified]),
        assets: selectedAssets.map((a) => a.id),
        feedback: submittedFeedback.map(
          ({ blob: _blob, asset: _asset, ...item }) => item,
        ),
      });
      const attempt =
        attemptRef.current?.signature === signature
          ? attemptRef.current
          : submissionAttempt(project.id, signature);
      attemptRef.current = attempt;
      if (!attempt.input) {
        const [uploaded, visualFeedback] = await Promise.all([
          Promise.all([
            ...files.map((file) => api.uploadAsset(project.id, file)),
            ...selectedAssets.map((asset) =>
              uploadLibraryAsset(project.id, asset),
            ),
          ]),
          Promise.all(
            submittedFeedback.map(async (draft) => {
              const {
                blob: _blob,
                asset: _asset,
                uploadId: _uploadId,
                ...item
              } = draft;
              if (item.kind !== "video-frame") return item;
              if (draft.screenshotAssetId && draft.screenshotPath && draft.screenshotSha256) return { ...item, screenshotAssetId: draft.screenshotAssetId, screenshotPath: draft.screenshotPath, screenshotSha256: draft.screenshotSha256 };
              if (!draft.blob) throw new Error("标注截图已丢失，请重新框选");
              const asset =
                draft.asset ??
                (await api.uploadFeedbackAsset(
                  project.id,
                  draft.uploadId ?? draft.id,
                  draft.blob,
                ));
              feedbackDraft.update((items) =>
                items.map((item) =>
                  item.id === draft.id ? { ...item, asset } : item,
                ),
              );
              return {
                ...item,
                screenshotAssetId: asset.id,
                screenshotPath: asset.path,
                screenshotSha256: asset.sha256,
              };
            }),
          ),
        ]);
        await Promise.all(
          uploaded.map((item, index) =>
            api.setAssetRole(
              project.id,
              item.path,
              assetRoles[
                index < files.length
                  ? fileRoleKey(files[index])
                  : `library:${selectedAssets[index - files.length].id}`
              ] ?? "auto",
            ),
          ),
        );
        const assetContexts = selectedAssets.map(
          (asset) =>
            `素材 · ${assetName(asset)}（${assetRoleLabels[assetRoles[`library:${asset.id}`] ?? "auto"]}）`,
        );
        const submissionContexts = contexts.map((value) => {
          if (!value.startsWith(sceneRevisionPrefix)) return value;
          const revision = sceneRevisionSchema.parse(
            JSON.parse(value.slice(sceneRevisionPrefix.length)),
          );
          if (revision.kind !== "image") return value;
          const candidates = files
            .map((file, index) => ({ file, index }))
            .filter(
              ({ file }) =>
                file.name === revision.value && file.type.startsWith("image/"),
            );
          if (candidates.length !== 1)
            throw new Error("替换截图缺失或同名图片不唯一，请重新选择截图。");
          return sceneRevisionContext({
            ...revision,
            replacementPath: uploaded[candidates[0].index].path,
          });
        });
        attempt.input = {
          baseVersionId: project.manifest.currentDraft ?? null,
          clientRequestId: attempt.id,
          text:
            text.trim() ||
            (submittedFeedback.length
              ? "请根据修改意见调整视频，保留其他内容。"
              : materialOnlyPrompt),
          attachments: uploaded.map((item) => item.path),
          context: [...new Set([...submissionContexts, ...assetContexts, ...(selectedVersion && selectedVersion.id !== project.manifest.currentDraft ? [`意见来自历史版本 ${selectedVersion.id}，正在查看不表示回退；先按稳定段落身份映射到当前版本，无法映射时请澄清。`] : [])])],
          feedback: visualFeedback,
          interrupt: false,
          ...selection,
        };
        saveSubmission(project.id, attempt);
      }
      setSendStage("sending");
      const accepted = await api.sendTurn(project.id, attempt.input);
      attemptRef.current = null;
      saveSubmission(project.id, null);
      feedbackDraft.update((items) =>
        items.filter(
          (item) => !submittedFeedback.some((sent) => sent.id === item.id),
        ),
      );
      if (project.manifest.checkpoint?.id)
        setDismissedCheckpoint(project.manifest.checkpoint.id);
      // Only clear this submission: the composer remains available for the next draft.
      setText((current) => (current === text ? "" : current));
      setFiles((current) => current.filter((file) => !files.includes(file)));
      setSelectedAssets((current) =>
        current.filter(
          (asset) => !selectedAssets.some((sent) => sent.id === asset.id),
        ),
      );
      setContexts((current) =>
        current.filter((context) => !contexts.includes(context)),
      );
      setSendResult({
        label: accepted.status === "queued" ? "已加入队列" : "已提交",
        turnId: accepted.turnId,
        queued: accepted.status === "queued",
      });
      setSendStage("sent");
      try {
        await refresh();
      } catch {
        setSubmissionSyncFailed(true);
      }
    } catch (reason) {
      setSendStage("failed");
      setError(reason instanceof Error ? reason.message : "消息发送失败");
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }
  async function generatePreview() {
    if (
      busy ||
      running ||
      project.queueDepth > 0 ||
      oldVersion ||
      !selectedVersion ||
      !project.manifest.dirty ||
      sendingRef.current
    )
      return;
    sendingRef.current = true;
    setBusy(true);
    setError("");
    const signature = JSON.stringify({
      baseVersionId: selectedVersion.id,
      ...selection,
    });
    const attempt =
      previewAttemptRef.current?.signature === signature
        ? previewAttemptRef.current
        : submissionAttempt(project.id, signature);
    previewAttemptRef.current = attempt;
    attempt.input ??= {
      baseVersionId: selectedVersion.id,
      clientRequestId: attempt.id,
      text: regeneratePreviewPrompt,
      interrupt: false,
      ...selection,
    };
    try {
      const accepted = await api.sendTurn(project.id, attempt.input);
      previewAttemptRef.current = null;
      setSendResult({
        label: "已提交新版预览制作",
        turnId: accepted.turnId,
        queued: accepted.status === "queued",
      });
      setSendStage("sent");
      setMobilePanel("thread");
      try {
        await refresh();
      } catch {
        setSubmissionSyncFailed(true);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "新版预览请求发送失败，请重试",
      );
      setMobilePanel("thread");
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  }
  const confirmAttempt = useRef<{ revision: string; id: string } | null>(null);
  async function confirm(receipt: PlanReceipt) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setBusy(true);
    setConfirming(true);
    setError("");
    try {
      const checkpointId = project.manifest.checkpoint?.id;
      const checkpointKind = project.manifest.checkpoint?.kind;
      if (confirmAttempt.current?.revision !== receipt.revision) confirmAttempt.current = { revision: receipt.revision, id: createClientRequestId() };
      await api.confirmCheckpoint(project.id, { ...receipt, ...selection, clientRequestId: confirmAttempt.current.id });
      if (checkpointId) setDismissedCheckpoint(checkpointId);
      setArtifactPreview(null);
      if (checkpointKind === "plan") {
        selectCanvasTab("preview");
        setMobilePanel("canvas");
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认失败");
    } finally {
      setBusy(false);
      setConfirming(false);
      sendingRef.current = false;
    }
  }
  async function stop() {
    setStopping(true);
    setError("");
    try {
      await api.interrupt(project.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "停止失败");
    } finally {
      setStopping(false);
    }
  }
  async function resumeQueue() {
    setBusy(true);
    setError("");
    try {
      await api.resume(project.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复队列失败");
    } finally {
      setBusy(false);
    }
  }
  function selectQuickReply(value: string) {
    clearSubmissionFeedback();
    setText(value);
    setMobilePanel("thread");
    composerRef.current?.focus();
    requestAnimationFrame(() => composerRef.current?.focus());
  }
  function prepareSceneRevision(revision: SceneRevision, file?: File) {
    if (contexts.some((value) => value.startsWith(sceneRevisionPrefix))) {
      setError("请先发送或移除当前镜头修改，再选择下一处修改。");
      return;
    }
    if (revision.versionId !== selectedVersion?.id || oldVersion) {
      setError("请切到当前版本后修改。");
      return;
    }
    clearSubmissionFeedback();
    setContexts((current) => [...current, sceneRevisionContext(revision)]);
    setText((current) =>
      [current.trim(), sceneRevisionPrompt(revision)]
        .filter(Boolean)
        .join("\n\n"),
    );
    if (file) setFiles((current) => [...current, file]);
    setMobilePanel("thread");
    requestAnimationFrame(() => composerRef.current?.focus());
  }
  async function answerWaitingInput(choice: string) {
    if (busy) return;
    if (oldVersion) {
      setError("请先切到当前版本或回退，再继续制作。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.sendTurn(project.id, {
        baseVersionId: project.manifest.currentDraft ?? null,
        text: `选择${choice.replace("（推荐）", "")}，请继续制作。`,
        ...selection,
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认发送失败");
    } finally {
      setBusy(false);
    }
  }
  function focusWaitingComposer() {
    requestAnimationFrame(() => composerRef.current?.focus());
  }
  async function addTimedFeedback(
    versionId: string,
    videoPath: string,
    feedback: Array<{ time: number; description: string }>,
  ) {
    if (feedbackDraft.items.length + feedback.length > 8)
      throw new Error("每条消息最多包含 8 条修改意见，请先发送已有意见");
    const converted: FeedbackDraft[] = feedback.map((item) => ({
      id: createClientRequestId(),
      kind: "video-time",
      versionId,
      videoPath,
      timeSeconds: item.time,
      note: item.description.trim(),
      createdAt: Date.now(),
    }));
    await feedbackDraft.update((items) => [...items, ...converted]);
    if (converted[0]) focusFeedback(converted[0].id);
  }
  async function previewArtifact(artifact: Artifact) {
    setMobilePanel("canvas");

    const kind = filePreviewKind(artifact.path);
    if (!["text", "markdown"].includes(kind)) {
      setArtifactPreview({ artifact, content: "", loading: false, error: "" });
      return;
    }
    setArtifactPreview({ artifact, content: "", loading: true, error: "" });
    try {
      let content = await api.readProjectFile(project.id, artifact.path);
      if (artifact.path.endsWith(".json")) {
        try {
          content = JSON.stringify(JSON.parse(content), null, 2);
        } catch {
          /* show original text */
        }
      }
      setArtifactPreview((current) =>
        current?.artifact.id === artifact.id
          ? { artifact, content, loading: false, error: "" }
          : current,
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "产物预览失败";
      setArtifactPreview((current) =>
        current?.artifact.id === artifact.id
          ? { artifact, content: "", loading: false, error: message }
          : current,
      );
    }
  }
  async function saveTitle(event: FormEvent) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (!title || renaming) return;
    if (title === project.title) {
      setEditingTitle(false);
      return;
    }
    setRenaming(true);
    setTitleError("");
    try {
      await onRename(project.id, title);
      setEditingTitle(false);
    } catch (reason) {
      setTitleError(reason instanceof Error ? reason.message : "标题修改失败");
    } finally {
      setRenaming(false);
    }
  }

  const checkpointSuperseded =
    running || project.queue.length > 0 || project.status === "queued";
  const visibleCheckpoint =
    project.manifest.checkpoint?.kind === "plan" &&
    !checkpointSuperseded &&
    project.manifest.checkpoint.id !== dismissedCheckpoint
      ? project.manifest.checkpoint
      : undefined;
  const checkpointPresence = useMotionPresence(visibleCheckpoint?.id ?? null);
  const lastCheckpoint = useRef(visibleCheckpoint);
  if (visibleCheckpoint) lastCheckpoint.current = visibleCheckpoint;
  const displayedCheckpoint = checkpointPresence.value
    ? lastCheckpoint.current
    : undefined;
  const checkpointArtifact = displayedCheckpoint?.artifactIds
    .map((id) =>
      project.manifest.artifacts.find((artifact) => artifact.id === id),
    )
    .find(Boolean);
  const workspaceStyle = {
    "--thread-width": `${visibleThreadWidth}px`,
  } as CSSProperties;
  function dragThread(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      setThreadWidth(Math.min(maxThreadWidth, Math.max(320, event.clientX)));
  }
  function finishResize(
    event: ReactPointerEvent<HTMLDivElement>,
    key: string,
    value: number,
  ) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    writeNumberSetting(key, value);
  }
  function resizeWithKeyboard(
    event: KeyboardEvent<HTMLDivElement>,
    value: number,
    setValue: (next: number) => void,
    key: string,
    min: number,
    max: number,
    direction: number,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const arrowDirection = event.key === "ArrowLeft" ? -1 : 1;
    const next = Math.min(
      max,
      Math.max(
        min,
        value + arrowDirection * direction * (event.shiftKey ? 24 : 8),
      ),
    );
    setValue(next);
    writeNumberSetting(key, next);
  }
  function selectReferenceAssets(assets: AssetLibraryItem[]) {
    clearSubmissionFeedback();
    const additions = assets.filter(
      (asset) => !selectedAssets.some((selected) => selected.id === asset.id),
    );
    if (!additions.length) return;
    setAssetFeedback(`已加入 ${additions.length} 个参考文件，可在对话中发送`);
    setSelectedAssets((items) => {
      const selectedIds = new Set(items.map((item) => item.id));
      return [
        ...items,
        ...assets.filter((asset) => !selectedIds.has(asset.id)),
      ];
    });
  }
  const chat = (
    <main className="thread">
      <header className="thread-header">
        <div>
          <span>创作对话</span>
          <b>
            {running
              ? "正在制作，可继续补充要求"
              : "用对话调整内容、画面与节奏"}
          </b>
        </div>
        {titleError ? (
          <small className="thread-title-error">{titleError}</small>
        ) : null}
      </header>
      <section
        className="timeline"
        aria-label="创作消息"
        tabIndex={0}
        ref={timelineRef}
        onScroll={onScroll}
      >
        <div className="timeline-inner" ref={contentRef}>
          {syncFailed ||
          submissionSyncFailed ||
          stalled ||
          connectionState === "disconnected" ? (
            <ConnectionNotice
              syncFailed={syncFailed || submissionSyncFailed}
              stalled={stalled}
              onRetry={() => void resync()}
            />
          ) : null}
          <ConversationFeed
            projectId={project.id}
            entries={conversation}
            onQuickReply={selectQuickReply}
          />
          {waitingInputMessage ? (
            <WaitingInputCard
              choices={waitingInputChoices}
              busy={busy}
              onAnswer={(choice) => void answerWaitingInput(choice)}
              onCompose={focusWaitingComposer}
            />
          ) : null}
          {(project.status === "failed" || project.status === "incomplete") &&
          project.manifest.dirty ? (
            <WorkflowRecoveryCard
              briefing={project.manifest.phase === "briefing"}
              incomplete={project.status === "incomplete"}
              statusLabel={project.statusLabel}
              onRecover={selectQuickReply}
            />
          ) : null}
          {displayedCheckpoint ? (
            <div
              className="checkpoint-presence"
              ref={checkpointPresence.ref}
              inert={checkpointPresence.exiting}
              aria-hidden={checkpointPresence.exiting || undefined}
            >
              <CheckpointCard
                title={displayedCheckpoint.title}
                summary={displayedCheckpoint.summary}
                busy={busy}
                confirming={confirming}
                onPreview={
                  checkpointArtifact
                    ? () => void previewArtifact(checkpointArtifact)
                    : undefined
                }
                onConfirm={() => { selectCanvasTab("plan"); setMobilePanel("canvas"); }}
              />
            </div>
          ) : null}
          {project.queue.length ? (
            <section className="queue-card">
              <p className="queue-interrupt-notice">意见按顺序处理；选择“立即执行”会停止当前制作，先处理这条意见。</p>
              <header>
                <Queue />
                <b>{project.queuePaused ? "队列已暂停" : "待处理消息"}</b>
                <span>{project.queue.length}</span>
                {project.queuePaused ? (
                  <button
                    className="queue-resume"
                    disabled={busy}
                    onClick={() => void resumeQueue()}
                  >
                    继续处理
                  </button>
                ) : null}
              </header>
              {project.queue.map((turn, index) => (
                <div key={turn.id}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  <span className="queued-message-copy">
                    <small>排队中</small>
                    {turn.text}
                  </span>
                  <div className="queued-message-actions">
                    <button
                      className="queue-execute"
                      title="中断当前任务，立即执行这条消息"
                      disabled={
                        Boolean(executingQueued || removingQueued) || stopping
                      }
                      onClick={() => void executeQueued(turn.id)}
                    >
                      {executingQueued === turn.id ? (
                        <CircleNotch className="spin" />
                      ) : (
                        <ArrowUp />
                      )}
                      {executingQueued === turn.id ? "正在切换…" : "立即执行"}
                    </button>
                    <button
                      aria-label="撤回排队消息"
                      disabled={Boolean(removingQueued || executingQueued)}
                      onClick={() => void removeQueued(turn.id)}
                    >
                      <X />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </section>
      <footer className="thread-footer">
        <div className="composer-context">
        {feedbackDraft.status === "error" ? (
          <p className="form-error" role="status">
            反馈草稿无法保存，请勿刷新页面。
          </p>
        ) : feedbackDraft.items.length ? (
          <p className="draft-save-status" role="status">
            {feedbackDraft.items.length}/8 条修改意见 ·{" "}
            {feedbackDraft.status === "saving"
              ? "正在保存反馈草稿…"
              : "反馈草稿已保存"}
          </p>
        ) : null}
        {feedbackCaptureBusy ? (
          <p className="draft-save-status" role="status">
            正在截取这条意见对应的画面…
          </p>
        ) : null}
        {parseTimeRange(text) && selectedVersion && !feedbackDraft.items.length ? <p className="range-feedback-hint" role="status">将针对 {selectedVersion.label} · {parseTimeRange(text)!.start}–{parseTimeRange(text)!.end} 秒提交修改</p> : null}
        <div className="feedback-drafts">
          {feedbackDraft.items.map((item) => (
            <FeedbackCard
              key={item.id}
              projectId={project.id}
              feedback={item}
              versionLabel={
                project.manifest.versions.find(
                  (version) => version.id === item.versionId,
                )?.label
              }
              disabled={busy || feedbackCaptureBusy}
              onNote={(note) => {
                clearSubmissionFeedback();
                feedbackDraft.update((items) =>
                  items.map((value) =>
                    value.id === item.id ? { ...value, note } : value,
                  ),
                );
              }}
              onAnnotate={() => void annotateFeedback(item)}
              onRemove={() => {
                clearSubmissionFeedback();
                feedbackDraft.update((items) =>
                  items.filter((value) => value.id !== item.id),
                );
              }}
            />
          ))}
        </div>
        {fileDraftStatus === "error" ? (
          <p className="form-error" role="status">
            附件无法保存，刷新后需重新添加。
          </p>
        ) : null}
        {text && !textSaved ? (
          <p className="form-error" role="status">
            草稿保存失败，请勿关闭页面
          </p>
        ) : null}
        {hasNewContent ? (
          <button
            className="timeline-latest"
            type="button"
            onClick={() => {
              scrollToLatest();
              timelineRef.current?.focus({ preventScroll: true });
            }}
          >
            <ArrowDown />
            有新消息，回到最新
          </button>
        ) : null}
        {assetPickerOpen ? (
          <ComposerAssetPicker
            folders={libraryFolders}
            assets={libraryAssets}
            selected={selectedAssets}
            onClose={() => setAssetPickerOpen(false)}
            onToggle={(asset) => {
              clearSubmissionFeedback();
              if (selectedAssets.some((item) => item.id === asset.id)) {
                setSelectedAssets((items) =>
                  items.filter((item) => item.id !== asset.id),
                );
                setAssetFeedback(`已移除 ${assetName(asset)}`);
              } else selectReferenceAssets([asset]);
            }}
          />
        ) : null}
        <SelectedAssetChips
          assets={selectedAssets}
          roles={assetRoles}
          onRole={(id, role) =>
            setAssetRoles((current) => ({
              ...current,
              [`library:${id}`]: role,
            }))
          }
          onRemove={(asset) => {
            clearSubmissionFeedback();
            setSelectedAssets((items) =>
              items.filter((item) => item.id !== asset.id),
            );
            setAssetFeedback(`已移除 ${assetName(asset)}`);
            composerRef.current?.focus({ preventScroll: true });
          }}
        />
        {contexts.length ? (
          <div className="context-chips">
            {contexts.map((value) => (
              <span key={value}>
                {displayContext(value)}
                <button
                  aria-label={`移除 ${displayContext(value)}`}
                  onClick={() =>
                    setContexts((items) =>
                      items.filter((item) => item !== value),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div
          className="composer-feedback"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {sendStage === "uploading" || sendStage === "sending" ? (
            <span key={sendStage}>
              <CircleNotch className="spin" />
              {sendStage === "uploading" ? "正在上传素材…" : "正在发送…"}
            </span>
          ) : sendStage === "failed" ? (
            <span className="composer-feedback-error">
              <Warning />
              发送未完成，可重试
            </span>
          ) : assetFeedback ? (
            <span key={assetFeedback}>
              <Check />
              {assetFeedback}
            </span>
          ) : sendStage === "sent" &&
            sendResult &&
            (sendResult.queued
              ? project.queue.some((turn) => turn.id === sendResult.turnId)
              : project.activeTurnId !== sendResult.turnId &&
                !project.messages.some(
                  (message) => message.turnId === sendResult.turnId,
                )) ? (
            <span>
              <Check />
              {sendResult.label}
            </span>
          ) : null}
        </div>
        {oldVersion ? (
          <div className="version-edit-notice" role="status">
            <span>正在看 {selectedVersion?.label}。定位意见保留原版位置，修改应用到最新版本。</span>
            <button
              type="button"
              onClick={() => selectVersion(project.manifest.currentDraft ?? "")}
            >
              切到当前版本
            </button>
          </div>
        ) : null}
        </div>
        <ComposerForm
          className="composer"
          onSubmit={send}
          onChange={clearSubmissionFeedback}
          filesDisabled={busy || fileDraftStatus === "loading"}
          onFiles={(added) => {
            clearSubmissionFeedback();
            setFiles((current) => [...current, ...added]);
          }}
        >
          {showRequirementsHint ? (
            <p
              className="composer-requirements-hint"
              id="requirements-hint"
              role="status"
            >
              在这里补充内容、目标受众或画面要求，点击发送后应用。
            </p>
          ) : null}
          <textarea
            rows={1}
            aria-describedby={
              showRequirementsHint ? "requirements-hint" : undefined
            }
            aria-label="修改描述"
            ref={composerRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setShowRequirementsHint(false);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              running ? "继续输入，默认排到当前任务之后…" : "描述想修改的内容…"
            }
          />
          <div className="attachment-row">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`}>
                {file.name}
                <AssetRoleSelect
                  name={file.name}
                  value={assetRoles[fileRoleKey(file)]}
                  disabled={busy}
                  onChange={(role) =>
                    setAssetRoles((current) => ({
                      ...current,
                      [fileRoleKey(file)]: role,
                    }))
                  }
                />
                <button
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  onClick={() =>
                    setFiles((value) => value.filter((item) => item !== file))
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <div className="composer-tools composer-toolbar">
            <div className="composer-resources">
              <ComposerMoreMenu
                onUpload={() => fileRef.current?.click()}
                onSelectAssets={() => setAssetPickerOpen(true)}
                selectedCount={selectedAssets.length}
                voiceId={project.voiceId}
                onVoice={onVoice}
                running={running}
                narration={(["narration", "replace"] as unknown[]).includes(
                  (
                    project.manifest.outputSpec.requirements as
                      Record<string, unknown> | undefined
                  )?.audioMode,
                )}
              />
              <input
                ref={fileRef}
                hidden
                multiple
                type="file"
                onChange={(event) => {
                  const added = Array.from(event.target.files ?? []);
                  setFiles((current) => [...current, ...added]);
                  event.target.value = "";
                }}
              />
            </div>
            <div className="composer-delivery">
              <div className="composer-settings">
                <ModelSelector
                  models={models}
                  value={selection}
                  onChange={onSelection}
                />
              </div>
              <div className="composer-actions">
                {running ? (
                  <button
                    className="stop-button"
                    type="button"
                    aria-label={stopping ? "正在停止" : "停止当前任务"}
                    title="停止当前任务"
                    disabled={stopping}
                    onClick={() => void stop()}
                  >
                    {stopping ? (
                      <CircleNotch className="spin" />
                    ) : (
                      <Stop weight="fill" />
                    )}
                    {stopping ? "停止中" : "停止"}
                  </button>
                ) : null}
                <button
                  className="send-button"
                  aria-label={
                    sendStage === "failed" ? "重试发送消息" : "发送消息"
                  }
                  title={sendStage === "failed" ? "重试发送" : "发送消息"}
                  aria-busy={
                    sendStage === "uploading" || sendStage === "sending"
                  }
                  disabled={
                    (!text.trim() &&
                      !files.length &&
                      !selectedAssets.length &&
                      !feedbackDraft.items.length) ||
                    busy ||
                    feedbackNotesIncomplete ||
                    feedbackCaptureBusy ||
                    fileDraftStatus === "loading" ||
                    feedbackDraft.status === "loading"
                  }
                >
                  {sendStage === "uploading" || sendStage === "sending" ? (
                    <CircleNotch className="spin" />
                  ) : sendStage === "failed" ? (
                    <ArrowClockwise />
                  ) : (
                    <ArrowUp weight="bold" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </ComposerForm>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </footer>
    </main>
  );
  const legacy = (
    <div
      className={`workspace workspace--canvas knowledge-workspace workspace-mobile--${mobilePanel}`}
      style={workspaceStyle}
    >
      <header className="project-header">
        <div className="project-header-brand">
          <img src="/brand/yingya-ghost.png" alt="" />
          <b>映芽</b>
        </div>
        <button className="project-back" onClick={onBack}>
          <CaretLeft />
          我的作品
        </button>
        <div className="project-heading">
          {editingTitle ? (
            <form className="thread-title-editor" onSubmit={saveTitle}>
              <input
                aria-label="项目标题"
                autoFocus
                maxLength={48}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setEditingTitle(false);
                    setTitleError("");
                  }
                }}
              />
              <button
                aria-label="保存项目标题"
                disabled={!titleDraft.trim() || renaming}
              >
                <Check />
              </button>
              <button
                type="button"
                aria-label="取消修改标题"
                onClick={() => {
                  setEditingTitle(false);
                  setTitleError("");
                }}
              >
                <X />
              </button>
            </form>
          ) : (
            <button
              className="thread-title-button"
              aria-label={`修改项目标题：${project.title}`}
              title="修改项目标题"
              onClick={() => {
                setTitleDraft(project.title);
                setTitleError("");
                setEditingTitle(true);
              }}
            >
              <h1>{project.title}</h1>
              <PencilSimple />
            </button>
          )}
          <span className={`project-state project-state--${project.status}`}>
            {state.label}
          </span>
        </div>
        <div className="project-header-actions">
          <ConnectionBadge state={connectionState} />
          <span className="spec-chip">{project.aspectRatio}</span>
          <button
            className="export-button"
            aria-label="分享与下载"
            onClick={() => {
              selectCanvasTab("preview");
              setMobilePanel("canvas");
              setExportRequest((value) => value + 1);
            }}
          >
            <DownloadSimple />
            <span>分享与下载</span>
          </button>
        </div>
      </header>
      <div
        className="workspace-splitter workspace-splitter--thread"
        role="separator"
        aria-label="调整创作对话宽度"
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={maxThreadWidth}
        aria-valuenow={visibleThreadWidth}
        tabIndex={0}
        onKeyDown={(event) =>
          resizeWithKeyboard(
            event,
            visibleThreadWidth,
            setThreadWidth,
            "yingya-review-thread-width",
            320,
            maxThreadWidth,
            1,
          )
        }
        onDoubleClick={() => { const next = Math.min(maxThreadWidth, Math.max(320, Math.round(viewportWidth / 3))); setThreadWidth(next); writeNumberSetting("yingya-review-thread-width", next); }}
        onPointerDown={(event) =>
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        onPointerMove={dragThread}
        onPointerUp={(event) =>
          finishResize(event, "yingya-review-thread-width", threadWidth)
        }
        onPointerCancel={(event) =>
          finishResize(event, "yingya-review-thread-width", threadWidth)
        }
      />
      <nav className="workspace-tabs" aria-label="工作区视图">
        <SelectionIndicator value={`${mobilePanel}:${canvasTab}`} />
        <button
          aria-pressed={mobilePanel === "thread"}
          className={mobilePanel === "thread" ? "active" : ""}
          onClick={() => setMobilePanel("thread")}
        >
          对话
        </button>
        {(["plan", "preview"] as CanvasTab[]).map((tab) => (
          <button
            key={tab}
            aria-pressed={mobilePanel === "canvas" && canvasTab === tab}
            className={
              mobilePanel === "canvas" && canvasTab === tab ? "active" : ""
            }
            onClick={() => {
              setMobilePanel("canvas");
              selectCanvasTab(tab);
            }}
          >
            {canvasTabLabel(tab)}
          </button>
        ))}
      </nav>
      {chat}
      {recoveredAnnotation ? <VideoAnnotationEditor
        {...recoveredAnnotation}
        projectId={project.id}
        restored={recoveredAnnotation}
        onAdd={addFeedback}
        onClose={() => setRecoveredAnnotation(null)}
      /> : null}
      {feedbackAnnotation ? (
        <VideoAnnotationEditor
          projectId={project.id}
          frame={feedbackAnnotation.frame}
          initial={feedbackAnnotation.initial}
          versionId={feedbackAnnotation.initial.versionId}
          videoPath={feedbackAnnotation.initial.videoPath}
          versionLabel={
            project.manifest.versions.find(
              (version) => version.id === feedbackAnnotation.initial.versionId,
            )?.label ?? feedbackAnnotation.initial.versionId
          }
          onAdd={addFeedback}
          onClose={() => setFeedbackAnnotation(null)}
        />
      ) : null}
      <ArtifactCanvas
        onVideoDuration={(path, duration) => { if (Number.isFinite(duration)) videoDurations.current.set(path, duration); }}
        onConfirm={receipt => void confirm(receipt)}
        confirming={confirming}
        onRevision={prepareSceneRevision}
        generationDisabled={
          busy || running || project.queueDepth > 0 || oldVersion
        }
        onGeneratePreview={() => void generatePreview()}
        selectedVersionId={selectedVersion?.id ?? ""}
        onSelectVersion={selectVersion}
        exportRequest={exportRequest}
        onDescribe={describeRequirements}
        project={project}
        activeTab={canvasTab}
        preview={artifactPreview}
        libraryAssets={libraryAssets}
        libraryFolders={libraryFolders}
        selectedAssets={selectedAssets}
        onClosePreview={() => setArtifactPreview(null)}
        onTab={selectCanvasTab}
        onPreview={(artifact) => void previewArtifact(artifact)}
        onContext={(value) =>
          setContexts((items) =>
            items.includes(value) ? items : [...items, value],
          )
        }
        onSelectAssets={selectReferenceAssets}
        onFeedback={addFeedback}
        feedbackDisabled={
          busy ||
          feedbackCaptureBusy ||
          feedbackDraft.status === "loading" ||
          feedbackDraft.items.length >= 8
        }
        onTimedFeedback={addTimedFeedback}
        onCompose={selectQuickReply}
        onRefresh={refresh}
      />
    </div>
  );
  return legacy;
}

function SelectedAssetChips({
  assets,
  onRemove,
  roles,
  onRole,
}: {
  assets: AssetLibraryItem[];
  roles: Record<string, import("../types").AssetRole>;
  onRole: (id: string, role: import("../types").AssetRole) => void;
  onRemove: (asset: AssetLibraryItem) => void;
}) {
  const [previous, setPrevious] = useState(assets);
  const [visible, setVisible] = useState(() =>
    assets.map((asset) => ({ asset, exiting: false })),
  );
  if (previous !== assets) {
    setPrevious(assets);
    // The parent selection changes immediately; retain only the visual shell during exit.
    setVisible((current) => [
      ...current.map((item) => ({
        asset: assets.find((asset) => asset.id === item.asset.id) ?? item.asset,
        exiting: !assets.some((asset) => asset.id === item.asset.id),
      })),
      ...assets
        .filter((asset) => !current.some((item) => item.asset.id === asset.id))
        .map((asset) => ({ asset, exiting: false })),
    ]);
  }
  return (
    <div
      className={`selected-asset-chips ${assets.length ? "" : "selected-asset-chips--empty"}`}
      role="group"
      aria-label="已选择素材"
    >
      {visible.map(({ asset, exiting }) => (
        <span
          key={asset.id}
          className={exiting ? "is-exiting" : ""}
          aria-hidden={exiting || undefined}
          inert={exiting}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && exiting)
              setVisible((items) =>
                items.filter(
                  (item) => item.asset.id !== asset.id || !item.exiting,
                ),
              );
          }}
        >
          <AssetReferenceThumb asset={asset} />
          <span>
            <b>{assetName(asset)}</b>
            <small>{assetTypeLabel(asset)}</small>
          </span>
          <button
            type="button"
            aria-label={`移除素材 ${assetName(asset)}`}
            onClick={() => onRemove(asset)}
          >
            <X />
          </button>
          <AssetRoleSelect
            name={assetName(asset)}
            value={roles[`library:${asset.id}`]}
            onChange={(role) => onRole(asset.id, role)}
          />
        </span>
      ))}
    </div>
  );
}

function ConnectionBadge({ state }: { state: AgentConnectionState }) {
  if (state === "connected") return null;
  const label =
    state === "connecting"
      ? "正在连接"
      : state === "recovering"
        ? "正在恢复连接"
        : "连接已中断";
  return (
    <span
      className={`connection-badge connection-badge--${state}`}
      role="status"
    >
      <i />
      {label}
    </span>
  );
}

function ConnectionNotice({
  stalled,
  syncFailed,
  onRetry,
}: {
  stalled: boolean;
  syncFailed: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="connection-notice" role="status">
      <Warning />
      <div>
        <b>
          {syncFailed
            ? "任务状态暂未同步"
            : stalled
              ? "任务长时间没有新进度"
              : "实时连接已中断"}
        </b>
        <p>
          {syncFailed
            ? "当前显示的是上次同步的内容，请重新同步以确认任务进度。"
            : stalled
              ? "映芽仍会保留任务和队列，你可以重新同步最新状态。"
              : "当前内容不会丢失，重新连接后会补齐期间的进度。"}
        </p>
      </div>
      <button type="button" onClick={onRetry}>
        <ArrowClockwise />
        重新同步
      </button>
    </section>
  );
}

function ComposerAssetPicker({
  assets,
  folders,
  selected,
  onToggle,
  onClose,
}: {
  assets: AssetLibraryItem[];
  folders: AssetFolder[];
  selected: AssetLibraryItem[];
  onToggle: (asset: AssetLibraryItem) => void;
  onClose: () => void;
}) {
  return (
    <section className="composer-asset-picker" aria-label="选择创作素材">
      <header>
        <div>
          <b>选择参考文件</b>
          <span>所选文件随下一条消息加入项目</span>
        </div>
        <button type="button" aria-label="关闭素材选择" onClick={onClose}>
          <X />
        </button>
      </header>
      <AssetPicker
        assets={assets}
        folders={folders}
        selectedIds={selected.map((item) => item.id)}
        onToggle={onToggle}
      />
    </section>
  );
}

function ConversationFeed({
  projectId,
  entries,
  onQuickReply,
}: {
  projectId: string;
  entries: ConversationEntry[];
  onQuickReply: (value: string) => void;
}) {
  const initialMessages = useRef(
    new Set(
      entries
        .filter((entry) => entry.kind === "message")
        .map((entry) => entry.item.id),
    ),
  );
  const rows: ReactNode[] = [];
  let pendingActivities: TimelineActivity[] = [];
  const visibleActivityIds = new Set(
    compactTimelineActivities(
      entries.flatMap((entry) =>
        entry.kind === "activity" ? [entry.item] : [],
      ),
    ).map((activity) => activity.id),
  );
  const flushActivities = () => {
    if (!pendingActivities.length) return;
    const batch = pendingActivities;
    pendingActivities = [];
    rows.push(
      <ActivityFeed activities={batch} key={`activities-${batch[0].id}`} />,
    );
  };
  for (const entry of entries) {
    if (entry.kind === "activity") {
      if (visibleActivityIds.has(entry.item.id))
        pendingActivities.push(entry.item);
      continue;
    }
    flushActivities();
    rows.push(
      <MessageRow
        projectId={projectId}
        message={entry.item}
        animate={!initialMessages.current.has(entry.item.id)}
        onQuickReply={onQuickReply}
        key={entry.item.id}
      />,
    );
  }
  flushActivities();
  return <>{rows}</>;
}

export function compactTimelineActivities(activities: TimelineActivity[]) {
  const latestOperation = [...activities]
    .reverse()
    .find(
      (activity) =>
        activity.kind !== "assistant" && activity.kind !== "request",
    );
  return activities.filter(
    (activity) =>
      activity.kind === "assistant" ||
      activity.kind === "request" ||
      activity.id === latestOperation?.id,
  );
}

function MessageRow({
  projectId,
  message,
  animate,
  onQuickReply,
}: {
  projectId: string;
  message: AgentMessage;
  animate: boolean;
  onQuickReply: (value: string) => void;
}) {
  const quickReplies =
    message.role === "assistant" ? extractQuickReplies(message.text) : [];
  const planConfirmation = message.role === "user"
    && message.context.some(value => value.startsWith("checkpoint:"))
    && message.text.startsWith("当前制作方案已经确认");
  const visibleContext = message.context.filter(value => !value.startsWith("plan-revision:") && !value.startsWith("checkpoint:"));
  return (
    <article
      className={`message message--${message.role}${animate ? " message--new" : ""}`}
    >
      <div className="message-body">
        {!planConfirmation && visibleContext.length ? (
          <div className="context-line">
            {visibleContext.map((value) => (
              <span key={value}>{displayContext(value)}</span>
            ))}
          </div>
        ) : null}
        {message.role === "assistant" ? (
          <div className="message-markdown">
            <Suspense fallback={<div>{message.text}</div>}>
              <MarkdownPreview compact projectId={projectId}>
                {message.text}
              </MarkdownPreview>
            </Suspense>
          </div>
        ) : (
          <div>{planConfirmation ? "已确认方案，开始制作。" : message.text}</div>
        )}
        {message.feedback?.map((item) => (
          <FeedbackCard key={item.id} projectId={projectId} feedback={item} />
        ))}
        {message.attachments.length ? (
          <small>{message.attachments.length} 个附件</small>
        ) : null}
        {quickReplies.length ? (
          <div className="quick-replies" aria-label="选择下一步">
            {quickReplies.map((value) => (
              <button
                type="button"
                key={value}
                onClick={() => onQuickReply(value)}
              >
                <span>{value}</span>
                <ArrowRight />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function extractQuickReplies(text: string) {
  const replies: string[] = [];
  for (const match of text.matchAll(/^\s*\d+[.)、]\s+`([^`\n]+)`\s*$/gm)) {
    const value = match[1].trim();
    if (value && !replies.includes(value)) replies.push(value);
    if (replies.length === 4) break;
  }
  return replies;
}

export function extractInputChoices(text: string) {
  const explicitReplies = extractQuickReplies(text);
  if (explicitReplies.length) return explicitReplies;
  const choices: string[] = [];
  for (const match of text.matchAll(/^\s*[-*]\s+([^：:\n]{2,32})[：:]/gm)) {
    const value = match[1].trim();
    if (value && !choices.includes(value)) choices.push(value);
    if (choices.length === 4) break;
  }
  return choices;
}

function WaitingInputActions({
  choices,
  busy,
  onAnswer,
  onCompose,
}: {
  choices: string[];
  busy: boolean;
  onAnswer: (choice: string) => void;
  onCompose: () => void;
}) {
  if (!choices.length)
    return (
      <button className="primary-button" type="button" onClick={onCompose}>
        输入回答
        <ArrowRight />
      </button>
    );
  return (
    <>
      {choices.map((choice, index) => (
        <button
          className={index === 0 ? "primary-button" : "waiting-choice"}
          type="button"
          disabled={busy}
          key={choice}
          onClick={() => onAnswer(choice)}
        >
          <span>{choice}</span>
          {index === 0 ? <ArrowRight /> : null}
        </button>
      ))}
    </>
  );
}

function WaitingInputCard({
  choices,
  busy,
  onAnswer,
  onCompose,
}: {
  choices: string[];
  busy: boolean;
  onAnswer: (choice: string) => void;
  onCompose: () => void;
}) {
  return (
    <section className="waiting-input-card" aria-label="等待你的确认">
      <div className="waiting-input-icon">
        <Warning weight="fill" />
      </div>
      <div>
        <small>需要你的输入</small>
        <h2>等待你的确认</h2>
        <p>任务已暂停，回答后才会继续制作。</p>
      </div>
      <div className="waiting-input-actions">
        <WaitingInputActions
          choices={choices}
          busy={busy}
          onAnswer={onAnswer}
          onCompose={onCompose}
        />
      </div>
    </section>
  );
}

function ActivityFeed({ activities }: { activities: TimelineActivity[] }) {
  const primary = activities.filter(item => item.kind === "assistant" || item.kind === "request");
  const technical = activities.filter(item => item.kind !== "assistant" && item.kind !== "request");
  return <>{primary.map(activity => <ActivityRow key={activity.id} activity={activity}/>)}{technical.length ? <details className="production-details"><summary>制作详情 · {technical.some(item => item.status === "running") ? "正在处理" : "查看记录"}</summary>{technical.map(activity => <ActivityRow key={activity.id} activity={activity}/>)}</details> : null}</>;
}

function ActivityRow({ activity }: { activity: TimelineActivity }) {
  if (activity.kind === "assistant")
    return (
      <article className="agent-update">
        <p>{activity.summary}</p>
        {activity.status === "running" ? (
          <CircleNotch className="spin" />
        ) : null}
      </article>
    );
  if (
    activity.kind === "request" &&
    activity.event &&
    activity.status === "waiting"
  )
    return (
      <section className="activity-request">
        <header>
          <Warning />
          <b>{activity.title}</b>
        </header>
        <RequestControls event={activity.event} />
      </section>
    );
  const icon =
    activity.kind === "command" ? (
      <Terminal />
    ) : activity.kind === "file" ? (
      <File />
    ) : activity.kind === "plan" ? (
      <Check />
    ) : activity.kind === "system" ? (
      <Warning />
    ) : (
      <Code />
    );
  const statusLabel =
    activity.status === "running"
      ? "进行中"
      : activity.status === "waiting"
        ? "自动重试中"
        : activity.status === "failed"
          ? "失败"
          : activity.status === "interrupted"
            ? "已中断"
            : "完成";
  return (
    <div
      className={`activity-item activity-item--${activity.status}`}
      role={activity.kind === "system" ? "status" : undefined}
    >
      <div className="activity-item-content">
        <span className="activity-icon" key={activity.status}>
          {activity.status === "running" ? (
            <CircleNotch className="spin" />
          ) : activity.status === "failed" ? (
            <Warning />
          ) : activity.status === "completed" ? (
            <Check />
          ) : (
            icon
          )}
        </span>
        <b>
          {activity.status === "failed"
            ? `${activity.title}失败`
            : activity.title}
        </b>
        {activity.summary ? <em>{activity.summary}</em> : null}
        <small>{statusLabel}</small>
      </div>
    </div>
  );
}

function RequestControls({ event }: { event: AgentEvent }) {
  const payload = event.payload as Record<string, unknown>;
  const params = (payload.params ?? {}) as Record<string, unknown>;
  const questions = (params.questions ?? []) as Array<{
    id: string;
    header: string;
    question: string;
    options?: Array<{ label: string; description: string }>;
  }>;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState("");
  async function respond(result: unknown) {
    try {
      await api.respondToRequest(event.projectId, payload.id, result);
      setResolved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法响应请求");
    }
  }
  if (resolved)
    return (
      <div className="request-resolved">
        <Check />
        处理结果已提交
      </div>
    );
  if (event.method.includes("requestUserInput"))
    return (
      <div className="request-controls">
        {questions.map((question) => (
          <label key={question.id}>
            <b>{question.header || "需要你的输入"}</b>
            <span>{question.question}</span>
            {question.options?.length ? (
              <select
                value={answers[question.id] ?? ""}
                onChange={(change) =>
                  setAnswers((value) => ({
                    ...value,
                    [question.id]: change.target.value,
                  }))
                }
              >
                <option value="">请选择</option>
                {question.options.map((option) => (
                  <option value={option.label} key={option.label}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={answers[question.id] ?? ""}
                onChange={(change) =>
                  setAnswers((value) => ({
                    ...value,
                    [question.id]: change.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
        <div>
          <button
            onClick={() =>
              void respond({
                answers: Object.fromEntries(
                  questions.map((question) => [
                    question.id,
                    { answers: [answers[question.id] ?? ""] },
                  ]),
                ),
              })
            }
          >
            提交回答
          </button>
          <button onClick={() => void respond({ answers: {} })}>取消</button>
        </div>
        {error ? <small>{error}</small> : null}
      </div>
    );
  if (event.method.includes("permissions/requestApproval"))
    return (
      <div className="request-controls">
        <p>{String(params.reason ?? "Codex 请求临时扩展项目权限。")}</p>
        <div>
          <button
            onClick={() =>
              void respond({
                scope: "turn",
                permissions: params.permissions ?? {},
              })
            }
          >
            仅本次允许
          </button>
          <button onClick={() => void respond({ permissions: {} })}>
            拒绝
          </button>
        </div>
        {error ? <small>{error}</small> : null}
      </div>
    );
  if (event.method.includes("elicitation/request"))
    return (
      <div className="request-controls">
        <p>
          {String(
            params.message ??
              "外部工具请求输入；请先检查原始事件中的表单结构。",
          )}
        </p>
        <div>
          <button
            onClick={() => void respond({ action: "decline", content: null })}
          >
            拒绝请求
          </button>
          <button
            onClick={() => void respond({ action: "cancel", content: null })}
          >
            取消工具
          </button>
        </div>
        {error ? <small>{error}</small> : null}
      </div>
    );
  if (
    event.method === "execCommandApproval" ||
    event.method === "applyPatchApproval"
  )
    return (
      <div className="request-controls">
        <p>{String(params.reason ?? "Codex 请求执行受限操作。")}</p>
        <div>
          <button onClick={() => void respond({ decision: "allow" })}>
            允许
          </button>
          <button onClick={() => void respond({ decision: "deny" })}>
            拒绝
          </button>
        </div>
        {error ? <small>{error}</small> : null}
      </div>
    );
  return (
    <div className="request-controls">
      <p>{String(params.reason ?? "此操作需要你的批准。")}</p>
      <div>
        <button onClick={() => void respond({ decision: "accept" })}>
          仅本次允许
        </button>
        <button onClick={() => void respond({ decision: "decline" })}>
          拒绝
        </button>
      </div>
      {error ? <small>{error}</small> : null}
    </div>
  );
}

function CheckpointCard({
  title,
  summary,
  busy,
  confirming,
  onPreview,
  onConfirm,
}: {
  title: string;
  summary: string;
  busy: boolean;
  confirming: boolean;
  onPreview?: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="checkpoint-card">
      <div className="checkpoint-icon">
        <CheckCircle weight="fill" />
      </div>
      <div className="checkpoint-copy">
        <small>制作检查点</small>
        <h2>{title || "制作方案已就绪"}</h2>
        <p>{summary || "确认方向后开始制作视频。"}</p>
      </div>
      <div className="checkpoint-actions">
        {onPreview ? (
          <button className="checkpoint-preview" onClick={onPreview}>
            <Eye />
            查看方案
          </button>
        ) : null}
        <button
          className="primary-button primary-fill"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirming ? "正在提交…" : "查看方案并制作"}
          {confirming ? <CircleNotch className="spin" /> : <ArrowUp />}
        </button>
      </div>
    </section>
  );
}

function WorkflowRecoveryCard({
  briefing,
  incomplete,
  statusLabel,
  onRecover,
}: {
  briefing: boolean;
  incomplete: boolean;
  statusLabel: string;
  onRecover: (value: string) => void;
}) {
  const prompt = briefing ? "重新生成制作方案" : "检查并恢复项目流程";
  const failureReason = /usage limit|额度/i.test(statusLabel)
    ? "制作服务额度已用完。服务恢复后可以继续，已有成果不会丢失。"
    : /capacity|overloaded/i.test(statusLabel)
      ? "制作服务暂时繁忙，请稍后继续。"
      : statusLabel.replace(/^Codex 执行失败：(?:Codex turn failed:\s*)?/, "");
  const detail = briefing
    ? "已有资料和输入会保留，恢复后将继续整理可确认的制作方案。"
    : incomplete
      ? "现有文件和有效检查结果已保留。恢复时会先复用已有成果，只补齐缺失的版本与审核登记。"
      : "项目状态或产物不完整。恢复后会先检查现有文件，再回到正确的确认节点。";
  return (
    <section
      className={`workflow-recovery ${incomplete ? "workflow-recovery--incomplete" : ""}`}
      role={incomplete ? "status" : "alert"}
    >
      <Warning />
      <div>
        <b>{incomplete ? statusLabel : "制作需要恢复"}</b>
        <p>{!incomplete ? <>{failureReason}<br /></> : null}{detail}</p>
      </div>
      <button type="button" onClick={() => onRecover(prompt)}>
        {prompt}
        <ArrowRight />
      </button>
    </section>
  );
}

function ArtifactCanvas({
  onVideoDuration,
  onConfirm, confirming,
  onRevision,
  generationDisabled,
  onGeneratePreview,
  selectedVersionId,
  onSelectVersion,
  exportRequest,
  onDescribe,
  onFeedback,
  feedbackDisabled,
  project,
  activeTab,
  preview,
  libraryAssets,
  libraryFolders,
  selectedAssets,
  onClosePreview,
  onTab,
  onPreview,
  onContext,
  onSelectAssets,
  onTimedFeedback,
  onCompose,
  onRefresh,
}: {
  onVideoDuration: (path: string, duration: number) => void;
  onConfirm: (receipt: PlanReceipt) => void;
  confirming: boolean;
  onRevision: (revision: SceneRevision, file?: File) => void;
  generationDisabled: boolean;
  onGeneratePreview: () => void;
  selectedVersionId: string;
  onSelectVersion: (id: string) => void;
  exportRequest: number;
  onDescribe: () => void;
  onFeedback: (draft: FeedbackDraft) => void;
  feedbackDisabled: boolean;
  project: ProjectDetail;
  activeTab: CanvasTab;
  preview: {
    artifact: Artifact;
    content: string;
    loading: boolean;
    error: string;
  } | null;
  libraryAssets: AssetLibraryItem[];
  libraryFolders: AssetFolder[];
  selectedAssets: AssetLibraryItem[];
  onClosePreview: () => void;
  onTab: (value: CanvasTab) => void;
  onPreview: (artifact: Artifact) => void;
  onContext: (value: string) => void;
  onSelectAssets: (assets: AssetLibraryItem[]) => void;
  onCompose: (text: string) => void;
  onTimedFeedback: (
    versionId: string,
    videoPath: string,
    feedback: Array<{ time: number; description: string }>,
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportRequest) return;
    const frame = requestAnimationFrame(() => {
      exportRef.current?.scrollIntoView({
        block: "center",
        behavior: "instant",
      });
      exportRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [exportRequest]);
  const tabListRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const animation = animateElement(contentRef.current, [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ]);
    return () => animation?.cancel();
  }, [activeTab, preview?.artifact.id]);
  function navigateTab(event: KeyboardEvent<HTMLDivElement>) {
    const tabs: CanvasTab[] = ["plan", "preview", "artifacts"];
    const index = tabs.indexOf(activeTab);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onTab(tabs[next]);
    tabListRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }
  const [artifactQuery, setArtifactQuery] = useState("");
  const [artifactGroups, setArtifactGroups] = useState<string[]>([
    "video",
    "plan",
  ]);
  const versionId = selectedVersionId;
  const setVersionId = onSelectVersion;
  const [timeFeedback, setTimeFeedback] = useSavedState(
    `yingya-feedback:${project.id}:${versionId}`,
    z.array(
      z.object({ id: z.number(), time: z.number(), description: z.string() }),
    ),
    [],
  );
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [migratingFeedback, setMigratingFeedback] = useState(false);
  const migrationRef = useRef(false);
  const [rollbackError, setRollbackError] = useState("");
  const [annotation, setAnnotation] = useState<{
    frame: CapturedFrame;
    versionId: string;
    versionLabel: string;
    videoPath: string;
  } | null>(null);
  const [captureError, setCaptureError] = useState("");
  const [videoLoadError, setVideoLoadError] = useState(false);
  const [videoRetry, setVideoRetry] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const version = selectedProjectVersion(project, versionId);
  const workbench = useWorkbench(project.id, version?.id, project.updatedAt);
  const [playbackTime, setPlaybackTime] = useState(0);
  const view = workbench.data;
  const bindings = view?.sourceBindings?.scenes ?? [];
  const resolvedSceneId =
    sceneAtTime(view?.scenes ?? [], bindings, playbackTime)?.id || "";
  const versionMedia: AgentMedia = {
    scenes: view?.scenes ?? [],
    assets: (view?.assets ?? []).map((asset) => {
      const path = sourceFilePath(
        view?.sourcePath ?? ".",
        asset.hyperframesPath,
      );
      return { ...asset, url: path ? api.fileUrl(project.id, path) : "" };
    }),
  };
  useEffect(() => {
    setPlaybackTime(0);
  }, [version?.id]);
  const updatePlayback = useCallback((time: number) => {
    setPlaybackTime(Math.floor(time * 10) / 10);
  }, []);

  const finalVideoArtifact = [...project.manifest.artifacts]
    .reverse()
    .find(
      (value) => value.kind === "final-video" && value.version === version?.id,
    );
  const videoArtifact = version
    ? project.manifest.artifacts.find(
        (value) => value.kind.includes("video") && value.version === version.id,
      )
    : project.manifest.artifacts.find((value) => value.kind.includes("video"));
  const videoPath =
    finalVideoArtifact?.path ?? version?.videoPath ?? videoArtifact?.path;
  useEffect(() => {
    setVideoLoadError(false);
    if (!videoPath || activeTab !== "preview") return;
    const timer = window.setTimeout(() => { if (!videoRef.current || videoRef.current.readyState < 2) setVideoLoadError(true); }, 15000);
    return () => clearTimeout(timer);
  }, [videoPath, version?.id, activeTab, videoRetry]);
  const canAnnotate = Boolean(
    version &&
    videoPath &&
    (videoPath === version.videoPath ||
      project.manifest.artifacts.some(
        (a) => a.version === version.id && a.path === videoPath,
      )),
  );
  async function annotate() {
    if (
      !videoRef.current ||
      !version ||
      !videoPath ||
      capturing ||
      !canAnnotate
    )
      return;
    setCapturing(true);
    setCaptureError("");
    try {
      const frame = await captureFrame(videoRef.current);
      setAnnotation({
        frame,
        versionId: version.id,
        versionLabel: version.label,
        videoPath,
      });
    } catch (reason) {
      setCaptureError(
        reason instanceof Error
          ? reason.message
          : "截图失败，请使用文字时间点反馈",
      );
    } finally {
      setCapturing(false);
    }
  }
  const completedFeedback = timeFeedback.filter((item) =>
    item.description.trim(),
  );
  const playbackKey = `yingya-video-time:${project.id}:${version?.id ?? "current"}`;
  useLayoutEffect(() => {
    const video = videoRef.current;
    // Capture the node before a tab/version change removes it. A paused seek does not
    // emit another pause event, so saving only onPause loses the playhead on navigation.
    return () => {
      if (video) saveVideoTime(video, playbackKey);
    };
  }, [activeTab, preview?.artifact.id, playbackKey, videoPath]);

  useEffect(() => {
    if (
      versionId &&
      project.manifest.versions.some((version) => version.id === versionId)
    )
      return;
    setVersionId(
      project.manifest.currentDraft ??
        project.manifest.versions.at(-1)?.id ??
        "",
    );
  }, [project.manifest.currentDraft, project.manifest.versions, versionId]);

  async function rollback() {
    if (!version || rollbackBusy) return;
    setRollbackBusy(true);
    setRollbackError("");
    try {
      await api.rollbackVersion(project.id, version.id);
      await onRefresh();
    } catch (reason) {
      setRollbackError(
        reason instanceof Error ? reason.message : "版本回退失败",
      );
    } finally {
      setRollbackBusy(false);
    }
  }
  function addTimeFeedback() {
    if (!version || !videoPath || feedbackDisabled) return;
    videoRef.current?.pause();
    onFeedback({
      id: createClientRequestId(),
      kind: "video-time",
      versionId: version.id,
      videoPath,
      timeSeconds: videoRef.current?.currentTime ?? 0,
      note: "",
      createdAt: Date.now(),
    });
  }
  function updateTimeFeedback(id: number, description: string) {
    setTimeFeedback((items) =>
      items.map((item) => (item.id === id ? { ...item, description } : item)),
    );
  }
  async function applyTimeFeedback() {
    if (
      !version ||
      !videoPath ||
      !completedFeedback.length ||
      migrationRef.current
    )
      return;
    migrationRef.current = true;
    setMigratingFeedback(true);
    try {
      await onTimedFeedback(version.id, videoPath, completedFeedback);
      setTimeFeedback((items) =>
        items.filter((item) => !item.description.trim()),
      );
    } catch (reason) {
      setCaptureError(
        reason instanceof Error ? reason.message : "草稿转换失败，请重试",
      );
    } finally {
      migrationRef.current = false;
      setMigratingFeedback(false);
    }
  }

  return (
    <section className="artifact-canvas" aria-label="作品工作区">
      {annotation ? (
        <VideoAnnotationEditor
          projectId={project.id}
          {...annotation}
          onAdd={onFeedback}
          onClose={() => setAnnotation(null)}
        />
      ) : null}
      <header>
        <div className="canvas-version">
          <span className="canvas-label">{"预览版本"}</span>
          {project.manifest.versions.length ? (
            <select
              aria-label="视频版本"
              value={version?.id ?? ""}
              onChange={(event) => {
                setVersionId(event.target.value);
                writeStringSetting(
                  `yingya-version:${project.id}`,
                  event.target.value,
                );
              }}
            >
              {project.manifest.versions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label.replace(/草稿/g, "视频")}
                </option>
              ))}
            </select>
          ) : (
            <h2>作品预览</h2>
          )}
        </div>
        <div
          className="canvas-tabs"
          ref={tabListRef}
          onKeyDown={navigateTab}
          role="tablist"
          aria-label="项目工作台"
        >
          <SelectionIndicator value={activeTab} line />
          {(["plan", "preview", "artifacts"] as CanvasTab[]).map((tab) => (
            <button
              role="tab"
              id={`canvas-tab-${tab}`}
              aria-controls="canvas-content"
              tabIndex={activeTab === tab ? 0 : -1}
              aria-selected={activeTab === tab}
              className={activeTab === tab ? "active" : ""}
              key={tab}
              onClick={() => onTab(tab)}
            >
              {canvasTabLabel(tab)}
              {tab === "assets" && selectedAssets.length ? (
                <span>{selectedAssets.length}</span>
              ) : tab === "artifacts" && project.manifest.artifacts.length ? (
                <span>{project.manifest.artifacts.length}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div>
          <button className="mobile-production-details" onClick={() => onTab(activeTab === "artifacts" ? "plan" : "artifacts")}>{activeTab === "artifacts" ? "返回方案" : "制作详情"}</button>
          {workflowState(project).sourceNotice ? (
            <span
              className="dirty-chip"
              title={workflowState(project).sourceNotice}
            >
              源文件有更新
            </span>
          ) : null}
        </div>
      </header>
      {rollbackError ? (
        <p className="form-error" role="alert">
          {rollbackError}
        </p>
      ) : null}
      <div
        className="canvas-content"
        id="canvas-content"
        role="tabpanel"
        aria-labelledby={`canvas-tab-${activeTab}`}
        ref={contentRef}
      >
        {preview ? (
          <InlineArtifactPreview
            projectId={project.id}
            preview={preview}
            onClose={onClosePreview}
          />
        ) : (
          <>
            {activeTab === "plan" ? <PlanDocument project={project} onCompose={onCompose} onConfirm={onConfirm} confirming={confirming}/> : null}
            {activeTab === "preview" ? (
              <section className="preview-panel preview-panel--with-inspector">
                <div className="preview-main">
                  <div className="section-heading">
                    <h3>
                      {videoPath
                        ? finalVideoArtifact
                          ? "已导出视频"
                          : "视频预览"
                        : "创作方案"}
                    </h3>
                    <span>{project.aspectRatio}</span>
                  </div>
                  {project.activeTurnId && version ? (
                    <div className="preview-version-notice">
                      <CircleNotch className="spin" />
                      <span>
                        正在生成新版，当前预览为{" "}
                        {version.label.replace(/草稿/g, "视频")}
                      </span>
                    </div>
                  ) : null}
                  <div
                    className={`preview-stage-shell ${videoPath ? "" : "preview-stage-shell--planning"}`}
                  >
                    <div
                      className={`video-stage ${project.aspectRatio === "9:16" ? "portrait" : project.aspectRatio === "1:1" ? "square" : ""}`}
                    >
                      {videoPath ? (
                        <video
                          aria-label="视频预览"
                          playsInline
                          key={`${version?.id}:${videoPath}:${videoRetry}`}
                          ref={videoRef}
                          src={api.fileUrl(project.id, videoPath)}
                          controls
                          onLoadedData={(event) =>
                            animateElement(event.currentTarget, [
                              { opacity: 0.4 },
                              { opacity: 1 },
                            ])
                          }
                          onError={() => setVideoLoadError(true)}
                          onCanPlay={() => setVideoLoadError(false)}
                          onLoadedMetadata={(event) => {
                            onVideoDuration(videoPath, event.currentTarget.duration);
                            restoreVideoTime(event.currentTarget, playbackKey);
                            updatePlayback(event.currentTarget.currentTime);
                          }}
                          onTimeUpdate={(event) => {
                            updatePlayback(event.currentTarget.currentTime);
                          }}
                          onPause={(event) =>
                            saveVideoTime(event.currentTarget, playbackKey)
                          }
                          onSeeked={(event) => {
                            saveVideoTime(event.currentTarget, playbackKey);
                            updatePlayback(event.currentTarget.currentTime);
                          }}
                        />
                      ) : (
                        <div className="planning-empty">
                          <FileText />
                          <h3>
                            {project.manifest.phase === "plan_review"
                              ? "制作方案待确认"
                              : "先梳理内容与素材"}
                          </h3>
                          <p>
                            {project.manifest.checkpoint?.summary ||
                              "提供要讲的内容、目标受众和素材，映芽会整理画面、动画与旁白安排，确认后开始制作。"}
                          </p>
                          <PlanDocument
                            project={project}
                            compact={Boolean(view?.scenes.length)}
                          />
                          {project.manifest.checkpoint?.artifactIds
                            .map((id) =>
                              project.manifest.artifacts.find(
                                (item) => item.id === id,
                              ),
                            )
                            .filter((item): item is Artifact => Boolean(item))
                            .map((item) => (
                              <button
                                key={item.id}
                                onClick={() => onPreview(item)}
                              >
                                <Eye />
                                查看{item.label}
                              </button>
                            ))}
                          <button type="button" onClick={onDescribe}>
                            <PencilSimple />
                            去对话补充要求
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {videoPath ? (
                    <>
                      {videoLoadError ? <p className="form-error" role="alert">视频暂时无法读取，已有作品和意见仍已保留。<button onClick={() => setVideoRetry(value => value + 1)}>重新加载视频</button></p> : null}
                      <div className="canvas-actions">
                        <button
                          type="button"
                          disabled={!canAnnotate || videoLoadError || feedbackDisabled}
                          onClick={addTimeFeedback}
                        >
                          <Clock />
                          对此处提修改
                        </button>
                        <button
                          type="button"
                          disabled={
                            !canAnnotate || videoLoadError || feedbackDisabled || capturing
                          }
                          onClick={() => void annotate()}
                        >
                          <BoundingBox />
                          {capturing ? "正在截取…" : "框选画面"}
                        </button>
                        {version &&
                        version.id !== project.manifest.currentDraft ? (
                          <button
                            disabled={
                              rollbackBusy || Boolean(project.activeTurnId)
                            }
                            onClick={() => void rollback()}
                          >
                            <ArrowClockwise />
                            {rollbackBusy ? "正在回退…" : "回退版本"}
                          </button>
                        ) : null}
                      </div>
                      {captureError ? (
                        <p className="form-error" role="alert">
                          {captureError}。可使用“对此处提修改”填写文字意见。
                        </p>
                      ) : null}
                      {timeFeedback.length ? (
                        <section
                          className="time-feedback"
                          aria-label="时间点修改"
                        >
                          <header>
                            <b>旧版时间点草稿</b>
                            <span>{timeFeedback.length} 条</span>
                          </header>
                          <div className="time-feedback-list">
                            {timeFeedback.map((item, index) => (
                              <div className="time-feedback-row" key={item.id}>
                                <time>{formatTimestamp(item.time)}</time>
                                <input
                                  autoFocus={index === timeFeedback.length - 1}
                                  aria-label={`${formatTimestamp(item.time)} 的修改描述`}
                                  value={item.description}
                                  onChange={(event) =>
                                    updateTimeFeedback(
                                      item.id,
                                      event.target.value,
                                    )
                                  }
                                  placeholder="描述这个时间点需要如何修改"
                                />
                                <button
                                  aria-label={`删除 ${formatTimestamp(item.time)} 的反馈`}
                                  title="删除反馈"
                                  onClick={() =>
                                    setTimeFeedback((items) =>
                                      items.filter(
                                        (value) => value.id !== item.id,
                                      ),
                                    )
                                  }
                                >
                                  <X />
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            className="time-feedback-apply"
                            disabled={
                              !completedFeedback.length ||
                              migratingFeedback ||
                              feedbackDisabled
                            }
                            onClick={() => void applyTimeFeedback()}
                          >
                            <ArrowLeft />
                            转为反馈卡片
                          </button>
                        </section>
                      ) : null}
                    </>
                  ) : null}
                  {view?.scenes.length ? (
                    <ProductStoryboard
                      scenes={versionMedia.scenes}
                      assets={versionMedia.assets}
                      selectedId={version ? resolvedSceneId : undefined}
                      versionId={version?.id}
                      scenesRevision={view.scenesRevision}
                      disabled={generationDisabled}
                      onCompose={onCompose}
                      onRevision={onRevision}
                      onBeginRevision={() => videoRef.current?.pause()}
                      onSelect={(scene) => {
                        const time = sceneStart(scene, bindings);
                        if (time !== undefined && videoRef.current) {
                          videoRef.current.pause();
                          writeNumberSetting(playbackKey, time);
                          videoRef.current.currentTime = time;
                          updatePlayback(time);
                        }
                      }}
                    />
                  ) : null}
                  {workbench.error ? (
                    <p className="form-error" role="alert">
                      素材信息读取失败：{workbench.error}
                      <button type="button" onClick={workbench.refresh}>
                        重试
                      </button>
                    </p>
                  ) : null}
                  <FeedbackResults project={project} onRetry={onFeedback} onView={(id,time) => { if (time !== undefined) writeNumberSetting(`yingya-video-time:${project.id}:${id}`, time); setVersionId(id); if (id === version?.id && time !== undefined && videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = time; } }}/>
                  {version ? (
                    <VersionComparison project={project} current={version} />
                  ) : null}
                  <div
                    ref={exportRef}
                    className="export-destination"
                    role="group"
                    tabIndex={-1}
                    aria-label="导出设置"
                  >
                    {version ? (
                      <PersistentRenderPanel
                        onGeneratePreview={onGeneratePreview}
                        generationDisabled={generationDisabled}
                        project={project}
                        version={version}
                        videoPath={videoPath}
                        exportRequest={exportRequest}
                        onRefresh={onRefresh}
                      />
                    ) : exportRequest ? (
                      <p role="status">
                        请先确认制作方案并完成动画编排，预览满意后在这里导出成片。
                      </p>
                    ) : null}
                  </div>
                </div>
                <PreviewAssetInspector
                  projectId={project.id}
                  sourcePath={view?.sourcePath ?? "."}
                  bindings={bindings}
                  selectedSceneId={resolvedSceneId}
                  playbackTime={playbackTime}
                  loading={!workbench.data}
                  media={versionMedia}
                  libraryAssets={libraryAssets}
                  selectedAssets={selectedAssets}
                  onSelect={(asset) => onSelectAssets([asset])}
                />
              </section>
            ) : null}
            {activeTab === "assets" || activeTab === "artifacts" ? (
              <>
                <AudioLibrary
                  projectId={project.id}
                  onRefresh={onRefresh}
                  onCompose={onCompose}
                />
                <ProjectAssetsPanel
                  media={versionMedia}
                  libraryAssets={libraryAssets}
                  libraryFolders={libraryFolders}
                  selectedAssets={selectedAssets}
                  onSelect={(asset) => onSelectAssets([asset])}
                  onSelectFolder={onSelectAssets}
                />
              </>
            ) : null}
            {activeTab === "artifacts" ? (
              <ArtifactList
                artifacts={project.manifest.artifacts}
                query={artifactQuery}
                onQuery={setArtifactQuery}
                expanded={artifactGroups}
                onExpanded={setArtifactGroups}
                onPreview={onPreview}
                onContext={onContext}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function ProjectAssetsPanel({
  media,
  libraryAssets,
  libraryFolders,
  selectedAssets,
  onSelect,
  onSelectFolder,
}: {
  media: AgentMedia;
  libraryAssets: AssetLibraryItem[];
  libraryFolders: AssetFolder[];
  selectedAssets: AssetLibraryItem[];
  onSelect: (asset: AssetLibraryItem) => void;
  onSelectFolder: (assets: AssetLibraryItem[]) => void;
}) {
  const [folderId, setFolderId] = useState("*");
  const visibleAssets =
    folderId === "*"
      ? libraryAssets
      : libraryAssets.filter((asset) => (asset.folderId ?? "") === folderId);
  const selectableAssets = visibleAssets.filter(
    (asset) => !selectedAssets.some((item) => item.id === asset.id),
  );
  return (
    <section className="project-assets-panel">
      <div className="section-heading">
        <div>
          <h3>参考文件</h3>
          <p>图片、视频、音频、文档及其他文件都可加入当前创作对话。</p>
        </div>
        <span>{media.assets.length} 项已进入项目</span>
      </div>
      {media.assets.length ? (
        <section className="project-media-section">
          <h4>项目中</h4>
          <div>
            {media.assets.map((asset) => (
              <article key={asset.id}>
                {asset.url && asset.mediaType?.startsWith("image/") ? (
                  <img src={asset.url} alt="" />
                ) : (
                  <span>
                    <File />
                  </span>
                )}
                <div>
                  <b>{displayFileName(asset.name)}</b>
                  <small>
                    {asset.source === "upload" ? "对话参考" : asset.source}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="project-library-section">
        <div className="project-library-heading">
          <div>
            <h4>全局素材库</h4>
            <span>{visibleAssets.length} 个文件</span>
          </div>
          <div className="project-library-controls">
            <label>
              <FolderSimple />
              <select
                aria-label="筛选素材文件夹"
                value={folderId}
                onChange={(event) => setFolderId(event.target.value)}
              >
                <option value="*">全部文件夹</option>
                <option value="">未整理</option>
                {libraryFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
            {folderId !== "*" && visibleAssets.length ? (
              <button
                type="button"
                disabled={!selectableAssets.length}
                onClick={() => onSelectFolder(selectableAssets)}
              >
                <FolderSimple />
                {selectableAssets.length ? "选择此文件夹" : "文件夹已选择"}
              </button>
            ) : null}
          </div>
        </div>
        {visibleAssets.length ? (
          <div className="project-library-grid">
            {visibleAssets.map((asset) => {
              const selected = selectedAssets.some(
                (item) => item.id === asset.id,
              );
              return (
                <article key={asset.id}>
                  <AssetReferenceThumb asset={asset} />
                  <div>
                    <b>{assetName(asset)}</b>
                    <small>
                      {assetTypeLabel(asset)} ·{" "}
                      {asset.kind === "generated" ? "AI 生成" : "已上传"}
                    </small>
                  </div>
                  <button
                    disabled={selected}
                    aria-label={`${selected ? "已选择" : "选择参考文件"} ${assetName(asset)}`}
                    onClick={() => onSelect(asset)}
                  >
                    {selected ? <Check /> : <Plus />}
                    {selected ? "已加入" : "加入提示"}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="workbench-empty">
            <File />
            <b>这个文件夹暂无素材</b>
            <p>可前往素材工坊上传任意类型的参考文件。</p>
          </div>
        )}
      </section>
    </section>
  );
}

function PreviewAssetInspector({
  projectId,
  sourcePath,
  bindings,
  selectedSceneId,
  playbackTime,
  loading,
  media,
  libraryAssets,
  selectedAssets,
  onSelect,
}: {
  projectId: string;
  sourcePath: string;
  bindings: import("../types").SourceBinding[];
  selectedSceneId: string;
  playbackTime: number;
  loading: boolean;
  media: AgentMedia;
  libraryAssets: AssetLibraryItem[];
  selectedAssets: AssetLibraryItem[];
  onSelect: (asset: AssetLibraryItem) => void;
}) {
  const scene =
    media.scenes.find((value) => value.id === selectedSceneId) ??
    sceneAtTime(media.scenes, bindings, playbackTime);
  const sceneAssets = scene
    ? scene.assetIds
        .map((id) => media.assets.find((asset) => asset.id === id))
        .filter((asset): asset is AgentMedia["assets"][number] =>
          Boolean(asset),
        )
    : [];
  const clip = scene && sourceClip(scene, bindings);
  const path = clip && sourceFilePath(sourcePath, clip.source);
  return (
    <aside className="preview-asset-inspector" aria-label="当前镜头素材">
      <header>
        <div>
          <b>
            {scene
              ? `镜头 ${String(media.scenes.indexOf(scene) + 1).padStart(2, "0")}`
              : "当前播放位置"}
          </b>
          <span>
            {formatTimestamp(playbackTime)} ·{" "}
            {scene?.narrativeRole || "所选版本"}
          </span>
        </div>
      </header>
      <section>
        <h4>已使用素材</h4>
        {loading ? (
          <p>正在读取版本素材…</p>
        ) : !scene ? (
          <p>这个时间点暂无已登记的素材。</p>
        ) : (
          <>
            {clip && path ? (
              <article className="inspector-source">
                <VideoCamera />
                <div>
                  <b>
                    {displayFileName(
                      clip.source.split("/").at(-1) ?? clip.source,
                    )}
                  </b>
                  <small>
                    源 {formatTimestamp(clip.sourceIn)}–
                    {formatTimestamp(clip.sourceOut)}
                  </small>
                  <a
                    href={api.fileUrl(projectId, path)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开源文件
                  </a>
                </div>
              </article>
            ) : null}
            {sceneAssets.length ? (
              <div className="preview-used-assets">
                {sceneAssets.map((asset) => (
                  <article key={asset.id}>
                    {asset.url && asset.mediaType?.startsWith("image/") ? (
                      <img src={asset.url} alt="" />
                    ) : (
                      <span>
                        <File />
                      </span>
                    )}
                    <div>
                      <b>{displayFileName(asset.name)}</b>
                      <small>{asset.description || asset.source}</small>
                    </div>
                  </article>
                ))}
              </div>
            ) : !clip ? (
              <p>此镜头没有已登记的素材绑定。</p>
            ) : null}
          </>
        )}
      </section>
      <section>
        <div className="inspector-section-title">
          <h4>全局素材库</h4>
          <span>{libraryAssets.length}</span>
        </div>
        <div className="preview-library-strip">
          {libraryAssets.slice(0, 6).map((asset) => {
            const selected = selectedAssets.some(
              (item) => item.id === asset.id,
            );
            return (
              <button
                key={asset.id}
                disabled={selected}
                aria-label={`${selected ? "已加入" : "加入提示"} ${assetName(asset)}`}
                onClick={() => onSelect(asset)}
              >
                <AssetReferenceThumb asset={asset} />
                <span>{selected ? <Check /> : <Plus />}</span>
              </button>
            );
          })}
        </div>
      </section>
      <p className="preview-inspector-hint">
        已使用素材跟随所选版本和当前播放镜头；新选择的素材将在发送消息后加入项目。
      </p>
    </aside>
  );
}

function InlineArtifactPreview({
  projectId,
  preview,
  onClose,
}: {
  projectId: string;
  preview: {
    artifact: Artifact;
    content: string;
    loading: boolean;
    error: string;
  };
  onClose: () => void;
}) {
  const kind = filePreviewKind(preview.artifact.path);
  const [source, setSource] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    setSource(false);
    setMediaError(false);
  }, [preview.artifact.id]);
  const url = api.fileUrl(projectId, preview.artifact.path);
  return (
    <section
      className="artifact-inline-preview"
      aria-label={`${preview.artifact.label}预览`}
    >
      <header>
        <button aria-label="返回项目产物" onClick={onClose}>
          <ArrowLeft />
        </button>
        <div>
          <small>项目文件</small>
          <h2>{preview.artifact.label}</h2>
          <span>{preview.artifact.path}</span>
        </div>
        <a href={url} download>
          下载文件
        </a>
        {kind === "markdown" ? (
          <div
            className="artifact-view-toggle"
            role="group"
            aria-label="产物查看方式"
          >
            <button aria-pressed={!source} onClick={() => setSource(false)}>
              预览
            </button>
            <button aria-pressed={source} onClick={() => setSource(true)}>
              源码
            </button>
          </div>
        ) : null}
      </header>
      <div>
        {preview.loading ? (
          <p role="status">正在读取文件…</p>
        ) : preview.error || mediaError ? (
          <p className="form-error" role="alert">
            {preview.error || "文件无法预览，可尝试下载或重新打开。"}
          </p>
        ) : kind === "image" ? (
          <img
            className="artifact-media"
            src={url}
            alt={preview.artifact.label}
            onError={() => setMediaError(true)}
          />
        ) : kind === "video" ? (
          <video
            className="artifact-media"
            src={url}
            controls
            onError={() => setMediaError(true)}
          />
        ) : kind === "audio" ? (
          <audio src={url} controls onError={() => setMediaError(true)} />
        ) : kind === "download" ? (
          <p>此文件暂不支持在线预览，请下载后查看。</p>
        ) : kind === "markdown" && !source ? (
          <div className="markdown-body">
            <Suspense fallback={<p>正在加载预览…</p>}>
              <MarkdownPreview projectId={projectId}>
                {preview.content}
              </MarkdownPreview>
            </Suspense>
          </div>
        ) : (
          <pre className="artifact-source">{preview.content}</pre>
        )}
      </div>
    </section>
  );
}

function formatTimestamp(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
function canvasTabLabel(tab: CanvasTab) {
  return ({ preview: "视频", plan: "方案", assets: "素材", artifacts: "制作详情" } as const)[tab];
}
function savedCanvasTab(projectId: string): CanvasTab {
  const value = readStringSetting(`yingya-canvas-tab:${projectId}`, "preview");
  return value === "plan" || value === "artifacts" ? value : "preview";
}
function savedVersionId(project: ProjectDetail) {
  const fallback =
    project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? "";
  const saved = readStringSetting(`yingya-version:${project.id}`, fallback);
  return project.manifest.versions.some((version) => version.id === saved)
    ? saved
    : fallback;
}
function restoreVideoTime(video: HTMLVideoElement, key: string) {
  const saved = readNumberSetting(key, 0);
  if (saved > 0 && Number.isFinite(video.duration))
    video.currentTime = Math.min(saved, Math.max(0, video.duration - 0.1));
}
function saveVideoTime(video: HTMLVideoElement, key: string) {
  if (
    video.readyState >= 1 &&
    Number.isFinite(video.currentTime) &&
    video.currentTime >= 0
  )
    writeNumberSetting(key, video.currentTime);
}
function assetName(asset: AssetLibraryItem) {
  return asset.sourceName?.trim() || asset.prompt?.trim() || "未命名素材";
}
function displayFileName(name: string) {
  return name.replace(/(\.[a-z0-9]{1,10})\1$/i, "$1");
}
function assetTypeLabel(asset: AssetLibraryItem) {
  return (
    {
      image: "图片",
      video: "视频",
      audio: "音频",
      document: "文档",
      file: "文件",
    } as const
  )[asset.category];
}
function AssetReferenceThumb({ asset }: { asset: AssetLibraryItem }) {
  if (asset.category === "image")
    return (
      <span className="asset-reference-thumb">
        <img src={asset.url} alt="" />
      </span>
    );
  if (asset.category === "video")
    return (
      <span className="asset-reference-thumb">
        <VideoCamera />
      </span>
    );
  if (asset.category === "audio")
    return (
      <span className="asset-reference-thumb">
        <FileAudio />
      </span>
    );
  if (asset.category === "document")
    return (
      <span className="asset-reference-thumb">
        <FileText />
      </span>
    );
  return (
    <span className="asset-reference-thumb">
      <File />
    </span>
  );
}
async function uploadLibraryAsset(projectId: string, asset: AssetLibraryItem) {
  return api.importLibraryAsset(asset.id, projectId);
}
function savedWidth(key: string, fallback: number) {
  return readNumberSetting(key, fallback);
}

function displayContext(value: string) {
  if (value.startsWith("editor-target:")) {
    try {
      const target = JSON.parse(value.slice(14));
      return `当前选择：${target.sceneName}${target.elementName ? ` · ${target.elementName}` : ""}`;
    } catch {
      return "当前镜头";
    }
  }
  if (!value.startsWith(sceneRevisionPrefix)) return value;
  try {
    return sceneRevisionLabel(
      sceneRevisionSchema.parse(
        JSON.parse(value.slice(sceneRevisionPrefix.length)),
      ),
    );
  } catch {
    return "镜头修改信息";
  }
}
