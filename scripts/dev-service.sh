#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service="${1:-}"
action="${2:-status}"
if (( $# >= 2 )); then shift 2; else set --; fi

case "${service}" in
  backend)
    session="yingya-backend"
    port="${YINGYA_ADDR:-127.0.0.1:8797}"
    port="${port##*:}"
    command=(cargo run)
    ;;
  frontend)
    session="yingya-frontend"
    port=8798
    command=(npm run web:dev)
    ;;
  voxcpm2)
    session="yingya-voxcpm2"
    port="${VOXCPM2_PORT:-8791}"
    command=("${project_root}/deploy/voxcpm2/serve.sh")
    ;;
  *) echo "Usage: $0 {backend|frontend|voxcpm2} {start|stop|restart|status|logs} [service arguments...]" >&2; exit 2 ;;
esac

has_session() { tmux has-session -t "=${session}" 2>/dev/null; }

start_service() {
  if has_session; then
    local stored_port
    stored_port="$(tmux show-options -qv -t "${session}" @yingya-port)"
    echo "Already running: tmux=${session} port=${stored_port:-${port}}"
    return
  fi
  # Old PID files are not process ownership evidence. Never signal their PID.
  if [[ "${service}" == voxcpm2 && -f "${project_root}/.runtime/voxcpm2/server.pid" ]]; then
    local legacy_pid
    legacy_pid="$(<"${project_root}/.runtime/voxcpm2/server.pid")"
    if [[ "${legacy_pid}" =~ ^[1-9][0-9]*$ ]] && kill -0 "${legacy_pid}" 2>/dev/null; then
      echo "Legacy VoxCPM2 PID ${legacy_pid} is still active; identify and stop that process before starting tmux=${session} port=${port}." >&2
      return 1
    fi
  fi
  # An existing tmux server may have an old environment. Forward the invoking
  # environment explicitly, including proxy variables and runtime overrides.
  local entry
  local -a environment=()
  while IFS= read -r -d '' entry; do
    [[ "${entry}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]] || continue
    case "${entry%%=*}" in TMUX|TMUX_PANE) continue ;; esac
    environment+=(-e "${entry}")
  done < <(env -0)
  tmux new-session -d -s "${session}" -c "${project_root}" "${environment[@]}" "${command[@]}" "$@"
  tmux set-option -t "${session}" @yingya-port "${port}"
  echo "Started: tmux=${session} port=${port}; logs: tmux capture-pane -pt ${session}"
}

stop_service() {
  if has_session; then tmux kill-session -t "=${session}"; fi
  echo "Stopped: tmux=${session} port=${port}"
}

case "${action}" in
  start) start_service "$@" ;;
  stop) stop_service ;;
  restart) stop_service; start_service "$@" ;;
  status)
    if ! has_session; then echo "Stopped: tmux=${session} port=${port}"; exit 1; fi
    stored_port="$(tmux show-options -qv -t "${session}" @yingya-port)"
    echo "Running: tmux=${session} port=${stored_port:-${port}}"
    tmux list-panes -t "=${session}:" -F 'pane=#{pane_id} command=#{pane_current_command} pid=#{pane_pid}'
    ;;
  logs) tmux capture-pane -pt "=${session}:" -S -100 ;;
  *) echo "Unknown action: ${action}" >&2; exit 2 ;;
esac
