#!/usr/bin/env bash
set -euo pipefail

mkdir -p .vercel .sync-private ebay-taxonomy-sync
ENV_FILE=""
LINK_STATUS="not_run"
PULL_STATUS="not_run"

cleanup_private() {
  if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    rm -f "$ENV_FILE"
  fi
  rm -rf .vercel .sync-private
}
trap cleanup_private EXIT

test -n "${VERCEL_TOKEN:-}"

if [ -n "${VERCEL_ORG_ID:-}" ] && [ -n "${VERCEL_PROJECT_ID:-}" ]; then
  printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > .vercel/project.json
  LINK_STATUS="ids"
else
  set +e
  npx vercel@56.2.0 link \
    --yes \
    --project truely-collectables \
    --scope "$VERCEL_SCOPE" \
    --token "$VERCEL_TOKEN" \
    > .sync-private/vercel-link.log 2>&1
  LINK_EXIT=$?
  set -e
  if [ "$LINK_EXIT" -ne 0 ]; then
    LINK_STATUS="failed"
    echo "[environment] Vercel project link failed." >&2
    tail -n 20 .sync-private/vercel-link.log >&2 || true
    exit 1
  fi
  LINK_STATUS="linked"
fi

set +e
npx vercel@56.2.0 pull \
  --yes \
  --environment=production \
  --scope "$VERCEL_SCOPE" \
  --token "$VERCEL_TOKEN" \
  > .sync-private/vercel-pull.log 2>&1
PULL_EXIT=$?
set -e
if [ "$PULL_EXIT" -ne 0 ]; then
  PULL_STATUS="failed"
  echo "[environment] Vercel Production environment pull failed." >&2
  tail -n 20 .sync-private/vercel-pull.log >&2 || true
  exit 1
fi
PULL_STATUS="success"

for candidate in \
  .vercel/.env.production.local \
  .env.production.local \
  .env.local; do
  if [ -f "$candidate" ]; then
    ENV_FILE="$candidate"
    break
  fi
done

if [ -z "$ENV_FILE" ]; then
  ENV_FILE="$(find .vercel . -maxdepth 2 -type f \( -name '.env.production.local' -o -name '.env.local' \) 2>/dev/null | head -n 1)"
fi

if [ -z "$ENV_FILE" ]; then
  echo "[environment] Vercel pull completed but no Production environment file was found." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

LINK_STATUS="$LINK_STATUS" \
PULL_STATUS="$PULL_STATUS" \
SUPABASE_URL_PRESENT="$([ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && printf true || printf false)" \
SUPABASE_ANON_PRESENT="$([ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ] && printf true || printf false)" \
SUPABASE_SERVICE_PRESENT="$([ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && printf true || printf false)" \
EBAY_CLIENT_ID_PRESENT="$([ -n "${EBAY_CLIENT_ID:-}" ] && printf true || printf false)" \
EBAY_CLIENT_SECRET_PRESENT="$([ -n "${EBAY_CLIENT_SECRET:-}" ] && printf true || printf false)" \
node <<'NODE'
const fs = require('node:fs');
const payload = {
  generatedAt: new Date().toISOString(),
  vercelLinkStatus: process.env.LINK_STATUS,
  vercelPullStatus: process.env.PULL_STATUS,
  supabaseUrlPresent: process.env.SUPABASE_URL_PRESENT === 'true',
  supabaseAnonKeyPresent: process.env.SUPABASE_ANON_PRESENT === 'true',
  supabaseServiceRolePresent: process.env.SUPABASE_SERVICE_PRESENT === 'true',
  ebayClientIdPresent: process.env.EBAY_CLIENT_ID_PRESENT === 'true',
  ebayClientSecretPresent: process.env.EBAY_CLIENT_SECRET_PRESENT === 'true',
};
fs.writeFileSync('ebay-taxonomy-sync/production-environment-preflight.json', `${JSON.stringify(payload, null, 2)}\n`);
console.log(`[environment] ${JSON.stringify(payload)}`);
NODE

for key in \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY \
  EBAY_CLIENT_ID \
  EBAY_CLIENT_SECRET; do
  if [ -z "${!key:-}" ]; then
    echo "[environment] Required Production variable ${key} is missing." >&2
    exit 1
  fi
done

node --import tsx scripts/run-production-ebay-taxonomy-sync.mjs
