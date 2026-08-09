#!/usr/bin/env bash
set -euo pipefail

SERVICE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$SERVICE_ROOT/scripts/lora-resume-freeze-patch"

export INSTACOMP_MLX_SAFE_RESUME=1
if [[ -n "${PYTHONPATH:-}" ]]; then
  export PYTHONPATH="$PATCH_DIR:$PYTHONPATH"
else
  export PYTHONPATH="$PATCH_DIR"
fi

exec "$SERVICE_ROOT/.venv/bin/python" \
  "$SERVICE_ROOT/scripts/run_lora_training.py" "$@"
