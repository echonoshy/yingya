#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_root="${project_root}/.runtime/voxcpm2-vllm"
venv_root="${runtime_root}/.venv"
model_root="${VOXCPM2_MODEL_PATH:-${project_root}/.runtime/models/VoxCPM2}"

python_bin="${venv_root}/bin/python"
if [[ ! -x "${python_bin}" ]]; then
  echo "VoxCPM2 vLLM-Omni environment is missing: ${venv_root}" >&2
  exit 1
fi
if [[ ! -f "${model_root}/config.json" ]]; then
  echo "VoxCPM2 model is missing: ${model_root}" >&2
  exit 1
fi

host="${VOXCPM2_HOST:-0.0.0.0}"
port="${VOXCPM2_PORT:-8791}"
gpu="${VOXCPM2_GPU:-1}"
gpu_memory_utilization="${VOXCPM2_GPU_MEMORY_UTILIZATION:-0.80}"

export CUDA_VISIBLE_DEVICES="${gpu}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
export HF_HOME="${HF_HOME:-${project_root}/.runtime/huggingface}"
export HF_HUB_OFFLINE="${HF_HUB_OFFLINE:-1}"
export SPEAKER_SAMPLES_DIR="${SPEAKER_SAMPLES_DIR:-${project_root}/.runtime/voxcpm2/speakers}"
export PYTHONPATH="${runtime_root}/src/vllm:${runtime_root}/src/vllm-omni${PYTHONPATH:+:${PYTHONPATH}}"

# The host uses CUDA 12.8/SM89. FlashInfer's published sampler extension is
# incompatible with this source-built stack; vLLM's CUDA model and attention
# kernels remain enabled while sampling falls back to the native implementation.
export VLLM_USE_FLASHINFER_SAMPLER="${VLLM_USE_FLASHINFER_SAMPLER:-0}"

exec "${python_bin}" -m vllm.entrypoints.cli.main serve "${model_root}" \
  --omni \
  --served-model-name voxcpm2 \
  --host "${host}" \
  --port "${port}" \
  --gpu-memory-utilization "${gpu_memory_utilization}" \
  "$@"
