from pathlib import Path
import subprocess
import sys

AUDIT_HEAD = "7ecba5b5444730793df45a6d64498a227bff7b96"
AUDIT_BLOB = "ae98844b75bb5a9cee161a91b69e4075f9234c1a"

root = Path(sys.argv[1]).resolve()
workflow = root / ".github/workflows/ops-truely-full-launch-audit-20260729.yml"
head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
blob = subprocess.check_output(["git", "-C", str(root), "hash-object", str(workflow)], text=True).strip()
if head != AUDIT_HEAD:
    raise SystemExit(f"Audit head moved: {head}")
if blob != AUDIT_BLOB:
    raise SystemExit(f"Audit workflow blob moved: {blob}")

source = workflow.read_text()
old = '''      - name: Run read-only Production integration and data audit
        shell: bash
        run: |
          set +e
          unset_keys=(
            NEXT_PUBLIC_SUPABASE_URL
            NEXT_PUBLIC_SUPABASE_ANON_KEY
            SUPABASE_SERVICE_ROLE_KEY
            STRIPE_SECRET_KEY
            NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
            STRIPE_WEBHOOK_SECRET
            EBAY_CLIENT_ID
            EBAY_CLIENT_SECRET
            EBAY_ENVIRONMENT
            TCOS_LIVE_PAYMENTS_ENABLED
          )
          unset_args=()
          for key in "${unset_keys[@]}"; do
            unset_args+=("-u" "$key")
          done
          env "${unset_args[@]}" node --env-file=.audit-production.env - <<'NODE'
          const fs = require('fs');
          const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
          const presence = Object.fromEntries(required.map((key) => [key, Boolean(process.env[key])]));
          fs.writeFileSync('.audit/runtime/runtime-env-presence.json', JSON.stringify(presence, null, 2));
          if (required.some((key) => !process.env[key])) process.exit(1);
          NODE
          preflight_status=$?
          if [ "$preflight_status" -eq 0 ]; then
            env "${unset_args[@]}" node --env-file=.audit-production.env scripts/run-truely-launch-audit-20260729.mjs runtime
            status=$?
          else
            status="$preflight_status"
          fi
          set -e
          rm -f .audit-production.env
          exit "$status"
'''
new = '''      - name: Run read-only Production integration and data audit
        shell: bash
        run: |
          set -euo pipefail
          set -a
          source .audit-production.env
          set +a
          for key in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY STRIPE_LIVE_SECRET_KEY RESEND_API_KEY EBAY_CLIENT_ID EBAY_CLIENT_SECRET; do
            value="${!key:-}"
            test -n "$value"
            echo "::add-mask::$value"
          done
          node - <<'NODE'
          const fs = require('fs');
          const required = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
          const presence = Object.fromEntries(required.map((key) => [key, Boolean(process.env[key])]));
          fs.writeFileSync('.audit/runtime/runtime-env-presence.json', JSON.stringify(presence, null, 2));
          if (required.some((key) => !process.env[key])) process.exit(1);
          NODE
          set +e
          node scripts/run-truely-launch-audit-20260729.mjs runtime
          status=$?
          set -e
          rm -f .audit-production.env
          exit "$status"
'''
if source.count(old) != 1:
    raise SystemExit("Runtime launch anchor mismatch")
workflow.write_text(source.replace(old, new, 1))
subprocess.run(["git", "-C", str(root), "diff", "--check"], check=True)
changed = subprocess.check_output(["git", "-C", str(root), "diff", "--name-only"], text=True).strip()
if changed != ".github/workflows/ops-truely-full-launch-audit-20260729.yml":
    raise SystemExit(f"Unexpected changed files: {changed}")
print("Shell-source runtime audit repair prepared successfully.")
