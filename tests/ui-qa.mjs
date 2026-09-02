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
  manifest, eventCursor: 3,
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiMock(page, seed = detail) {
  let projects = [seed];
  let current = structuredClone(seed);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === "/api/codex/models") return json(route, { data: [] });
    if (pathname.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    if (pathname.endsWith("/event-log")) return json(route, {
      items: [
        { seq: 1, projectId: seed.id, turnId: "turn-1", method: "item/started", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes lint" } } }, createdAt: now },
        { seq: 2, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes lint", status: "completed", aggregatedOutput: "passed" } } }, createdAt: now + 1 },
        { seq: 3, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "update-1", type: "agentMessage", text: "画面结构已经确认，接下来整理制作文件。" } } }, createdAt: now + 4 },
        { seq: 4, projectId: seed.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "file-1", type: "fileChange", status: "completed", changes: [{ path: "plans/production.md" }] } } }, createdAt: now + 6 },
      ],
      latestSeq: 4, hasMore: false,
    });
    if (pathname.endsWith("/files/plans/production.md")) return route.fulfill({ status: 200, contentType: "text/markdown", body: "# 制作方案\n\n三幕结构与视觉方向。" });
    if (pathname === "/api/agent-projects" && method === "GET") return json(route, projects);
    if (pathname === "/api/agent-projects" && method === "POST") {
      current = { ...structuredClone(detail), id: "22222222-2222-4222-8222-222222222222", title: "网站产品宣传片", status: "idle", statusLabel: "准备就绪", queueDepth: 0, queuePaused: false, queue: [], messages: [], manifest: { ...manifest, checkpoint: null, artifacts: [] }, eventCursor: 0 };
      projects = [current, ...projects];
      return json(route, current);
    }
    const projectMatch = pathname.match(/^\/api\/agent-projects\/([^/]+)$/);
    if (projectMatch && method === "GET") return json(route, current.id === projectMatch[1] ? current : seed);
    if (pathname.endsWith("/turns") && method === "POST") return json(route, { turnId: "turn-new", status: "queued", queueDepth: 1 });
    if (pathname.endsWith("/resume") && method === "POST") {
      current = { ...current, queuePaused: false, status: "queued", statusLabel: "已排队" };
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname.endsWith("/checkpoint") && method === "POST") return json(route, { turnId: "turn-confirm", status: "queued", queueDepth: 1 });
    if (pathname.endsWith("/render") && method === "POST") {
      const input = request.postDataJSON();
      const dimensions = input.resolution === "portrait-4k" ? "2160x3840" : "1080x1920";
      const dimensionsLabel = input.resolution === "portrait-4k" ? "2160 × 3840 p" : "1080 × 1920 p";
      const output = { path: `.yingya/exports/${input.versionId}-${input.resolution}-${input.fps}fps.mp4`, label: `${dimensionsLabel} 成片`, resolution: dimensions, fps: input.fps };
      current = { ...current, status: "completed", statusLabel: `${dimensionsLabel} 成片已完成`, manifest: { ...current.manifest, phase: "completed", checkpoint: null, artifacts: [...current.manifest.artifacts, { id: "final-video", kind: "final-video", label: output.label, path: output.path, version: input.versionId, metadata: { resolution: dimensions, frameRate: input.fps } }] } };
      return json(route, output);
    }
    return json(route, { code: "not_found", message: `Unhandled mock route: ${method} ${pathname}` }, 404);
  });
}

