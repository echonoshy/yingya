import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
// Reuse the named tmux frontend service, as the marketing checks do.
const baseUrl = process.env.YINGYA_UI_QA_URL ?? "http://127.0.0.1:8798";
const workspaceUrl = `${baseUrl}/app`;

async function waitForFrontend() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* the tmux service may still be starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`No frontend at ${baseUrl}. Run npm run web:service:start (tmux yingya-frontend, port 8798), or set YINGYA_UI_QA_URL.`);
}

const now = 1_750_000_000_000;
const record = {
  id: "11111111-1111-4111-8111-111111111111", title: "秋季新品短片", status: "waiting", statusLabel: "等待确认",
  threadId: "thread-1", activeTurnId: null, queueDepth: 1, queuePaused: true, model: "gpt-5.6-terra",
  reasoningEffort: "medium", aspectRatio: "9:16", createdAt: now, updatedAt: now,
  voiceId: "default",
};
const manifest = {
  schemaVersion: 1, phase: "plan_review", dirty: false,
  checkpoint: { id: "checkpoint-1", kind: "plan", title: "制作方案已就绪", summary: "三幕结构，约 30 秒。", artifactIds: ["plan"] },
  outputSpec: { requirements: { audioMode: "narration" } }, artifacts: [{ id: "plan", kind: "plan", label: "制作方案", path: "plans/production.md", version: null, metadata: {} }],
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
  // Existing scenarios exercise the retained legacy workbench. New timeline flows
  // are covered by editor-browser.mjs through the default user preference.
  await page.addInitScript(() => localStorage.setItem("yingya-user:qa-user:yingya-editor-view", JSON.stringify({version:1,value:"legacy"})));
  let projects = [seed];
  let current = structuredClone(seed);
  let nextTurnId = 0;
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
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname.replace(/^\/api\/u\/qa-user\//, "/api/");
    if (pathname === "/api/auth/me") return json(route, { user: { id: "qa-user", email: "qa@example.com", isAdmin: false } });
    const method = request.method();

    if (pathname === "/api/video/capabilities") return json(route, { available: false, model: "gen4.5", reason: "视频生成服务尚未连接" });
    if (pathname.endsWith("/composition")) return json(route, request.method() === "GET" ? { available: false } : { brands: [], templates: [] });
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
    if (pathname.endsWith("/plan")) return json(route, {checkpointId:current.manifest.checkpoint?.id ?? null,revision:"legacy-plan",ready:true,document:null,markdown:"制作方案"});
    if (pathname.endsWith("/feedback-results")) return json(route, {items:[]});
    if (pathname.endsWith("/event-log")) return json(route, {
      items: [
        { seq: 1, projectId: seed.id, turnId: "turn-1", method: "item/started", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes check" } } }, createdAt: now },
        { seq: 2, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes check", status: "completed", aggregatedOutput: "passed" } } }, createdAt: now + 1 },
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
    if (pathname.endsWith("/asset-roles") && method === "PATCH") return json(route, { assetRoles: [request.postDataJSON()] });
    if (pathname.endsWith("/workbench") && method === "GET") {
      const selected = current.manifest.versions.find(v => v.id === url.searchParams.get("versionId"));
      const workspace = { sourcePath: ".", scenesRevision: "qa-scenes", scenes: media.scenes, assets: media.assets, sourceBindings: null };
      return json(route, { ...workspace, versionId: selected?.id ?? null, currentVersionId: current.manifest.currentDraft,
        sourcePath: selected?.sourcePath ?? ".", requirements: current.manifest.outputSpec.requirements ?? {},
        assetRoles: [], recipeCatalog: { schemaVersion: 1, recipes: [] }, editable: false,
        editReason: "此测试项目没有受控镜头", workspace });
    }
    if (pathname.endsWith("/turns") && method === "POST") {
      const input = request.postDataJSON();
      const turnId = `turn-new-${++nextTurnId}`;
      current.queue.push({ id: turnId, text: input.text, attachments: input.attachments ?? [], context: input.context ?? [], createdAt: now + 10 });
      current.queueDepth = current.queue.length;
      return json(route, { turnId, status: "queued", queueDepth: current.queueDepth });
    }
    if (pathname.endsWith("/resume") && method === "POST") {
      current = { ...current, queuePaused: false, status: "queued", statusLabel: "已排队" };
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname.endsWith("/checkpoint") && method === "POST") return json(route, { turnId: "turn-confirm", status: "queued", queueDepth: 1 });
    if (pathname.endsWith("/studio") && method === "POST") return json(route, { storyboardUrl: `${baseUrl}/mock-hyperframes-storyboard`, previewUrl: `${baseUrl}/mock-hyperframes-studio`, state: "running", host: "", port: 0, projectName: current.id, lastSeenAt: now });
    if (pathname.endsWith("/studio/heartbeat") && method === "POST") return json(route, { storyboardUrl: `${baseUrl}/mock-hyperframes-storyboard`, previewUrl: `${baseUrl}/mock-hyperframes-studio`, state: "running", host: "", port: 0, projectName: current.id, lastSeenAt: Date.now() });
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
  async function assertResourceErrorRecovery(target, suffix) {
    const iframe = await target.getByTitle("HyperFrames 实时画面").elementHandle();
    const failedFrame = await iframe.contentFrame();
    const message = "模型纹理加载失败：assets/models/product.png";
    await failedFrame.evaluate(message => parent.postMessage({ type: "yingya-preview-error", message }, "*"), message);
    await target.getByText("实时画面暂不可用", { exact: true }).waitFor();
    await target.getByText(message, { exact: true }).waitFor();
    await target.getByTitle("HyperFrames 实时画面").waitFor({ state: "detached" });
    if (!failedFrame.isDetached()) throw new Error("A resource failure must unload the failed iframe before retrying");
    // React may reuse the former dark iframe wrapper; wait until its error
    // surface has repainted before assessing contrast or taking evidence.
    await target.waitForFunction(() => getComputedStyle(document.querySelector(".live-preview-state--error")).backgroundColor === "rgb(255, 255, 255)", null, { timeout: 2000 });
    await target.screenshot({ path: `/tmp/yingya-ui-hyperframes-error-${suffix}.png`, fullPage: true });
    await target.getByRole("button", { name: "重新连接", exact: true }).click();
    await target.getByText("已连接", { exact: true }).waitFor();
    await target.frameLocator('iframe[title="HyperFrames 实时画面"]').getByText("Agent 正在更新 Composition", { exact: true }).waitFor();
    if (await target.getByText(message, { exact: true }).count()) throw new Error("A reconnected preview must clear the resource error");
    const recoveredFrame = await (await target.getByTitle("HyperFrames 实时画面").elementHandle()).contentFrame();
    if (recoveredFrame === failedFrame) throw new Error("Reconnect must mount a fresh iframe");
    await target.screenshot({ path: `/tmp/yingya-ui-hyperframes-reconnected-${suffix}.png`, fullPage: true });
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, reducedMotion: "reduce" });
  const errors = [];
  let dirtyRequests = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  page.on("request", request => { if (request.url().endsWith("/studio/dirty")) dirtyRequests += 1; });
  await installApiMock(page, production);
  await page.goto(workspaceUrl);
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
  await assertResourceErrorRecovery(page, "desktop");
  if (dirtyRequests !== 0) throw new Error("Recovering a preview resource error must not mark the project dirty");
  await page.getByRole("button", { name: "断开 Studio" }).click();
  await page.getByText("Studio 已断开", { exact: true }).waitFor();
  if (errors.length) throw new Error(`Live preview errors:\n${errors.join("\n")}`);
  await page.close();

  const mobile = await browser.newPage({ viewport: { width: 900, height: 844 }, reducedMotion: "reduce" });
  await installApiMock(mobile, production);
  await mobile.goto(workspaceUrl);
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
  await assertResourceErrorRecovery(mobile, "320");
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > 320)) throw new Error("The resource error or recovered preview overflows a narrow viewport");
  await mobile.close();
}

async function assertAssetWorkshop(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("request", request => { if (/\/api\/u\/qa-user\/assets\/library\/[^/]+\/usage$/.test(request.url())) errors.push("Removed asset usage endpoint was requested"); });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  await installApiMock(page);
  await page.goto(workspaceUrl);
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
  page.on("request", request => { if (/\/api\/u\/qa-user\/assets\/library\/[^/]+$/.test(request.url()) && request.method() === "PATCH") moveRequests.push(request); });
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
  const uploadRequest = page.waitForRequest(request => request.url().endsWith("/assets/library") && request.method() === "POST");
  await page.locator('.asset-library-header input[type="file"]').setInputFiles({ name: "活动执行方案.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf-test") });
  await uploadRequest;
  await page.getByRole("button", { name: /活动执行方案\.pdf.*已上传/ }).waitFor();
  await page.getByRole("button", { name: /活动执行方案\.pdf.*已上传/ }).click();
  if (await page.getByRole("heading", { name: "使用位置", exact: true }).count() || await page.getByLabel("选择项目", { exact: true }).count()) throw new Error("Removed asset usage controls reappeared");
  const folderSelect = page.locator('select[aria-label="素材文件夹"]');
  const clearFolder = page.waitForResponse(response => response.url().includes('/assets/library/') && response.request().method() === 'PATCH');
  await folderSelect.selectOption("");
  await clearFolder;
  // Moving out of the current folder removes the selected item and its inspector.
  await folderSelect.waitFor({ state: 'detached' });
  await page.getByRole("button", { name: /全部素材/ }).click();
  await page.getByRole("button", { name: /活动执行方案\.pdf.*已上传/ }).click();
  await folderSelect.selectOption({ label: "活动素材" });
  await page.getByRole("button", { name: /全部素材/ }).click();
  await page.getByRole("button", { name: "AI 生成", exact: true }).click();
  await page.getByRole("button", { name: /深色背景中的发光新芽，电影级侧光.*AI 生成/ }).waitFor();
  await page.getByRole("button", { name: "全部来源" }).click();
  await page.getByRole("button", { name: /创建素材/ }).click();
  await page.getByRole("button", { name: "生成图片" }).click();
  const prompt = page.getByPlaceholder("主体、场景、构图、光线和画幅要求");
  await prompt.fill("极简桌面上的透明智能设备，冷色轮廓光，16:9");
  const requestPromise = page.waitForRequest(request => request.url().endsWith("/codex/threads/image-thread-1/images") && request.method() === "POST");
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
  await mobile.goto(workspaceUrl);
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
  await page.goto(workspaceUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.locator(".artifact-canvas").waitFor();
  if (await page.locator(".checkpoint-card").count()) throw new Error("Draft review must use the preview and export workspace without a duplicate checkpoint card");
  if (await page.getByRole("tab", { name: "分镜", exact: true }).count()) throw new Error("Storyboard tab should be removed");
  const renderPanel = page.getByLabel("视频分享与导出");
  await renderPanel.waitFor();
  if (await page.locator(".artifact-canvas > header select").inputValue() !== "draft-3") throw new Error("The newest current draft should be selected automatically");
  if (!(await page.locator(".video-stage video").getAttribute("src"))?.includes("draft-3")) throw new Error("The preview should use the current draft video instead of an older final render");
  await renderPanel.getByRole("button", { name: "分享当前视频", exact: true }).waitFor();
  if (await renderPanel.getByText("可分享和下载", { exact: true }).count()) throw new Error("Redundant ready badge should be removed");
  if (await renderPanel.locator(".export-settings").evaluate(el => el.open)) throw new Error("Extra export settings should start collapsed");
  await renderPanel.locator(".video-download-menu summary").click();
  const currentDownload = renderPanel.getByRole("link", { name: "下载当前视频", exact: true });
  if (await currentDownload.getAttribute("href") !== await page.locator(".video-stage video").getAttribute("src")) throw new Error("Download must match the selected preview before export");
  await page.locator(".artifact-canvas > header select").selectOption("draft-2");
  await renderPanel.locator(".video-download-menu summary").click();
  if (!(await currentDownload.getAttribute("href"))?.includes("draft-2/final.mp4")) throw new Error("Selecting an older version must also switch the download source");
  await page.locator(".artifact-canvas > header select").selectOption("draft-3");
  await renderPanel.locator(".video-download-menu summary").click();
  if (!(await currentDownload.getAttribute("href"))?.includes("draft-3/draft.mp4")) throw new Error("Returning to the preview version must restore its download source");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "导出其他规格", exact: true }).click();
  await renderPanel.locator(".export-settings[open]").waitFor();
  if (await renderPanel.getByText("直接生成下载文件，不进入对话").count()) throw new Error("Export panel should not show redundant explanatory copy");
  if (await renderPanel.getByLabel("分辨率").inputValue() !== "portrait") throw new Error("1080 portrait resolution should be the default export setting");
  if ((await renderPanel.getByLabel("分辨率").locator("option:checked").textContent()) !== "1080 × 1920 p") throw new Error("Resolution should display its p suffix");
  if (await renderPanel.getByLabel("帧率").inputValue() !== "30") throw new Error("30 FPS should be the fallback export setting");
  await renderPanel.getByText("导出历史", { exact: false }).click();
  await renderPanel.getByText("已中断", { exact: true }).waitFor();
  await renderPanel.getByRole("button", { name: "重试" }).waitFor();
  await page.getByRole("button", { name: "时间点反馈" }).click();
  await page.locator(".feedback-drafts .visual-feedback-card textarea").first().fill("放大标题并提高对比度");
  await assertCompactTextarea(page.locator(".feedback-drafts .visual-feedback-card textarea").first());
  await page.getByRole("button", { name: "时间点反馈" }).click();
  await page.locator(".feedback-drafts .visual-feedback-card textarea").last().fill("让产品停留时间更长");
  if (await page.locator(".feedback-drafts .visual-feedback-card").count() !== 2) throw new Error("Time feedback should support multiple entries");
  await page.screenshot({ path: "/tmp/yingya-ui-time-feedback.png", fullPage: true });
  const composer = page.getByPlaceholder("描述想修改的内容…");
  const feedbackText = await composer.inputValue();
  if (feedbackText.includes("放大标题并提高对比度")) throw new Error("Structured feedback should not be copied into the message text");
  if (!(await page.locator(".feedback-drafts").innerText()).includes("Draft 3")) throw new Error("Feedback cards lost their version label");
  const renderRequest = page.waitForRequest(request => request.url().endsWith("/render") && request.method() === "POST");
  await renderPanel.getByRole("button", { name: "开始导出" }).click();
  const payload = (await renderRequest).postDataJSON();
  if (payload.versionId !== "draft-3" || payload.resolution !== "portrait" || payload.fps !== 30) throw new Error(`Unexpected render settings: ${JSON.stringify(payload)}`);
  await renderPanel.locator(".video-download-menu summary").click();
  const download = renderPanel.getByRole("link", { name: "下载当前视频" });
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
  await page.goto(workspaceUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.getByText("制作需要恢复").waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-recovery.png", fullPage: true });
  await page.getByRole("button", { name: /重新生成制作方案/ }).click();
  const composer = page.getByPlaceholder("描述想修改的内容…");
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
  await page.goto(workspaceUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  const recovery = page.getByRole("status");
  await recovery.getByText("检查已通过，草稿待封存", { exact: true }).waitFor();
  await recovery.getByText("只补齐缺失的版本与审核登记", { exact: false }).waitFor();
  if (await page.getByText("制作需要恢复", { exact: true }).count()) throw new Error("Recoverable incomplete work should not be presented as a failed workflow");
  await page.screenshot({ path: "/tmp/yingya-ui-incomplete.png", fullPage: true });
  await recovery.getByRole("button", { name: "检查并恢复项目流程" }).click();
  if (await page.getByPlaceholder("描述想修改的内容…").inputValue() !== "检查并恢复项目流程") throw new Error("Incomplete recovery action did not populate the composer");
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
    await page.goto(workspaceUrl);
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
  await page.goto(workspaceUrl);
  if (page.url() !== workspaceUrl || await page.title() !== "映芽 | 对话式动画视频制作工作台") throw new Error("Unexpected page identity");
  await page.getByRole("heading", { name: "让想法，成为会动的作品。", exact: true }).waitFor();
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
  await page.getByText("更多创作方式", { exact: true }).click();
  await page.getByRole("button", { name: "开始产品演示", exact: true }).click();
  await page.getByLabel("产品与核心卖点", { exact: true }).fill("展示产品如何帮助新用户整理素材");
  await page.getByRole("button", { name: "带入创作区", exact: true }).click();
  if (!(await page.getByRole("textbox", { name: "想把什么内容做成视频？" }).inputValue()).includes("产品演示视频")) throw new Error("Task starter did not fill the composer");
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
  const planLink = page.locator(`.message--assistant a[href="/api/u/qa-user/agent-projects/${record.id}/files/plans/production.md"]`);
  await planLink.getByText("查看制作方案", { exact: true }).waitFor();
  const activityTop = await page.locator(".activity-item").first().evaluate(element => element.getBoundingClientRect().top);
  const replyTop = await finalReply.evaluate(element => element.getBoundingClientRect().top);
  if (replyTop <= activityTop) throw new Error("Final assistant reply should follow its run activity chronologically");
  if (await page.locator(".activity-item").count() !== 1) throw new Error("Conversation should show only the latest tool operation");
  if (await page.locator(".activity-item pre, .activity-item > p").count()) throw new Error("Raw tool output should not appear in the conversation");
  await page.getByText("画面结构已经确认，接下来整理制作文件。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "添加素材与设置" }).click();
  await page.getByRole("menuitem", { name: /^旁白音色/ }).click();
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
  await page.getByLabel("已选择素材").getByText("图片", { exact: true }).waitFor();
  await page.getByLabel("已选择素材").getByText("视频", { exact: true }).waitFor();
  await page.getByRole("button", { name: "文件夹已选择" }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-project-reference-folder.png", fullPage: true });
  await page.getByRole("button", { name: "移除素材 深色背景中的发光新芽，电影级侧光" }).click();
  await page.getByRole("button", { name: "移除素材 产品定格镜头.mp4" }).click();
  await projectFolderFilter.selectOption("*");
  await page.getByRole("button", { name: "选择参考文件 品牌创作说明.pdf" }).click();
  await page.getByLabel("已选择素材").getByText("文档", { exact: true }).waitFor();
  await page.getByRole("button", { name: "移除素材 品牌创作说明.pdf" }).click();
  await page.getByRole("button", { name: "添加素材与设置" }).click();
  await page.getByRole("menuitem", { name: /^选择素材/ }).click();
  const materialPicker = page.getByLabel("选择创作素材");
  await materialPicker.getByText("深色背景中的发光新芽，电影级侧光", { exact: true }).click();
  await materialPicker.getByText("秋日背景音乐.mp3", { exact: true }).click();
  await page.getByLabel("已选择素材").getByText("图片", { exact: true }).waitFor();
  await page.getByLabel("已选择素材").getByText("音频", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-project-assets.png", fullPage: true });
  await page.getByRole("button", { name: "移除素材 深色背景中的发光新芽，电影级侧光" }).click();
  await page.getByRole("button", { name: "移除素材 秋日背景音乐.mp3" }).click();
  await materialPicker.getByRole("button", { name: "关闭素材选择" }).click();
  await page.locator(".activity-item").getByText("修改文件", { exact: true }).waitFor();
  if (await page.getByText("检查 HyperFrames", { exact: true }).count()) throw new Error("Older tool operations should be hidden");
  await page.getByRole("button", { name: /直接渲染/ }).click();
  const composer = page.getByPlaceholder("描述想修改的内容…");
  if (await composer.inputValue() !== "直接渲染") throw new Error("Quick reply did not populate the composer");
  if (!await composer.evaluate(element => element === document.activeElement)) throw new Error("Quick reply did not focus the composer");
  await composer.fill("");
  await page.getByText("制作方案已就绪", { exact: true }).waitFor();
  if (await page.getByText("历史运行记录", { exact: true }).count()) throw new Error("Debug run history should not appear in the conversation");
  await page.getByRole("button", { name: /查看计划/ }).click();
  await page.getByRole("heading", { name: "制作方案", exact: true, level: 2 }).waitFor();
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
  await page.goto(workspaceUrl);
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
  await page.goto(workspaceUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  const checkpoint = page.locator(".checkpoint-card");
  await checkpoint.waitFor();
  await page.getByPlaceholder("描述想修改的内容…").fill("调整画面构图后重新生成草稿");
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
  await page.goto(workspaceUrl);
  await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
  await page.getByLabel("音频处理").selectOption("narration");
  await page.getByRole("menuitem", {name:/旁白音色/}).click();
  const voiceDialog = page.getByRole("dialog", { name: "旁白音色" });
  await voiceDialog.waitFor();
  const voiceBox = await voiceDialog.boundingBox();
  if (!voiceBox || voiceBox.x < 0 || voiceBox.x + voiceBox.width > 360 || voiceBox.y < 0 || voiceBox.y + voiceBox.height > 800) throw new Error(`Mobile voice dialog is outside the viewport: ${JSON.stringify(voiceBox)}`);
  await page.screenshot({ path: "/tmp/yingya-ui-voice-mobile.png", fullPage: true });
  await voiceDialog.getByRole("button", { name: "关闭对话框" }).click();
  const prompt = page.getByRole("textbox", { name: "想把什么内容做成视频？" });
  await prompt.fill("网站产品宣传片");
  const createRequest = page.waitForRequest(request => request.url().endsWith("/agent-projects") && request.method() === "POST");
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
  const composer = page.getByPlaceholder("描述想修改的内容…");
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
  await page.goto(workspaceUrl);
  const homePrompt = page.getByRole("textbox", { name: "想把什么内容做成视频？" });
  await homePrompt.fill("保存这条未发送的创作想法");
  await page.locator('input[type=file]').first().setInputFiles({ name: "参考文件.pdf", mimeType: "application/pdf", buffer: Buffer.from("test reference") });
  await page.getByText("附件已保存", { exact: true }).waitFor();
  await page.getByRole('button',{name:'添加素材与设置',exact:true}).click();
  await page.getByLabel("目标时长").selectOption("30 秒");
  await page.getByLabel("目标受众").fill("新用户");
  await page.getByRole("menuitem", { name: /^选择素材/ }).click();
  await page.getByLabel("品牌创作说明.pdf", { exact: true }).check();
  await page.getByRole("button", { name: /^完成选择/ }).click();
  await page.reload();
  await page.getByText("附件已保存", { exact: true }).waitFor();
  if (await homePrompt.inputValue() !== "保存这条未发送的创作想法") throw new Error("Home text draft was lost after reload");
  await page.getByRole("button", { name: "移除 参考文件.pdf" }).waitFor();
  await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
  if (await page.getByLabel("目标时长").inputValue() !== "30 秒") throw new Error("Creation settings did not survive reload");
  await page.getByRole("menuitem", { name: /^选择素材/ }).click();
  if (!(await page.getByLabel("品牌创作说明.pdf", { exact: true }).isChecked())) throw new Error("Library selection did not survive reload");
  await page.getByRole("button", { name: /^完成选择/ }).click();
  await page.getByRole("button", { name: "任务中心" }).click();
  await page.locator(".task-row").getByText("修改待检查", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  const projectListUrl = `${baseUrl}/api/u/qa-user/agent-projects`;
  await page.route(projectListUrl, route => json(route, [{ ...seed, workflowStatus: "completed", workflowLabel: "成片已完成", statusLabel: "成片已完成" }]));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.locator(".task-center-trigger b").waitFor();
  await page.getByRole("button", { name: "任务中心" }).click();
  await page.locator(".task-row").getByText("成片已完成", { exact: true }).waitFor();
  await page.getByRole("button", { name: "标记已读" }).click();
  await page.keyboard.press("Escape");
  await page.unroute(projectListUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.waitForURL(url => url.hash === `#/projects/${seed.id}`);
  const composer = page.getByPlaceholder("描述想修改的内容…");
  await composer.fill("这个项目独有的修改草稿");
  await page.reload();
  await composer.waitFor();
  if (await composer.inputValue() !== "这个项目独有的修改草稿") throw new Error("Project draft or direct project route was lost");
  await page.evaluate(projectId => localStorage.setItem(`yingya-user:qa-user:yingya-canvas-tab:${projectId}`, JSON.stringify({ version: 1, value: "storyboard" })), seed.id);
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
  await page.getByRole("button", { name: "时间点反馈" }).click();
  await page.locator(".feedback-drafts .visual-feedback-card textarea").first().fill("新版保留的意见");
  await page.locator(".artifact-canvas > header select").selectOption("draft-1");
  if (!(await page.locator(".feedback-drafts").innerText()).includes("草稿 2")) throw new Error("Feedback card lost its original version when changing the player");
  await page.locator(".artifact-canvas > header select").selectOption("draft-2");
  if (await page.locator(".feedback-drafts .visual-feedback-card textarea").first().inputValue() !== "新版保留的意见") throw new Error("Version feedback was lost when switching versions");
  await page.setViewportSize({ width: 320, height: 800 });
  if (await page.locator(".workspace-tabs").getByRole("button", { name: "分镜", exact: true }).count()) throw new Error("Mobile navigation should not show storyboard");
  await page.locator(".workspace-tabs").getByRole("button", { name: "预览", exact: true }).click();
  if (await page.evaluate(() => document.documentElement.scrollWidth) > 320) throw new Error("Preview overflows at 320px");
  await page.screenshot({ path: "/tmp/yingya-features-preview-320.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "所有项目", exact: true }).click();
  await page.goBack();
  await page.waitForURL(url => url.hash === `#/projects/${seed.id}`);
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
  await creation.goto(workspaceUrl);
  await creation.getByRole("textbox", { name: "想把什么内容做成视频？" }).fill("展示我们的产品");
  await creation.getByRole("button",{name:"添加素材与设置",exact:true}).click();
  await creation.getByLabel("目标时长").selectOption("30 秒");
  await creation.getByRole("menuitem", { name: /^选择素材/ }).click();
  await creation.getByLabel("品牌创作说明.pdf", { exact: true }).check();
  await creation.getByRole("button", { name: /^完成选择/ }).click();
  const created = creation.waitForRequest(request => request.url().endsWith("/agent-projects") && request.method() === "POST");
  const turn = creation.waitForRequest(request => request.url().endsWith("/turns") && request.method() === "POST");
  await creation.getByRole("button", { name: "创建视频任务" }).click();
  const payload = (await turn).postDataJSON();
  if ((await created).postDataJSON().requirements.targetDurationSeconds !== 30 || !payload.attachments.includes("assets/inbox/document-1")) throw new Error("Creation settings or library files were not sent to the project");
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
  await page.goto(workspaceUrl);
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
  await page.route("**/api/u/qa-user/agent-projects/*/turns", route => json(route, { code: "unavailable", message: "测试发送失败" }, 503));
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
  await page.goto(workspaceUrl);
  await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
  await page.getByLabel("音频处理").selectOption("narration");
  await page.getByRole("menuitem", {name:/旁白音色/}).click();
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
  if (await link.getAttribute("href") !== `/api/u/qa-user/agent-projects/${seed.id}/files/renders/draft.mp4`) throw new Error("Historical file URL was not resolved through the project API");
  if (await page.locator(".dirty-chip").count()) throw new Error("Draft review should not show an unscoped dirty warning");
  await page.getByRole("button", { name: "导出其他规格", exact: true }).click();
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
  if (await page.getByRole("button", { name: "描述修改", exact: true }).count()) throw new Error("Redundant describe button remains");
  await page.getByRole("button", { name: "时间点反馈", exact: true }).click();
  await page.locator(".feedback-drafts textarea").last().fill("从预览添加意见");
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
  await page.goto(workspaceUrl);
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
  await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
  await page.getByLabel("音频处理").selectOption("narration");
  await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
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

async function assertLostExecutionState(browser) {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const seed = { ...structuredClone(detail), status: "failed", statusLabel: "执行连接中断，队列已暂停；请检查已有成果后继续", activeTurnId: null, queueDepth: 0, queuePaused: true, queue: [], manifest: { ...structuredClone(manifest), phase: "production", dirty: true, checkpoint: null } };
    await installApiMock(page, seed);
    await page.route("**/event-log*", route => json(route, {items: [{seq: 1, projectId: seed.id, turnId: "lost-turn", method: "item/started", payload: {params: {item: {id: "lost-cmd", type: "commandExecution", command: "base64 -w0 assets/audio/scene-1.wav"}}}, createdAt: now + 20}], latestSeq: 1, hasMore: false, nextBefore: null}));
    await page.goto(`${workspaceUrl}#/projects/${seed.id}`);
    await page.getByText("制作需要恢复", {exact: true}).waitFor();
    const recover = page.getByRole("button", {name: "检查并恢复项目流程", exact: true});
    await recover.focus();
    await page.keyboard.press("Enter");
    const composer = page.getByPlaceholder("描述想修改的内容…");
    if (await composer.inputValue() !== "检查并恢复项目流程") throw new Error("Recovery did not populate composer");
    if (await page.locator(".activity-item--running").count()) throw new Error("Orphaned command is still spinning");
    if (await page.getByText("制作流程已安全暂停", {exact: true}).count()) throw new Error("Unverified stop claim is visible");
    if (!await page.locator(".activity-item--interrupted").count()) throw new Error("Missing interrupted command status");
    if (errors.length) throw new Error(errors.join("\n"));
    await page.screenshot({ path: `/tmp/yingya-recovered-state-${width}.png` });
    await page.close();
  }
  console.log("Lost execution QA passed: no stale spinner, honest recovery state, keyboard-accessible recovery at 1280/390/320px");
}

async function assertCompactWorkspaceAndQueue(browser) {
  for (const width of [1259, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: width === 1259 ? 1180 : 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const seed = { ...structuredClone(detail), status: 'running', statusLabel: '正在制作', activeTurnId: 'turn-active', queuePaused: false, queueDepth: 0, queue: [] };
    seed.messages[0].text = '继续调整标题和画面节奏，保留已确认的旁白与素材。'.repeat(5);
    await installApiMock(page, seed);
    let current = structuredClone(seed), sends = 0, promotions = 0, failPromotion = true;
    await page.route(url => url.pathname.startsWith("/api/"), async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/u\/qa-user\//, '/api/');
      if (path === `/api/agent-projects/${seed.id}` && route.request().method() === 'GET') return json(route, current);
      if (path === `/api/agent-projects/${seed.id}/turns`) {
        const input = route.request().postDataJSON();
        if (input.interrupt !== false) throw new Error('New messages must queue by default');
        sends++;
        const turn = { id: 'queued-new', text: input.text, attachments: input.attachments, context: input.context, model: input.model, reasoningEffort: input.reasoningEffort, createdAt: now + 10 };
        current.queue.push(turn); current.queueDepth = current.queue.length;
        current.messages.push({ id: 'message-queued', turnId: turn.id, role: 'user', text: turn.text, attachments: input.attachments, context: input.context, status: 'queued', createdAt: now + 10 });
        return json(route, { turnId: turn.id, status: 'queued', queueDepth: current.queueDepth });
      }
      if (path === `/api/agent-projects/${seed.id}/queue/queued-new/execute`) {
        promotions++;
        if (failPromotion) { failPromotion = false; return json(route, { message: '测试切换失败，请重试' }, 409); }
        current.queue = []; current.queueDepth = 0; current.activeTurnId = 'queued-new';
        current.messages.find(message => message.turnId === 'queued-new').status = 'running';
        return route.fulfill({ status: 202, body: '' });
      }
      return route.fallback();
    });
    await page.goto(workspaceUrl);
    await page.locator('.account-panel').waitFor({ state: 'visible' });
    await page.locator('.home-project-open').first().click();
    const composer = page.getByRole('textbox', { name: '修改描述', exact: true });
    await composer.waitFor();
    if (await page.locator('.account-panel').isVisible()) throw new Error('Workspace account navigation remains');
    if (await page.getByRole('combobox', { name: '发送方式' }).count()) throw new Error('Old send mode remains');
    if (width === 1259) {
      const separator = page.getByRole('separator', { name: '调整创作对话宽度' });
      const box = await separator.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down(); await page.mouse.move(760, box.y + 100); await page.mouse.up();
      await separator.focus(); await page.keyboard.press('ArrowRight');
      if (Number(await separator.getAttribute('aria-valuenow')) !== 768) throw new Error('Expanded resize range failed');
      if (await composer.evaluate(el => getComputedStyle(el).fontSize) !== '13px') throw new Error('Composer typography is not compact');
      if (await page.locator('.message--user').first().evaluate(el => getComputedStyle(el).fontSize) !== '13px') throw new Error('Message typography is not compact');
      if (await page.locator('.composer .model-trigger').evaluate(el => getComputedStyle(el).fontSize) !== '12px') throw new Error('Model typography is not compact');
      await page.getByRole('tab', { name: /^产物/ }).click();
      if (await page.getByRole('textbox', { name: '搜索产物名称或路径' }).evaluate(el => getComputedStyle(el).fontSize) !== '13px') throw new Error('Search typography is not compact');
    }
    if (width === 320) await page.emulateMedia({ reducedMotion: 'reduce' });
    await composer.fill('让开场标题更清楚，其他内容保持不变');
    await page.keyboard.press('Enter');
    await page.locator('.queue-card .queue-execute').waitFor();
    if (await composer.inputValue()) throw new Error('Submitted draft was not cleared');
    await page.getByText('已加入队列', { exact: true }).waitFor();
    if (sends !== 1 || !await page.locator('.queue-card').getByText('排队中', { exact: true }).isVisible()) throw new Error('Missing queued state');
    const geometry = await page.locator('.composer').evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
    if (geometry.left < 0 || geometry.right > geometry.width || geometry.bottom > geometry.height) throw new Error(`Composer clipped: ${JSON.stringify(geometry)}`);
    await page.screenshot({ path: `/tmp/yingya-compact-workspace-${width}.png` });
    await page.locator('.queue-execute').click();
    await page.getByRole('alert').filter({ hasText: '测试切换失败，请重试' }).waitFor();
    if (!await page.locator('.queue-execute').isVisible()) throw new Error('Failed promotion lost the queued message');
    if (!await page.getByText('已加入队列', { exact: true }).isVisible()) throw new Error('Failed promotion cleared queued feedback');
    await page.locator('.queue-execute').click();
    await page.locator('.queue-card').waitFor({ state: 'detached' });
    await page.getByText('已加入队列', { exact: true }).waitFor({ state: 'detached' });
    await page.screenshot({ path: `/tmp/yingya-queue-executing-${width}.png` });
    if (sends !== 1 || promotions !== 2 || current.messages.filter(m => m.turnId === 'queued-new').length !== 1) throw new Error('Promotion duplicated the message');
    if (width === 1259) {
      await page.reload(); await composer.waitFor();
      if (Number(await page.getByRole('separator', { name: '调整创作对话宽度' }).getAttribute('aria-valuenow')) !== 768) throw new Error('Panel width not saved');
      await page.setViewportSize({ width: 1050, height: 900 });
      await page.waitForFunction(() => Number(document.querySelector('.workspace-splitter--thread')?.getAttribute('aria-valuenow')) <= 650);
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Workspace horizontal overflow');
    await page.getByRole('button', { name: '所有项目', exact: true }).click();
    await page.locator('.account-panel').waitFor({ state: 'visible' });
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('Compact workspace QA passed: queued submission, promotion retry without duplicates, full-height workspace, resize persistence, compact typography, 390px/320px and reduced motion');
}

async function assertFrontendRecovery(browser) {
  const errors = [];
  const makePage = async (seed = detail, width = 1440) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.qaStreams = [];
      window.EventSource = class extends EventTarget {
        constructor(url) { super(); this.url = url; this.readyState = 0; window.qaStreams.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(new Event('open')); }); }
        close() { this.readyState = 2; }
        emit(name, data) { this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) })); }
      };
    });
    await installApiMock(page, seed);
    return page;
  };
  const open = async page => {
    await page.goto(workspaceUrl);
    await page.getByRole('button', { name: /^秋季新品短片/ }).click();
    await page.locator('.project-heading h1').waitFor();
    await page.waitForFunction(() => window.qaStreams.some(stream => stream.readyState === 1));
  };
  const emit = (page, kind = 'agent-event') => page.evaluate(({ kind, id }) => {
    window.qaStreams.filter(stream => stream.readyState === 1).forEach(stream => stream.emit(kind, { seq: 99, projectId: id, method: 'project/updated', payload: {}, createdAt: Date.now() }));
  }, { kind, id: detail.id });
  const pathOf = route => new URL(route.request().url()).pathname.replace(/^\/api\/u\/qa-user\//, '/api/');
  const running = { ...structuredClone(detail), activeTurnId: 'in-progress', status: 'running', queue: [], queuePaused: false, manifest: { ...manifest, phase: 'production', checkpoint: null } };

  // A late refresh from an unmounted project must not replace the active screen.
  {
    const page = await makePage();
    const second = { ...structuredClone(detail), id: '22222222-2222-4222-8222-222222222222', title: '第二个项目' };
    let hold = false, release, seen;
    const held = new Promise(resolve => { release = resolve; });
    const pending = new Promise(resolve => { seen = resolve; });
    await page.route(url => url.pathname.startsWith("/api/"), async route => {
      const path = pathOf(route);
      if (path === '/api/agent-projects') return json(route, [detail, second]);
      if (path === `/api/agent-projects/${second.id}`) return json(route, second);
      if (path === `/api/agent-projects/${detail.id}` && hold) { seen(); await held; return json(route, detail); }
      return route.fallback();
    });
    await open(page); hold = true; await emit(page); await pending;
    await page.getByRole('button', { name: '所有项目', exact: true }).click();
    await page.getByRole('button', { name: /^第二个项目/ }).click();
    await page.getByRole('heading', { name: '第二个项目', exact: true }).waitFor();
    const late = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/agent-projects/${detail.id}`));
    release(); await late; await page.waitForTimeout(200);
    if (!await page.getByRole('heading', { name: '第二个项目', exact: true }).isVisible() || !page.url().endsWith(second.id)) throw new Error('Old project response replaced the current route');
    await page.close();
  }

  // Snapshot failure must stay visible even while SSE is open; retry clears it.
  {
    const page = await makePage(running); await open(page);
    let fail = true;
    await page.route(url => url.pathname.startsWith("/api/"), route => {
      if (pathOf(route).endsWith('/event-log')) return json(route, { items: [{ seq: 99, projectId: detail.id, method: 'project/updated', payload: {}, createdAt: Date.now() }], latestSeq: 99, hasMore: false, nextBefore: null });
      return pathOf(route) === `/api/agent-projects/${detail.id}` ? json(route, fail ? { message: 'snapshot unavailable' } : running, fail ? 503 : 200) : route.fallback();
    });
    await emit(page, 'resync-required');
    await page.getByText('任务状态暂未同步', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/yingya-fixed-sync-warning.png' });
    fail = false;
    await page.getByRole('button', { name: '重新同步', exact: true }).click();
    await page.locator('.connection-notice').waitFor({ state: 'detached' });
    await page.close();
  }

  // Real preview player: revisions refresh repeatedly, steady heartbeats do not,
  // and the paused playhead survives iframe navigation.
  {
    const page = await makePage(running);
    await page.clock.install();
    let revision = 1, frames = 0;
    const player = await (await import('node:fs/promises')).readFile(new URL('../web/preview-player.js', import.meta.url), 'utf8');
    await page.route('**/mock-hyperframes-storyboard*', route => {
      frames++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body><main data-composition-id="qa" data-width="400" data-height="600"><h1>画面 ${revision}</h1></main><script>window.qaTime=0;window.qaPlaying=true;window.__timelines={qa:{repeat(){},play(){window.qaPlaying=true},pause(){window.qaPlaying=false},seek(t){window.qaTime=t},time(){return window.qaTime},duration(){return 30}}};</script><script>${player}</script></body></html>` });
    });
    await page.route(url => url.pathname.startsWith("/api/"), route => /\/studio(?:\/heartbeat)?$/.test(pathOf(route)) ? json(route, { storyboardUrl: `${baseUrl}/mock-hyperframes-storyboard`, previewUrl: `${baseUrl}/mock-hyperframes-studio`, sourceRevision: String(revision), state: 'running', host: '', port: 0, projectName: detail.id, lastSeenAt: Date.now() }) : route.fallback());
    await open(page);
    const frame = page.frameLocator('iframe[title="HyperFrames 实时画面"]');
    await frame.getByRole('heading', { name: '画面 1' }).waitFor();
    await page.getByRole('button', { name: '暂停实时画面' }).click();
    await frame.locator('body').evaluate(() => { window.qaTime = 12; parent.postMessage({ type: 'yingya-preview-position', time: 12 }, '*'); });
    await page.waitForTimeout(100);
    for (revision = 2; revision <= 3; revision++) {
      const heartbeat = page.waitForResponse(response => response.url().includes('/studio/heartbeat'));
      await page.clock.fastForward(5100); await heartbeat;
      await frame.getByRole('heading', { name: `画面 ${revision}` }).waitFor();
      await page.waitForFunction(() => { const frame = document.querySelector('iframe'); return frame?.contentWindow?.qaTime === 12 && frame?.contentWindow?.qaPlaying === false; }, null, { polling: 100 });
    }
    revision = 3;
    const before = frames;
    const heartbeat = page.waitForResponse(response => response.url().includes('/studio/heartbeat'));
    await page.clock.fastForward(5100); await heartbeat; await page.waitForTimeout(100);
    if (frames !== before || frames !== 3) throw new Error('Preview missed a revision or reloaded on an unchanged heartbeat');
    await page.close();
  }

  // Reload after acceptance opens the original project without another POST.
  {
    const page = await makePage(); let creates = 0, turns = 0, release;
    const held = new Promise(resolve => { release = resolve; });
    const created = { ...structuredClone(detail), id: '33333333-3333-4333-8333-333333333333', title: '恢复原任务' };
    let hold = true;
    await page.route(url => url.pathname.startsWith("/api/"), async route => {
      const path = pathOf(route);
      if (path === '/api/agent-projects' && route.request().method() === 'POST') { creates++; return json(route, created); }
      if (path.endsWith('/turns')) { turns++; return json(route, { turnId: 'accepted', status: 'running', queueDepth: 0 }); }
      if (path === `/api/agent-projects/${created.id}`) { if (hold) await held; return json(route, created).catch(() => {}); }
      return route.fallback();
    });
    await page.goto(workspaceUrl);
    await page.locator('.composer--hero textarea').fill('刷新后恢复同一个任务');
    const opening = page.waitForRequest(request => new URL(request.url()).pathname.endsWith(`/agent-projects/${created.id}`));
    await page.getByRole('button', { name: '创建视频任务', exact: true }).click(); await opening;
    await page.reload();
    await page.getByRole('button', { name: '继续打开任务', exact: true }).waitFor();
    hold = false; release();
    await page.getByRole('button', { name: '继续打开任务', exact: true }).click();
    await page.getByRole('heading', { name: '恢复原任务', exact: true }).waitFor();
    if (creates !== 1 || turns !== 1) throw new Error(`Reload duplicated accepted work: ${creates} creates, ${turns} turns`);
    await page.close();
  }

  // 401 returns to login; logging back in restores text and files for that account.
  {
    const page = await makePage(detail, 390); await page.goto(workspaceUrl);
    await page.locator('.composer--hero textarea').fill('登录过期前的草稿');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('private draft') });
    await page.getByText('附件已保存', { exact: true }).waitFor();
    let expired = true;
    await page.route(url => url.pathname.startsWith("/api/"), route => {
      const path = pathOf(route);
      if (path === '/api/auth/login') { expired = false; return json(route, { user: { id: 'qa-user', email: 'qa@example.com', isAdmin: false } }); }
      if (path === '/api/agent-projects' && expired) return json(route, { message: '请先登录' }, 401);
      return route.fallback();
    });
    // Trigger the normal list refresh without reloading the whole application.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.locator('#login-email').waitFor();
    await page.getByText('登录已过期，请重新登录后继续。', { exact: true }).waitFor();
    if (await page.getByRole('heading', { name: '本地服务未连接' }).count()) throw new Error('401 displayed as offline');
    await page.screenshot({ path: '/tmp/yingya-fixed-expired-session-390.png' });
    await page.locator('#login-email').fill('qa@example.com');
    await page.locator('#login-password').fill('qa-test-password');
    await page.getByRole('button', { name: '进入工作台', exact: true }).click();
    await page.locator('.composer--hero textarea').waitFor();
    if (await page.locator('.composer--hero textarea').inputValue() !== '登录过期前的草稿') throw new Error('Login recovery lost the draft');
    await page.getByRole('button', { name: '移除 draft.txt', exact: true }).waitFor();
    await page.close();
  }
  if (errors.length) throw new Error(`Recovery scenarios produced runtime errors: ${errors.join('\n')}`);
  console.log('Frontend recovery QA passed: late project response, snapshot retry, repeated preview revisions with paused playhead, creation reload dedupe, expired login and draft recovery');
}

