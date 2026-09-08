import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { once } from "node:events";

const host = "127.0.0.1";
const port = 4174;
const baseUrl = `http://${host}:${port}`;
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--config", "web/vite.config.ts", "--host", host, "--port", String(port), "--strictPort"], {
  cwd: new URL("..", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
});

let previewOutput = "";
preview.stdout.on("data", chunk => { previewOutput += chunk; });
preview.stderr.on("data", chunk => { previewOutput += chunk; });

async function waitForPreview() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`Vite preview exited early:\n${previewOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch { /* preview is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Vite preview:\n${previewOutput}`);
}

const now = 1_750_000_000_000;
const record = {
  id: "11111111-1111-4111-8111-111111111111", title: "秋季新品短片", status: "waiting", statusLabel: "等待确认",
  threadId: "thread-1", activeTurnId: null, queueDepth: 1, queuePaused: true, model: "gpt-5.4",
  reasoningEffort: "medium", aspectRatio: "9:16", createdAt: now, updatedAt: now,
  voiceId: "default",
};
const manifest = {
  schemaVersion: 1, phase: "plan_review", dirty: false,
  checkpoint: { id: "checkpoint-1", kind: "plan", title: "制作方案已就绪", summary: "三幕结构，约 30 秒。", artifactIds: ["plan"] },
  outputSpec: {}, artifacts: [{ id: "plan", kind: "plan", label: "制作方案", path: "plans/production.md", version: null, metadata: {} }],
  versions: [], currentDraft: null, studioEntry: "index.html",
};
const detail = {
  ...record,
  messages: [
    { id: "message-1", turnId: "turn-1", role: "user", text: "制作一条秋季新品短片", attachments: [], context: [], status: "completed", createdAt: now },
    { id: "message-2", turnId: "turn-1", role: "assistant", text: "制作方案已创建并进入审核：\n\n[查看制作方案](plans/production.md)\n\n预览已完成，请选择下一步：\n\n1. `直接渲染`\n2. `加中文旁白再渲染`\n3. `调整画面`", attachments: [], context: [], status: "completed", createdAt: now + 10 },
  ],
  queue: [{ id: "turn-2", text: "把节奏再收紧", attachments: [], context: [], model: null, reasoningEffort: null, createdAt: now + 1 }],
  manifest, eventCursor: 3, renderJobs: [],
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiMock(page, seed = detail, { creationDelayMs = 0 } = {}) {
  let projects = [seed];
  let current = structuredClone(seed);
  let libraryImages = [{ id: "image-1", url: "/brand/yingya-ghost.png", hyperframesPath: "assets/generated/image-1.png", mimeType: "image/png", prompt: "深色背景中的发光新芽，电影级侧光", sourceName: null, kind: "generated", createdAt: now }];
  let assetFolders = [{ id: "folder-brand", name: "品牌素材", createdAt: now }];
  let libraryAssets = [
    { ...libraryImages[0], category: "image", folderId: "folder-brand" },
    { id: "video-1", url: "/assets/uploads/product.mp4", hyperframesPath: "assets/uploads/product.mp4", mimeType: "video/mp4", category: "video", prompt: null, sourceName: "产品定格镜头.mp4", kind: "uploaded", folderId: "folder-brand", createdAt: now - 1 },
    { id: "audio-1", url: "/assets/uploads/music.mp3", hyperframesPath: "assets/uploads/music.mp3", mimeType: "audio/mpeg", category: "audio", prompt: null, sourceName: "秋日背景音乐.mp3", kind: "uploaded", folderId: null, createdAt: now - 2 },
    { id: "document-1", url: "/assets/uploads/brief.pdf", hyperframesPath: "assets/uploads/brief.pdf", mimeType: "application/pdf", category: "document", prompt: null, sourceName: "品牌创作说明.pdf", kind: "uploaded", folderId: null, createdAt: now - 3 },
  ];
  const media = { scenes: [], assets: [] };
  await page.route("**/mock-hyperframes-storyboard*", route => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body style='margin:0;background:#1d1d1f;color:white;font:16px sans-serif;display:grid;place-items:center;height:100vh'><main><b>HyperFrames 实时画面</b><p>Agent 正在更新 Composition</p></main></body></html>" }));
  await page.route("**/assets/uploads/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const contentType = pathname.endsWith(".mp4") ? "video/mp4" : pathname.endsWith(".mp3") ? "audio/mpeg" : "application/octet-stream";
    return route.fulfill({ status: 200, contentType, body: Buffer.alloc(0) });
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === "/api/codex/models") return json(route, { data: [] });
    if (pathname === "/api/codex/threads" && method === "POST") return json(route, { threadId: "image-thread-1" });
    if (pathname === "/api/codex/threads/image-thread-1/images" && method === "POST") {
      const input = request.postDataJSON();
      libraryImages = [{ id: "image-2", url: "/brand/yingya-ghost.png", hyperframesPath: "assets/generated/image-2.png", mimeType: "image/png", prompt: input.prompt, sourceName: null, kind: "generated", createdAt: now + 1 }, ...libraryImages];
      libraryAssets = [{ ...libraryImages[0], category: "image", folderId: null }, ...libraryAssets];
      return json(route, { threadId: "image-thread-1", turnId: "image-turn-1", status: "completed", text: "", images: [{ id: "image-2", url: libraryImages[0].url, hyperframesPath: libraryImages[0].hyperframesPath, mimeType: "image/png", revisedPrompt: input.prompt }] });
    }
    if (pathname === "/api/assets/images" && method === "GET") return json(route, { images: libraryImages });
    if (pathname === "/api/assets/images" && method === "POST") return json(route, { url: "/assets/uploads/reference.png", hyperframesPath: "assets/uploads/reference.png" });
    if (pathname === "/api/assets/library" && method === "GET") return json(route, { assets: libraryAssets });
    if (pathname === "/api/assets/library" && method === "POST") {
      const created = { id: `upload-${libraryAssets.length}`, url: "/assets/uploads/uploaded.pdf", hyperframesPath: "assets/uploads/uploaded.pdf", mimeType: "application/pdf", category: "document", prompt: null, sourceName: "活动执行方案.pdf", kind: "uploaded", folderId: assetFolders.at(-1)?.id ?? null, createdAt: now + 2 };
      libraryAssets = [created, ...libraryAssets];
      return json(route, created);
    }
    const importMatch = pathname.match(/^\/api\/assets\/library\/([^/]+)\/projects\/([^/]+)$/);
    if (importMatch) {
      const asset = libraryAssets.find(item => item.id === importMatch[1]);
      if (!asset) return json(route, { message: "素材不存在" }, 404);
      const path = `assets/inbox/${asset.id}`;
      if (!media.assets.some(item => item.id === asset.id)) media.assets.push({ id: asset.id, name: asset.sourceName || asset.prompt, url: asset.url, hyperframesPath: path, kind: asset.category, source: "library", mediaType: asset.mimeType, createdAt: now });
      return json(route, { path, name: asset.sourceName || asset.prompt });
    }
    const folderMatch = pathname.match(/^\/api\/assets\/folders\/([^/]+)$/);
    if (folderMatch && method === "PATCH") { assetFolders = assetFolders.map(folder => folder.id === folderMatch[1] ? { ...folder, name: request.postDataJSON().name } : folder); return route.fulfill({ status: 204, body: "" }); }
    if (folderMatch && method === "DELETE") { assetFolders = assetFolders.filter(folder => folder.id !== folderMatch[1]); libraryAssets = libraryAssets.map(asset => asset.folderId === folderMatch[1] ? { ...asset, folderId: null } : asset); return route.fulfill({ status: 204, body: "" }); }
    const libraryAssetMatch = pathname.match(/^\/api\/assets\/library\/([^/]+)$/);
    if (libraryAssetMatch && method === "PATCH") {
      const { folderId, name } = request.postDataJSON();
      libraryAssets = libraryAssets.map(asset => asset.id === libraryAssetMatch[1] ? { ...asset, ...(name ? { sourceName: name } : { folderId: folderId ?? null }) } : asset);
      return route.fulfill({ status: 204, body: "" });
    }
    if (libraryAssetMatch && method === "DELETE") { libraryAssets = libraryAssets.filter(asset => asset.id !== libraryAssetMatch[1]); return route.fulfill({ status: 204, body: "" }); }
    if (pathname === "/api/assets/folders" && method === "GET") return json(route, assetFolders);
    if (pathname === "/api/assets/folders" && method === "POST") {
      const input = request.postDataJSON();
      const folder = { id: `folder-${assetFolders.length + 1}`, name: input.name, createdAt: now + 2 };
      assetFolders = [...assetFolders, folder];
      return json(route, folder);
    }
    if (pathname === "/api/voices" && method === "GET") return json(route, { voices: ["default", "映芽讲解"], uploaded_voices: [{ name: "映芽讲解", consent: "generated-by-voxcpm2", created_at: now, file_size: 2048, mime_type: "audio/wav", ref_text: "参考文字", speaker_description: "沉稳清晰的青年男声" }] });
    if (pathname.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    if (pathname.endsWith("/event-log")) return json(route, {
      items: [
        { seq: 1, projectId: seed.id, turnId: "turn-1", method: "item/started", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes lint" } } }, createdAt: now },
        { seq: 2, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes lint", status: "completed", aggregatedOutput: "passed" } } }, createdAt: now + 1 },
        { seq: 3, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "update-1", type: "agentMessage", text: "画面结构已经确认，接下来整理制作文件。" } } }, createdAt: now + 4 },
        { seq: 4, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "file-1", type: "fileChange", status: "completed", changes: [{ path: "plans/production.md" }] } } }, createdAt: now + 6 },
      ],
      nextBefore: null, latestSeq: 4, hasMore: false,
    });
    if (pathname.endsWith("/files/plans/production.md")) return route.fulfill({ status: 200, contentType: "text/markdown", body: "# 制作方案\n\n三幕结构与视觉方向。" });
    if (pathname === "/api/agent-projects" && method === "GET") return json(route, projects);
    if (pathname === "/api/agent-projects" && method === "POST") {
      if (creationDelayMs) await new Promise(resolve => setTimeout(resolve, creationDelayMs));
      current = { ...structuredClone(detail), id: "22222222-2222-4222-8222-222222222222", title: "网站产品宣传片", status: "idle", statusLabel: "准备就绪", queueDepth: 0, queuePaused: false, queue: [], messages: [], manifest: { ...manifest, checkpoint: null, artifacts: [] }, eventCursor: 0 };
      projects = [current, ...projects];
      return json(route, current);
    }
    const projectMatch = pathname.match(/^\/api\/agent-projects\/([^/]+)$/);
    if (projectMatch && method === "GET") return json(route, current.id === projectMatch[1] ? current : seed);
    if (pathname.endsWith("/index.html") && pathname.includes("/files/")) return route.fulfill({ status: 200, contentType: "text/html", body: '<section id="scene-one" class="scene" data-start="0" data-duration="5"><h1>产品登场</h1><p class="caption">介绍核心功能</p></section>' });
    if (pathname === "/api/heygen/audio") return json(route, { data: [{ id: "music-test", name: "轻快钢琴", description: "温暖的钢琴配乐", audioUrl: "/assets/uploads/music.mp3", duration: 30, type: "music" }], hasMore: false });
    if (pathname.endsWith("/heygen/audio") && method === "POST") { const asset = { id: "music-test", name: "轻快钢琴", url: "/assets/uploads/music.mp3", hyperframesPath: "assets/audio/music-test.mp3", kind: "music", source: "heygen", mediaType: "audio/mpeg", createdAt: now }; media.assets.push(asset); return json(route, asset); }
    if (pathname.endsWith("/assets") && method === "POST") return json(route, { path: "assets/inbox/reference.pdf", name: "参考文件.pdf" });
    if (pathname.endsWith("/media") && method === "GET") return json(route, media);
    if (pathname.endsWith("/turns") && method === "POST") return json(route, { turnId: "turn-new", status: "queued", queueDepth: 1 });
    if (pathname.endsWith("/resume") && method === "POST") {
      current = { ...current, queuePaused: false, status: "queued", statusLabel: "已排队" };
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname.endsWith("/checkpoint") && method === "POST") return json(route, { turnId: "turn-confirm", status: "queued", queueDepth: 1 });
    if (pathname.endsWith("/studio") && method === "POST") return json(route, { storyboardUrl: `${baseUrl}/mock-hyperframes-storyboard`, previewUrl: `${baseUrl}/mock-hyperframes-studio`, state: "running", host: "0.0.0.0", port: 8600, projectName: current.id, lastSeenAt: now });
    if (pathname.endsWith("/studio/heartbeat") && method === "POST") return json(route, { storyboardUrl: `${baseUrl}/mock-hyperframes-storyboard`, previewUrl: `${baseUrl}/mock-hyperframes-studio`, state: "running", host: "0.0.0.0", port: 8600, projectName: current.id, lastSeenAt: Date.now() });
    if (pathname.endsWith("/studio") && method === "DELETE") return route.fulfill({ status: 204, body: "" });
    if (pathname.endsWith("/studio/dirty") && method === "POST") return route.fulfill({ status: 204, body: "" });
    if (pathname.endsWith("/render") && method === "POST") {
      const input = request.postDataJSON();
      const dimensions = input.resolution === "portrait-4k" ? "2160x3840" : "1080x1920";
      const dimensionsLabel = input.resolution === "portrait-4k" ? "2160 × 3840 p" : "1080 × 1920 p";
      const output = { jobId: "render-job-1", status: "rendering", resolution: dimensions, fps: input.fps };
      const outputPath = `.yingya/exports/${input.versionId}-${input.resolution}-${input.fps}fps.mp4`;
      current = { ...current, status: "completed", statusLabel: `${dimensionsLabel} 成片已完成`, renderJobs: [{ id: "render-job-1", versionId: input.versionId, status: "completed", quality: "high", resolution: input.resolution, fps: input.fps, progress: 100, message: "成片渲染完成", outputPath, startedAt: now, updatedAt: now + 10, endedAt: now + 10 }], manifest: { ...current.manifest, phase: "completed", checkpoint: null, artifacts: [...current.manifest.artifacts, { id: "final-video", kind: "final-video", label: `${dimensionsLabel} 成片`, path: outputPath, version: input.versionId, metadata: { resolution: dimensions, frameRate: input.fps } }] } };
      return json(route, output);
    }
    return json(route, { code: "not_found", message: `Unhandled mock route: ${method} ${pathname}` }, 404);
  });
}

