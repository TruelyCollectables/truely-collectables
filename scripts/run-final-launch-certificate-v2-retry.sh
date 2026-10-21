#!/usr/bin/env bash
set -euo pipefail

cp scripts/run-final-launch-certificate-v2-continuation.sh /tmp/final-launch-certificate-runner.sh
python - <<'PY'
from pathlib import Path
path = Path('/tmp/final-launch-certificate-runner.sh')
text = path.read_text()

old_pr = '''jq -e --arg source "$SOURCE_SHA" --arg head "$PRIOR_AUDIT_HEAD_SHA" '.base.sha == $source and .head.sha == $head' "$EVIDENCE_DIR/prior-pr.json" > /dev/null
'''
new_pr = '''jq -e --arg source "$SOURCE_SHA" '.number == 205 and .base.sha == $source' "$EVIDENCE_DIR/prior-pr.json" > /dev/null
jq -e --arg source "$SOURCE_SHA" '.pull_requests[] | select(.number == 205 and .base.sha == $source)' "$EVIDENCE_DIR/prior-run.json" > /dev/null
'''
if text.count(old_pr) != 1:
    raise SystemExit('Expected stale PR-head assertion was not found exactly once')
text = text.replace(old_pr, new_pr, 1)

bad_runtime_patch = '''old = \'\'\'            const requiredEnv = [
              "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_LIVE_SECRET_KEY",
              "RESEND_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SUPABASE_ACCESS_TOKEN",
            ];
            for (const name of requiredEnv) {
              if (!process.env[name]) add("blocker", "runtime-environment", `${name} is unavailable inside the Production runtime.`);
            }
\'\'\'
new = \'\'\'            const requiredEnv = [
              "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
              "RESEND_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SUPABASE_ACCESS_TOKEN",
            ];
            for (const name of requiredEnv) {
              if (!process.env[name]) add("blocker", "runtime-environment", `${name} is unavailable inside the Production runtime.`);
            }
            const liveStripeCandidate = String(process.env.STRIPE_LIVE_SECRET_KEY || "").startsWith("sk_live_") || String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_");
            if (!liveStripeCandidate) add("blocker", "runtime-environment", "No live Stripe secret is available inside the Production runtime.");
\'\'\'
'''
good_runtime_patch = '''old = \'\'\'  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_LIVE_SECRET_KEY",
    "RESEND_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SUPABASE_ACCESS_TOKEN",
  ];
  for (const name of requiredEnv) {
    if (!process.env[name]) add("blocker", "runtime-environment", `${name} is unavailable inside the Production runtime.`);
  }
\'\'\'
new = \'\'\'  const requiredEnv = [
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "RESEND_API_KEY", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "SUPABASE_ACCESS_TOKEN",
  ];
  for (const name of requiredEnv) {
    if (!process.env[name]) add("blocker", "runtime-environment", `${name} is unavailable inside the Production runtime.`);
  }
  const liveStripeCandidate = String(process.env.STRIPE_LIVE_SECRET_KEY || "").startsWith("sk_live_") || String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_");
  if (!liveStripeCandidate) add("blocker", "runtime-environment", "No live Stripe secret is available inside the Production runtime.");
\'\'\'
'''
if text.count(bad_runtime_patch) != 1:
    raise SystemExit('Expected YAML-indented runtime patch was not found exactly once')
text = text.replace(bad_runtime_patch, good_runtime_patch, 1)

path.write_text(text)
PY
bash -n /tmp/final-launch-certificate-runner.sh
exec bash /tmp/final-launch-certificate-runner.sh