async function assertCompactTextarea(field) {
  const original = await field.inputValue();
  const measure = () => field.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const style = getComputedStyle(element);
    return { height: element.getBoundingClientRect().height, line: parseFloat(style.lineHeight), scroll: element.scrollHeight, client: element.clientHeight, overflow: style.overflowY };
  });
  await field.fill(""); const empty = await measure();
  if (empty.height > 42) throw new Error("Empty composer should occupy one compact line");
  await field.fill("第一行\n第二行\n第三行"); const three = await measure();
  if (three.height < empty.height + 20) throw new Error("Multiline input did not expand");
  await field.fill(Array(20).fill("多行修改要求").join("\n")); const long = await measure();
  if (long.height > empty.height + long.line * 3 + 2 || long.scroll <= long.client || long.overflow !== "auto") throw new Error("Long input must scroll within four lines");
  await field.fill("简短要求"); const short = await measure();
  if (short.height > empty.height + 1) throw new Error("Deleting text must shrink the input, including with reduced motion");
  await field.fill(original);
}

async function assertFeedbackLifecycle(browser) {
  for (const width of [1280, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.EventSource = class extends EventTarget { close() {} }; });
    const seed = { ...structuredClone(detail), queue: [], queueDepth: 0, activeTurnId: null };
    await installApiMock(page, seed);
    let current = structuredClone(seed), failSnapshot = false;
    await page.route(url => url.pathname.startsWith("/api/"), route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/u\/qa-user\//, '/api/');
      if (path.endsWith('/event-log')) return json(route, { items: [{ seq: 99, projectId: seed.id, method: 'project/updated', payload: {}, createdAt: Date.now() }], latestSeq: 99, hasMore: false, nextBefore: null });
      if (path === `/api/agent-projects/${seed.id}/turns`) {
        current.activeTurnId = 'direct-turn'; current.status = 'running';
        return json(route, { turnId: 'direct-turn', status: 'running', queueDepth: 0 });
      }
      if (path === `/api/agent-projects/${seed.id}`) return json(route, failSnapshot ? { message: 'snapshot unavailable' } : current, failSnapshot ? 503 : 200);
      return route.fallback();
    });
    await page.goto(workspaceUrl);
    await page.locator('.home-project-open').first().click();
    const composer = page.getByRole('textbox', { name: '修改描述', exact: true });
    await composer.waitFor();
    await assertCompactTextarea(composer);
    await page.getByRole('button', { name: '添加素材与设置' }).click();
    await page.getByRole('menuitem', { name: /^选择素材/ }).click();
    await page.getByLabel('选择创作素材').getByText('秋日背景音乐.mp3', { exact: true }).click();
    await page.locator('.composer-feedback').getByText(/已加入 1 个参考文件/).waitFor();
    await page.getByRole('button', { name: '关闭素材选择' }).click();
    // Typing must dismiss material feedback even when no message has been sent yet.
    await composer.fill('添加配乐');
    if (await page.locator('.composer-feedback').innerText()) throw new Error('Material feedback survived typing');
    await page.getByRole('button', { name: '移除素材 秋日背景音乐.mp3' }).click();
    await page.locator('.composer-feedback').getByText(/已移除/).waitFor();
    await page.waitForFunction(() => document.querySelector('.composer-feedback')?.textContent === '', null, { timeout: 6000 });
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('button', { name: '停止当前任务', exact: true }).waitFor();
    if (await page.locator('.composer-feedback').innerText()) throw new Error('Direct submission feedback survived execution');
    // A successful send followed by a failed snapshot is recoverable without resending.
    await composer.fill('继续修改'); failSnapshot = true;
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByText('任务状态暂未同步', { exact: true }).waitFor();
    failSnapshot = false;
    await page.getByRole('button', { name: '重新同步', exact: true }).click();
    await page.getByRole('button', { name: '重新同步', exact: true }).waitFor({ state: 'detached' });
    if (await page.locator('.thread-footer .form-error').count()) throw new Error('Recovered snapshot retained stale warning');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Feedback causes horizontal overflow');
    await page.screenshot({ path: `/tmp/yingya-feedback-lifecycle-${width}.png` });
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('Feedback lifecycle QA passed: direct execution, asset feedback typing/expiry, snapshot recovery at 1280/390/320px');
}

