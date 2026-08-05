#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv ]]; then
  echo "Missing .venv. Run scripts/install-macos.sh first." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created .env from .env.example. Configure it before the first live mission."
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

source .venv/bin/activate
exec uvicorn app.main:app \
  --host "${INSTACOMP_AI_HOST:-127.0.0.1}" \
  --port "${INSTACOMP_AI_PORT:-8787}" \
  --workers 1
