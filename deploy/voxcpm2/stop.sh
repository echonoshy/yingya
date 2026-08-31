#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pid_file="${project_root}/.runtime/voxcpm2/server.pid"

if [[ ! -f "${pid_file}" ]]; then
  echo "VoxCPM2 is not running (no PID file)."
  exit 0
fi

server_pid="$(<"${pid_file}")"
if ! kill -0 "${server_pid}" 2>/dev/null; then
  rm -f "${pid_file}"
  echo "Removed stale VoxCPM2 PID file."
  exit 0
fi

kill "${server_pid}"
for _ in $(seq 1 30); do
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    rm -f "${pid_file}"
    echo "Stopped VoxCPM2."
    exit 0
  fi
  sleep 1
done

echo "VoxCPM2 did not stop within 30 seconds (PID ${server_pid})." >&2
exit 1