async function assertComposerFileDrop(browser) {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await installApiMock(page);
    await page.goto(workspaceUrl);
    const prompt = page.locator('.composer textarea');
    await prompt.fill('使用附件制作动画');
    await page.locator('.composer input[type=file]').setInputFiles({ name: 'existing.txt', mimeType: 'text/plain', buffer: Buffer.from('existing') });
    await page.getByText('附件已保存', { exact: true }).waitFor();
    const transfer = await page.evaluateHandle(() => {
      const data = new DataTransfer();
      data.items.add(new File(['reference'], 'reference.png', { type: 'image/png' }));
      data.items.add(new File(['brief'], 'brief.txt', { type: 'text/plain' }));
      return data;
    });
    await prompt.dispatchEvent('dragenter', { dataTransfer: transfer });
    await page.getByText('松开以添加附件', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/yingya-drop-hover-${width}.png` });
    await prompt.dispatchEvent('dragleave', { dataTransfer: transfer });
    await page.locator('.composer-drop-overlay').waitFor({ state: 'detached' });
    await prompt.dispatchEvent('dragenter', { dataTransfer: transfer });
    await prompt.dispatchEvent('dragover', { dataTransfer: transfer });
    await prompt.dispatchEvent('drop', { dataTransfer: transfer });
    await page.getByText('已添加 2 个附件，发送时上传', { exact: true }).waitFor();
    if (await page.locator('.attachment-row > span').count() !== 3) throw new Error('Drop replaced existing files');
    if (await prompt.inputValue() !== '使用附件制作动画') throw new Error('Drop changed prompt');
    await page.getByText('附件已保存', { exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '移除 reference.png', exact: true }).waitFor();
    if (await page.locator('.attachment-row > span').count() !== 3) throw new Error('File draft was not restored');
    await page.getByRole('button', { name: '移除 brief.txt', exact: true }).click();
    const uploads = [];
    page.on('request', request => { if (request.url().endsWith('/assets') && request.method() === 'POST') uploads.push(request); });
    const turn = page.waitForRequest(request => request.url().endsWith('/turns') && request.method() === 'POST');
    await page.getByRole('button', { name: '创建视频任务', exact: true }).click();
    if ((await turn).postDataJSON().attachments.length !== 2 || uploads.length !== 2) throw new Error('Dropped files were not uploaded on creation');
    await page.getByRole('textbox', { name: '修改描述', exact: true }).waitFor();
    const textarea = page.getByRole('textbox', { name: '修改描述', exact: true });
    await textarea.fill('再补充参考文件');
    const projectTransfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['more'], 'extra.txt', { type: 'text/plain' })); return data; });
    await textarea.dispatchEvent('dragenter', { dataTransfer: projectTransfer });
    await page.getByText('松开以添加附件', { exact: true }).waitFor();
    await textarea.dispatchEvent('drop', { dataTransfer: projectTransfer });
    await page.getByRole('button', { name: '移除 extra.txt', exact: true }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Composer overflows viewport');
    await page.screenshot({ path: `/tmp/yingya-drop-workspace-${width}.png` });
    const sent = page.waitForRequest(request => request.url().endsWith('/turns') && request.method() === 'POST');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    if ((await sent).postDataJSON().attachments.length !== 1 || uploads.length !== 3) throw new Error('Workspace dropped file was not uploaded');
    await page.getByRole('button', { name: '移除 extra.txt', exact: true }).waitFor({ state: 'detached' });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Composer file drop QA passed at ${width}px: hover, leave, append, draft restore, removal, creation and message uploads; ${await page.title()}`);
    await page.close();
  }
}

