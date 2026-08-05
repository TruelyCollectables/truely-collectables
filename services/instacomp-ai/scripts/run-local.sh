#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv ]]; then
  echo "Missing .venv. Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Review it before exposing this service beyond localhost."
fi

source .venv/bin/activate
exec uvicorn app.main:app \
  --host "${INSTACOMP_AI_HOST:-127.0.0.1}" \
  --port "${INSTACOMP_AI_PORT:-8787}" \
  --workers 1
