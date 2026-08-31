#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_API_BASE = "http://127.0.0.1:8791";
const REQUEST_TIMEOUT_MS = 300_000;

const usage = `Usage:
  voxcpm2_tts.mjs [--base-url URL] health
  voxcpm2_tts.mjs [--base-url URL] models
  voxcpm2_tts.mjs [--base-url URL] voices
  voxcpm2_tts.mjs [--base-url URL] synthesize --text TEXT --output PATH
    [--model MODEL] [--voice VOICE] [--format wav|pcm] [--stream] [--force]`;

function expandPath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

async function request(baseUrl, route, payload) {
  const url = `${baseUrl.replace(/\/+$/, "")}${route}`;
  let response;

  try {
    response = await fetch(url, {
      method: payload === undefined ? "GET" : "POST",
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot reach VoxCPM2 API at ${baseUrl}: ${detail}`);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`VoxCPM2 API returned HTTP ${response.status}: ${detail}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function printJson(raw) {
  const parsed = raw.length === 0 ? { ok: true } : JSON.parse(raw.toString("utf8"));
  console.log(JSON.stringify(parsed, null, 2));
}

function parseCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      "base-url": {
        type: "string",
        default: process.env.VOXCPM2_API_BASE ?? DEFAULT_API_BASE,
      },
      text: { type: "string" },
      output: { type: "string" },
      model: { type: "string", default: "voxcpm2" },
      voice: { type: "string", default: "default" },
      format: { type: "string", default: "wav" },
      stream: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(usage);
    return null;
  }
  if (positionals.length !== 1) {
    throw new Error(`Expected exactly one command.\n${usage}`);
  }

  return { command: positionals[0], ...values };
}

async function ensureOutputIsAvailable(output, force) {
  if (force) return;
  try {
    await access(output);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Output already exists: ${output}; pass --force to overwrite it`);
}

async function main() {
  const args = parseCli();
  if (args === null) return;

  if (args.command === "health") {
    await request(args["base-url"], "/health");
    console.log(JSON.stringify({ ok: true, url: args["base-url"] }));
    return;
  }
  if (args.command === "models") {
    printJson(await request(args["base-url"], "/v1/models"));
    return;
  }
  if (args.command === "voices") {
    printJson(await request(args["base-url"], "/v1/audio/voices"));
    return;
  }
  if (args.command !== "synthesize") {
    throw new Error(`Unknown command: ${args.command}.\n${usage}`);
  }
  if (!args.text) throw new Error("synthesize requires --text");
  if (!args.output) throw new Error("synthesize requires --output");
  if (!new Set(["wav", "pcm"]).has(args.format)) {
    throw new Error("--format must be wav or pcm");
  }

  const output = expandPath(args.output);
  await ensureOutputIsAvailable(output, args.force);
  await mkdir(dirname(output), { recursive: true });

  const payload = {
    model: args.model,
    input: args.text,
    voice: args.voice,
    response_format: args.format,
    ...(args.stream ? { stream: true, stream_format: "audio" } : {}),
  };
  const audio = await request(args["base-url"], "/v1/audio/speech", payload);

  try {
    await writeFile(output, audio, { flag: args.force ? "w" : "wx" });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(`Output already exists: ${output}; pass --force to overwrite it`);
    }
    throw error;
  }
  console.log(JSON.stringify({ ok: true, output, bytes: audio.length }));
}

try {
  await main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`error: ${detail}`);
  process.exitCode = 1;
}