async function assertEditedSourceActions(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const draft = { ...structuredClone(detail), status: "draft_review", activeTurnId: null, queueDepth: 0, queuePaused: false, queue: [],
    manifest: { ...structuredClone(manifest), phase: "draft_review", dirty: true, checkpoint: null, currentDraft: "draft-2", versions: [
      { id: "draft-1", label: "旧版", sourcePath: ".yingya/versions/draft-1", videoPath: ".yingya/versions/draft-1/preview.mp4", createdAt: now - 1 },
      { id: "draft-2", label: "当前预览", sourcePath: ".yingya/versions/draft-2", videoPath: ".yingya/versions/draft-2/preview.mp4", createdAt: now },
    ] } };
  await installApiMock(page, draft);
  await page.goto(workspaceUrl);
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  const panel = page.getByLabel("视频分享与导出");
  await panel.waitFor();
  if (await panel.locator('.source-edit-notice').count()) throw new Error("Removed source warning is still visible");
  if (await panel.getByRole("button", { name: "生成新版预览", exact: true }).count()) throw new Error("Removed preview action is still visible");
  await page.getByRole("button", { name: "导出其他规格", exact: true }).click();
  await panel.getByRole("button", { name: "导出已有版本", exact: true }).waitFor();
  await page.locator(".artifact-canvas > header select").selectOption("draft-1");
  if (await panel.locator('.source-edit-notice').count()) throw new Error("Historical version shows removed warning");
  await page.locator(".artifact-canvas > header select").selectOption("draft-2");
  await page.screenshot({ path: "/tmp/yingya-workbench-dirty-export.png" });
  await page.close();
  console.log("Edited-source actions QA passed: warning removed and existing version export retained.");
}

