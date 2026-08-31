#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
host="${VOXCPM2_HOST:-127.0.0.1}"
port="${VOXCPM2_PORT:-8791}"
output_dir="${project_root}/artifacts/voxcpm2"
output_file="${output_dir}/smoke-test.wav"
client="${project_root}/skills/voxcpm2-tts/scripts/voxcpm2_tts.mjs"

mkdir -p "${output_dir}"
node "${client}" \
  --base-url "http://${host}:${port}" \
  synthesize \
  --text "你好，这里是映芽。VoxCPM 二语音服务已经部署成功。" \
  --output "${output_file}" \
  --force

node - "${output_file}" <<'JS'
const fs = require("node:fs");

const path = process.argv[2];
const wav = fs.readFileSync(path);
if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
  throw new Error("unexpected VoxCPM2 WAV container");
}

let format;
let dataBytes;
for (let offset = 12; offset + 8 <= wav.length;) {
  const chunk = wav.toString("ascii", offset, offset + 4);
  const size = wav.readUInt32LE(offset + 4);
  const start = offset + 8;
  if (start + size > wav.length) throw new Error("truncated VoxCPM2 WAV file");
  if (chunk === "fmt " && size >= 16) {
    format = {
      channels: wav.readUInt16LE(start + 2),
      rate: wav.readUInt32LE(start + 4),
      byteRate: wav.readUInt32LE(start + 8),
    };
  } else if (chunk === "data") {
    dataBytes = size;
  }
  offset = start + size + (size % 2);
}

if (!format || dataBytes === undefined || format.byteRate <= 0) {
  throw new Error("missing VoxCPM2 WAV format or data chunk");
}
const duration = dataBytes / format.byteRate;
console.log(`ok file=${path} rate=${format.rate}Hz channels=${format.channels} duration=${duration.toFixed(2)}s`);
if (format.rate !== 48_000 || format.channels !== 1 || duration <= 0) {
  throw new Error("unexpected VoxCPM2 WAV format");
}
JS
