#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pid_file="${project_root}/.runtime/voxcpm2/server.pid"
host="${VOXCPM2_HOST:-127.0.0.1}"
port="${VOXCPM2_PORT:-8791}"

if [[ -f "${pid_file}" ]] && kill -0 "$(<"${pid_file}")" 2>/dev/null; then
  echo "process=running pid=$(<"${pid_file}")"
else
  echo "process=stopped"
fi

if curl --silent --fail --max-time 2 "http://${host}:${port}/health" >/dev/null; then
  echo "api=ready url=http://${host}:${port}"
else
  echo "api=not-ready url=http://${host}:${port}"
  exit 1
fi
