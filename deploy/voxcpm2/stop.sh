#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "${project_root}/scripts/dev-service.sh" voxcpm2 stop "$@"
