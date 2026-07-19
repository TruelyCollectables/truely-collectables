#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.market-intel-worker.local"
MINUTES=15
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
SKIP_MIGRATION=0
SKIP_INSTALL=0

usage() {
  cat <<'EOF'
TCOS Market Intel Mac worker activation

Usage:
  bash scripts/bootstrap-market-intel-worker-macos.sh [options]

Options:
  --minutes N          Worker interval in minutes (default: 15; minimum: 5)
  --env-file PATH      Protected local worker env file
  --project-ref REF    Supabase project reference
  --skip-migration     Do not initialize/link/push Supabase migrations
  --skip-install       Run validation and one live cycle, but do not install launchd
  --help               Show this help

This script never asks for or prints production credentials. It reuses a protected
worker env file or existing ignored .env files. It never deploys the app or changes Vercel.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --minutes) MINUTES="${2:-}"; shift 2 ;;
    --env-file)
      ENV_FILE="$(cd -- "$(dirname -- "${2:-}")" 2>/dev/null && pwd)/$(basename -- "${2:-}")"
      shift 2
      ;;
    --project-ref) PROJECT_REF="${2:-}"; shift 2 ;;
    --skip-migration) SKIP_MIGRATION=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This activation command is for macOS. Use the portable container deployment for Linux/cloud hosts." >&2
  exit 69
fi
if ! [[ "$MINUTES" =~ ^[0-9]+$ ]] || (( MINUTES < 5 || MINUTES > 1440 )); then
  echo "--minutes must be a whole number from 5 to 1440." >&2
  exit 64
fi

cd "$REPO_ROOT"
for command_name in node npm npx git zsh; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Required command is missing: $command_name" >&2
    exit 69
  }
done
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 20 )); then
  echo "Node.js 20 or newer is required. Current: $(node --version)" >&2
  exit 69
fi

for required_file in \
  scripts/run-market-intel-external-worker.ts \
  scripts/preflight-market-intel-worker.ts \
  scripts/run-market-intel-worker-cycle.sh \
  scripts/install-market-intel-worker-launchd.mjs \
  scripts/status-market-intel-worker-launchd.mjs \
  supabase/migrations/20260719153000_market_intel_identity_proof_gate.sql; do
  [[ -f "$required_file" ]] || {
    echo "Required worker file is missing: $required_file" >&2
    exit 66
  }
done

