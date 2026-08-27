#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$SERVICE_ROOT/scripts/lora-resume-freeze-patch"
SERVICE_PYTHON="$SERVICE_ROOT/.venv/bin/python"

if [[ ! -x "$SERVICE_PYTHON" ]]; then
  SERVICE_PYTHON="${PYTHON:-python3}"
fi

export INSTACOMP_MLX_SAFE_RESUME=1
# A checkpoint chunk must never be allowed to sit frozen for an hour. The
# checkpoint-safe wrapper owns the exact MLX child and will terminate/retry it
# on timeout without deleting the last valid adapter bundle.
export INSTACOMP_LORA_CHUNK_TIMEOUT_SECONDS="${INSTACOMP_LORA_CHUNK_TIMEOUT_SECONDS:-900}"
export INSTACOMP_LORA_TIMEOUT_RETRIES="${INSTACOMP_LORA_TIMEOUT_RETRIES:-2}"
if [[ -n "${PYTHONPATH:-}" ]]; then
  export PYTHONPATH="$PATCH_DIR:$PYTHONPATH"
else
  export PYTHONPATH="$PATCH_DIR"
fi

exec "$SERVICE_PYTHON" \
  "$SERVICE_ROOT/scripts/run_lora_training_checkpoint_safe.py" "$@"
