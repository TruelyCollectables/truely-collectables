from pathlib import Path

source = Path('/tmp/full-launch-audit.yml')
output = Path('ops-output/ops-truely-full-launch-audit-20260729.yml')
text = source.read_text(encoding='utf-8')

old_runtime = '''      - name: Run read-only Production integration and data audit
        shell: bash
        run: |
          set +e
          node --env-file=.audit-production.env scripts/run-truely-launch-audit-20260729.mjs runtime
          status=$?
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

old_lighthouse = '''      - name: Grade Lighthouse reports
        shell: bash
        run: |
          node - <<'NODE'
          const fs = require('fs');
          const path = require('path');
          const dir = '.audit/lighthouse';
          const rows = [];
          let blocker = false;
          for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
            const report = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            const row = { page: file.replace('.json', '') };
            for (const key of ['performance', 'accessibility', 'best-practices', 'seo']) {
              row[key] = Math.round((report.categories[key]?.score || 0) * 100);
            }
            if (row.accessibility < 90 || row.seo < 90 || row['best-practices'] < 85) blocker = true;
            rows.push(row);
          }
          fs.writeFileSync(path.join(dir, 'lighthouse-summary.json'), JSON.stringify({ rows, blocker }, null, 2));
          fs.writeFileSync(path.join(dir, 'lighthouse-summary.md'), '# Lighthouse summary\\n\\n' + rows.map(row => `- ${row.page}: Performance ${row.performance}, Accessibility ${row.accessibility}, Best Practices ${row['best-practices']}, SEO ${row.seo}`).join('\\n') + '\\n');
          console.table(rows);
          if (blocker) process.exit(1);
          NODE

'''
new_lighthouse = '''      - name: Grade Lighthouse reports
        shell: bash
        run: |
          set -euo pipefail
          curl --silent --show-error --fail --location https://truelycollectables.com/cart > .audit/lighthouse/cart.html
          curl --silent --show-error --fail --location https://truelycollectables.com/account/signup > .audit/lighthouse/signup.html
          grep -Eiq '<link[^>]+rel="canonical"[^>]+href="https://truelycollectables.com/cart"|<link[^>]+href="https://truelycollectables.com/cart"[^>]+rel="canonical"' .audit/lighthouse/cart.html
          grep -Eiq '<link[^>]+rel="canonical"[^>]+href="https://truelycollectables.com/account/signup"|<link[^>]+href="https://truelycollectables.com/account/signup"[^>]+rel="canonical"' .audit/lighthouse/signup.html
          grep -Eiq '<meta[^>]+name="robots"[^>]+content="[^"]*noindex[^"]*nofollow|<meta[^>]+content="[^"]*noindex[^"]*nofollow[^"]*"[^>]+name="robots"' .audit/lighthouse/cart.html
          grep -Eiq '<meta[^>]+name="robots"[^>]+content="[^"]*noindex[^"]*nofollow|<meta[^>]+content="[^"]*noindex[^"]*nofollow[^"]*"[^>]+name="robots"' .audit/lighthouse/signup.html
          node - <<'NODE'
          const fs = require('fs');
          const path = require('path');
          const dir = '.audit/lighthouse';
          const transactionalPages = new Set(['cart', 'signup']);
          const rows = [];
          let blocker = false;
          for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
            const report = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            const row = { page: file.replace('.json', '') };
            for (const key of ['performance', 'accessibility', 'best-practices', 'seo']) {
              row[key] = Math.round((report.categories[key]?.score || 0) * 100);
            }
            row.canonical = report.audits.canonical?.score ?? null;
            row.crawlable = report.audits['is-crawlable']?.score ?? null;
            row.robots = report.audits['robots-txt']?.score ?? null;
            row.title = report.audits['document-title']?.score ?? null;
            row.description = report.audits['meta-description']?.score ?? null;
            const commonFailure = row.accessibility < 90 || row['best-practices'] < 85 || row.canonical !== 1 || row.robots !== 1 || row.title !== 1 || row.description !== 1;
            if (transactionalPages.has(row.page)) {
              if (commonFailure || row.crawlable !== 0) blocker = true;
            } else if (commonFailure || row.seo < 90 || row.crawlable !== 1) {
              blocker = true;
            }
            rows.push(row);
          }
          fs.writeFileSync(path.join(dir, 'lighthouse-summary.json'), JSON.stringify({ rows, blocker }, null, 2));
          fs.writeFileSync(path.join(dir, 'lighthouse-summary.md'), '# Lighthouse summary\\n\\n' + rows.map(row => `- ${row.page}: Performance ${row.performance}, Accessibility ${row.accessibility}, Best Practices ${row['best-practices']}, SEO ${row.seo}, Canonical ${row.canonical}, Crawlable ${row.crawlable}`).join('\\n') + '\\n');
          console.table(rows);
          if (blocker) process.exit(1);
          NODE

'''

if text.count(old_runtime) != 1:
    raise SystemExit('Expected exactly one stale runtime audit invocation.')
if text.count(old_lighthouse) != 1:
    raise SystemExit('Expected exactly one stale Lighthouse grader.')

text = text.replace(old_runtime, new_runtime)
text = text.replace(old_lighthouse, new_lighthouse)

required = [
    'runtime-env-presence.json',
    'env "${unset_args[@]}" node --env-file=.audit-production.env',
    "const transactionalPages = new Set(['cart', 'signup']);",
    'row.crawlable !== 0',
    'row.seo < 90 || row.crawlable !== 1',
    'https://truelycollectables.com/account/signup',
]
for value in required:
    if value not in text:
        raise SystemExit(f'Missing corrected audit requirement: {value}')

output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(text, encoding='utf-8')
