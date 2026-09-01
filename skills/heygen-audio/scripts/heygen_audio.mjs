#!/usr/bin/env node

import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_API_BASE = "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const usage = `Usage:
  heygen_audio.mjs [--base-url URL] health
  heygen_audio.mjs [--base-url URL] [--project-id UUID] project
  heygen_audio.mjs [--base-url URL] search-music --query TEXT [--limit 1-20] [--min-score 0-1]
  heygen_audio.mjs [--base-url URL] search-sfx --query TEXT [--limit 1-20] [--min-score 0-1]
  heygen_audio.mjs [--base-url URL] [--project-id UUID] import --id ID --query TEXT --type music|sound_effects
  heygen_audio.mjs [--base-url URL] [--project-id UUID] assign --asset-id ID --scene-id ID`;

function parseCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      "base-url": { type: "string", default: process.env.YINGYA_API_BASE ?? DEFAULT_API_BASE },
      "project-id": { type: "string", default: process.env.YINGYA_PROJECT_ID },
      query: { type: "string" },
      type: { type: "string" },
      limit: { type: "string", default: "8" },
      "min-score": { type: "string", default: "0.7" },
      id: { type: "string" },
      "asset-id": { type: "string" },
      "scene-id": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(usage);
    return null;
  }
  if (positionals.length !== 1) throw new Error(`Expected exactly one command.\n${usage}`);
  return { command: positionals[0], ...values };
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function normalizeType(value) {
  if (value === "music") return "music";
  if (["sound_effects", "sound-effects", "sfx"].includes(value)) return "sound_effects";
  throw new Error("--type must be music or sound_effects");
}

function resolveProjectId(explicit) {
  const projectId = explicit ?? basename(resolve(process.cwd()));
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("Cannot derive a Yingya project ID from the current directory; pass --project-id UUID");
  }
  return projectId;
}

function parseNumber(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

async function requestJson(baseUrl, route, init) {
  let response;
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}${route}`, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach Yingya API at ${baseUrl}: ${detail}`);
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || response.statusText };
  }
  if (!response.ok) {
    throw new Error(`Yingya API returned HTTP ${response.status}: ${body.error ?? response.statusText}`);
  }
  return body;
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const args = parseCli();
  if (args === null) return;
  const baseUrl = args["base-url"];

  if (args.command === "health") {
    const health = await requestJson(baseUrl, "/health");
    print({ ok: true, apiBase: normalizeBaseUrl(baseUrl), backend: health.backend });
    return;
  }

  if (args.command === "project") {
    const projectId = resolveProjectId(args["project-id"]);
    const project = await requestJson(baseUrl, `/api/projects/${projectId}`);
    print({
      ok: true,
      project: { id: project.id, title: project.title, status: project.status },
      scenes: project.scenes.map(({ id, order, narrativeRole, assetIds }) => ({ id, order, narrativeRole, assetIds })),
      audioAssets: project.assets.filter(asset => asset.mediaType).map(({ id, name, mediaType, durationSeconds, providerId }) => ({ id, name, mediaType, durationSeconds, providerId })),
    });
    return;
  }

  if (args.command === "search-music" || args.command === "search-sfx") {
    if (!args.query?.trim()) throw new Error(`${args.command} requires --query`);
    const type = args.command === "search-music" ? "music" : "sound_effects";
    const limit = parseNumber(args.limit, "--limit", 1, 20);
    const minScore = parseNumber(args["min-score"], "--min-score", 0, 1);
    const params = new URLSearchParams({ query: args.query.trim(), type, limit: String(limit), minScore: String(minScore) });
    const result = await requestJson(baseUrl, `/api/heygen/audio?${params}`);
    print({
      ok: true,
      query: args.query.trim(),
      type,
      results: result.data.map(({ id, name, description, duration, score }) => ({ id, name, description, duration, score })),
      hasMore: result.hasMore,
    });
    return;
  }

  if (args.command === "import") {
    if (!args.id) throw new Error("import requires --id");
    if (!args.query?.trim()) throw new Error("import requires --query");
    const type = normalizeType(args.type);
    const projectId = resolveProjectId(args["project-id"]);
    const asset = await requestJson(baseUrl, `/api/projects/${projectId}/heygen/audio`, {
      method: "POST",
      body: JSON.stringify({ id: args.id, query: args.query.trim(), type }),
    });
    print({ ok: true, projectId, asset });
    return;
  }

  if (args.command === "assign") {
    if (!args["asset-id"]) throw new Error("assign requires --asset-id");
    if (!args["scene-id"]) throw new Error("assign requires --scene-id");
    const projectId = resolveProjectId(args["project-id"]);
    const project = await requestJson(baseUrl, `/api/projects/${projectId}`);
    const scene = project.scenes.find(item => item.id === args["scene-id"]);
    if (!scene) throw new Error(`Unknown scene ID: ${args["scene-id"]}`);
    if (!project.assets.some(asset => asset.id === args["asset-id"])) {
      throw new Error(`Unknown project asset ID: ${args["asset-id"]}`);
    }
    const assetIds = [...new Set([...(scene.assetIds ?? []), args["asset-id"]])];
    const updated = await requestJson(baseUrl, `/api/projects/${projectId}/scenes/${scene.id}`, {
      method: "PATCH",
      body: JSON.stringify({ assetIds }),
    });
    const updatedScene = updated.scenes.find(item => item.id === scene.id);
    print({ ok: true, projectId, scene: { id: updatedScene.id, order: updatedScene.order, narrativeRole: updatedScene.narrativeRole, assetIds: updatedScene.assetIds } });
    return;
  }

  throw new Error(`Unknown command: ${args.command}.\n${usage}`);
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`error: ${detail}`);
  process.exitCode = 1;
}
