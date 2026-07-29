#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_SHA:?}"
: "${PRIOR_AUDIT_RUN_ID:?}"
: "${PRIOR_AUDIT_HEAD_SHA:?}"
: "${OPS_BRANCH:?}"
: "${VERCEL_TOKEN:?}"
: "${VERCEL_SCOPE:?}"
: "${GH_SUPABASE_ACCESS_TOKEN:?}"
: "${GITHUB_TOKEN:?}"
: "${GITHUB_REPOSITORY:?}"
: "${EVIDENCE_DIR:?}"

mkdir -p "$EVIDENCE_DIR"
echo "::add-mask::$GH_SUPABASE_ACCESS_TOKEN"
printf '%s\n' "$SOURCE_SHA" > "$EVIDENCE_DIR/source-sha.txt"
RUNTIME_URL=""

cleanup() {
  set +e
  if [[ -n "$RUNTIME_URL" ]]; then
    npx vercel@56.2.0 remove "$RUNTIME_URL" --yes --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" > "$EVIDENCE_DIR/runtime-deployment-removal.txt" 2>&1
  fi
}
trap cleanup EXIT

git fetch origin main "$OPS_BRANCH"
test "$(git rev-parse origin/main)" = "$SOURCE_SHA"

api="https://api.github.com/repos/$GITHUB_REPOSITORY"
headers=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
curl --fail --silent --show-error "${headers[@]}" "$api/actions/runs/$PRIOR_AUDIT_RUN_ID" > "$EVIDENCE_DIR/prior-run.json"
curl --fail --silent --show-error "${headers[@]}" "$api/actions/runs/$PRIOR_AUDIT_RUN_ID/jobs?per_page=100" > "$EVIDENCE_DIR/prior-jobs.json"
curl --fail --silent --show-error "${headers[@]}" "$api/pulls/205" > "$EVIDENCE_DIR/prior-pr.json"
jq -e --arg sha "$PRIOR_AUDIT_HEAD_SHA" '.head_sha == $sha' "$EVIDENCE_DIR/prior-run.json" > /dev/null
jq -e --arg source "$SOURCE_SHA" --arg head "$PRIOR_AUDIT_HEAD_SHA" '.base.sha == $source and .head.sha == $head' "$EVIDENCE_DIR/prior-pr.json" > /dev/null
required=(
  "Repository inventory and source security"
  "Dependencies, lint, TypeScript, and production build"
  "API route and privilege audit"
  "Live Production crawl and access checks"
  "Simulation shard 0"
  "Simulation shard 1"
  "Simulation shard 2"
  "Simulation shard 3"
  "Simulation shard 4"
  "Simulation shard 5"
)
for name in "${required[@]}"; do
  jq -e --arg name "$name" '.jobs[] | select(.name == $name and .conclusion == "success")' "$EVIDENCE_DIR/prior-jobs.json" > /dev/null
done
jq -n --arg run "$PRIOR_AUDIT_RUN_ID" --arg audit "$PRIOR_AUDIT_HEAD_SHA" --arg source "$SOURCE_SHA" --argjson gates "$(printf '%s\n' "${required[@]}" | jq -R . | jq -s .)" '{runId:($run|tonumber),auditHeadSha:$audit,sourceSha:$source,successfulGates:$gates}' > "$EVIDENCE_DIR/immutable-prior-gates.json"

git checkout --detach "$SOURCE_SHA"
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
git diff --quiet

mkdir -p .vercel
if [[ -n "${VERCEL_ORG_ID:-}" && -n "${VERCEL_PROJECT_ID:-}" ]]; then
  printf '{"orgId":"%s","projectId":"%s"}\n' "$VERCEL_ORG_ID" "$VERCEL_PROJECT_ID" > .vercel/project.json
else
  npx vercel@56.2.0 link --yes --project truely-collectables --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN"
fi
npx vercel@56.2.0 whoami --token "$VERCEL_TOKEN" > "$EVIDENCE_DIR/vercel-identity.txt"

npx vercel@56.2.0 deploy --prod --yes --force \
  --meta "launchSourceSha=$SOURCE_SHA" \
  --meta "launchPurpose=final-launch-certificate-v2-script" \
  --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" \
  2>&1 | tee "$EVIDENCE_DIR/clean-production-deploy.log"