async function assertDraftCheckpoint(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 }, reducedMotion: "reduce" });
  const draft = {
    ...structuredClone(detail), status: "draft_review", statusLabel: "草稿等待确认", queueDepth: 0, queuePaused: false, queue: [],
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
  if (await page.locator(".checkpoint-card").count()) throw new Error("Draft rendering should not appear as a conversation checkpoint");
  const renderPanel = page.getByLabel("导出视频");
  await renderPanel.waitFor();
  if (await page.locator(".artifact-canvas > header select").inputValue() !== "draft-3") throw new Error("The newest current draft should be selected automatically");
  if (!(await page.locator(".video-stage video").getAttribute("src"))?.includes("draft-3")) throw new Error("The preview should use the current draft video instead of an older final render");
  if (await renderPanel.getByText("直接生成下载文件，不进入对话").count()) throw new Error("Export panel should not show redundant explanatory copy");
  if (await renderPanel.getByLabel("分辨率").inputValue() !== "portrait-4k") throw new Error("The 4K portrait resolution should be the default export setting");
  if ((await renderPanel.getByLabel("分辨率").locator("option:checked").textContent()) !== "2160 × 3840 p") throw new Error("Resolution should display its p suffix");
  if (await renderPanel.getByLabel("帧率").inputValue() !== "60") throw new Error("60 FPS should be the default export setting");
  await page.getByRole("button", { name: "添加时间点" }).click();
  await page.locator(".time-feedback-row input").first().fill("放大标题并提高对比度");
  await page.getByRole("button", { name: "添加时间点" }).click();
  await page.locator(".time-feedback-row input").last().fill("让产品停留时间更长");
  if (await page.locator(".time-feedback-row").count() !== 2) throw new Error("Time feedback should support multiple entries");
  await page.screenshot({ path: "/tmp/yingya-ui-time-feedback.png", fullPage: true });
  await page.getByRole("button", { name: "添加到修改描述" }).click();
  const composer = page.getByPlaceholder("描述修改，或继续推进视频…");
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
  const composer = page.getByPlaceholder("描述修改，或继续推进视频…");
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
  if (await page.getByPlaceholder("描述修改，或继续推进视频…").inputValue() !== "检查并恢复项目流程") throw new Error("Incomplete recovery action did not populate the composer");
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
  if (page.url() !== `${baseUrl}/` || await page.title() !== "映芽 | 视频创作工作台") throw new Error("Unexpected page identity");
  await page.getByRole("heading", { name: "项目" }).waitFor();
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.locator(".checkpoint-card").waitFor();
  if (await page.getByRole("dialog").count()) throw new Error("Plan confirmation should stay inside the conversation");
  await page.screenshot({ path: "/tmp/yingya-ui-checkpoint.png", fullPage: true });
  const finalReply = page.getByText("预览已完成，请选择下一步：", { exact: false });
  await finalReply.waitFor();
  await page.locator(".message--assistant ol > li").first().waitFor();
  const planLink = page.locator('.message--assistant a[href="plans/production.md"]');
  await planLink.getByText("查看制作方案", { exact: true }).waitFor();
  const activityTop = await page.locator(".activity-item").first().evaluate(element => element.getBoundingClientRect().top);
  const replyTop = await finalReply.evaluate(element => element.getBoundingClientRect().top);
  if (replyTop <= activityTop) throw new Error("Final assistant reply should follow its run activity chronologically");
  if (await page.locator(".activity-item").count() !== 1) throw new Error("Conversation should show only the latest tool operation");
  if (await page.locator(".activity-item pre, .activity-item > p").count()) throw new Error("Raw tool output should not appear in the conversation");
  await page.getByText("画面结构已经确认，接下来整理制作文件。", { exact: true }).waitFor();
  await page.locator(".activity-item").getByText("修改文件", { exact: true }).waitFor();
  if (await page.getByText("检查 HyperFrames", { exact: true }).count()) throw new Error("Older tool operations should be hidden");
  await page.getByRole("button", { name: /直接渲染/ }).click();
  const composer = page.getByPlaceholder("描述修改，或继续推进视频…");
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
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.getByRole("heading", { name: "秋季新品短片" }).waitFor();
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
  await page.getByPlaceholder("描述修改，或继续推进视频…").fill("调整画面构图后重新生成草稿");
  await page.getByRole("button", { name: "发送消息" }).click();
  await checkpoint.waitFor({ state: "hidden" });
  await page.close();
}

async function assertCreateAndMobile(browser) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`); });
  await installApiMock(page);
  await page.goto(baseUrl);
  const prompt = page.getByPlaceholder("描述视频主题、风格、时长，或直接粘贴网页链接…");
  await prompt.fill("网站产品宣传片");
  await page.getByRole("button", { name: "创建视频任务" }).click();
  await page.getByRole("heading", { name: "网站产品宣传片" }).waitFor();
  const composer = page.getByPlaceholder("描述修改，或继续推进视频…");
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

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  await assertDesktop(browser);
  await assertDraftCheckpoint(browser);
  await assertSupersededCheckpoint(browser);
  await assertCheckpointHiddenAfterRevision(browser);
  await assertWorkflowRecovery(browser);
  await assertIncompleteWorkflowRecovery(browser);
  await assertWaitingInputPrompt(browser);
  await assertCreateAndMobile(browser);
  console.log("UI QA passed: waiting-input prompt, plan/draft checkpoints, failed/incomplete workflow recovery, desktop project flow, and 360px create/message flow");
  console.log("Screenshots: /tmp/yingya-ui-waiting-desktop.png, /tmp/yingya-ui-waiting-mobile.png, /tmp/yingya-ui-checkpoint.png, /tmp/yingya-ui-desktop.png, /tmp/yingya-ui-mobile.png");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  if (preview.exitCode === null) await Promise.race([once(preview, "exit"), new Promise(resolve => setTimeout(resolve, 2_000))]);
}
