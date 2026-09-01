#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_root="${project_root}/skills/heygen-audio"
target_root="${project_root}/.runtime/codex-home/skills/heygen-audio"

if [[ ! -f "${source_root}/SKILL.md" ]]; then
  echo "HeyGen audio skill source is missing: ${source_root}" >&2
  exit 1
fi

mkdir -p "${target_root}"
cp -a "${source_root}/." "${target_root}/"
chmod +x "${target_root}/scripts/heygen_audio.mjs"

echo "Installed heygen-audio skill into ${target_root}"