async function assertRetiredStyleIsAbsent(browser) {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // An old response may still carry the field during a rolling deployment.
    await installApiMock(page, { ...structuredClone(detail), visualStyle: { id: 'warm-editorial', version: 1, name: '温暖编辑' } });
    await page.goto(workspaceUrl);
    await page.getByRole('button', { name: /^秋季新品短片/ }).click();
    const composer = page.getByRole('textbox', { name: '修改描述', exact: true });
    await composer.waitFor();
    if (await page.locator('.project-visual-style,.visual-style-open').count()) throw new Error('Retired style UI is still present');
    if (await page.getByText('起始风格', { exact: false }).count()) throw new Error('Retired style is still shown');
    await composer.focus();
    if (!await composer.evaluate(element => element === document.activeElement)) throw new Error('Composer focus is broken');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Workspace overflow at ${width}px`);
    await page.screenshot({ path: `/tmp/yingya-no-style-${width}.png` });
    await composer.fill('保留产品图片，把标题改为新品上市');
    const sent = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/turns'));
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    if ((await sent).postDataJSON().text !== '保留产品图片，把标题改为新品上市') throw new Error('Conversation revision changed');
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('Retired style QA passed: legacy projects, no style reference UI, conversation edits, focus, desktop/390/320 and reduced motion.');
}

async function assertMaterialFirstCreation(browser) {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installApiMock(page);
    await page.goto(workspaceUrl);
    await page.getByRole('button', { name: '创建视频任务' }).waitFor();
    if (await page.locator('.visual-style-open').count()) throw new Error('New creation still requires an abstract style');
    if (await page.getByRole('menuitem',{name:/旁白音色/}).count()) throw new Error('Voice selection must follow an explicit narration choice');
    await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
    await page.getByLabel('目标时长').selectOption('30 秒');
    await page.getByLabel('时长要求').selectOption('max');
    await page.getByLabel('音频处理').selectOption('narration');
    await page.getByRole('menuitem',{name:/旁白音色/}).waitFor();
    await page.getByLabel('音频处理').selectOption('preserve');
    await page.getByLabel('字幕').selectOption('不添加字幕');
    await page.getByLabel('配乐').selectOption('不添加配乐');
    await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
    await page.locator('.composer--hero input[type=file]').setInputFiles({ name: 'recording.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fixture') });
    await page.getByLabel('recording.mp4的素材用途').selectOption('required');
    if (await page.getByRole('button', { name: '创建视频任务' }).isDisabled()) throw new Error('Attachments alone must enable creation');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Material controls overflow at ${width}px`);
    await page.screenshot({ path: `/tmp/yingya-workbench-materials-${width}.png` });
    const requests = [];
    page.on('request', r => { if (r.method() === 'POST' || r.method() === 'PATCH') requests.push(r); });
    const sent = page.waitForRequest(r => r.url().endsWith('/turns') && r.method() === 'POST');
    await page.getByRole('button', { name: '创建视频任务' }).click();
    const turn = (await sent).postDataJSON();
    const payload = requests.find(r => r.url().endsWith('/agent-projects')).postDataJSON();
    if (payload.visualStyleId !== undefined) throw new Error('New creation should not silently choose a six-style template');
    if (payload.requirements.audioMode !== 'preserve' || payload.requirements.targetDurationSeconds !== 30 || payload.requirements.durationMode !== 'max' || payload.requirements.subtitles !== 'none' || payload.requirements.music !== 'off') throw new Error('Structured requirements were lost');
    if (!turn.text.includes('先分析') || !turn.text.includes('确认方案后') || turn.attachments.length !== 1) throw new Error('File-only creation must analyze before production');
    const role = requests.find(r => r.url().endsWith('/asset-roles'))?.postDataJSON();
    if (role?.role !== 'required') throw new Error('Asset role did not reach the project');
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('Material-first creation QA passed: no style picker, file-only input, roles, structured duration/audio/subtitles/music, conditional voice, desktop/390/320 and reduced motion.');
}

