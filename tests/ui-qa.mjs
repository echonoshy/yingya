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
  messages: [{ id: "message-1", turnId: "turn-1", role: "user", text: "制作一条秋季新品短片", attachments: [], context: [], status: "completed", createdAt: now }],
  queue: [{ id: "turn-2", text: "把节奏再收紧", attachments: [], context: [], model: null, reasoningEffort: null, createdAt: now + 1 }],
  manifest, eventCursor: 3,
};

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installApiMock(page) {
  let projects = [record];
  let current = structuredClone(detail);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const method = request.method();

    if (pathname === "/api/codex/models") return json(route, { data: [] });
    if (pathname.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ready\n\n" });
    if (pathname.endsWith("/event-log")) return json(route, {
      items: [
        { seq: 1, projectId: record.id, turnId: "turn-1", method: "item/started", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes lint" } } }, createdAt: now },
        { seq: 2, projectId: record.id, turnId: "turn-1", method: "item/completed", payload: { params: { item: { id: "cmd-1", type: "commandExecution", command: "hyperframes lint", status: "completed", aggregatedOutput: "passed" } } }, createdAt: now + 1 },
      ],
      latestSeq: 3, hasMore: false,
    });
    if (pathname.endsWith("/files/plans/production.md")) return route.fulfill({ status: 200, contentType: "text/markdown", body: "# 制作方案\n\n三幕结构与视觉方向。" });
    if (pathname === "/api/agent-projects" && method === "GET") return json(route, projects);
    if (pathname === "/api/agent-projects" && method === "POST") {
      current = { ...structuredClone(detail), id: "22222222-2222-4222-8222-222222222222", title: "网站产品宣传片", status: "idle", statusLabel: "准备就绪", queueDepth: 0, queuePaused: false, queue: [], messages: [], manifest: { ...manifest, checkpoint: null, artifacts: [] }, eventCursor: 0 };
      projects = [current, ...projects];
      return json(route, current);
    }
    const projectMatch = pathname.match(/^\/api\/agent-projects\/([^/]+)$/);
    if (projectMatch && method === "GET") return json(route, current.id === projectMatch[1] ? current : detail);
    if (pathname.endsWith("/turns") && method === "POST") return json(route, { turnId: "turn-new", status: "queued", queueDepth: 1 });
    if (pathname.endsWith("/resume") && method === "POST") {
      current = { ...current, queuePaused: false, status: "queued", statusLabel: "已排队" };
      return route.fulfill({ status: 204, body: "" });
    }
    if (pathname.endsWith("/checkpoint") && method === "POST") return json(route, { turnId: "turn-confirm", status: "queued", queueDepth: 1 });
    return json(route, { code: "not_found", message: `Unhandled mock route: ${method} ${pathname}` }, 404);
  });
}

async function assertDesktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await installApiMock(page);
  await page.goto(baseUrl);
  await page.getByRole("heading", { name: "项目" }).waitFor();
  await page.getByRole("button", { name: /^秋季新品短片/ }).click();
  await page.getByText("制作方案已就绪", { exact: true }).waitFor();
  await page.locator(".debug-events summary").click();
  await page.locator(".debug-event-list pre").first().waitFor();
  await page.getByRole("button", { name: "继续处理" }).click();
  await page.getByRole("button", { name: /查看计划/ }).click();
  await page.getByRole("heading", { name: "制作方案", exact: true }).waitFor();
  await page.getByText("三幕结构与视觉方向。").waitFor();
  await page.screenshot({ path: "/tmp/yingya-ui-desktop.png", fullPage: true });
  if (errors.length) throw new Error(`Desktop page errors:\n${errors.join("\n")}`);
  await page.close();
}

async function assertCreateAndMobile(browser) {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
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
  await assertCreateAndMobile(browser);
  console.log("UI QA passed: desktop project/queue/checkpoint/artifact and 360px create/message flows");
  console.log("Screenshots: /tmp/yingya-ui-desktop.png, /tmp/yingya-ui-mobile.png");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  if (preview.exitCode === null) await Promise.race([once(preview, "exit"), new Promise(resolve => setTimeout(resolve, 2_000))]);
}
