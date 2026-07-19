#!/bin/zsh
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
  zsh scripts/bootstrap-market-intel-worker-macos.sh [options]

Options:
  --minutes N          Worker interval in minutes (default: 15; minimum: 5)
  --env-file PATH      Protected local worker env file
  --project-ref REF    Supabase project reference
  --skip-migration     Do not initialize/link/push Supabase migrations
  --skip-install       Run validation and one live cycle, but do not install launchd
  --help               Show this help

This script never deploys or merges the application and never sets Vercel variables.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --minutes)
      MINUTES="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="$(cd -- "$(dirname -- "${2:-}")" 2>/dev/null && pwd)/$(basename -- "${2:-}")"
      shift 2
      ;;
    --project-ref)
      PROJECT_REF="${2:-}"
      shift 2
      ;;
    --skip-migration)
      SKIP_MIGRATION=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This activation command is for macOS. Use the portable container deployment online." >&2
  exit 69
fi

if ! [[ "$MINUTES" =~ '^[0-9]+$' ]] || (( MINUTES < 5 || MINUTES > 1440 )); then
  echo "--minutes must be a whole number from 5 to 1440." >&2
  exit 64
fi

cd "$REPO_ROOT"

for command_name in node npm npx git zsh; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 69
  fi
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
  if [[ ! -f "$required_file" ]]; then
    echo "Required worker file is missing: $required_file" >&2
    exit 66
  fi
done

prompt_visible() {
  local variable_name="$1"
  local prompt_text="$2"
  local current_value="${(P)variable_name:-}"
  if [[ -n "$current_value" ]]; then
    return
  fi
  read -r "${variable_name}?${prompt_text}: "
}

prompt_secret() {
  local variable_name="$1"
  local prompt_text="$2"
  local current_value="${(P)variable_name:-}"
  if [[ -n "$current_value" ]]; then
    return
  fi
  read -rs "${variable_name}?${prompt_text} (hidden): "
  echo
}

if [[ -f "$ENV_FILE" ]]; then
  permissions="$(stat -f '%Lp' "$ENV_FILE")"
  if [[ "$permissions" != "600" ]]; then
    echo "Protecting existing worker environment file with chmod 600: $ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "Creating protected worker environment file: $ENV_FILE"
  prompt_visible NEXT_PUBLIC_SUPABASE_URL "Supabase project URL"
  prompt_secret SUPABASE_SERVICE_ROLE_KEY "Supabase service-role key"
  prompt_visible EBAY_CLIENT_ID "eBay production client ID"
  prompt_secret EBAY_CLIENT_SECRET "eBay production client secret"

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

set -a
source "$ENV_FILE"
set +a

for variable_name in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY EBAY_CLIENT_ID EBAY_CLIENT_SECRET; do
  if [[ -z "${(P)variable_name:-}" ]]; then
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
    read -r "PROJECT_REF?Supabase project reference (from dashboard URL): "
  fi
  if [[ -z "$PROJECT_REF" ]]; then
    echo "A Supabase project reference is required unless --skip-migration is used." >&2
    exit 64
  fi

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
  read -r "MIGRATION_CONFIRM?Type APPLY to deploy the displayed pending migrations, or anything else to stop: "
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
node scripts/install-market-intel-worker-launchd.mjs \
  --minutes "$MINUTES" \
  --env-file "$ENV_FILE"

echo
echo "Worker status:"
node scripts/status-market-intel-worker-launchd.mjs

echo
cat <<'EOF'
MAC WORKER ACTIVATION COMPLETE

Next controlled production step, only after reviewing staged candidates:
  Set MARKET_INTEL_SEARCH_EXECUTION=external in Vercel.
  Disable any duplicate cron-job.org call targeting the Vercel Hot Watch route.

Do not run a Mac worker and an online worker at the same time. The same worker can later move to the provider-neutral container without changing Profit Hunter or Supabase data.
EOF
