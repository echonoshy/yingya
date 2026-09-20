import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  lstat,
  copyFile,
  rm,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validateDocument, emptyDocument, assetPath } from "./model.mjs";
import { containedFile } from "./store.mjs";
import { acquireLock } from "./lock.mjs";
const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
async function safeDirectory(root, child) {
  let result = root;
  for (const part of child.split("/")) {
    if (!part || part === "." || part === "..") throw Error("资料库目录无效");
    result = path.join(result, part);
    await mkdir(result).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    const info = await lstat(result);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw Error("资料库目录不能使用软链接");
  }
  return result;
}
export async function libraryAction(root, project, action, request, state) {
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw Error("资料库目录无效");
  for (const folder of ["brands", "templates"])
    await safeDirectory(root, folder);
  if (action === "library-list") {
    const list = async (kind) => {
      const result = [];
      for (const entry of await readdir(path.join(root, kind), {
        withFileTypes: true,
      })) {
        if (entry.isFile() && entry.name.endsWith(".json"))
          result.push(
            JSON.parse(
              await readFile(
                await containedFile(root, `${kind}/${entry.name}`),
                "utf8",
              ),
            ),
          );
      }
      return result;
    };
    return { brands: await list("brands"), templates: await list("templates") };
  }
  const release = await acquireLock(path.join(root, "write.lock"));
  try {
    if (action === "brand-save") {
      const { brand } = request;
      if (
        !brand ||
        !validId(brand.id) ||
        typeof brand.name !== "string" ||
        !brand.name.trim() ||
        brand.name.length > 100 ||
        !["sans", "serif", "mono"].includes(brand.font) ||
        !["foreground", "background", "accent"].every((key) =>
          /^#[a-f0-9]{6}$/i.test(brand[key]),
        )
      )
        throw Error("品牌名称、配色或字体无效");
      const file = path.join(root, "brands", brand.id + ".json");
      let previous = null;
      try {
        previous = JSON.parse(
          await readFile(
            await containedFile(root, `brands/${brand.id}.json`),
            "utf8",
          ),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if ((previous?.revision ?? 0) !== request.expectedRevision)
        throw Error("REVISION_CONFLICT: 品牌资料已有新修改");
      let logoPath = previous?.logoPath;
      if (brand.logoSource === "") logoPath = undefined;
      else if (brand.logoSource !== undefined) {
        if (
          typeof brand.logoSource !== "string" ||
          !/\.(png|jpe?g|webp)$/i.test(brand.logoSource)
        )
          throw Error("品牌标识请使用 PNG、JPEG 或 WebP");
        const source = await containedFile(project, brand.logoSource);
        if ((await lstat(source)).size > 5_000_000)
          throw Error("品牌标识不能超过 5 MB");
        const extension = path.extname(source).toLowerCase();
        logoPath = `brands/deps/${brand.id}/${randomUUID()}/logo${extension}`;
        await safeDirectory(root, path.dirname(logoPath));
        await copyFile(source, path.join(root, logoPath));
      }
      const next = {
        ...(logoPath ? { logoPath } : {}),
        id: brand.id,
        name: brand.name.trim(),
        font: brand.font,
        foreground: brand.foreground,
        background: brand.background,
        accent: brand.accent,
        revision: (previous?.revision ?? 0) + 1,
      };
      const temporary = file + "." + randomUUID() + ".tmp";
      await writeFile(temporary, JSON.stringify(next));
      await rename(temporary, file);
      return { brand: next };
    }
    if (action === "brand-load") {
      if (!validId(request.id)) throw Error("品牌标识无效");
      const brand = JSON.parse(
        await readFile(
          await containedFile(root, `brands/${request.id}.json`),
          "utf8",
        ),
      );
      if (brand.logoPath) {
        const source = await containedFile(root, brand.logoPath);
        const destination = `assets/editor-brands/${brand.id}/${brand.revision}/logo${path.extname(source)}`;
        await safeDirectory(project, path.dirname(destination));
        await copyFile(source, path.join(project, destination));
        brand.logoSource = destination;
      }
      return { brand };
    }
    if (action === "library-delete") {
      if (
        !["brands", "templates"].includes(request.kind) ||
        !validId(request.id)
      )
        throw Error("资料标识无效");
      const file = await containedFile(
        root,
        `${request.kind}/${request.id}.json`,
      );
      const entry = JSON.parse(await readFile(file, "utf8"));
      if (entry.revision !== request.expectedRevision)
        throw Error("REVISION_CONFLICT: 资料已有新修改");
      await unlink(file);
      // Keep immutable template dependencies for in-flight consumers; they are small and can be collected separately.
      return { deleted: true };
    }
    if (action === "template-save") {
      if (!state || state.revision !== request.expectedRevision)
        throw Error("REVISION_CONFLICT: 请先保存当前修改");
      const scene = state.document.scenes.find((s) => s.id === request.sceneId);
      if (!scene) throw Error("镜头不存在");
      if (
        typeof request.name !== "string" ||
        !request.name.trim() ||
        request.name.length > 100
      )
        throw Error("请输入模板名称");
      const id = randomUUID(),
        pack = await safeDirectory(root, `templates/${id}`),
        copy = structuredClone(scene);
      const trackIds = new Set(copy.elements.map((el) => el.trackId)),
        tracks = state.document.tracks.filter((t) => trackIds.has(t.id));
      for (const el of copy.elements) {
        if (!["image", "video", "audio"].includes(el.kind)) continue;
        const original = await containedFile(project, el.source),
          relative = `assets/${randomUUID()}${path.extname(el.source)}`;
        await mkdir(path.join(pack, "assets"), { recursive: true });
        await copyFile(original, path.join(pack, relative));
        el.source = relative;
      }
      const next = {
        id,
        name: request.name.trim(),
        revision: 1,
        width: state.document.width,
        height: state.document.height,
        scene: copy,
        tracks,
      };
      const file = path.join(root, "templates", id + ".json");
      await writeFile(file, JSON.stringify(next), { flag: "wx" });
      return { template: next };
    }
    if (action === "template-load") {
      if (!validId(request.id) || !state) throw Error("模板或工程无效");
      const template = JSON.parse(
        await readFile(
          await containedFile(root, `templates/${request.id}.json`),
          "utf8",
        ),
      );
      const document = emptyDocument();
      document.width = template.width;
      document.height = template.height;
      document.tracks = template.tracks.length
        ? template.tracks
        : document.tracks;
      document.scenes = [template.scene];
      validateDocument(document);
      const target = await safeDirectory(project, "assets/editor-templates"),
        destination = await safeDirectory(target, template.id),
        scene = structuredClone(template.scene);
      const map = new Map(),
        newTracks = [];
      for (const track of template.tracks) {
        const existing = state.document.tracks.find(
          (t) => t.kind === track.kind && !t.locked,
        );
        const id = existing?.id ?? `track-${randomUUID()}`;
        map.set(track.id, id);
        if (!existing) newTracks.push({ ...track, id, locked: false });
      }
      const scaleX = state.document.width / template.width,
        scaleY = state.document.height / template.height;
      scene.id = randomUUID();
      for (const el of scene.elements) {
        el.id = randomUUID();
        el.trackId = map.get(el.trackId);
        el.x *= scaleX;
        el.y *= scaleY;
        el.width *= scaleX;
        el.height *= scaleY;
        el.fontSize = Math.min(
          600,
          Math.max(8, el.fontSize * Math.min(scaleX, scaleY)),
        );
        if (["image", "video", "audio"].includes(el.kind)) {
          if (!assetPath(el.source)) throw Error("模板素材路径无效");
          const original = await containedFile(
            root,
            `templates/${template.id}/${el.source}`,
          );
          const filename = path.basename(el.source);
          const dest = path.join(destination, filename);
          try {
            const info = await lstat(dest);
            if (info.isSymbolicLink()) throw Error("模板目标不能使用软链接");
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
          await copyFile(original, dest);
          el.source = `assets/editor-templates/${template.id}/${filename}`;
        }
      }
      return {
        command: {
          type: "batch",
          commands: [
            ...newTracks.map((track) => ({ type: "track.add", track })),
            { type: "scene.add", index: state.document.scenes.length, scene },
          ],
        },
      };
    }
    throw Error("未知资料库操作");
  } finally {
    await release();
  }
}
