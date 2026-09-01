import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const projectId = "11111111-1111-4111-8111-111111111111";
const script = new URL("../skills/heygen-audio/scripts/heygen_audio.mjs", import.meta.url);

test("HeyGen client searches, imports idempotently, and assigns a scene asset", async () => {
  let imports = 0;
  let assignedAssetIds = [];
  const asset = { id: "asset-1", name: "Soft pulse", mediaType: "music", durationSeconds: 15, providerId: "provider-1" };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && url.pathname === "/api/heygen/audio") {
      response.end(JSON.stringify({ data: [{ id: "provider-1", name: "Soft pulse", description: "restrained", duration: 15, score: 0.92 }], hasMore: false }));
      return;
    }
    if (request.method === "POST" && url.pathname === `/api/agent-projects/${projectId}/heygen/audio`) {
      imports += 1;
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { id: "provider-1", query: "soft pulse", type: "music" });
      response.end(JSON.stringify(asset));
      return;
    }
    if (request.method === "GET" && url.pathname === `/api/agent-projects/${projectId}/media`) {
      response.end(JSON.stringify({ scenes: [{ id: "scene-1", order: 1, narrativeRole: "opening", assetIds: [] }], assets: [asset] }));
      return;
    }
    if (request.method === "PATCH" && url.pathname === `/api/agent-projects/${projectId}/scenes/scene-1`) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assignedAssetIds = JSON.parse(Buffer.concat(chunks).toString()).assetIds;
      response.end(JSON.stringify({ id: "scene-1", order: 1, narrativeRole: "opening", assetIds: assignedAssetIds }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "not_found", message: "mock route not found" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseArgs = [script.pathname, "--base-url", `http://127.0.0.1:${address.port}`, "--project-id", projectId];

  try {
    const search = JSON.parse((await exec(process.execPath, [script.pathname, "--base-url", `http://127.0.0.1:${address.port}`, "search-music", "--query", "soft pulse"])).stdout);
    assert.equal(search.results[0].id, "provider-1");
    const imported = JSON.parse((await exec(process.execPath, [...baseArgs, "import", "--id", "provider-1", "--query", "soft pulse", "--type", "music"])).stdout);
    const duplicate = JSON.parse((await exec(process.execPath, [...baseArgs, "import", "--id", "provider-1", "--query", "soft pulse", "--type", "music"])).stdout);
    assert.equal(imported.asset.id, duplicate.asset.id);
    await exec(process.execPath, [...baseArgs, "assign", "--asset-id", "asset-1", "--scene-id", "scene-1"]);
    assert.deepEqual(assignedAssetIds, ["asset-1"]);
    assert.equal(imports, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
