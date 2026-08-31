#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_home="$project_root/.runtime/hyperframes-home"
codex_home="$project_root/.runtime/codex-home"
npm_cache="$project_root/.runtime/npm-cache"
source_root="$runtime_home/.agents/skills"
staging_root="$runtime_home/.agents"
target_root="$codex_home/skills"

skill_names=(
  hyperframes
  hyperframes-animation
  hyperframes-audio
  hyperframes-cli
  hyperframes-core
  hyperframes-creative
  hyperframes-keyframes
  hyperframes-registry
  media-use
)

mkdir -p "$runtime_home" "$target_root" "$npm_cache"

skill_arguments=()
for skill_name in "${skill_names[@]}"; do
  skill_arguments+=(--skill "$skill_name")
done

(
  cd "$runtime_home"
  HOME="$runtime_home" \
  CODEX_HOME="$codex_home" \
  npm_config_cache="$npm_cache" \
    npx -y skills@1.5.23 add heygen-com/hyperframes \
      --global \
      --agent codex \
      --copy \
      --yes \
      "${skill_arguments[@]}"
)

for skill_name in "${skill_names[@]}"; do
  source_path="$source_root/$skill_name"
  target_path="$target_root/$skill_name"

  if [[ ! -d "$source_path" ]]; then
    echo "HyperFrames skill was not installed: $skill_name" >&2
    exit 1
  fi

  if [[ -L "$target_path" ]]; then
    unlink "$target_path"
  fi
  mkdir -p "$target_path"
  cp -a "$source_path/." "$target_path/"
done

printf 'Installed %d HyperFrames skills into %s\n' "${#skill_names[@]}" "$target_root"
rm -rf -- "$staging_root"
