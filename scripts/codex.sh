#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec env CODEX_HOME="$project_root/.runtime/codex-home" "$project_root/node_modules/.bin/codex" "$@"
