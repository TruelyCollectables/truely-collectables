#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_SHA:?}"
: "${VERCEL_TOKEN:?}"
: "${VERCEL_SCOPE:?}"
: "${EVIDENCE_DIR:?}"

mkdir -p "$EVIDENCE_DIR"
RUNTIME_URL=""
cleanup() {
  set +e
  if [[ -n "$RUNTIME_URL" ]]; then
    npx vercel@56.2.0 remove "$RUNTIME_URL" --yes --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" > "$EVIDENCE_DIR/runtime-removal.txt" 2>&1
  fi
}
trap cleanup EXIT

git fetch origin main
test "$(git rev-parse origin/main)" = "$SOURCE_SHA"
git checkout --detach "$SOURCE_SHA"
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
git diff --quiet

mkdir -p .vercel
if [[ -n "${VERCEL_ORG_ID:-}" && -n "${VERCEL_PROJECT_ID:-}" ]]; then
  printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > .vercel/project.json
else
  npx vercel@56.2.0 link --yes --project truely-collectables --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN"
fi

DIAGNOSTIC_TOKEN="$(openssl rand -hex 32)"
echo "::add-mask::$DIAGNOSTIC_TOKEN"
mkdir -p src/app/api/internal/final-integration-diagnostics-20260729
cat > src/app/api/internal/final-integration-diagnostics-20260729/route.js <<'ROUTE'
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

function equal(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ""), "utf8");
  const right = Buffer.from(String(rightValue || ""), "utf8");
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function safe(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(refresh_token|access_token|client_secret|api_key)[=:]\s*[^\s,}]+/gi, "$1=[REDACTED]")
    .replace(/re_[A-Za-z0-9_-]{12,}/g, "[REDACTED_RESEND_KEY]")
    .slice(0, 1000);
}

