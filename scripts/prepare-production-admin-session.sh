#!/usr/bin/env bash
set -euo pipefail

mkdir -p .vercel .sync-private ebay-taxonomy-sync
STATUS_FILE="ebay-taxonomy-sync/session-preflight.json"
SECRET_SOURCE="none"
ENV_FILE=""
PULL_STATUS="not_run"
LINK_STATUS="not_run"

write_status() {
  SESSION_SECRET_PRESENT="$([ -n "${ADMIN_SESSION_SECRET:-}" ] && printf true || printf false)" \
  ADMIN_PASSWORD_PRESENT="$([ -n "${ADMIN_PASSWORD:-}" ] && printf true || printf false)" \
  SECRET_SOURCE="$SECRET_SOURCE" \
  ENV_FILE_FOUND="$([ -n "$ENV_FILE" ] && printf true || printf false)" \
  PULL_STATUS="$PULL_STATUS" \
  LINK_STATUS="$LINK_STATUS" \
  node <<'NODE'
  const fs = require('node:fs');
  const payload = {
    generatedAt: new Date().toISOString(),
    githubAdminSessionSecretPresent: process.env.SESSION_SECRET_PRESENT === 'true',
    githubAdminPasswordPresent: process.env.ADMIN_PASSWORD_PRESENT === 'true',
    secretSource: process.env.SECRET_SOURCE,
    vercelEnvironmentFileFound: process.env.ENV_FILE_FOUND === 'true',
    vercelPullStatus: process.env.PULL_STATUS,
    vercelLinkStatus: process.env.LINK_STATUS,
  };
  fs.writeFileSync('ebay-taxonomy-sync/session-preflight.json', `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[session] ${JSON.stringify(payload)}`);
NODE
}

cleanup_private() {
  if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    rm -f "$ENV_FILE"
  fi
  rm -rf .vercel .sync-private
}
trap cleanup_private EXIT

if [ -n "${ADMIN_SESSION_SECRET:-}" ]; then
  SECRET_SOURCE="github_actions_secret"
else
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
      write_status
      echo "[session] Vercel project link failed. Last diagnostic lines:" >&2
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
    write_status
    echo "[session] Vercel Production environment pull failed. Last diagnostic lines:" >&2
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
    write_status
    echo "[session] Vercel pull completed but no Production environment file was found." >&2
    find .vercel . -maxdepth 2 -type f -name '.env*' -print >&2 || true
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  if [ -n "${ADMIN_SESSION_SECRET:-}" ]; then
    SECRET_SOURCE="vercel_production_environment"
  fi
fi

write_status

if [ -z "${ADMIN_SESSION_SECRET:-}" ]; then
  echo "[session] ADMIN_SESSION_SECRET is absent from both GitHub Actions and Vercel Production." >&2
  exit 1
fi

SESSION_VALUE="$(node <<'NODE'
const crypto = require('node:crypto');
const issuedAt = String(Math.floor(Date.now() / 1000));
const signature = crypto
  .createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
  .update(issuedAt)
  .digest('base64url');
process.stdout.write(`${issuedAt}.${signature}`);
NODE
)"

test -n "$SESSION_VALUE"
echo "::add-mask::$SESSION_VALUE"
printf 'ADMIN_SESSION_VALUE=%s\n' "$SESSION_VALUE" >> "$GITHUB_ENV"
echo "[session] One-run admin session generated successfully from ${SECRET_SOURCE}."