async function assertCapabilities(browser) {
  const page = await browser.newPage({ viewport: { width: 1514, height: 1040 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installApiMock(page);
  await page.goto(workspaceUrl);
  await page.getByText('更多创作方式', { exact: true }).click();
  await page.getByRole('heading', { name: '看看可以怎么做' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '/tmp/yingya-capabilities-desktop.png' });
  if (await page.locator('.cap-card').count() !== 6) throw new Error('Missing capability cards');
  await page.getByRole('button', { name: '搜索效果', exact: true }).click();
  await page.getByRole('searchbox', { name: '搜索表现方式' }).fill('Baoyu');
  if (await page.locator('.cap-card').count() !== 1) throw new Error('Provider search failed');
  await page.getByRole('button', { name: '查看信息图解' }).click();
  if (await page.getByRole('button', { name: '播放示例', exact: true }).count()) throw new Error('Reference must not pretend to be an executable Baoyu workflow');
  await page.getByRole('button', { name: '收起搜索' }).click();
  await page.getByRole('button', { name: '查看3D 产品展示' }).click();
  await page.getByRole('button', { name: '用这个方式创作' }).click();
  await page.getByRole('textbox', { name: '想把什么内容做成视频？' }).fill('展示我的产品');
  let createCount = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/agent-projects')) createCount++; });
  await page.getByRole('button', { name: '创建视频任务' }).click();
  await page.getByRole('alert').filter({ hasText: '3D 展示需要已有模型' }).waitFor();
  if (createCount) throw new Error('Missing model must not create an empty project');
  await page.getByRole('button', { name: '移除表现方式' }).click();
  for (const name of ['3D 产品展示', '流程演示', '动态标题', '数据对比', '关系连线']) {
    await page.getByRole('button', { name: `查看${name}` }).click();
    await page.getByRole('button', { name: '播放示例', exact: true }).click();
    const frame = await (await page.getByTitle(`${name}组件运行示例`).elementHandle()).contentFrame();
    if (!frame) throw new Error('Demo iframe missing');
    await frame.waitForFunction(() => window.demoReady === true);
    await page.getByRole('slider', { name: '示例播放位置' }).waitFor({ state: 'visible' });
    await page.getByRole('slider', { name: '示例播放位置' }).fill('3');
    await frame.waitForFunction(() => Math.abs(window.demoTime - 3) < .1);
    if (name === '3D 产品展示') await page.screenshot({ path: '/tmp/yingya-capabilities-3d.png' });
    await page.getByRole('button', { name: '关闭表现方式详情' }).click();
  }
  await page.getByRole('button', { name: '查看流程演示' }).click();
  await page.getByRole('button', { name: '四步讲解', exact: true }).click();
  await page.getByRole('button', { name: '用这个方式创作' }).click();
  await page.reload();
  await page.getByText('表现方式：流程演示 · 四步讲解', { exact: true }).waitFor();
  const selected = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/agent-projects'));
  const turn = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/turns'));
  await page.getByRole('button', { name: '创建视频任务' }).click();
  const requirement = (await selected).postDataJSON().requirements.presentation;
  if (requirement.capabilityId !== 'flow-path' || requirement.variant !== 'four-steps') throw new Error('Persisted presentation did not reach the creation API');
  await turn;
  await page.waitForURL(url => url.hash.includes('/projects/'));
  await page.goto(workspaceUrl);
  await page.getByText('更多创作方式', { exact: true }).click();
  await page.getByRole('heading', { name: '看看可以怎么做' }).waitFor();
  if (await page.getByRole('button', { name: '移除表现方式' }).count()) throw new Error('Successful creation must clear selected presentation');
  await page.close();
  for (const width of [1280, 1024, 800, 390, 320]) {
    const mobile = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    mobile.on('pageerror', error => errors.push(error.message));
    await installApiMock(mobile);
    await mobile.goto(workspaceUrl);
    await mobile.getByText('更多创作方式', { exact: true }).click();
    await mobile.getByRole('heading', { name: '看看可以怎么做' }).waitFor();
    if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Home overflow at ${width}`);
    await mobile.screenshot({ path: `/tmp/yingya-capabilities-home-${width}.png`, fullPage: true });
    await mobile.getByRole('button', { name: '查看关系连线' }).click();
    await mobile.getByRole('button', { name: '用这个方式创作' }).waitFor();
    if (width < 1100) {
      await mobile.getByRole('dialog', { name: '表现方式详情' }).waitFor();
      const box = await mobile.getByRole('dialog', { name: '表现方式详情' }).boundingBox();
      if (box.y !== 0 || box.height !== 900) throw new Error('Detail dialog must fill the viewport vertically');
      await mobile.getByRole('button', { name: '用这个方式创作' }).focus();
      await mobile.keyboard.press('Tab');
      if (!(await mobile.getByRole('button', { name: '关闭表现方式详情' }).evaluate(el => el === document.activeElement))) throw new Error('Mobile modal focus escaped');
      await mobile.keyboard.press('Escape');
      await mobile.getByRole('dialog').waitFor({ state: 'detached' });
      if (!(await mobile.getByRole('button', { name: '查看关系连线' }).evaluate(el => el === document.activeElement))) throw new Error('Focus not restored');
      await mobile.getByRole('button', { name: '查看关系连线' }).click();
    }
    await mobile.screenshot({ path: `/tmp/yingya-capabilities-detail-${width}.png` });
    await mobile.getByRole('button', { name: '用这个方式创作' }).click();
    await mobile.getByRole('button', { name: /^从素材库选择/ }).click();
    await mobile.getByLabel('品牌创作说明.pdf', { exact: true }).check();
    await mobile.screenshot({ path: `/tmp/yingya-capabilities-library-${width}.png` });
    await mobile.getByRole('button', { name: /^完成选择/ }).click();
    if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Selection overflow at ${width}`);
    await mobile.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Capability QA passed: six cards/search, honest sources, five live demos, model prerequisite, persisted selection/submission/clear, responsive 1514/1280/1024/800/390/320, native modal keyboard focus and real library wiring (API mocked).');
}

async function assertTaskDiscovery(browser) {
  for (const width of [1514, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], creations = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/agent-projects')) creations.push(r.postDataJSON()); });
    await installApiMock(page);
    await page.goto(workspaceUrl);
    await page.getByText('更多创作方式', { exact: true }).click();
    await page.getByRole('heading', { name: '你想完成什么？', exact: true }).waitFor();
    if (await page.locator('.creation-task-grid button').count() !== 6) throw new Error('Task entries missing');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `/tmp/yingya-discovery-home-${width}.png`, fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Task home overflow at ${width}`);
    await page.getByRole('button', { name: '直接使用动态标题', exact: true }).click();
    await page.getByText('表现方式：动态标题 · 开场标题', { exact: true }).waitFor();
    const composer = page.getByRole('textbox', { name: '想把什么内容做成视频？' });
    await composer.fill('我的原始需求：保留品牌标识。');
    await page.getByRole('button', { name: '开始文案转视频', exact: true }).click();
    await page.getByLabel('要制作的文案', { exact: true }).fill('新品上线，帮助团队整理内容与素材。');
    await page.screenshot({ path: `/tmp/yingya-discovery-task-${width}.png` });
    await page.getByRole('button', { name: '追加到创作区', exact: true }).click();
    const combined = await composer.inputValue();
    if (!combined.startsWith('我的原始需求：保留品牌标识。') || !combined.includes('新品上线')) throw new Error('Existing draft overwritten');
    await page.reload();
    await page.getByText('表现方式：动态标题 · 开场标题', { exact: true }).waitFor();
    if (await composer.inputValue() !== combined) throw new Error('Task draft did not persist');
    if (await page.getByRole('button', { name: '关闭表现方式详情' }).isVisible()) await page.getByRole('button', { name: '关闭表现方式详情' }).click();
    if (!(await page.getByRole('button', { name: '开始网页转视频', exact: true }).isVisible())) await page.getByText('更多创作方式', { exact: true }).click();
    await page.getByRole('button', { name: '开始网页转视频', exact: true }).click();
    const url = page.getByLabel('网页链接', { exact: true });
    await url.fill('ftp://invalid.example');
    await page.getByRole('button', { name: '追加到创作区', exact: true }).click();
    if (await page.getByRole('dialog', { name: '网页转视频' }).count() !== 1) throw new Error('Non-http page URL accepted');
    await url.fill('https://example.com/product');
    await page.getByRole('button', { name: '追加到创作区', exact: true }).click();
    if (!(await composer.inputValue()).includes('https://example.com/product')) throw new Error('Web source missing');
    await page.getByRole('button', { name: '开始剪辑已有素材', exact: true }).click();
    if (!(await page.getByRole('button', { name: '追加到创作区', exact: true }).isDisabled())) throw new Error('Editing requires source material');
    await page.getByRole('dialog', { name: '剪辑已有素材' }).getByRole('button', { name: '从素材库选择', exact: true }).click();
    await page.getByLabel('产品定格镜头.mp4', { exact: true }).check();
    await page.getByRole('button', { name: /^完成选择/ }).click();
    await page.getByText('已添加 1 项素材', { exact: true }).waitFor();
    await page.getByRole('button', { name: '追加到创作区', exact: true }).click();
    for (const [name, label, value] of [['产品演示','产品与核心卖点','提供真实产品说明'],['知识动画','知识点与参考内容','解释水循环'],['数据故事','数据、单位与来源','用户提供的年度统计表']]) {
      await page.getByRole('button', { name: `开始${name}`, exact: true }).click();
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByRole('button', { name: '追加到创作区', exact: true }).click();
      if (!(await composer.inputValue()).includes(value)) throw new Error(`${name} input missing`);
    }
    const savedPrompt = await composer.inputValue();
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await page.waitForURL(url => url.hash === '#/assets/image');
    await page.locator('.asset-drawer').getByRole('heading', { name: '生成图片', exact: true }).waitFor();
    await page.reload();
    await page.locator('.asset-drawer').getByRole('heading', { name: '生成图片', exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭创建面板' }).click();
    await page.getByRole('button', { name: '视频创作', exact: true }).click();
    if (!(await page.getByRole('button', { name: '创建音色', exact: true }).isVisible())) await page.getByText('更多创作方式', { exact: true }).click();
    await page.getByRole('button', { name: '创建音色', exact: true }).click();
    await page.waitForURL(url => url.hash === '#/assets/voice');
    await page.locator('#asset-drawer-title').filter({ hasText: '创建音色' }).waitFor();
    await page.getByRole('button', { name: '关闭创建面板' }).click();
    await page.getByRole('button', { name: '视频创作', exact: true }).click();
    if (await composer.inputValue() !== savedPrompt) throw new Error('Tool navigation lost home draft');
    if (creations.length) throw new Error('Discovery must not submit work automatically');
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Selected task overflow at ${width}`);
    const sent = page.waitForRequest(r => r.url().endsWith('/turns') && r.method() === 'POST');
    await page.getByRole('button', { name: '创建视频任务', exact: true }).click();
    const turn = (await sent).postDataJSON();
    if (!turn.text.includes('我的原始需求') || !turn.attachments.includes('assets/inbox/video-1') || creations[0].requirements.presentation.capabilityId !== 'title-reveal') throw new Error('Task content, selected effect or materials missing from actual submission');
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('Task discovery passed: six guided tasks, append/persist draft, HTTP URL validation, nested library selection, direct effect use, image/voice deep links and reload, no auto submit, real creation payload, 1514/390/320 reduced motion (API mocks).');
}

async function assertProductWorkflow(browser) {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await installApiMock(page);
    await page.goto(workspaceUrl);
    await page.getByRole('heading', { name: '让想法，成为会动的作品。', exact: true }).waitFor();
    await page.getByText('选择使用场景', {exact:true}).click();
    const introduction = page.getByRole('button', { name: '产品介绍 讲清产品价值', exact: true });
    if (await introduction.getAttribute('aria-pressed') !== 'true') throw new Error('First visit must suggest product introduction');
    await page.getByRole("button",{name:"添加素材与设置",exact:true}).click();
    await page.getByLabel('目标时长', { exact: true }).selectOption('60 秒');
    await page.getByLabel('时长要求', { exact: true }).selectOption('max');
    await page.getByLabel('音频处理', { exact: true }).selectOption('preserve');
    await page.getByLabel('字幕', { exact: true }).selectOption('不添加字幕');
    await page.keyboard.press('Escape');
    await page.getByText('产品视频案例',{exact:true}).click();
    const composer = page.getByRole('textbox', { name: '想把什么内容做成视频？' });
    await composer.fill('用我的真实产品截图，讲清新功能。');
    await page.getByRole('button', { name: '制作类似视频：新功能发布', exact: true }).click();
    await page.getByRole('button',{name:'添加素材与设置',exact:true}).click();
    if (await page.getByLabel('目标时长', { exact: true }).inputValue() !== '60 秒') throw new Error('Example overwrote explicit duration');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByText('参考样片：映芽 · 准确修改每一镜', { exact: true }).waitFor();
    if (await composer.inputValue() !== '用我的真实产品截图，讲清新功能。') throw new Error('Example lost prompt');
    await page.getByText('选择使用场景', {exact:true}).click();
    await page.getByText('产品视频案例',{exact:true}).click();
    console.log('Product QA: example persisted', width);
    const durations = [30, 25, 35];
    for (let index = 0; index < 3; index++) {
      const video = page.locator('.product-example-grid video').nth(index);
      await video.evaluate(el => { el.load(); });
      await page.waitForFunction(({ index, duration }) => { const v = document.querySelectorAll('.product-example-grid video')[index]; return v.readyState >= 2 && Math.abs(v.duration-duration)<.1; }, { index, duration: durations[index] });
      await video.evaluate(async el => { await Promise.race([el.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('Sample playback did not start')), 10000))]); });
      await page.waitForFunction(index => document.querySelectorAll('.product-example-grid video')[index].currentTime > .1, index);
      await video.evaluate(el => new Promise(resolve => { el.pause(); el.addEventListener('seeked', resolve, { once: true }); el.currentTime = 2; }));
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Product home overflow at ${width}`);
    await page.locator('.home-scroll').evaluate(el => { el.scrollTop = 0; });
    console.log('Product QA: capturing home', width);
    await page.screenshot({ path: `/tmp/yingya-product-home-${width}.png`, fullPage: true, timeout: 15000 });
    await introduction.focus();
    await page.keyboard.press('Enter');
    if (await introduction.getAttribute('aria-pressed') !== 'true') throw new Error('Keyboard scene selection failed');
    if (await page.getByText('参考样片：映芽 · 准确修改每一镜', { exact: true }).count()) throw new Error('Changing workflow retained unrelated example');
    await page.getByRole('button', { name: '制作类似视频：新功能发布', exact: true }).click();
    const creation = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/agent-projects'));
    await page.getByRole('button', { name: '创建视频任务', exact: true }).click();
    const requirements = (await creation).postDataJSON().requirements;
    if (requirements.workflow !== 'feature-launch' || requirements.referenceExample !== 'feature-launch' || requirements.targetDurationSeconds !== 60 || requirements.durationMode !== 'max' || requirements.audioMode !== 'preserve' || requirements.subtitles !== 'none') throw new Error('Workflow/reference or explicit requirements lost in actual submission');
    if (errors.length) throw new Error(errors.join('\n'));
    await page.close();
  }
  console.log('Product workflow passed: three playable MP4s, sample reuse/persistence, keyboard selection, explicit requirements preserved, real creation payload, 1440/390/320 with reduced motion (API mocks).');
}

async function assertProductStoryboard(browser) {
  const scenes = [
    {id:'intro',order:1,onScreenText:'产品介绍',narration:'介绍产品',assetIds:[],startSeconds:0,durationSeconds:6,narrativeRole:'产品价值',assetStrategy:'真实产品截图',visualDirection:'先展示全貌'},
    {id:'detail',order:2,onScreenText:'添加素材',narration:'提供产品资料',assetIds:[],startSeconds:6,durationSeconds:8,narrativeRole:'添加素材',assetStrategy:'真实上传界面',visualDirection:'聚焦上传区域'},
  ];
  for (const width of [1440,390,320]) {
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const seed={...structuredClone(detail),queue:[],queueDepth:0,queuePaused:false,aspectRatio:'16:9'};
    seed.manifest.currentDraft='draft-2';seed.manifest.checkpoint=null;seed.manifest.phase='draft_review';
    seed.manifest.versions=[1,2].map(n=>({id:`draft-${n}`,label:`视频 ${n}`,sourcePath:`.yingya/versions/draft-${n}`,videoPath:`.yingya/versions/draft-${n}/preview.mp4`,createdAt:now+n}));
    await installApiMock(page,seed);
    const data={sourcePath:'.',scenesRevision:'a'.repeat(64),scenes,assets:[],sourceBindings:null};
    await page.route(url=>url.pathname.startsWith('/api/')&&url.pathname.endsWith('/workbench'),route=>{
      const version=new URL(route.request().url()).searchParams.get('versionId')??'draft-2';
      return json(route,{...data,sourcePath:`.yingya/versions/${version}`,versionId:version,currentVersionId:'draft-2',workspace:data,requirements:{workflow:'product-intro'},editable:version==='draft-2',recipeCatalog:{schemaVersion:1,recipes:[]}});
    });
    await page.route(url=>url.pathname.startsWith('/api/')&&url.pathname.endsWith('/preview.mp4'),async route=>route.fulfill({response:await route.fetch({url:`${baseUrl}/product-examples/product-intro.mp4`})}));
    await page.route(url=>url.pathname.startsWith('/api/')&&url.pathname.endsWith('/assets') ,route=>route.request().method()==='POST'?json(route,{path:'assets/inbox/replacement.png',name:'replacement.png'}):route.fallback());
    await page.route(url=>url.pathname.startsWith('/api/')&&url.pathname.endsWith(`/agent-projects/${seed.id}`),route=>json(route,seed));
    await page.goto(`${workspaceUrl}#/projects/${seed.id}`);
    if(width<800)await page.locator('.workspace-tabs').getByRole('button',{name:'预览',exact:true}).click();
    await page.getByRole('heading',{name:'镜头与修改',exact:true}).waitFor();
    await page.waitForFunction(() => document.querySelector('.video-stage video')?.readyState >= 2);
    for(const [kind,label,value] of [['text','改文字','新的标题'],['duration','调时长','7'],['narration','改旁白','新的旁白内容'],['image','换截图','replacement.png']]){
      await page.locator('.product-scene-strip button').nth(1).click();
      await page.waitForFunction(() => document.querySelectorAll('.product-scene-strip button')[1]?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 5000 }).catch(async error => { console.log('Scene debug', await page.locator('.video-stage video').evaluate(el => ({time:el.currentTime,readyState:el.readyState,duration:el.duration}))); await page.screenshot({path:'/tmp/yingya-product-scene-failure.png'});throw error;});
      if(kind==='text')await page.locator('.video-stage video').evaluate(el=>el.play());
      await page.getByRole('button',{name:label,exact:true}).click();
      if(!(await page.locator('.video-stage video').evaluate(el=>el.paused)))throw Error('Video kept playing while editing a scene');
      const form=page.locator('.scene-revision-form');
      if(kind==='image')await form.locator('input[type=file]').setInputFiles({name:value,mimeType:'image/png',buffer:Buffer.from('fixture-image')});
      else if(kind==='duration')await form.getByLabel('单镜时长（秒）').fill(value);
      else await form.locator('textarea').fill(value);
      if(width===320&&kind==='text')await page.screenshot({path:'/tmp/yingya-product-revision-320.png'});
      const requests=[];const onRequest=r=>{if(r.method()==='POST'&&r.url().endsWith('/turns'))requests.push(r)};page.on('request',onRequest);
      await page.getByRole('button',{name:'带入修改',exact:true}).click();
      const composer=page.getByRole('textbox',{name:'修改描述',exact:true});await composer.waitFor({state:'visible'});
      if(requests.length)throw Error('Staging revision submitted it automatically');
      if(!(await composer.inputValue()).includes('detail'))throw Error('Revision lacks chosen scene');
      const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/turns'));
      await page.getByRole('button',{name:'发送消息',exact:true}).click();
      const payload=(await sent).postDataJSON();
      const scope=payload.context.find(c=>c.startsWith('YINGYA_SCENE_REVISION '));
      const parsed=JSON.parse(scope.slice('YINGYA_SCENE_REVISION '.length));
      if(payload.baseVersionId!=='draft-2'||parsed.sceneId!=='detail'||parsed.versionId!=='draft-2'||parsed.kind!==kind||parsed.value!==value)throw Error('Wrong revision '+JSON.stringify({width,kind,base:payload.baseVersionId,parsed}));
      if(kind==='image'&&(parsed.replacementPath!=='assets/inbox/replacement.png'||!payload.attachments.includes(parsed.replacementPath)))throw Error('Replacement file not bound to uploaded attachment');
      page.off('request',onRequest);
      await page.waitForFunction(el => el.value === '', await composer.elementHandle());
      await page.reload();
      if(width<800)await page.locator('.workspace-tabs').getByRole('button',{name:'预览',exact:true}).click();
      await page.getByRole('heading',{name:'镜头与修改',exact:true}).waitFor();
    }
    await page.getByLabel('视频版本').selectOption('draft-1');
    await page.getByText('请等待当前制作完成，并切到当前版本后修改。',{exact:true}).waitFor();
    if(!(await page.getByRole('button',{name:'改文字',exact:true}).isDisabled()))throw Error('Old version allows scoped revision');
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(`Storyboard overflow ${width}`);
    if(errors.length)throw Error(errors.join('\n'));
    await page.screenshot({path:`/tmp/yingya-product-storyboard-${width}.png`});
    await page.close();
  }
  console.log('Storyboard passed: seek/selection, four staged and version-bound revision payloads, exact uploaded image binding, old version protection, desktop/390/320 (API mocks, real MP4).');
}

