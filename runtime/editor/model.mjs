// Shared by the editor, server and agent CLI. No browser or filesystem dependencies.
export const SCHEMA_VERSION = 1;
export const TRACK_KINDS = ["visual", "text", "audio"];
export const ELEMENT_KINDS = ["text", "shape", "image", "video", "audio"];
export const FONTS = ["sans", "serif", "mono"];
export const ANIMATIONS = ["none", "fade", "rise", "scale"];
const clone = (value) => structuredClone(value);
const fail = (message) => {
  throw new Error(message);
};
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const finite = (n, min, max) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const id = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const color = (value) =>
  typeof value === "string" && /^#[a-f0-9]{6}$/i.test(value);
const text = (value, limit) =>
  typeof value === "string" && value.length <= limit;
export function assetPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length < 1000 &&
    !/[\\\x00-\x1f?#:]/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
function keys(value, allowed, label) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail(`${label}包含不支持的字段`);
}
export function validateDocument(doc) {
  keys(
    doc,
    ["schemaVersion", "width", "height", "fps", "scenes", "tracks", "brandId"],
    "工程",
  );
  if (
    doc.schemaVersion !== SCHEMA_VERSION ||
    !finite(doc.width, 128, 4096) ||
    !finite(doc.height, 128, 4096) ||
    !finite(doc.fps, 1, 120) ||
    !Number.isInteger(doc.width) ||
    !Number.isInteger(doc.height) ||
    !Number.isInteger(doc.fps)
  )
    fail("工程画幅或帧率无效");
  if (
    !Array.isArray(doc.scenes) ||
    doc.scenes.length > 200 ||
    !Array.isArray(doc.tracks) ||
    doc.tracks.length < 1 ||
    doc.tracks.length > 32
  )
    fail("最多支持 200 个镜头、32 条轨道");
  if (doc.brandId !== undefined && !id(doc.brandId)) fail("品牌标识无效");
  const ids = new Set();
  const unique = (value) => {
    if (!id(value) || ids.has(value)) fail("元素、镜头和轨道需要唯一标识");
    ids.add(value);
  };
  for (const track of doc.tracks) {
    keys(track, ["id", "name", "kind", "muted", "locked"], "轨道");
    unique(track.id);
    if (
      !text(track.name, 100) ||
      !TRACK_KINDS.includes(track.kind) ||
      typeof track.muted !== "boolean" ||
      typeof track.locked !== "boolean"
    )
      fail("轨道参数无效");
  }
  let total = 0,
    count = 0;
  for (const scene of doc.scenes) {
    keys(
      scene,
      ["id", "name", "duration", "background", "elements", "styleId"],
      "镜头",
    );
    unique(scene.id);
    if (
      !text(scene.name, 200) ||
      !finite(scene.duration, 0.1, 3600) ||
      !color(scene.background) ||
      !Array.isArray(scene.elements)
    )
      fail("镜头参数无效");
    if (scene.styleId !== undefined && !id(scene.styleId)) fail("风格标识无效");
    total += scene.duration;
    count += scene.elements.length;
    for (const el of scene.elements) {
      keys(
        el,
        [
          "id",
          "kind",
          "trackId",
          "name",
          "start",
          "duration",
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "opacity",
          "text",
          "font",
          "fontSize",
          "fontWeight",
          "align",
          "color",
          "fill",
          "radius",
          "source",
          "sourceIn",
          "sourceDuration",
          "volume",
          "fit",
          "animation",
        ],
        "元素",
      );
      unique(el.id);
      const track = doc.tracks.find((t) => t.id === el.trackId);
      if (
        !track ||
        !ELEMENT_KINDS.includes(el.kind) ||
        (el.kind === "audio"
          ? track.kind !== "audio"
          : el.kind === "text"
            ? track.kind !== "text"
            : track.kind !== "visual")
      )
        fail("元素与轨道类型不匹配");
      if (
        !text(el.name, 200) ||
        !finite(el.start, 0, scene.duration) ||
        !finite(el.duration, 0.05, scene.duration) ||
        el.start + el.duration > scene.duration + 0.00001
      )
        fail("元素时间超出镜头");
      if (
        !finite(el.x, -8192, 8192) ||
        !finite(el.y, -8192, 8192) ||
        !finite(el.width, 1, 8192) ||
        !finite(el.height, 1, 8192) ||
        !finite(el.rotation, -360, 360) ||
        !finite(el.opacity, 0, 1) ||
        !finite(el.radius, 0, 4096)
      )
        fail("元素位置或尺寸无效");
      if (
        !color(el.color) ||
        !color(el.fill) ||
        !ANIMATIONS.includes(el.animation)
      )
        fail("元素配色或动效无效");
      if (
        !FONTS.includes(el.font) ||
        !finite(el.fontSize, 8, 600) ||
        ![400, 500, 600, 700, 800, 900].includes(el.fontWeight) ||
        !["left", "center", "right"].includes(el.align) ||
        !text(el.text, 10000)
      )
        fail("文字格式无效");
      if (
        !["cover", "contain"].includes(el.fit) ||
        !finite(el.volume, 0, 1) ||
        !finite(el.sourceIn, 0, 86400)
      )
        fail("素材参数无效");
      if (
        ["image", "video", "audio"].includes(el.kind) &&
        !assetPath(el.source)
      )
        fail("素材必须来自当前项目");
      if (el.kind === "video" || el.kind === "audio") {
        if (
          !finite(el.sourceDuration, 0.05, 86400) ||
          el.sourceIn + el.duration > el.sourceDuration + 0.05
        )
          fail("裁切超出素材实测时长");
      } else if (el.sourceDuration !== null) fail("非音视频元素不应含素材时长");
    }
  }
  if (total > 3600 || count > 2000 || JSON.stringify(doc).length > 2_000_000)
    fail("工程超过一小时或元素数量上限");
  return doc;
}
export function emptyDocument(aspect = "16:9") {
  const [width, height] =
    aspect === "9:16"
      ? [720, 1280]
      : aspect === "1:1"
        ? [1080, 1080]
        : [1280, 720];
  return {
    schemaVersion: 1,
    width,
    height,
    fps: 30,
    scenes: [],
    tracks: [
      {
        id: "track-visual",
        name: "画面",
        kind: "visual",
        muted: false,
        locked: false,
      },
      {
        id: "track-text",
        name: "文字",
        kind: "text",
        muted: false,
        locked: false,
      },
      {
        id: "track-audio",
        name: "声音",
        kind: "audio",
        muted: false,
        locked: false,
      },
    ],
  };
}
export function newElement(elementId, kind, scene, doc) {
  const track = doc.tracks.find(
    (t) =>
      t.kind ===
        (kind === "text" ? "text" : kind === "audio" ? "audio" : "visual") &&
      !t.locked,
  );
  if (!track) fail("请先添加或解锁对应轨道");
  return {
    id: elementId,
    kind,
    trackId: track.id,
    name: kind === "text" ? "文字" : "素材",
    start: 0,
    duration: scene.duration,
    x: doc.width * 0.1,
    y: doc.height * 0.35,
    width: doc.width * 0.8,
    height: doc.height * 0.3,
    rotation: 0,
    opacity: 1,
    text: kind === "text" ? "输入你的文字" : "",
    font: "sans",
    fontSize: 64,
    fontWeight: 600,
    align: "center",
    color: "#24262b",
    fill: "#ffffff",
    radius: 0,
    source: "",
    sourceIn: 0,
    sourceDuration: null,
    volume: 1,
    fit: "contain",
    animation: "fade",
  };
}
export function sceneSchedule(doc) {
  let start = 0;
  return doc.scenes.map((scene) => {
    const result = { ...scene, start };
    start += scene.duration;
    return result;
  });
}
export function documentDuration(doc) {
  return doc.scenes.reduce((sum, scene) => sum + scene.duration, 0);
}
const editable = (doc, element) => {
  if (doc.tracks.find((t) => t.id === element.trackId)?.locked)
    fail("请先解锁轨道");
};
export function applyCommand(input, command) {
  validateDocument(input);
  const doc = clone(input);
  if (!object(command) || typeof command.type !== "string")
    fail("编辑命令无效");
  const scene = () =>
    doc.scenes.find((s) => s.id === command.sceneId) ??
    fail("镜头已不存在，请刷新");
  const element = () =>
    scene().elements.find((el) => el.id === command.elementId) ??
    fail("元素已不存在，请刷新");
  switch (command.type) {
    case "document.replace":
      return validateDocument(clone(command.document));
    case "document.resize": {
      if (
        !finite(command.width, 128, 4096) ||
        !finite(command.height, 128, 4096)
      )
        fail("画幅无效");
      const sx = command.width / doc.width,
        sy = command.height / doc.height;
      for (const scene of doc.scenes)
        for (const el of scene.elements) {
          editable(doc, el);
          el.x *= sx;
          el.y *= sy;
          el.width *= sx;
          el.height *= sy;
          el.fontSize = Math.min(
            600,
            Math.max(8, el.fontSize * Math.min(sx, sy)),
          );
        }
      doc.width = command.width;
      doc.height = command.height;
      break;
    }
    case "element.move": {
      const target = scene(),
        el = element();
      editable(doc, el);
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index >= target.elements.length
      )
        fail("图层位置无效");
      target.elements.splice(target.elements.indexOf(el), 1);
      target.elements.splice(command.index, 0, el);
      break;
    }
    case "scene.add": {
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index > doc.scenes.length
      )
        fail("插入位置无效");
      doc.scenes.splice(command.index, 0, clone(command.scene));
      break;
    }
    case "scene.remove": {
      const target = scene();
      target.elements.forEach((el) => editable(doc, el));
      doc.scenes.splice(doc.scenes.indexOf(target), 1);
      break;
    }
    case "scene.move": {
      const target = scene();
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index >= doc.scenes.length
      )
        fail("移动位置无效");
      doc.scenes.splice(doc.scenes.indexOf(target), 1);
      doc.scenes.splice(command.index, 0, target);
      break;
    }
    case "scene.update": {
      keys(command.patch, ["name", "background", "duration"], "镜头修改");
      const target = scene();
      if (
        command.patch.duration !== undefined &&
        command.patch.duration !== target.duration
      ) {
        const duration = command.patch.duration;
        if (!finite(duration, 0.1, 3600)) fail("镜头时长无效");
        target.elements.forEach((el) => {
          editable(doc, el);
          if (el.start >= duration) fail("请先移走超出新时长的元素");
          el.duration = Math.min(el.duration, duration - el.start);
        });
      }
      Object.assign(target, command.patch);
      break;
    }
    case "scene.split": {
      const target = scene(),
        at = command.at;
      if (!finite(at, 0.1, target.duration - 0.1) || !id(command.newSceneId))
        fail("切分位置无效");
      target.elements.forEach((el) => editable(doc, el));
      const second = {
        ...clone(target),
        id: command.newSceneId,
        name: `${target.name} · 后段`,
        duration: target.duration - at,
        elements: [],
      };
      const first = [];
      for (const el of target.elements) {
        const end = el.start + el.duration;
        if (el.start < at)
          first.push({ ...el, duration: Math.min(end, at) - el.start });
        if (end > at)
          second.elements.push({
            ...el,
            id: `${command.newSceneId}-${second.elements.length}`,
            start: Math.max(0, el.start - at),
            duration: end - Math.max(at, el.start),
            sourceIn:
              el.sourceIn +
              (["audio", "video"].includes(el.kind)
                ? Math.max(0, at - el.start)
                : 0),
          });
      }
      target.duration = at;
      target.elements = first;
      doc.scenes.splice(doc.scenes.indexOf(target) + 1, 0, second);
      break;
    }
    case "element.add": {
      const el = clone(command.element);
      editable(doc, el);
      scene().elements.push(el);
      break;
    }
    case "element.update": {
      const el = element();
      editable(doc, el);
      keys(
        command.patch,
        [
          "trackId",
          "name",
          "start",
          "duration",
          "x",
          "y",
          "width",
          "height",
          "rotation",
          "opacity",
          "text",
          "font",
          "fontSize",
          "fontWeight",
          "align",
          "color",
          "fill",
          "radius",
          "source",
          "sourceIn",
          "sourceDuration",
          "volume",
          "fit",
          "animation",
        ],
        "元素修改",
      );
      Object.assign(el, command.patch);
      editable(doc, el);
      break;
    }
    case "element.remove": {
      const target = scene(),
        el = element();
      editable(doc, el);
      target.elements.splice(target.elements.indexOf(el), 1);
      break;
    }
    case "track.add":
      doc.tracks.push(clone(command.track));
      break;
    case "track.update": {
      const track =
        doc.tracks.find((t) => t.id === command.trackId) ?? fail("轨道不存在");
      keys(command.patch, ["name", "muted", "locked"], "轨道修改");
      Object.assign(track, command.patch);
      break;
    }
    case "track.remove": {
      const track =
        doc.tracks.find((t) => t.id === command.trackId) ?? fail("轨道不存在");
      if (
        doc.scenes.some((s) => s.elements.some((el) => el.trackId === track.id))
      )
        fail("请先移走轨道上的元素");
      doc.tracks.splice(doc.tracks.indexOf(track), 1);
      break;
    }
    case "brand.apply": {
      const brand = command.brand;
      if (
        !object(brand) ||
        !id(brand.id) ||
        !color(brand.foreground) ||
        !color(brand.background) ||
        !FONTS.includes(brand.font)
      )
        fail("品牌参数无效");
      if (brand.logoSource && !assetPath(brand.logoSource))
        fail("品牌标识路径无效");
      doc.brandId = brand.id;
      for (const s of doc.scenes) {
        s.background = brand.background;
        for (const el of s.elements) {
          editable(doc, el);
          if (el.kind === "text") {
            el.color = brand.foreground;
            el.font = brand.font;
          }
          if (el.kind === "shape" && color(brand.accent))
            el.fill = brand.accent;
        }
        if (brand.logoSource === "")
          s.elements = s.elements.filter(
            (el) => el.id !== `brand-logo-${s.id}`.slice(0, 100),
          );
        if (brand.logoSource) {
          const logoId = `brand-logo-${s.id}`.slice(0, 100);
          const prior = s.elements.find((el) => el.id === logoId);
          if (prior) prior.source = brand.logoSource;
          else {
            const logo = newElement(logoId, "image", s, doc);
            Object.assign(logo, {
              name: "品牌标识",
              source: brand.logoSource,
              x: doc.width * 0.84,
              y: doc.height * 0.06,
              width: doc.width * 0.1,
              height: doc.height * 0.1,
              fit: "contain",
              animation: "none",
            });
            editable(doc, logo);
            s.elements.push(logo);
          }
        }
      }
      break;
    }
    case "batch": {
      if (
        !Array.isArray(command.commands) ||
        command.commands.length > 200 ||
        command.commands.some((c) => c.type === "batch")
      )
        fail("批量修改最多 200 条，不支持嵌套");
      return command.commands.reduce(
        (current, next) => applyCommand(current, next),
        doc,
      );
    }
    default:
      fail("不支持的编辑命令");
  }
  return validateDocument(doc);
}
export function initialState(doc) {
  return {
    schemaVersion: 1,
    revision: 0,
    document: validateDocument(clone(doc)),
    past: [],
    future: [],
    receipts: [],
    updatedAt: 0,
  };
}
export function transact(state, request) {
  if (!id(request.requestId)) fail("需要有效的操作标识");
  const receipt = state.receipts.find((r) => r.requestId === request.requestId);
  if (receipt) {
    if (
      receipt.body !==
      JSON.stringify({
        expectedRevision: request.expectedRevision,
        command: request.command,
      })
    )
      fail("同一操作标识不能用于不同修改");
    return state;
  }
  if (request.expectedRevision !== state.revision)
    fail("REVISION_CONFLICT: 工程已有新修改，请刷新后重试");
  let doc,
    past = state.past,
    future = state.future;
  if (request.command.type === "undo") {
    if (!past.length) fail("没有可撤销的修改");
    doc = past.at(-1).document;
    past = past.slice(0, -1);
    future = [
      { document: state.document, label: request.command.label ?? "修改" },
      ...future,
    ];
  } else if (request.command.type === "redo") {
    if (!future.length) fail("没有可重做的修改");
    doc = future[0].document;
    future = future.slice(1);
    past = [...past, { document: state.document, label: "重做" }];
  } else {
    doc = applyCommand(state.document, request.command);
    past = [
      ...past,
      { document: state.document, label: request.command.type },
    ].slice(-60);
    future = [];
  }
  // Bound serialized history, not only command count, for large compositions.
  while (past.length > 1 && JSON.stringify(past).length > 6_000_000)
    past.shift();
  return {
    ...state,
    document: validateDocument(clone(doc)),
    past,
    future,
    revision: state.revision + 1,
    updatedAt: Date.now(),
    receipts: [
      ...state.receipts,
      {
        requestId: request.requestId,
        body: JSON.stringify({
          expectedRevision: request.expectedRevision,
          command: request.command,
        }),
      },
    ].slice(-100),
  };
}
