import {
  readFile,
  writeFile,
  mkdir,
  rename,
  lstat,
  realpath,
  copyFile,
  cp,
  open,
  unlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const executeFile = promisify(execFile);
import {
  assetPath,
  initialState,
  validateDocument,
  transact,
  sceneSchedule,
  documentDuration,
} from "./model.mjs";
import { compileHTML } from "./compile.mjs";
import { libraryAction } from "./library.mjs";
import { acquireLock } from "./lock.mjs";
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export async function containedFile(root, relative) {
  if (!assetPath(relative)) throw Error("素材路径无效");
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) throw Error("素材不能使用软链接");
  }
  if (!(await lstat(cursor)).isFile()) throw Error("素材不是文件");
  return cursor;
}
async function directory(root, relative) {
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    await mkdir(cursor).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw Error("工程目录无效");
  }
  return cursor;
}
async function atomic(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(data, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, file);
}
export function publicState(state) {
  return {
    available: true,
    schemaVersion: state.schemaVersion,
    revision: state.revision,
    document: state.document,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    updatedAt: state.updatedAt,
  };
}
export async function readState(root) {
  try {
    const filename = await containedFile(root, ".yingya/editor/state.json");
    const stat = await lstat(filename);
    if (stat.size > 32_000_000) throw Error("工程历史过大");
    const state = JSON.parse(await readFile(filename, "utf8"));
    validateDocument(state.document);
    return state;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function verifyAssets(root, document) {
  const elements = document.scenes.flatMap((s) =>
    s.elements.filter((el) => ["image", "video", "audio"].includes(el.kind)),
  );
  const sources = [...new Set(elements.map((el) => el.source))];
  if (sources.length > 256) throw Error("每个工程最多使用 256 个独立素材");
  let cache = {};
  try {
    cache = JSON.parse(
      await readFile(
        await containedFile(root, ".yingya/editor/media-cache.json"),
        "utf8",
      ),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const nextCache = {};
  for (const source of sources) {
    const file = await containedFile(root, source),
      clips = elements.filter(
        (el) => el.source === source && ["video", "audio"].includes(el.kind),
      );
    if (!clips.length) continue;
    const stat = await lstat(file),
      fingerprint = `${stat.size}:${stat.mtimeNs ?? stat.mtimeMs}`;
    let duration =
      cache[source]?.fingerprint === fingerprint
        ? cache[source].duration
        : undefined;
    if (!Number.isFinite(duration)) {
      const { stdout } = await executeFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          file,
        ],
        { timeout: 15000, maxBuffer: 1048576 },
      );
      duration = Number(JSON.parse(stdout).format?.duration);
    }
    if (!Number.isFinite(duration) || duration <= 0)
      throw Error("无法确认音视频素材时长");
    for (const clip of clips)
      if (
        Math.abs(clip.sourceDuration - duration) > 0.25 ||
        clip.sourceIn + clip.duration > duration + 0.05
      )
        throw Error("素材时长已经变化或裁切超出源文件，请重新载入素材");
    nextCache[source] = { fingerprint, duration };
  }
  await atomic(path.join(root, ".yingya/editor/media-cache.json"), nextCache);
}
export async function editStore(project, action, request = {}, libraryRoot) {
  const root = await realpath(project);
  if (action === "library-list") {
    if (!libraryRoot) throw Error("缺少资料库目录");
    return libraryAction(libraryRoot, root, action, request, null);
  }
  if (action === "read") {
    const state = await readState(root);
    return state ? publicState(state) : { available: false };
  }
  await directory(root, ".yingya/editor");
  const lockFile = path.join(root, ".yingya/editor/write.lock");
  const release = await acquireLock(lockFile);
  try {
    const state = await readState(root);
    if (
      action.startsWith("library-") ||
      action.startsWith("brand-") ||
      action.startsWith("template-")
    ) {
      if (!libraryRoot) throw Error("缺少资料库目录");
      return await libraryAction(libraryRoot, root, action, request, state);
    }
    if (action === "init") {
      if (state)
        throw Error("REVISION_CONFLICT: 工程已经存在，请先打开当前工程");
      const next = initialState(request.document);
      await verifyAssets(root, next.document);
      await atomic(path.join(root, ".yingya/editor/state.json"), next);
      return publicState(next);
    }
    if (!state) throw Error("尚未创建可编辑工程");
    if (action === "command") {
      const next = transact(state, request);
      await verifyAssets(root, next.document);
      if (next !== state)
        await atomic(path.join(root, ".yingya/editor/state.json"), next);
      return publicState(next);
    }
    if (action === "checkpoint") {
      if (request.expectedRevision !== state.revision)
        throw Error("REVISION_CONFLICT: 工程已有新修改，请先保存");
      if (!state.document.scenes.length) throw Error("请先添加镜头");
      await verifyAssets(root, state.document);
      if (
        typeof request.requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(request.requestId)
      )
        throw Error("版本标识无效");
      const versionId = `editor-${request.requestId}`,
        relative = `.yingya/versions/${versionId}`;
      await directory(root, ".yingya/versions");
      const destination = path.join(root, relative),
        digest = createHash("sha256")
          .update(JSON.stringify(state.document))
          .digest("hex");
      try {
        const prior = JSON.parse(
          await readFile(
            await containedFile(root, `${relative}/editor-snapshot.json`),
            "utf8",
          ),
        );
        if (prior.digest !== digest)
          throw Error("同一版本标识不能保存不同内容");
        return prior;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const temporary = await directory(
        root,
        `.yingya/versions/.editor-tmp-${randomUUID()}`,
      );
      try {
        const sources = new Set(
          state.document.scenes.flatMap((s) =>
            s.elements
              .filter((el) => ["image", "video", "audio"].includes(el.kind))
              .map((el) => el.source),
          ),
        );
        for (const source of sources) {
          const original = await containedFile(root, source);
          // Preserve project-relative references in the immutable snapshot.
          await mkdir(path.dirname(path.join(temporary, source)), {
            recursive: true,
          });
          await copyFile(original, path.join(temporary, source));
        }
        await mkdir(path.join(temporary, "assets/editor-runtime"), {
          recursive: true,
        });
        await copyFile(
          path.join(repo, "runtime/editorial/vendor/gsap-3.14.2.min.js"),
          path.join(temporary, "assets/editor-runtime/gsap.js"),
        );
        let fontCss = "";
        for (const [packageName, file, directoryName] of [
          ["@fontsource-variable/noto-sans-sc", "index.css", "font"],
          ["@fontsource-variable/noto-serif-sc", "index.css", "serif"],
          ["@fontsource/fragment-mono", "400.css", "mono"],
        ]) {
          await cp(
            path.join(repo, "node_modules", packageName),
            path.join(temporary, "assets/editor-runtime", directoryName),
            { recursive: true },
          );
          fontCss += (
            await readFile(
              path.join(repo, "node_modules", packageName, file),
              "utf8",
            )
          ).replaceAll(
            "url(./files/",
            `url(assets/editor-runtime/${directoryName}/files/`,
          );
        }
        await writeFile(
          path.join(temporary, "index.html"),
          compileHTML(state.document, { fontCss }),
        );
        await writeFile(
          path.join(temporary, "index.motion.json"),
          JSON.stringify({
            duration: documentDuration(state.document),
            assertions: sceneSchedule(state.document).flatMap((scene) =>
              scene.elements
                .filter((el) => el.kind !== "audio" && el.opacity > 0)
                .map((el) => ({
                  kind: "appearsBy",
                  selector: `#element-${el.id}`,
                  bySec:
                    scene.start + el.start + Math.min(0.7, el.duration / 2),
                })),
            ),
          }),
        );
        await writeFile(
          path.join(temporary, "editor-document.json"),
          JSON.stringify(state.document, null, 2),
        );
        const result = {
          versionId,
          sourcePath: relative,
          revision: state.revision,
          width: state.document.width,
          height: state.document.height,
          fps: state.document.fps,
          digest,
          createdAt: Date.now(),
        };
        await writeFile(
          path.join(temporary, "editor-snapshot.json"),
          JSON.stringify(result),
        );
        await rename(temporary, destination);
        return result;
      } catch (e) {
        await rm(temporary, { recursive: true, force: true });
        throw e;
      }
    }
    if (action === "restore") {
      if (request.expectedRevision !== state.revision)
        throw Error("REVISION_CONFLICT: 工程已有新修改，请刷新");
      if (
        typeof request.versionId !== "string" ||
        !/^editor-[a-zA-Z0-9_-]{1,100}$/.test(request.versionId)
      )
        throw Error("不是可直接恢复的编辑器版本");
      const document = validateDocument(
        JSON.parse(
          await readFile(
            await containedFile(
              root,
              `.yingya/versions/${request.versionId}/editor-document.json`,
            ),
            "utf8",
          ),
        ),
      );
      // Restore dependencies from the snapshot under a separate namespace; do not overwrite current assets.
      for (const scene of document.scenes)
        for (const el of scene.elements)
          if (["image", "video", "audio"].includes(el.kind))
            el.source = `.yingya/versions/${request.versionId}/${el.source}`;
      await verifyAssets(root, document);
      const next = {
        ...state,
        revision: state.revision + 1,
        document,
        past: [
          ...state.past,
          { document: state.document, label: "恢复版本" },
        ].slice(-30),
        future: [],
        updatedAt: Date.now(),
      };
      await atomic(path.join(root, ".yingya/editor/state.json"), next);
      return publicState(next);
    }
    throw Error("未知工程操作");
  } finally {
    await release();
  }
}
