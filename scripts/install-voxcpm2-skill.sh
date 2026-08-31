#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_root="${project_root}/skills/voxcpm2-tts"
target_root="${project_root}/.runtime/codex-home/skills/voxcpm2-tts"

if [[ ! -f "${source_root}/SKILL.md" ]]; then
  echo "VoxCPM2 skill source is missing: ${source_root}" >&2
  exit 1
fi

mkdir -p "${target_root}/agents" "${target_root}/scripts"
rm -f "${target_root}/scripts/voxcpm2_tts.py"
cp "${source_root}/SKILL.md" "${target_root}/SKILL.md"
cp "${source_root}/agents/openai.yaml" "${target_root}/agents/openai.yaml"
cp "${source_root}/scripts/voxcpm2_tts.mjs" "${target_root}/scripts/voxcpm2_tts.mjs"
chmod +x "${target_root}/scripts/voxcpm2_tts.mjs"

echo "Installed voxcpm2-tts skill into ${target_root}"