export { installApiMock, detail };
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
let browser;
try {
  await waitForFrontend();
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const requestedFlows = new Set((process.env.YINGYA_UI_QA_FLOWS ?? "").split(",").filter(Boolean));
  const flows = [assertProductWorkflow, assertProductStoryboard, assertTaskDiscovery, assertCapabilities, assertRetiredStyleIsAbsent, assertEditedSourceActions, assertMaterialFirstCreation, assertComposerFileDrop, assertFeedbackLifecycle, assertFrontendRecovery, assertCompactWorkspaceAndQueue, assertLostExecutionState, assertSelectionMotion, assertDesignRepairs, assertMotionFeedback, assertFunctionalEnhancements, assertAssetWorkshop, assertDesktop, assertLiveHyperFramesPreview, assertDraftCheckpoint, assertSupersededCheckpoint, assertCheckpointHiddenAfterRevision, assertWorkflowRecovery, assertIncompleteWorkflowRecovery, assertWaitingInputPrompt, assertCreateAndMobile];
  // The knowledge workspace replaces editor/live-canvas and template-picker flows.
  // Keep those historical fixtures callable explicitly; the default covers retained behavior.
  const active = [assertAssetWorkshop, assertWorkflowRecovery, assertIncompleteWorkflowRecovery, assertWaitingInputPrompt, assertLostExecutionState];
  const selected = requestedFlows.size ? flows.filter(flow => requestedFlows.has(flow.name)) : active;
  for (const flow of selected) await flow(browser);
  console.log("UI QA passed:", selected.map(flow => flow.name).join(", "));
} finally {
  await browser?.close();
}

}
