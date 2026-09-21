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
    const pathname = url.pathname.replace(/^\/api\/u\/[^/]+\//, "/api/");
    if (pathname === "/api/auth/avatar") return json(route, { presetId: "cat", url: "/avatars/cat-v1.webp" });
    if (pathname === "/api/auth/me") return json(route, { user: { id: "qa-user", email: "qa@example.com", isAdmin: false } });
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

async function assertWorkflowRecovery(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  const failed = {
    ...structuredClone(detail), status: "failed", statusLabel: "制作流程异常，已暂停", queuePaused: true,
    manifest: { ...structuredClone(manifest), phase: "briefing", dirty: true, checkpoint: null, artifacts: [], versions: [], currentDraft: null },
  };
  await installApiMock(page, failed);
  await page.goto(`${workspaceUrl}#/projects`);
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
  await page.goto(`${workspaceUrl}#/projects`);
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
    await page.goto(`${workspaceUrl}#/projects`);
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

export { installApiMock, detail };
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
let browser;
try {
  await waitForFrontend();
  browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const requestedFlows = new Set((process.env.YINGYA_UI_QA_FLOWS ?? "").split(",").filter(Boolean));
  const flows = [assertAssetWorkshop, assertWorkflowRecovery, assertIncompleteWorkflowRecovery, assertWaitingInputPrompt, assertLostExecutionState];
  for (const name of requestedFlows) if (!flows.some(flow => flow.name === name)) throw new Error(`Unknown UI flow: ${name}`);
  const selected = requestedFlows.size ? flows.filter(flow => requestedFlows.has(flow.name)) : flows;
  for (const flow of selected) await flow(browser);
  console.log("UI QA passed:", selected.map(flow => flow.name).join(", "));
} finally {
  await browser?.close();
}

}