CLEAN_URL="$(grep -Eo 'https://[^[:space:]]+\.vercel\.app' "$EVIDENCE_DIR/clean-production-deploy.log" | tail -n 1)"
test -n "$CLEAN_URL"
printf '%s\n' "$CLEAN_URL" > "$EVIDENCE_DIR/clean-production-url.txt"

for label in deployment custom; do
  if [[ "$label" == deployment ]]; then base="$CLEAN_URL"; else base="https://truelycollectables.com"; fi
  for path in / /shop /cart /account/signup /account/login /shipping /returns /buyer-protection; do
    code="$(curl --location --silent --show-error --connect-timeout 15 --max-time 90 --output "$EVIDENCE_DIR/${label}-${path//\//-}.html" --write-out '%{http_code}' "$base$path")"
    test "$code" = "200"
  done
  admin_code="$(curl --silent --show-error --output "$EVIDENCE_DIR/${label}-admin.html" --write-out '%{http_code}' "$base/admin")"
  login_code="$(curl --location --silent --show-error --output "$EVIDENCE_DIR/${label}-admin-login.html" --write-out '%{http_code}' "$base/admin/login")"
  test "$admin_code" = "307"
  test "$login_code" = "200"
  grep -Fq 'Admin Login' "$EVIDENCE_DIR/${label}-admin-login.html"
  grep -Fq 'id="shop-search"' "$EVIDENCE_DIR/${label}--shop.html"
  grep -Fq 'for="shop-search"' "$EVIDENCE_DIR/${label}--shop.html"
  ! grep -Fq 'aria-label="Truely Collectables home"' "$EVIDENCE_DIR/${label}--shop.html"
done
grep -Eiq '<link[^>]+rel="canonical"[^>]+href="https://truelycollectables.com/cart"' "$EVIDENCE_DIR/custom--cart.html"
grep -Eiq '<meta[^>]+name="robots"[^>]+content="noindex, nofollow"' "$EVIDENCE_DIR/custom--cart.html"
grep -Eiq '<link[^>]+rel="canonical"[^>]+href="https://truelycollectables.com/account/signup"' "$EVIDENCE_DIR/custom--account-signup.html"
grep -Eiq '<meta[^>]+name="robots"[^>]+content="noindex, nofollow"' "$EVIDENCE_DIR/custom--account-signup.html"

RUNTIME_TOKEN="$(openssl rand -hex 32)"
echo "::add-mask::$RUNTIME_TOKEN"
git show "origin/$OPS_BRANCH:.github/workflows/final-launch-certificate-v2-20260729.yml" > /tmp/original-final-workflow.yml
mkdir -p src/app/api/internal/final-launch-audit-v2
awk '
  /cat > src\/app\/api\/internal\/final-launch-audit-v2\/route.js <<.ROUTE./ { capture=1; next }
  capture && /^          ROUTE$/ { exit }
  capture { sub(/^          /, ""); print }
' /tmp/original-final-workflow.yml > src/app/api/internal/final-launch-audit-v2/route.js
grep -Fq 'export async function POST' src/app/api/internal/final-launch-audit-v2/route.js
python - <<'PY'
from pathlib import Path
path = Path('src/app/api/internal/final-launch-audit-v2/route.js')
text = path.read_text()
old = '''            const requiredEnv = [
              "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_LIVE_SECRET_KEY",
              "RESEND_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SUPABASE_ACCESS_TOKEN",
            ];
            for (const name of requiredEnv) {
              if (!process.env[name]) add("blocker", "runtime-environment", `${name} is unavailable inside the Production runtime.`);
            }
'''
new = '''            const requiredEnv = [
              "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
              "RESEND_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SUPABASE_ACCESS_TOKEN",
            ];
            for (const name of requiredEnv) {
              if (!process.env[name]) add("blocker", "runtime-environment", `${name} is unavailable inside the Production runtime.`);
            }
            const liveStripeCandidate = String(process.env.STRIPE_LIVE_SECRET_KEY || "").startsWith("sk_live_") || String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_");
            if (!liveStripeCandidate) add("blocker", "runtime-environment", "No live Stripe secret is available inside the Production runtime.");
'''
if text.count(old) != 1:
    raise SystemExit('Expected runtime environment block was not found exactly once')
path.write_text(text.replace(old, new, 1))
PY
git diff --check

npx vercel@56.2.0 deploy --prod --yes --force --skip-domain \
  --meta "launchSourceSha=$SOURCE_SHA" \
  --meta "launchPurpose=final-certificate-runtime-audit-script" \
  --env "TCOS_FINAL_AUDIT_TOKEN=$RUNTIME_TOKEN" \
  --env "TCOS_AUDIT_SOURCE_SHA=$SOURCE_SHA" \
  --env "SUPABASE_ACCESS_TOKEN=$GH_SUPABASE_ACCESS_TOKEN" \
  --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" \
  2>&1 | tee "$EVIDENCE_DIR/runtime-deployment.log"
RUNTIME_URL="$(grep -Eo 'https://[^[:space:]]+\.vercel\.app' "$EVIDENCE_DIR/runtime-deployment.log" | head -n 1)"
test -n "$RUNTIME_URL"
printf '%s\n' "$RUNTIME_URL" > "$EVIDENCE_DIR/runtime-deployment-url.txt"

endpoint="$RUNTIME_URL/api/internal/final-launch-audit-v2"
unauthorized="$(curl --silent --show-error --output "$EVIDENCE_DIR/runtime-unauthorized.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --data '{}' "$endpoint")"
test "$unauthorized" = "401"
code="$(curl --silent --show-error --connect-timeout 15 --max-time 300 --output "$EVIDENCE_DIR/runtime-response.json" --write-out '%{http_code}' --request POST --header 'Content-Type: application/json' --header "x-tcos-final-audit-token: $RUNTIME_TOKEN" --data '{}' "$endpoint")"
test "$code" = "200"
node - <<'NODE'
const fs = require('node:fs');
const response = JSON.parse(fs.readFileSync(`${process.env.EVIDENCE_DIR}/runtime-response.json`, 'utf8'));
if (response.ok !== true || !response.result) throw new Error('Production runtime audit did not return a result.');
if (response.result.sourceSha !== process.env.SOURCE_SHA) throw new Error('Runtime audit source SHA mismatch.');
if (response.result.environment !== 'production') throw new Error('Runtime audit was not Production-targeted.');
const blockers = (response.result.findings || []).filter((finding) => finding.severity === 'blocker');
fs.writeFileSync(`${process.env.EVIDENCE_DIR}/runtime-integrations-audit.json`, JSON.stringify(response.result, null, 2));
fs.writeFileSync(`${process.env.EVIDENCE_DIR}/runtime-integrations-audit.md`, '# Production runtime integrations\n\n' + (response.result.findings || []).map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.area}: ${finding.message}`).join('\n') + '\n');
if (blockers.length) throw new Error(`Production runtime audit has ${blockers.length} blocker(s).`);
NODE

rm -rf src/app/api/internal/final-launch-audit-v2
git diff --exit-code
test "$(git rev-parse HEAD)" = "$SOURCE_SHA"

mkdir -p "$EVIDENCE_DIR/lighthouse"
urls=("https://truelycollectables.com/" "https://truelycollectables.com/shop" "https://truelycollectables.com/account/signup" "https://truelycollectables.com/cart")
names=(home shop signup cart)
for index in "${!urls[@]}"; do
  npx --yes lighthouse@12.8.2 "${urls[$index]}" --only-categories=performance,accessibility,best-practices,seo --output=json --output-path="$EVIDENCE_DIR/lighthouse/${names[$index]}.json" --chrome-flags="--headless --no-sandbox --disable-gpu" --quiet
done
node - <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const dir = `${process.env.EVIDENCE_DIR}/lighthouse`;
const rows = [];
for (const page of ['home', 'shop', 'signup', 'cart']) {
  const report = JSON.parse(fs.readFileSync(path.join(dir, `${page}.json`), 'utf8'));
  const mismatch = report.audits['label-content-name-mismatch'];
  const row = { page, performance: Math.round((report.categories.performance?.score || 0) * 100), accessibility: Math.round((report.categories.accessibility?.score || 0) * 100), bestPractices: Math.round((report.categories['best-practices']?.score || 0) * 100), seo: Math.round((report.categories.seo?.score || 0) * 100), canonical: report.audits.canonical?.score, crawlable: report.audits['is-crawlable']?.score, selectName: report.audits['select-name']?.score ?? null, labelMismatchScore: mismatch?.score ?? null, labelMismatchFindings: mismatch?.details?.items?.length ?? 0 };
  if (row.accessibility < 90 || row.bestPractices < 85 || row.canonical !== 1) throw new Error(`${page} Lighthouse quality gate failed.`);
  if (['home', 'shop'].includes(page)) { if (row.seo < 90 || row.crawlable !== 1) throw new Error(`${page} public SEO/crawlability failed.`); }
  else if (row.crawlable !== 0) throw new Error(`${page} must remain intentionally non-crawlable.`);
  if (page === 'shop' && row.selectName !== 1) throw new Error('Shop select-name failed.');
  if (!(row.labelMismatchScore === 1 || (row.labelMismatchScore === null && row.labelMismatchFindings === 0))) throw new Error(`${page} visible-label mismatch failed.`);
  rows.push(row);
}
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ rows }, null, 2));
fs.writeFileSync(path.join(dir, 'summary.md'), '# Corrected Lighthouse summary\n\n' + rows.map((row) => `- ${row.page}: Performance ${row.performance}, Accessibility ${row.accessibility}, Best Practices ${row.bestPractices}, SEO ${row.seo}, canonical ${row.canonical}, crawlable ${row.crawlable}`).join('\n') + '\n');
NODE

npx vercel@56.2.0 inspect https://truelycollectables.com --scope "$VERCEL_SCOPE" --token "$VERCEL_TOKEN" > "$EVIDENCE_DIR/vercel-production-inspect.txt"
grep -Fq 'production' "$EVIDENCE_DIR/vercel-production-inspect.txt"
grep -Fq 'Ready' "$EVIDENCE_DIR/vercel-production-inspect.txt"

node - <<'NODE'
const fs = require('node:fs');
const prior = JSON.parse(fs.readFileSync(`${process.env.EVIDENCE_DIR}/immutable-prior-gates.json`, 'utf8'));
const runtime = JSON.parse(fs.readFileSync(`${process.env.EVIDENCE_DIR}/runtime-integrations-audit.json`, 'utf8'));
const lighthouse = JSON.parse(fs.readFileSync(`${process.env.EVIDENCE_DIR}/lighthouse/summary.json`, 'utf8'));
const blockers = runtime.findings.filter((finding) => finding.severity === 'blocker');
if (blockers.length) throw new Error('Cannot issue verified certificate with runtime blockers.');
const certificate = { schema: 'truely.collectables.full-launch-audit.v2', generatedAt: new Date().toISOString(), sourceSha: process.env.SOURCE_SHA, overall: 'verified', exactProductionDeployment: true, sourceSecretScan: 'passed', dependencyLintTypeScriptBuild: 'passed', privilegedRoutes: 'passed', simulationShards: 6, liveProductionCrawl: 'passed', runtimeIntegrations: 'passed', lighthouse: 'passed', priorEvidence: prior, runtimeSummary: { findings: runtime.findings.length, blockers: 0, warnings: runtime.findings.filter((finding) => finding.severity === 'warning').length, stripe: runtime.stripeSummary, resend: runtime.resendSummary, ebay: runtime.ebaySummary, databaseSafety: runtime.databaseSafety }, lighthouseSummary: lighthouse.rows, unverifiedByDesign: ['A controlled real-money charge has not been completed by this audit.', 'Physical postage purchase, carrier acceptance, and delivery have not been completed by this audit.', 'A real refund and dispute have not been manufactured by this audit.', 'Customer and owner inbox receipt has not been proven by this audit.'] };
fs.writeFileSync(`${process.env.EVIDENCE_DIR}/final-audit-certificate-v2.json`, JSON.stringify(certificate, null, 2));
fs.writeFileSync(`${process.env.EVIDENCE_DIR}/final-audit-certificate-v2.md`, '# Truely Collectables Launch 2.0 final Production certificate\n\n- Overall: **VERIFIED**\n- Source SHA: `' + certificate.sourceSha + '`\n- Exact Production deployment: passed\n- Source secret scan: passed\n- Dependencies, lint, TypeScript, Production build: passed\n- Privileged routes: passed\n- All six simulation shards: passed\n- Live Production crawl: passed\n- Production runtime integrations: passed\n- Corrected Lighthouse gates: passed\n\n## Kept separate from this certificate\n' + certificate.unverifiedByDesign.map((value) => `- ${value}`).join('\n') + '\n');
NODE