async function assertLiveHyperFramesPreview(browser) {
  const production = {
    ...structuredClone(detail), status: "running", statusLabel: "正在制作 HyperFrames", activeTurnId: "turn-live", queueDepth: 0, queuePaused: false, queue: [],
    manifest: { ...structuredClone(manifest), phase: "production", checkpoint: null },
  };
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, reducedMotion: "reduce" });
  const errors = [];
  let dirtyRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  page.on("request", request => { if (request.url().endsWith("/studio/dirty")) dirtyRequests += 1; });
  await installApiMock(page, production);
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.getByTitle("HyperFrames 实时画面").waitFor();
  await page.frameLocator('iframe[title="HyperFrames 实时画面"]').getByText("Agent 正在更新 Composition", { exact: true }).waitFor();
  await page.getByText("已连接", { exact: true }).waitFor();
  if (dirtyRequests !== 0) throw new Error("Read-only HyperFrames preview should not mark the project dirty");
  await page.getByRole("button", { name: "刷新实时画面" }).click();
  const frameUrl = await page.getByTitle("HyperFrames 实时画面").getAttribute("src");
  if (!frameUrl?.includes("yingyaReload=1")) throw new Error(`Live preview did not refresh: ${frameUrl}`);
  await page.frameLocator('iframe[title="HyperFrames 实时画面"]').getByText("Agent 正在更新 Composition", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-hyperframes-live.png", fullPage: true });
  await page.getByRole("button", { name: "断开 Studio" }).click();
  await page.getByText("Studio 已断开", { exact: true }).waitFor();
  if (errors.length) throw new Error(`Live preview errors:\n${errors.join("\n")}`);
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 900, height: 844 }, reducedMotion: "reduce" });
  await installApiMock(mobile, production);
  await mobile.goto(baseUrl);
  await mobile.getByRole("button", { name: /^秋季新品短片/ }).click();
  await mobile.setViewportSize({ width: 390, height: 844 });
  const liveButton = mobile.getByRole("button", { name: "预览", exact: true });
  await liveButton.click();
  await mobile.locator(".artifact-canvas").waitFor({ state: "visible" });
  if (!(await liveButton.getAttribute("class"))?.includes("active")) throw new Error("Mobile preview tab did not become active");
  await mobile.waitForFunction(() => {
    const canvas = document.querySelector(".artifact-canvas");
    if (!canvas) return false;
    const style = getComputedStyle(canvas);
    return style.opacity === "1" && Math.abs(canvas.getBoundingClientRect().left) < 1;
  });
  await mobile.getByTitle("HyperFrames 实时画面").waitFor();
  await mobile.screenshot({ path: "/tmp/yingya-ui-hyperframes-live-mobile.png", fullPage: true });
  await mobile.setViewportSize({ width: 320, height: 760 });
  const documentWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
  if (documentWidth > 320) throw new Error(`320px live preview overflows horizontally: ${documentWidth}px`);
  for (let index = 0; index < 20; index += 1) {
    await mobile.keyboard.press("Tab");
    const label = await mobile.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (label === "刷新实时画面") break;
  }
  if (!(await mobile.getByRole("button", { name: "刷新实时画面" }).evaluate(element => element.matches(":focus-visible")))) throw new Error("Studio toolbar action is not reachable with visible keyboard focus");
  await mobile.screenshot({ path: "/tmp/yingya-ui-hyperframes-live-320.png", fullPage: true });
  await mobile.close();
}

