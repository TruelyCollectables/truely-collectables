#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ ! -d .venv ]]; then
  echo "Missing .venv; run scripts/install-macos.sh first" >&2
  exit 1
fi
source .venv/bin/activate
set -a
[[ -f .env ]] && source .env
set +a
exec python scripts/sync_checklists.py
