#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
host="${VOXCPM2_HOST:-127.0.0.1}"
port="${VOXCPM2_PORT:-8791}"

bash "${project_root}/scripts/dev-service.sh" voxcpm2 status || exit 1
stored_port="$(tmux show-options -qv -t yingya-voxcpm2 @yingya-port)"
port="${stored_port:-${port}}"

if curl --silent --fail --max-time 2 "http://${host}:${port}/health" >/dev/null; then
  echo "api=ready url=http://${host}:${port}"
else
  echo "api=not-ready url=http://${host}:${port}"
  exit 1
fi
