#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${MARKET_INTEL_WORKER_ENV_FILE:-$REPO_ROOT/.env.market-intel-worker.local}"
NODE_BIN="${MARKET_INTEL_NODE_BIN:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Market Intel worker environment file not found: $ENV_FILE" >&2
  echo "Create it with the activation bootstrap and protect it with chmod 600." >&2
  exit 78
fi

if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js executable was not found. Set MARKET_INTEL_NODE_BIN to the full Node path." >&2
  exit 78
fi
if [[ "$($NODE_BIN -p "process.allowedNodeEnvironmentFlags.has('--env-file')")" != "true" ]]; then
  echo "This Node.js installation does not support --env-file." >&2
  exit 78
fi

cd "$REPO_ROOT"
exec "$NODE_BIN" --env-file="$ENV_FILE" --import tsx "$REPO_ROOT/scripts/run-market-intel-external-worker.ts"
