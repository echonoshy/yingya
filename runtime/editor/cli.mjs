#!/usr/bin/env node
import { editStore } from "./store.mjs";
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Yingya editor: node runtime/editor/cli.mjs --project DIR --action read|init|command|checkpoint|restore\nJSON request via stdin. Commands use expectedRevision + requestId; never overwrite state or compiled HTML directly.",
  );
} else {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 3_000_000) throw Error("请求内容过大");
    }
    const project = args[args.indexOf("--project") + 1],
      action = args[args.indexOf("--action") + 1];
    if (!args.includes("--project") || !args.includes("--action"))
      throw Error("缺少工程目录或操作");
    const result = await editStore(
      project,
      action,
      input.trim() ? JSON.parse(input) : {},
      args.includes("--library")
        ? args[args.indexOf("--library") + 1]
        : undefined,
    );
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exitCode = 1;
  }
}