async function assertAssetWorkshop(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("request", request => { if (/\/api\/assets\/library\/[^/]+\/usage$/.test(request.url())) errors.push("Removed asset usage endpoint was requested"); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  await installApiMock(page);
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "素材工坊", exact: true }).click();
  await page.getByLabel("搜索素材").waitFor();
  await page.getByRole("heading", { name: "素材工坊", exact: true }).waitFor();
  if (await page.getByText("最近项目", { exact: true }).count()) throw new Error("Asset workshop should not show video projects in its navigation");
  const mediaTabs = page.getByRole("navigation", { name: "素材类型" });
  await mediaTabs.getByRole("button", { name: /^视频/ }).waitFor();
  await mediaTabs.getByRole("button", { name: /^音频/ }).waitFor();
  await mediaTabs.getByRole("button", { name: /^文档/ }).waitFor();
  await page.getByRole("button", { name: "批量整理" }).click();
  await page.getByRole("button", { name: "选择素材 产品定格镜头.mp4" }).click();
  await page.getByRole("button", { name: "选择素材 秋日背景音乐.mp3" }).click();
  const bulkToolbar = page.getByRole("toolbar", { name: "批量整理素材" });
  await bulkToolbar.getByText("2 项已选", { exact: true }).waitFor();
  await bulkToolbar.getByLabel("批量移动到文件夹").selectOption("folder-brand");
  await page.screenshot({ path: "/tmp/yingya-ui-asset-bulk-select.png", fullPage: true });
  const moveRequests = [];
  page.on("request", request => { if (/\/api\/assets\/library\/[^/]+$/.test(request.url()) && request.method() === "PATCH") moveRequests.push(request); });
  await bulkToolbar.getByRole("button", { name: "移动", exact: true }).click();
  await page.getByText("已将 2 项素材移动到“品牌素材”", { exact: true }).waitFor();
  await page.locator(".asset-card-item.batch-selected").first().waitFor({ state: "detached" });
  if (moveRequests.length !== 2 || moveRequests.some(request => request.postDataJSON().folderId !== "folder-brand")) throw new Error(`Unexpected batch move requests: ${moveRequests.length}`);
  await page.locator(".asset-card-item", { hasText: "秋日背景音乐.mp3" }).getByText("品牌素材", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-asset-bulk-moved.png", fullPage: true });
  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByPlaceholder("文件夹名称").fill("活动素材");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await page.getByRole("button", { name: /^活动素材/ }).waitFor();
  const uploadRequest = page.waitForRequest(request => request.url().endsWith("/api/assets/library") && request.method() === "POST");
  await page.locator('.asset-library-header input[type="file"]').setInputFiles({ name: "活动执行方案.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf-test") });
  await uploadRequest;
  await page.getByRole("button", { name: /活动执行方案\.pdf.*已上传/ }).waitFor();
  await page.getByRole("button", { name: /活动执行方案\.pdf.*已上传/ }).click();
  if (await page.getByRole("heading", { name: "使用位置", exact: true }).count() || await page.getByLabel("选择项目", { exact: true }).count()) throw new Error("Removed asset usage controls reappeared");
  const folderSelect = page.locator('select[aria-label="素材文件夹"]');
  await folderSelect.selectOption("");
  await folderSelect.selectOption({ label: "活动素材" });
  await page.getByRole("button", { name: /全部素材/ }).click();
  await page.getByRole("button", { name: "AI 生成", exact: true }).click();
  await page.getByRole("button", { name: /深色背景中的发光新芽，电影级侧光.*AI 生成/ }).waitFor();
  await page.getByRole("button", { name: "全部来源" }).click();
  await page.getByRole("button", { name: /创建素材/ }).click();
  await page.getByRole("button", { name: "生成图片" }).click();
  const prompt = page.getByPlaceholder("主体、场景、构图、光线和画幅要求");
  await prompt.fill("极简桌面上的透明智能设备，冷色轮廓光，16:9");
  const requestPromise = page.waitForRequest(request => request.url().endsWith("/api/codex/threads/image-thread-1/images") && request.method() === "POST");
  await page.getByRole("button", { name: "生成图片" }).click();
  const payload = (await requestPromise).postDataJSON();
  if (payload.prompt !== "极简桌面上的透明智能设备，冷色轮廓光，16:9") throw new Error(`Unexpected image prompt: ${JSON.stringify(payload)}`);
  await page.locator(".asset-mixed-grid b").getByText(payload.prompt, { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-asset-images.png", fullPage: true });
  await page.getByRole("button", { name: /^音色/ }).click();
  await page.getByRole("heading", { name: "音色", exact: true }).waitFor();
  await page.getByText("映芽讲解", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-asset-voices.png", fullPage: true });
  if (errors.length) throw new Error(`Asset workshop errors:\n${errors.join("\n")}`);
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });
  await installApiMock(mobile);
  await mobile.goto(baseUrl);
  await mobile.getByRole("button", { name: "素材工坊", exact: true }).click();
  await mobile.getByLabel("搜索素材").waitFor();
  await mobile.locator(".asset-mixed-grid").waitFor();
  await mobile.getByRole("button", { name: "批量整理" }).click();
  await mobile.getByRole("button", { name: "选择素材 产品定格镜头.mp4" }).click();
  await mobile.getByRole("toolbar", { name: "批量整理素材" }).getByText("1 项已选", { exact: true }).waitFor();
  const mobileDocumentWidth = await mobile.evaluate(() => document.documentElement.scrollWidth);
  if (mobileDocumentWidth > 360) throw new Error(`360px asset workshop overflows horizontally: ${mobileDocumentWidth}px`);
  await mobile.screenshot({ path: "/tmp/yingya-ui-asset-bulk-mobile.png", fullPage: true });
  await mobile.close();
}

async function assertDraftCheckpoint(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  const draft = {
    ...structuredClone(detail), status: "draft_review", statusLabel: "草稿等待确认", queueDepth: 0, queuePaused: false, queue: [],
    renderJobs: [{ id: "render-interrupted", versionId: "draft-3", status: "interrupted", quality: "high", resolution: "portrait", fps: 30, progress: 0, message: "服务重启导致渲染中断，可按原设置重试", error: "渲染服务已重启", startedAt: now - 1000, updatedAt: now, endedAt: now }],
    manifest: {
      ...structuredClone(manifest), phase: "draft_review", currentDraft: "draft-3",
      checkpoint: { id: "checkpoint-draft-3", kind: "draft", title: "草稿视频已就绪", summary: "请确认画面和节奏。", artifactIds: ["draft-3-video"] },
      artifacts: [
        { id: "draft-2-final", kind: "final-video", label: "旧版成片", path: ".yingya/versions/draft-2/final.mp4", version: "draft-2", metadata: {} },
        { id: "draft-3-video", kind: "video", label: "草稿视频", path: ".yingya/versions/draft-3/draft.mp4", version: "draft-3", metadata: {} },
      ],
      versions: [
        { id: "draft-2", label: "Draft 2", sourcePath: ".yingya/versions/draft-2", videoPath: ".yingya/versions/draft-2/draft.mp4", reportPath: null, createdAt: now - 1 },
        { id: "draft-3", label: "Draft 3", sourcePath: ".yingya/versions/draft-3", videoPath: ".yingya/versions/draft-3/draft.mp4", reportPath: null, createdAt: now },
      ],
    },
  };
  await installApiMock(page, draft);
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.locator(".artifact-canvas").waitFor();
  if (await page.locator(".checkpoint-card").count()) throw new Error("Draft review must use the preview and export workspace without a duplicate checkpoint card");
  if (await page.getByRole("tab", { name: "分镜", exact: true }).count()) throw new Error("Storyboard tab should be removed");
  const renderPanel = page.getByLabel("导出视频");
  await renderPanel.waitFor();
  if (await page.locator(".artifact-canvas > header select").inputValue() !== "draft-3") throw new Error("The newest current draft should be selected automatically");
  if (!(await page.locator(".video-stage video").getAttribute("src"))?.includes("draft-3")) throw new Error("The preview should use the current draft video instead of an older final render");
  if (await renderPanel.getByText("直接生成下载文件，不进入对话").count()) throw new Error("Export panel should not show redundant explanatory copy");
  if (await renderPanel.getByLabel("分辨率").inputValue() !== "portrait-4k") throw new Error("The 4K portrait resolution should be the default export setting");
  if ((await renderPanel.getByLabel("分辨率").locator("option:checked").textContent()) !== "2160 × 3840 p") throw new Error("Resolution should display its p suffix");
  if (await renderPanel.getByLabel("帧率").inputValue() !== "60") throw new Error("60 FPS should be the default export setting");
  await renderPanel.getByText("渲染历史", { exact: false }).click();
  await renderPanel.getByText("已中断", { exact: true }).waitFor();
  await renderPanel.getByRole("button", { name: "重试" }).waitFor();
  await page.getByRole("button", { name: "添加时间点" }).click();
  await page.locator(".time-feedback-row input").first().fill("放大标题并提高对比度");
  await page.getByRole("button", { name: "添加时间点" }).click();
  await page.locator(".time-feedback-row input").last().fill("让产品停留时间更长");
  if (await page.locator(".time-feedback-row").count() !== 2) throw new Error("Time feedback should support multiple entries");
  await page.screenshot({ path: "/tmp/yingya-ui-time-feedback.png", fullPage: true });
  await page.getByRole("button", { name: "添加到修改描述" }).click();
  const composer = page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…");
  const feedbackText = await composer.inputValue();
  if (!feedbackText.includes("Draft 3 时间点修改：") || !feedbackText.includes("放大标题并提高对比度") || !feedbackText.includes("让产品停留时间更长")) throw new Error(`Timed feedback was not added to the composer: ${feedbackText}`);
  const renderRequest = page.waitForRequest(request => request.url().endsWith("/render") && request.method() === "POST");
  await renderPanel.getByRole("button", { name: "渲染 2160 × 3840 p 成片" }).click();
  const payload = (await renderRequest).postDataJSON();
  if (payload.versionId !== "draft-3" || payload.resolution !== "portrait-4k" || payload.fps !== 60) throw new Error(`Unexpected render settings: ${JSON.stringify(payload)}`);
  const download = renderPanel.getByRole("link", { name: "下载成片" });
  await download.waitFor();
  if (await download.getAttribute("download") === null) throw new Error("Final video download should use a download link");
  await page.screenshot({ path: "/tmp/yingya-ui-render-panel.png", fullPage: true });
  await page.close();
}

async function assertWorkflowRecovery(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  const failed = {
    ...structuredClone(detail), status: "failed", statusLabel: "制作流程异常，已暂停", queuePaused: true,
    manifest: { ...structuredClone(manifest), phase: "briefing", dirty: true, checkpoint: null, artifacts: [], versions: [], currentDraft: null },
  };
  await installApiMock(page, failed);
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.getByText("制作流程已安全暂停").waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-recovery.png", fullPage: true });
  await page.getByRole("button", { name: /重新生成制作方案/ }).click();
  const composer = page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…");
  if (await composer.inputValue() !== "重新生成制作方案") throw new Error("Recovery action did not populate the composer");
  await page.close();
}

async function assertIncompleteWorkflowRecovery(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  const incomplete = {
    ...structuredClone(detail), status: "incomplete", statusLabel: "检查已通过，草稿待封存", queuePaused: true,
    manifest: { ...structuredClone(manifest), phase: "production", dirty: true, checkpoint: null, versions: [], currentDraft: null },
  };
  await installApiMock(page, incomplete);
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  const recovery = page.getByRole("status");
  await recovery.getByText("检查已通过，草稿待封存", { exact: true }).waitFor();
  await recovery.getByText("只补齐缺失的版本与审核登记", { exact: false }).waitFor();
  if (await page.getByText("制作流程已安全暂停", { exact: true }).count()) throw new Error("Recoverable incomplete work should not be presented as a failed workflow");
  await page.screenshot({ path: "/tmp/yingya-ui-incomplete.png", fullPage: true });
  await recovery.getByRole("button", { name: "检查并恢复项目流程" }).click();
  if (await page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…").inputValue() !== "检查并恢复项目流程") throw new Error("Incomplete recovery action did not populate the composer");
  await page.close();
}

async function assertWaitingInputPrompt(browser) {
  const waiting = {
    ...structuredClone(detail), status: "waiting_input", statusLabel: "等待补充创作信息", queueDepth: 0, queuePaused: false, queue: [],
    messages: [
      detail.messages[0],
      { id: "message-waiting", turnId: "turn-waiting", role: "assistant", text: "制作前请确认视觉方向：\n\n- 明亮课堂风（推荐）：白/浅蓝底，清晰的斜面示意图与公式动画\n- 深色科技讲解：深蓝底，紫色重点标注\n- 手绘板书风：仿课堂粉笔/白板演示", attachments: [], context: [], status: "completed", createdAt: now + 10 },
    ],
    manifest: { ...structuredClone(manifest), phase: "briefing", checkpoint: null, artifacts: [], versions: [], currentDraft: null },
  };
  for (const viewport of [{ width: 1440, height: 960, name: "desktop" }, { width: 360, height: 800, name: "mobile" }]) {
    const page = await browser.newPage({ viewport: viewport.name === "mobile" ? { width: 900, height: 800 } : viewport, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
    await installApiMock(page, waiting);
    await page.goto(baseUrl);
    await page.getByRole("button", { name: /^秋季新品短片/ }).click();
    if (viewport.name === "mobile") await page.setViewportSize(viewport);
    const prompt = page.getByLabel("等待你的确认");
    await prompt.waitFor();
    await prompt.getByRole("button", { name: /明亮课堂风/ }).waitFor();
    if (await page.getByRole("dialog").count()) throw new Error("Waiting input should stay inside the conversation");
    await page.screenshot({ path: `/tmp/yingya-ui-waiting-${viewport.name}.png`, fullPage: true });
    if (viewport.name === "desktop") {
      const turnRequest = page.waitForRequest(request => request.url().endsWith("/turns") && request.method() === "POST");
      await prompt.getByRole("button", { name: /明亮课堂风/ }).click();
      const payload = (await turnRequest).postDataJSON();
      if (payload.text !== "选择明亮课堂风，请继续制作。") throw new Error(`Unexpected waiting-input answer: ${payload.text}`);
    }
    if (errors.length) throw new Error(`Waiting input ${viewport.name} errors:\n${errors.join("\n")}`);
    await page.close();
  }
}

async function assertDesktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  await installApiMock(page, { ...structuredClone(detail), queueDepth: 0, queuePaused: false, queue: [] });
  await page.goto(baseUrl);
  if (page.url() !== `${baseUrl}/` || await page.title() !== "映芽 | 对话式动画视频制作工作台") throw new Error("Unexpected page identity");
  await page.getByRole("heading", { name: "把内容，做成会动的视频。", exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-home-desktop.png", fullPage: true });
  await page.getByRole("searchbox", { name: "搜索项目" }).fill("不存在的项目");
  await page.getByText("没有符合条件的项目", { exact: true }).waitFor();
  await page.getByRole("button", { name: "查看全部项目", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索项目" }).fill("秋季");
  await page.getByRole("button", { name: /^秋季新品短片/ }).waitFor();
  await page.getByRole("button", { name: "清除搜索" }).click();
  await page.getByRole("tab", { name: "全部", exact: true }).focus();
  await page.keyboard.press("End");
  if (await page.getByRole("tab", { name: "待恢复", exact: true }).getAttribute("aria-selected") !== "true") throw new Error("Keyboard project filtering failed");
  await page.getByRole("button", { name: "产品演示", exact: true }).click();
  if (!(await page.getByRole("textbox", { name: "想把什么内容做成视频？" }).inputValue()).includes("产品演示视频")) throw new Error("Starter idea did not fill the composer");
  await page.getByRole("tab", { name: "待处理" }).click();
  await page.getByRole("button", { name: /^秋季新品短片/ }).waitFor();
  await page.getByRole("tab", { name: "全部" }).click();
  await page.getByRole("button", { name: "项目操作 秋季新品短片" }).click();
  await page.getByRole("button", { name: "打开项目" }).waitFor();
  await page.getByRole("button", { name: "项目操作 秋季新品短片" }).click();
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.locator(".checkpoint-card").waitFor();
  const userBubbleBackground = await page.locator(".message--user .message-body").first().evaluate(element => getComputedStyle(element).backgroundColor);
  if (["rgb(0, 0, 0)", "rgb(29, 29, 31)"].includes(userBubbleBackground)) throw new Error(`User message bubble should not be black: ${userBubbleBackground}`);
  if (await page.getByRole("dialog").count()) throw new Error("Plan confirmation should stay inside the conversation");
  await page.screenshot({ path: "/tmp/yingya-ui-checkpoint.png", fullPage: true });
  const finalReply = page.getByText("预览已完成，请选择下一步：", { exact: false });
  await finalReply.waitFor();
  await page.locator(".message--assistant ol > li").first().waitFor();
  const planLink = page.locator(`.message--assistant a[href="/api/agent-projects/${record.id}/files/plans/production.md"]`);
  await planLink.getByText("查看制作方案", { exact: true }).waitFor();
  const activityTop = await page.locator(".activity-item").first().evaluate(element => element.getBoundingClientRect().top);
  const replyTop = await finalReply.evaluate(element => element.getBoundingClientRect().top);
  if (replyTop <= activityTop) throw new Error("Final assistant reply should follow its run activity chronologically");
  if (await page.locator(".activity-item").count() !== 1) throw new Error("Conversation should show only the latest tool operation");
  if (await page.locator(".activity-item pre, .activity-item > p").count()) throw new Error("Raw tool output should not appear in the conversation");
  await page.getByText("画面结构已经确认，接下来整理制作文件。", { exact: true }).waitFor();
  await page.getByTitle("旁白音色：默认音色").click();
  const voiceDialog = page.getByRole("dialog", { name: "旁白音色" });
  await voiceDialog.getByText("映芽讲解", { exact: true }).waitFor();
  await voiceDialog.getByRole("button", { name: "描述生成" }).click();
  await voiceDialog.getByPlaceholder("例如：温暖女声").waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-voice-design.png", fullPage: true });
  await voiceDialog.getByRole("button", { name: "关闭对话框" }).click();
  await page.locator(".canvas-tabs").getByRole("tab", { name: "素材", exact: true }).click();
  await page.getByRole("heading", { name: "参考文件", exact: true }).waitFor();
  await page.getByText("产品定格镜头.mp4", { exact: true }).waitFor();
  await page.getByText("秋日背景音乐.mp3", { exact: true }).waitFor();
  await page.getByText("品牌创作说明.pdf", { exact: true }).waitFor();
  const projectFolderFilter = page.getByLabel("筛选素材文件夹");
  await projectFolderFilter.selectOption("folder-brand");
  if (await page.getByText("品牌创作说明.pdf", { exact: true }).count()) throw new Error("Project asset folder filter did not hide unfiled documents");
  await page.getByRole("button", { name: "选择此文件夹" }).click();
  await page.getByLabel("已选择素材").getByText("图片 · 创作参考", { exact: true }).waitFor();
  await page.getByLabel("已选择素材").getByText("视频 · 创作参考", { exact: true }).waitFor();
  await page.getByRole("button", { name: "文件夹已选择" }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-project-reference-folder.png", fullPage: true });
  await page.getByRole("button", { name: "移除素材 深色背景中的发光新芽，电影级侧光" }).click();
  await page.getByRole("button", { name: "移除素材 产品定格镜头.mp4" }).click();
  await projectFolderFilter.selectOption("*");
  await page.getByRole("button", { name: "选择参考文件 品牌创作说明.pdf" }).click();
  await page.getByLabel("已选择素材").getByText("文档 · 创作参考", { exact: true }).waitFor();
  await page.getByRole("button", { name: "移除素材 品牌创作说明.pdf" }).click();
  await page.getByRole("button", { name: "选择素材" }).click();
  const materialPicker = page.getByLabel("选择创作素材");
  await materialPicker.getByText("深色背景中的发光新芽，电影级侧光", { exact: true }).click();
  await materialPicker.getByText("秋日背景音乐.mp3", { exact: true }).click();
  await page.getByLabel("已选择素材").getByText("图片 · 创作参考", { exact: true }).waitFor();
  await page.getByLabel("已选择素材").getByText("音频 · 创作参考", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-project-assets.png", fullPage: true });
  await page.getByRole("button", { name: "移除素材 深色背景中的发光新芽，电影级侧光" }).click();
  await page.getByRole("button", { name: "移除素材 秋日背景音乐.mp3" }).click();
  await materialPicker.getByRole("button", { name: "关闭素材选择" }).click();
  await page.locator(".activity-item").getByText("修改文件", { exact: true }).waitFor();
  if (await page.getByText("检查 HyperFrames", { exact: true }).count()) throw new Error("Older tool operations should be hidden");
  await page.getByRole("button", { name: /直接渲染/ }).click();
  const composer = page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…");
  if (await composer.inputValue() !== "直接渲染") throw new Error("Quick reply did not populate the composer");
  if (!await composer.evaluate(element => element === document.activeElement)) throw new Error("Quick reply did not focus the composer");
  await composer.fill("");
  await page.getByText("制作方案已就绪", { exact: true }).waitFor();
  if (await page.getByText("历史运行记录", { exact: true }).count()) throw new Error("Debug run history should not appear in the conversation");
  await page.getByRole("button", { name: /查看计划/ }).click();
  await page.getByRole("heading", { name: "制作方案", exact: true }).waitFor();
  await page.getByText("三幕结构与视觉方向。").waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-desktop.png", fullPage: true });
  if (errors.length) throw new Error(`Desktop page errors:\n${errors.join("\n")}`);
  await page.close();
}

async function assertSupersededCheckpoint(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  const revising = {
    ...structuredClone(detail), status: "running", statusLabel: "Codex 正在执行", activeTurnId: "turn-revision", queueDepth: 0, queuePaused: false, queue: [],
  };
  await installApiMock(page, revising);
  await page.goto(baseUrl);
  const eventStreamRequest = page.waitForRequest(request => request.url().includes("/events?after="));
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.getByRole("heading", { name: "秋季新品短片" }).waitFor();
  await eventStreamRequest;
  if (await page.locator(".checkpoint-card").count()) throw new Error("A checkpoint superseded by a running revision should be hidden");
  await page.close();
}

async function assertCheckpointHiddenAfterRevision(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  await installApiMock(page, { ...structuredClone(detail), queueDepth: 0, queuePaused: false, queue: [] });
  await page.goto(baseUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  const checkpoint = page.locator(".checkpoint-card");
  await checkpoint.waitFor();
  await page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…").fill("调整画面构图后重新生成草稿");
  await page.getByRole("button", { name: "发送消息" }).click();
  await checkpoint.waitFor({ state: "hidden" });
  await page.close();
}

async function assertCreateAndMobile(browser) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, "randomUUID", { configurable: true, value: undefined }); });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  await installApiMock(page, detail, { creationDelayMs: 700 });
  await page.goto(baseUrl);
  await page.getByTitle("旁白音色：默认音色").click();
  const voiceDialog = page.getByRole("dialog", { name: "旁白音色" });
  await voiceDialog.waitFor();
  const voiceBox = await voiceDialog.boundingBox();
  if (!voiceBox || voiceBox.x < 0 || voiceBox.x + voiceBox.width > 360 || voiceBox.y < 0 || voiceBox.y + voiceBox.height > 800) throw new Error(`Mobile voice dialog is outside the viewport: ${JSON.stringify(voiceBox)}`);
  await page.screenshot({ path: "/tmp/yingya-ui-voice-mobile.png", fullPage: true });
  await voiceDialog.getByRole("button", { name: "关闭对话框" }).click();
  const prompt = page.getByPlaceholder("粘贴文案或网页链接，也可以上传截图、图片和视频。告诉映芽要讲什么、给谁看…");
  await prompt.fill("网站产品宣传片");
  const createRequest = page.waitForRequest(request => request.url().endsWith("/api/agent-projects") && request.method() === "POST");
  const turnRequest = page.waitForRequest(request => request.url().endsWith("/turns") && request.method() === "POST");
  await page.getByRole("button", { name: "创建视频任务" }).click();
  await page.getByRole("heading", { name: "正在准备你的创作空间" }).waitFor();
  await page.locator(".creation-pending-card").waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".creation-pending-card")).opacity === "1");
  const pendingWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (pendingWidth > 360) throw new Error(`Mobile creation transition overflows horizontally: ${pendingWidth}px`);
  await page.screenshot({ path: "/tmp/yingya-ui-creation-pending-mobile.png", fullPage: true });
  const createPayload = (await createRequest).postDataJSON();
  if (!/^[0-9a-f-]{36}$/i.test(createPayload.clientRequestId ?? "")) throw new Error("Create request is missing a stable clientRequestId");
  const turnPayload = (await turnRequest).postDataJSON();
  if (!/^[0-9a-f-]{36}$/i.test(turnPayload.clientRequestId ?? "")) throw new Error("Turn request is missing a stable clientRequestId");
  await page.getByRole("heading", { name: "网站产品宣传片" }).waitFor();
  const composer = page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…");
  await composer.fill("加入品牌结尾");
  await page.getByRole("button", { name: "发送消息" }).click();
  await page.locator(".workspace").waitFor();
  await page.locator(".thread-footer .composer").waitFor();
  const composerBox = await page.locator(".thread-footer .composer").boundingBox();
  if (!composerBox || composerBox.y < 0 || composerBox.y + composerBox.height > 800) {
    const boxes = { composerBox, workspace: await page.locator(".workspace").boundingBox(), thread: await page.locator(".thread").boundingBox(), footer: await page.locator(".thread-footer").boundingBox() };
    throw new Error(`Mobile composer is outside the viewport: ${JSON.stringify(boxes)}`);
  }
  await page.screenshot({ path: "/tmp/yingya-ui-mobile.png", fullPage: true });
  if (errors.length) throw new Error(`Mobile page errors:\n${errors.join("\n")}`);
  await page.close();
}

async function assertFunctionalEnhancements(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const seed = { ...structuredClone(detail), status: "completed", statusLabel: "已完成", workflowStatus: "review", workflowLabel: "修改待检查", queue: [], queueDepth: 0, queuePaused: false,
    manifest: { ...structuredClone(manifest), dirty: true, checkpoint: null, currentDraft: "draft-2", versions: [1, 2].map(n => ({ id: `draft-${n}`, label: `草稿 ${n}`, sourcePath: `.yingya/versions/draft-${n}`, videoPath: `.yingya/versions/draft-${n}/draft.mp4`, reportPath: null, createdAt: now + n })) } };
  await installApiMock(page, seed);
  await page.goto(baseUrl);
  const homePrompt = page.getByPlaceholder("粘贴文案或网页链接，也可以上传截图、图片和视频。告诉映芽要讲什么、给谁看…");
  await homePrompt.fill("保存这条未发送的创作想法");
  await page.locator('input[type=file]').first().setInputFiles({ name: "参考文件.pdf", mimeType: "application/pdf", buffer: Buffer.from("test reference") });
  await page.getByText("附件已保存", { exact: true }).waitFor();
  await page.getByText("创作设置与素材", { exact: true }).click();
  await page.getByLabel("目标时长").selectOption("30 秒");
  await page.getByLabel("目标受众").fill("新用户");
  await page.getByLabel("品牌创作说明.pdf", { exact: true }).check();
  await page.reload();
  await page.getByText("附件已保存", { exact: true }).waitFor();
  if (await homePrompt.inputValue() !== "保存这条未发送的创作想法") throw new Error("Home text draft was lost after reload");
  await page.getByRole("button", { name: "移除 参考文件.pdf" }).waitFor();
  await page.getByText(/创作设置与素材/).click();
  if (await page.getByLabel("目标时长").inputValue() !== "30 秒" || !(await page.getByLabel("品牌创作说明.pdf", { exact: true }).isChecked())) throw new Error("Creation settings or reference selection did not survive reload");
  await page.getByRole("button", { name: "任务中心" }).click();
  await page.locator(".task-row").getByText("修改待检查", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  const projectListUrl = `${baseUrl}/api/agent-projects`;
  await page.route(projectListUrl, route => json(route, [{ ...seed, workflowStatus: "completed", workflowLabel: "成片已完成", statusLabel: "成片已完成" }]));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.locator(".task-center-trigger b").waitFor();
  await page.getByRole("button", { name: "任务中心" }).click();
  await page.locator(".task-row").getByText("成片已完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "标记已读" }).click();
  await page.keyboard.press("Escape");
  await page.unroute(projectListUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.waitForURL(`**/#/projects/${seed.id}`);
  const composer = page.getByPlaceholder("例如：把开场标题放大，第 8 秒的图表多停留 2 秒…");
  await composer.fill("这个项目独有的修改草稿");
  await page.reload();
  await composer.waitFor();
  if (await composer.inputValue() !== "这个项目独有的修改草稿") throw new Error("Project draft or direct project route was lost");
  await page.evaluate(projectId => localStorage.setItem(`yingya-canvas-tab:${projectId}`, JSON.stringify({ version: 1, value: "storyboard" })), seed.id);
  await page.reload();
  await page.locator('#canvas-tab-preview[aria-selected="true"]').waitFor();
  if (await page.getByRole("tab", { name: "分镜", exact: true }).count()) throw new Error("Removed storyboard tab should not reappear from saved state");
  await page.locator("#canvas-tab-preview").focus();
  await page.keyboard.press("ArrowRight");
  await page.locator('#canvas-tab-assets[aria-selected="true"]').waitFor();
  await page.locator(".canvas-tabs").getByRole("tab", { name: "素材", exact: true }).click();
  await page.getByText("查找配乐与音效", { exact: true }).click();
  await page.getByLabel("搜索描述").fill("轻快钢琴");
  await page.getByRole("button", { name: "搜索音频" }).click();
  await page.getByLabel("试听 轻快钢琴").waitFor();
  await page.getByRole("button", { name: "加入项目并描述用途" }).click();
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="修改描述"]')?.value.includes("assets/audio/music-test.mp3"));
  await page.locator(".canvas-tabs").getByRole("tab", { name: "预览", exact: true }).click();
  await page.getByText("比较版本", { exact: true }).click();
  await page.locator(".version-comparison video").nth(1).waitFor();
  if (await page.locator(".version-comparison video").count() !== 2) throw new Error("Version comparison did not show two versions");
  await page.getByRole("button", { name: "添加时间点" }).click();
  await page.locator(".time-feedback-row input").first().fill("新版保留的意见");
  await page.locator(".artifact-canvas > header select").selectOption("draft-1");
  if (await page.locator(".time-feedback-row").count()) throw new Error("Feedback leaked into a different version");
  await page.locator(".artifact-canvas > header select").selectOption("draft-2");
  if (await page.locator(".time-feedback-row input").first().inputValue() !== "新版保留的意见") throw new Error("Version feedback was lost when switching versions");
  await page.setViewportSize({ width: 320, height: 800 });
  if (await page.locator(".workspace-tabs").getByRole("button", { name: "分镜", exact: true }).count()) throw new Error("Mobile navigation should not show storyboard");
  await page.locator(".workspace-tabs").getByRole("button", { name: "预览", exact: true }).click();
  if (await page.evaluate(() => document.documentElement.scrollWidth) > 320) throw new Error("Preview overflows at 320px");
  await page.screenshot({ path: "/tmp/yingya-features-preview-320.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.goBack();
  await page.waitForURL(`**/#/projects/${seed.id}`);
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  if (await homePrompt.inputValue() !== "保存这条未发送的创作想法") throw new Error("Home and project drafts were mixed");
  await page.getByRole("button", { name: "素材工坊", exact: true }).click();
  await page.locator(".asset-folder-row", { hasText: "品牌素材" }).hover();
  await page.getByRole("button", { name: "重命名文件夹 品牌素材" }).click();
  await page.getByRole("dialog").getByLabel("新名称").fill("品牌参考");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await page.locator(".asset-folder-row", { hasText: "品牌参考" }).hover();
  await page.getByRole("button", { name: "删除文件夹 品牌参考" }).click();
  await page.getByRole("dialog").getByText(/文件不会删除/).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByLabel("搜索素材").fill("品牌创作说明");
  await page.locator(".asset-mixed-grid b").getByText("品牌创作说明.pdf", { exact: true }).click();
  await page.getByRole("button", { name: "重命名素材" }).click();
  await page.getByRole("dialog").getByLabel("新名称").fill("新品牌说明.pdf");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await page.getByLabel("搜索素材").fill("新品牌说明");
  await page.locator(".asset-mixed-grid b").getByText("新品牌说明.pdf", { exact: true }).click();
  await page.getByRole("button", { name: "删除素材", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await page.locator(".asset-mixed-grid b").getByText("新品牌说明.pdf", { exact: true }).waitFor({ state: "hidden" });
  if (errors.length) throw new Error(`Feature page errors: ${errors.join("; ")}`);
  await page.close();
  const creation = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  await installApiMock(creation);
  await creation.goto(baseUrl);
  await creation.getByPlaceholder("粘贴文案或网页链接，也可以上传截图、图片和视频。告诉映芽要讲什么、给谁看…").fill("展示我们的产品");
  await creation.getByText("创作设置与素材", { exact: true }).click();
  await creation.getByLabel("目标时长").selectOption("30 秒");
  await creation.getByLabel("品牌创作说明.pdf", { exact: true }).check();
  const turn = creation.waitForRequest(request => request.url().endsWith("/turns") && request.method() === "POST");
  await creation.getByRole("button", { name: "创建视频任务" }).click();
  const payload = (await turn).postDataJSON();
  if (!payload.text.includes("目标时长：30 秒") || !payload.attachments.includes("assets/inbox/document-1")) throw new Error("Creation settings or library files were not sent to the project");
  await creation.close();
  console.log("Feature QA passed: persisted text/files/settings, direct links, tasks, conversation editing, retired storyboard navigation, audio, version comparison/feedback, and asset/folder management");
}

async function assertMotionFeedback(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    window.motionSources = [];
    window.EventSource = class extends EventTarget {
      constructor() { super(); window.motionSources.push(this); }
      close() { window.motionSources = window.motionSources.filter(source => source !== this); }
    };
  });
  const seed = structuredClone(detail);
  seed.queue = []; seed.queueDepth = 0;
  seed.messages = Array.from({ length: 20 }, (_, index) => ({ ...detail.messages[0], id: `motion-history-${index}`, text: `创作讨论 ${index}。${"保留画面与旁白的清晰层次。".repeat(12)}`, createdAt: now + 100 + index }));
  await installApiMock(page, seed);
  await page.goto(baseUrl);
  await page.locator(".home-project-open").first().click();
  await page.waitForFunction(() => window.motionSources.length > 0);
  await page.waitForFunction(() => { const el = document.querySelector(".timeline"); return el && el.scrollHeight - el.clientHeight - el.scrollTop < 3; });
  await page.locator(".timeline").evaluate(el => { el.scrollTop = 100; el.dispatchEvent(new Event("scroll")); });
  await page.evaluate(event => window.motionSources.forEach(source => source.dispatchEvent(new MessageEvent("agent-event", { data: JSON.stringify(event) }))), {
    seq: 100, projectId: seed.id, turnId: "motion-turn", method: "item/agentMessage/delta", payload: { params: { itemId: "motion-message", delta: "正在更新分镜。".repeat(10) } }, createdAt: now + 1000,
  });
  const latest = page.getByRole("button", { name: "有新消息，回到最新" });
  await latest.waitFor();
  if (Math.abs(await page.locator(".timeline").evaluate(el => el.scrollTop) - 100) > 2) throw new Error("Live output moved the reader away from history");
  await latest.click();
  await page.waitForFunction(() => { const el = document.querySelector(".timeline"); return el.scrollHeight - el.clientHeight - el.scrollTop < 3; });

  const composer = page.getByRole("textbox", { name: "修改描述", exact: true });
  await composer.fill("测试排队反馈");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByText("已加入队列", { exact: true }).waitFor();
  await composer.fill("下一条草稿");
  if (await page.locator(".composer-feedback").innerText()) throw new Error("Previous submission status remained on the next draft");
  await page.route("**/api/agent-projects/*/turns", route => json(route, { code: "unavailable", message: "测试发送失败" }, 503));
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "重试发送消息" }).waitFor();
  if (await composer.inputValue() !== "下一条草稿") throw new Error("Failed submission lost the draft");
  await composer.fill("修改后重新发送");
  if (await page.locator(".composer-feedback").innerText() || await page.locator(".thread-footer .form-error").count()) throw new Error("Editing a new draft retained an old send error");
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();

  const trigger = page.locator(".model-trigger");
  await trigger.click();
  await page.locator(".model-menu").evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
  await trigger.click();
  // Freeze midway through exit so this checks interrupted motion without depending on CPU speed.
  await page.locator(".model-menu").evaluate(el => el.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = 75; }));
  await trigger.evaluate(el => el.click());
  const firstOpacity = await page.locator(".model-menu").evaluate(el => el.getAnimations().flatMap(animation => animation.effect.getKeyframes()).find(frame => frame.opacity !== undefined)?.opacity);
  if (!(Number(firstOpacity) > 0)) throw new Error("Reopening a closing menu flashed back to transparent");
  await trigger.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => !document.querySelector(".model-menu"));
  await page.close();
  console.log("Motion QA passed: history position, latest navigation, server queue feedback, draft/error continuity, interrupted menu motion and reduced motion");
}

async function assertDesignRepairs(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const seed = { ...structuredClone(detail), queue: [], queueDepth: 0, queuePaused: false,
    manifest: { ...structuredClone(manifest), phase: "draft_review", dirty: true, checkpoint: { id: "review", kind: "draft", title: "审阅草稿", summary: "", artifactIds: [] }, currentDraft: "draft-1", versions: [{ id: "draft-1", label: "草稿 1", sourcePath: "index.html", videoPath: "renders/draft.mp4", createdAt: now }], artifacts: [{ id: "sheet", kind: "snapshot", label: "关键帧总览", path: "snapshots/contact-sheet.jpg", metadata: {} }] },
    messages: [{ id: "reply", role: "assistant", text: `[打开视频](/home/lake/workspace/yingya/data/video-projects/${record.id}/renders/draft.mp4)`, attachments: [], context: [], status: "completed", createdAt: now }],
  };
  await installApiMock(page, seed);
  await page.route("**/files/snapshots/contact-sheet.jpg", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  await page.goto(baseUrl);
  await page.getByTitle("旁白音色：默认音色").click();
  await page.getByRole("button", { name: "描述生成", exact: true }).click();
  await page.getByPlaceholder("例如：温暖女声").fill("可见的音色表单");
  const dialog = await page.getByRole("dialog", { name: "旁白音色", exact: true }).boundingBox();
  if (!dialog || dialog.y < 0 || dialog.y + dialog.height > 960) throw new Error("Voice creation escaped the desktop viewport");
  await page.keyboard.press("Escape");
  await page.locator(".model-trigger").click();
  await page.keyboard.press("ArrowDown");
  if (await page.evaluate(() => document.activeElement?.getAttribute("role")) !== "menuitemradio") throw new Error("Model keyboard navigation did not enter its options");
  await page.keyboard.press("Escape");
  await page.goto(`${baseUrl}/#/projects/${seed.id}`);
  await page.locator(".video-stage video").waitFor();
  const link = page.getByRole("link", { name: "打开视频", exact: true });
  if (await link.getAttribute("href") !== `/api/agent-projects/${seed.id}/files/renders/draft.mp4`) throw new Error("Historical file URL was not resolved through the project API");
  if (await page.locator(".dirty-chip").count()) throw new Error("Draft review should not show an unscoped dirty warning");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("export-destination"));
  await page.locator("#canvas-tab-artifacts").click();
  const imageGroup = page.getByRole("button", { name: "画面与封面 1", exact: true });
  if (await imageGroup.getAttribute("aria-expanded") !== "false") throw new Error("Secondary artifact groups should start collapsed");
  await imageGroup.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /关键帧总览.*snapshots/ }).click();
  await page.waitForFunction(() => document.querySelector("img.artifact-media")?.naturalWidth > 0);
  if (await page.locator(".artifact-source").count()) throw new Error("Image artifact was decoded as source text");
  await page.getByRole("button", { name: "返回项目产物" }).click();
  if (await imageGroup.getAttribute("aria-expanded") !== "true") throw new Error("Returning from preview lost the expanded artifact group");
  await page.locator("#canvas-tab-preview").click();
  await page.setViewportSize({ width: 1024, height: 768 });
  const stage = await page.locator(".video-stage").boundingBox();
  if (!stage || stage.width < 240) throw new Error(`Portrait preview was squeezed: ${JSON.stringify(stage)}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByRole("button", { name: "描述修改", exact: true }).click();
  await page.getByRole("textbox", { name: "修改描述" }).fill("从预览继续修改");
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.getByRole("button", { name: "素材工坊", exact: true }).click();
  await page.locator(".asset-media-tabs").getByRole("button", { name: /^视频/ }).click();
  if (await page.locator(".asset-inspector").isVisible()) throw new Error("Mobile category navigation opened an unsolicited inspector");
  await page.close();
  console.log("Design repair QA passed: desktop voice, keyboard model selection, project file links, typed image preview, export focus, 1024px portrait, mobile feedback and asset filters");
}

async function assertSelectionMotion(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "no-preference" });
  await installApiMock(page);
  await page.goto(baseUrl);
  const filters = page.locator(".project-filters");
  await filters.getByRole("tab").first().waitFor();
  async function aligned(selector, line = false) {
    await page.waitForFunction(({ selector, line }) => {
      const parent = document.querySelector(selector);
      const target = parent?.querySelector("button.active")?.getBoundingClientRect();
      const marker = parent?.querySelector(".selection-indicator")?.getBoundingClientRect();
      return target && marker && marker.width > 0 && Math.abs(marker.left - target.left - (line ? 12 : 0)) < 1 && Math.abs(marker.width - target.width + (line ? 24 : 0)) < 1;
    }, { selector, line });
  }
  await aligned(".project-filters");
  await filters.getByRole("tab").nth(1).click();
  // Pause the marker mid-flight, then change destination to verify visual continuity.
  const before = await filters.locator(".selection-indicator").evaluate(el => {
    el.getAnimations().forEach(a => { a.pause(); a.currentTime = 65; });
    return el.getBoundingClientRect().left;
  });
  await filters.getByRole("tab").nth(3).evaluate(el => el.click());
  const after = await filters.locator(".selection-indicator").evaluate(el => {
    el.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; });
    return el.getBoundingClientRect().left;
  });
  if (Math.abs(before - after) > 1) throw new Error("Selection jumped when interrupted");
  await filters.locator(".selection-indicator").evaluate(el => el.getAnimations().forEach(a => a.finish()));
  await aligned(".project-filters");
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await aligned(".project-filters");
  }
  await filters.getByRole("tab").first().click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await aligned(".project-filters");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const voice = page.locator(".voice-trigger");
  await voice.click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".action-dialog").waitFor({ state: "detached" });
  if (!(await voice.evaluate(el => el === document.activeElement))) throw new Error("Animated dialog did not restore focus");
  await voice.click();
  if (await page.getByRole("dialog").evaluate(el => el.getAnimations().length)) throw new Error("Reduced-motion dialog still animates");
  await page.keyboard.press("Escape");
  await page.locator(".action-dialog").waitFor({ state: "detached" });
  await page.locator(".home-project-open").first().click();
  await aligned(".canvas-tabs", true);
  await page.getByRole("tab", { name: /^素材/ }).click();
  await aligned(".canvas-tabs", true);
  await page.setViewportSize({ width: 390, height: 844 });
  await aligned(".workspace-tabs");
  await page.locator(".workspace-tabs").getByRole("button", { name: "预览" }).click();
  await aligned(".workspace-tabs");
  await page.setViewportSize({ width: 320, height: 740 });
  await aligned(".workspace-tabs");
  await page.close();
  console.log("Selection motion QA passed: interrupted motion, responsive alignment, live reduced-motion switch, modal focus and mobile tabs");
}

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  await assertSelectionMotion(browser);
  await assertDesignRepairs(browser);
  await assertMotionFeedback(browser);
  await assertFunctionalEnhancements(browser);
  await assertAssetWorkshop(browser);
  await assertDesktop(browser);
  await assertLiveHyperFramesPreview(browser);
  await assertDraftCheckpoint(browser);
  await assertSupersededCheckpoint(browser);
  await assertCheckpointHiddenAfterRevision(browser);
  await assertWorkflowRecovery(browser);
  await assertIncompleteWorkflowRecovery(browser);
  await assertWaitingInputPrompt(browser);
  await assertCreateAndMobile(browser);
  console.log("UI QA passed: asset workshop batch move, HyperFrames live preview, waiting-input prompt, plan/draft checkpoints, failed/incomplete workflow recovery, desktop project flow, and 360px creation/message flow");
  console.log("Screenshots: /tmp/yingya-ui-asset-bulk-select.png, /tmp/yingya-ui-asset-bulk-moved.png, /tmp/yingya-ui-asset-bulk-mobile.png, /tmp/yingya-ui-home-desktop.png, /tmp/yingya-ui-hyperframes-live.png, /tmp/yingya-ui-hyperframes-live-mobile.png, /tmp/yingya-ui-hyperframes-live-320.png, /tmp/yingya-ui-waiting-desktop.png, /tmp/yingya-ui-waiting-mobile.png, /tmp/yingya-ui-checkpoint.png, /tmp/yingya-ui-desktop.png, /tmp/yingya-ui-creation-pending-mobile.png, /tmp/yingya-ui-mobile.png");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  if (preview.exitCode === null) await Promise.race([once(preview, "exit"), new Promise(resolve => setTimeout(resolve, 2_000))]);
}