load_env_file() {
  local file_path="$1"
  [[ -f "$file_path" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$file_path"
  set +a
}

if [[ -f "$ENV_FILE" ]]; then
  chmod 600 "$ENV_FILE"
  load_env_file "$ENV_FILE"
else
  load_env_file "$REPO_ROOT/.env"
  load_env_file "$REPO_ROOT/.env.local"
  load_env_file "$REPO_ROOT/.env.production.local"

  missing=()
  for variable_name in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY EBAY_CLIENT_ID EBAY_CLIENT_SECRET; do
    if [[ -z "${!variable_name:-}" ]]; then
      missing+=("$variable_name")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    echo "Worker activation stopped. Add these values to an ignored local env file:" >&2
    printf '  %s\n' "${missing[@]}" >&2
    echo "Then rerun this command. Credentials were not requested or displayed." >&2
    exit 78
  fi

  umask 077
  {
    printf 'NEXT_PUBLIC_SUPABASE_URL=%q\n' "$NEXT_PUBLIC_SUPABASE_URL"
    printf 'SUPABASE_SERVICE_ROLE_KEY=%q\n' "$SUPABASE_SERVICE_ROLE_KEY"
    printf 'EBAY_CLIENT_ID=%q\n' "$EBAY_CLIENT_ID"
    printf 'EBAY_CLIENT_SECRET=%q\n' "$EBAY_CLIENT_SECRET"
    printf 'MARKET_INTEL_WORKER_NAME=%q\n' 'mac-private-worker'
    printf 'MARKET_INTEL_WORKER_MAX_SUBJECTS=%q\n' '3'
    printf 'MARKET_INTEL_WORKER_MAX_IDENTITIES=%q\n' '4'
    printf 'MARKET_INTEL_WORKER_MAX_QUERIES=%q\n' '8'
    printf 'MARKET_INTEL_WORKER_RESULTS_PER_QUERY=%q\n' '5'
    printf 'MARKET_INTEL_WORKER_MINIMUM_CONFIDENCE=%q\n' '55'
    printf 'MARKET_INTEL_WORKER_INTERVAL_MINUTES=%q\n' "$MINUTES"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

load_env_file "$ENV_FILE"
for variable_name in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY EBAY_CLIENT_ID EBAY_CLIENT_SECRET; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "Required worker setting is missing from $ENV_FILE: $variable_name" >&2
    exit 78
  fi
done
export MARKET_INTEL_WORKER_INTERVAL_MINUTES="$MINUTES"

if [[ ! -d node_modules || ! -e node_modules/.bin/tsx ]]; then
  echo "Installing repository dependencies with npm ci..."
  npm ci
fi

echo "Running Identity Proof Gate simulations..."
node --import tsx scripts/run-market-intel-identity-proof-simulations.ts

if (( SKIP_MIGRATION == 0 )); then
  if [[ ! -f supabase/config.toml ]]; then
    echo "Initializing Supabase CLI configuration..."
    npx --yes supabase init
  fi
  if [[ -z "$PROJECT_REF" ]]; then
    read -r -p "Supabase project reference (from dashboard URL): " PROJECT_REF
  fi
  [[ -n "$PROJECT_REF" ]] || {
    echo "A Supabase project reference is required unless --skip-migration is used." >&2
    exit 64
  }

  if ! npx --yes supabase projects list >/dev/null 2>&1; then
    echo "Supabase CLI login is required. Follow the secure CLI prompt."
    npx --yes supabase login
  fi
  echo "Linking this repository to Supabase project $PROJECT_REF..."
  npx --yes supabase link --project-ref "$PROJECT_REF"
  echo "Current local/remote migration status:"
  npx --yes supabase migration list

  mkdir -p .codex-run
  DRY_RUN_LOG="$REPO_ROOT/.codex-run/market-intel-supabase-dry-run.log"
  echo "Previewing every pending migration. Nothing is applied during this step."
  npx --yes supabase db push --dry-run | tee "$DRY_RUN_LOG"
  echo
  echo "IMPORTANT: db push applies ALL pending migrations shown above, not only Identity Proof Gate."
  read -r -p "Type APPLY to deploy the displayed pending migrations, or anything else to stop: " MIGRATION_CONFIRM
  if [[ "$MIGRATION_CONFIRM" != "APPLY" ]]; then
    echo "Stopped before database changes. Dry-run saved at: $DRY_RUN_LOG"
    exit 0
  fi
  npx --yes supabase db push
else
  echo "Skipping Supabase migration by request. The candidate queue must already be installed."
fi

echo "Validating Supabase queue access and eBay OAuth without running a marketplace search..."
node --import tsx scripts/preflight-market-intel-worker.ts

echo "Running one live Profit Hunter worker cycle..."
MARKET_INTEL_WORKER_ENV_FILE="$ENV_FILE" MARKET_INTEL_NODE_BIN="$(command -v node)" \
  zsh scripts/run-market-intel-worker-cycle.sh

if (( SKIP_INSTALL == 1 )); then
  echo "Validation and live cycle passed. launchd installation was skipped by request."
  exit 0
fi

echo "Installing the private Mac worker every $MINUTES minutes..."
node scripts/install-market-intel-worker-launchd.mjs --minutes "$MINUTES" --env-file "$ENV_FILE"
echo
node scripts/status-market-intel-worker-launchd.mjs

echo
cat <<'EOF'
MAC WORKER ACTIVATION COMPLETE

After staged candidates are visible and reviewed:
  Set MARKET_INTEL_SEARCH_EXECUTION=external in Vercel.
  Disable any duplicate cron-job.org call targeting Vercel Hot Watch.

Run only one search executor: Mac or online worker, never both.
EOF
