from pathlib import Path

source = Path('/tmp/full-launch-audit.yml')
output = Path('ops-output/ops-truely-full-launch-audit-20260729.yml')
text = source.read_text(encoding='utf-8')

old_env = '''      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      VERCEL_SCOPE: truelycollectables-projects
'''
new_env = '''      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      VERCEL_SCOPE: truelycollectables-projects
      GH_SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
'''

old_runtime = '''      - name: Run read-only Production integration and data audit
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

new_runtime = '''      - name: Run read-only Production integration and data audit
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

          SERVICE_ROLE_SOURCE=vercel-production-environment
          SERVICE_ROLE_KEY="$(env "${unset_args[@]}" node --env-file=.audit-production.env -e 'process.stdout.write(process.env.SUPABASE_SERVICE_ROLE_KEY || "")')"
          service_status=$?
          if [ "$service_status" -ne 0 ] || [ -z "$SERVICE_ROLE_KEY" ]; then
            SERVICE_ROLE_SOURCE=supabase-management-api
            SERVICE_ROLE_KEY="$(env "${unset_args[@]}" node --env-file=.audit-production.env - <<'NODE'
          const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
          const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
          if (!url || !token) process.exit(1);
          const ref = new URL(url).hostname.split('.')[0];
          const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok) process.exit(1);
          const rows = await response.json();
          const key =
            rows.find((row) => row.name === 'service_role' && row.api_key)?.api_key ||
            rows.find((row) => row.type === 'secret' && row.api_key)?.api_key ||
            rows.find((row) => /service|secret/i.test(String(row.name || '')) && row.api_key)?.api_key ||
            '';
          if (!key) process.exit(1);
          process.stdout.write(key);
          NODE
            )"
            service_status=$?
          fi

          if [ "$service_status" -ne 0 ] || [ -z "$SERVICE_ROLE_KEY" ]; then
            node -e 'require("node:fs").writeFileSync(".audit/runtime/runtime-env-presence.json", JSON.stringify({NEXT_PUBLIC_SUPABASE_URL:true,SUPABASE_SERVICE_ROLE_KEY:false,serviceRoleSource:"unavailable"}, null, 2))'
            status=1
          else
            echo "::add-mask::$SERVICE_ROLE_KEY"
            env "${unset_args[@]}" SERVICE_ROLE_SOURCE="$SERVICE_ROLE_SOURCE" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node --env-file=.audit-production.env - <<'NODE'
          const fs = require('fs');
          const presence = {
            NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
            SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
            serviceRoleSource: process.env.SERVICE_ROLE_SOURCE || 'unknown',
          };
          fs.writeFileSync('.audit/runtime/runtime-env-presence.json', JSON.stringify(presence, null, 2));
          if (!presence.NEXT_PUBLIC_SUPABASE_URL || !presence.SUPABASE_SERVICE_ROLE_KEY) process.exit(1);
          NODE
            preflight_status=$?
            if [ "$preflight_status" -eq 0 ]; then
              env "${unset_args[@]}" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node --env-file=.audit-production.env scripts/run-truely-launch-audit-20260729.mjs runtime
              status=$?
            else
              status="$preflight_status"
            fi
          fi
          unset SERVICE_ROLE_KEY
          set -e
          rm -f .audit-production.env
          exit "$status"

'''

if text.count(old_env) != 1:
    raise SystemExit('Expected exactly one runtime Vercel environment block.')
if text.count('GH_SUPABASE_ACCESS_TOKEN:') != 0:
    raise SystemExit('Supabase Management API token is already wired or audit shape changed.')
if text.count(old_runtime) != 1:
    raise SystemExit('Expected exactly one current runtime audit block.')

text = text.replace(old_env, new_env, 1)
text = text.replace(old_runtime, new_runtime, 1)

required = [
    'GH_SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}',
    '/v1/projects/${ref}/api-keys?reveal=true',
    "row.name === 'service_role'",
    'SERVICE_ROLE_SOURCE="$SERVICE_ROLE_SOURCE" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node --env-file=.audit-production.env',
    'echo "::add-mask::$SERVICE_ROLE_KEY"',
    'SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" node --env-file=.audit-production.env scripts/run-truely-launch-audit-20260729.mjs runtime',
    "const transactionalPages = new Set(['cart', 'signup']);",
]
for value in required:
    if value not in text:
        raise SystemExit(f'Missing strengthened audit requirement: {value}')

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(text, encoding='utf-8')