function reply(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function resendDiagnostic() {
  const configured = Boolean(process.env.RESEND_API_KEY);
  if (!configured) {
    return { configured: false, httpStatus: null, ok: false, verifiedDomain: false, domains: [], errorCode: "KEY_UNAVAILABLE", errorMessage: "RESEND_API_KEY is unavailable." };
  }
  try {
    const response = await fetch("https://api.resend.com/domains", {
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    const domains = Array.isArray(json.data)
      ? json.data.map((domain) => ({ name: String(domain.name || ""), status: String(domain.status || ""), region: domain.region ? String(domain.region) : null }))
      : [];
    const verifiedDomain = domains.some((domain) => /(^|\.)truelycollectables\.com$/i.test(domain.name) && domain.status === "verified");
    return {
      configured: true,
      httpStatus: response.status,
      ok: response.ok,
      verifiedDomain,
      domains,
      errorCode: response.ok ? null : safe(json.name || json.code || "RESEND_API_ERROR"),
      errorMessage: response.ok ? null : safe(json.message || text || `Resend returned HTTP ${response.status}.`),
    };
  } catch (error) {
    return { configured: true, httpStatus: null, ok: false, verifiedDomain: false, domains: [], errorCode: "REQUEST_FAILED", errorMessage: safe(error?.message || error) };
  }
}

async function ebayDiagnostic() {
  const secret = String(process.env.CRON_SECRET || "");
  if (secret.length < 16) {
    return { configured: false, httpStatus: null, ok: false, success: false, error: "CRON_SECRET is unavailable." };
  }
  try {
    const response = await fetch("https://truelycollectables.com/api/cron/ebay-store-fixed-price-sync", {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const text = await response.text();
    let receipt = {};
    try { receipt = text ? JSON.parse(text) : {}; } catch { receipt = {}; }
    const success = response.status === 200 && receipt.success === true;
    return {
      configured: true,
      httpStatus: response.status,
      ok: response.ok,
      success,
      schema: receipt.schema || null,
      postSaleProtectionAvailable: receipt.postSaleProtectionAvailable === true,
      matchesEligibleEbayInventory: receipt.databaseAudit?.matchesEligibleEbayInventory === true,
      warningCount: Array.isArray(receipt.warnings) ? receipt.warnings.length : 0,
      errorCount: Array.isArray(receipt.errors) ? receipt.errors.length : 0,
      remoteFixedPriceTotal: receipt.authoritative?.remoteFixedPriceTotal ?? receipt.remoteFixedPriceTotal ?? null,
      representedInventoryRows: receipt.authoritative?.representedInventoryRows ?? receipt.representedInventoryRows ?? null,
      error: success ? null : safe(receipt.error || receipt.message || text || `Protected eBay sync returned HTTP ${response.status}.`),
    };
  } catch (error) {
    return { configured: true, httpStatus: null, ok: false, success: false, error: safe(error?.message || error) };
  }
}

export async function POST(request) {
  if (!equal(request.headers.get("x-tcos-final-integration-token"), process.env.TCOS_FINAL_INTEGRATION_TOKEN)) {
    return reply({ ok: false, code: "UNAUTHORIZED" }, 401);
  }
  const [resend, ebay] = await Promise.all([resendDiagnostic(), ebayDiagnostic()]);
  return reply({
    ok: true,
    sourceSha: process.env.TCOS_DIAGNOSTIC_SOURCE_SHA || null,
    environment: process.env.VERCEL_ENV || null,
    checkedAt: new Date().toISOString(),
    resend,
    ebay,
  });
}
ROUTE

git diff --check
npx vercel@56.2.0 deploy --prod --yes --force --skip-domain \
  --meta "launchSourceSha=$SOURCE_SHA" \
  --meta "launchPurpose=final-resend-ebay-diagnostics" \
  --env "TCOS_FINAL_INTEGRATION_TOKEN=$DIAGNOSTIC_TOKEN" \
  --env "TCOS_DIAGNOSTIC_SOURCE_SHA=$SOURCE_SHA" \
  --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" \
  2>&1 | tee "$EVIDENCE_DIR/deployment.log"
RUNTIME_URL="$(grep -Eo 'https://[^[:space:]]+\.vercel\.app' "$EVIDENCE_DIR/deployment.log" | head -n 1)"
test -n "$RUNTIME_URL"
printf '%s\n' "$RUNTIME_URL" > "$EVIDENCE_DIR/deployment-url.txt"

endpoint="$RUNTIME_URL/api/internal/final-integration-diagnostics-20260729"
unauthorized="$(curl --silent --show-error --output "$EVIDENCE_DIR/unauthorized.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --data '{}' "$endpoint")"
test "$unauthorized" = "401"
code="$(curl --silent --show-error --connect-timeout 15 --max-time 320 --output "$EVIDENCE_DIR/diagnostics.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --header "x-tcos-final-integration-token: $DIAGNOSTIC_TOKEN" --data '{}' "$endpoint")"
test "$code" = "200"

node - <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(`${process.env.EVIDENCE_DIR}/diagnostics.json`, 'utf8'));
if (value.ok !== true) throw new Error('Diagnostic route did not complete.');
if (value.sourceSha !== process.env.SOURCE_SHA) throw new Error('Diagnostic source SHA mismatch.');
if (value.environment !== 'production') throw new Error('Diagnostic deployment is not Production-targeted.');
const ebayPassed = value.ebay?.success === true && value.ebay?.schema === 'truelycollectables.ebayStoreFixedPriceSyncReceipt.v3' && value.ebay?.postSaleProtectionAvailable === true && value.ebay?.matchesEligibleEbayInventory === true && Number(value.ebay?.errorCount || 0) === 0;
const resendPassed = value.resend?.ok === true && value.resend?.verifiedDomain === true;
fs.writeFileSync(`${process.env.EVIDENCE_DIR}/summary.json`, JSON.stringify({ sourceSha: value.sourceSha, checkedAt: value.checkedAt, ebayPassed, resendPassed, ebay: value.ebay, resend: value.resend }, null, 2));
fs.writeFileSync(`${process.env.EVIDENCE_DIR}/summary.md`, [
  '# Final integration diagnostics',
  '',
  `- Source SHA: ${value.sourceSha}`,
  `- eBay protected Production integration: ${ebayPassed ? 'PASSED' : 'BLOCKED'}`,
  `- Resend verified-domain proof: ${resendPassed ? 'PASSED' : 'BLOCKED'}`,
  `- Resend HTTP status: ${value.resend?.httpStatus ?? 'none'}`,
  `- Resend error code: ${value.resend?.errorCode ?? 'none'}`,
  `- Resend domains: ${(value.resend?.domains || []).map((domain) => `${domain.name} (${domain.status})`).join(', ') || 'none returned'}`,
  `- eBay receipt schema: ${value.ebay?.schema ?? 'none'}`,
  `- eBay warnings/errors: ${value.ebay?.warningCount ?? 0}/${value.ebay?.errorCount ?? 0}`,
].join('\n') + '\n');
if (!ebayPassed || !resendPassed) process.exit(1);
NODE

rm -rf src/app/api/internal/final-integration-diagnostics-20260729
git diff --exit-code
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
