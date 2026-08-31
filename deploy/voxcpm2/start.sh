#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
state_dir="${project_root}/.runtime/voxcpm2"
pid_file="${state_dir}/server.pid"
log_file="${state_dir}/server.log"

mkdir -p "${state_dir}"
if [[ -f "${pid_file}" ]]; then
  old_pid="$(<"${pid_file}")"
  if kill -0 "${old_pid}" 2>/dev/null; then
    echo "VoxCPM2 is already running (PID ${old_pid})."
    exit 0
  fi
  rm -f "${pid_file}"
fi

# Give the model server its own session so it survives the launching shell.
nohup setsid "${project_root}/deploy/voxcpm2/serve.sh" "$@" >"${log_file}" 2>&1 &
server_pid=$!
echo "${server_pid}" >"${pid_file}"
echo "Started VoxCPM2 (PID ${server_pid}); log: ${log_file}"
