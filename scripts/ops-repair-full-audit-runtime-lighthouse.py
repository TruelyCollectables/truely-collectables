from pathlib import Path
import subprocess
import sys

AUDIT_HEAD = "3417c615337436df896cfe9d3238f5d29ae33518"
AUDIT_BLOB = "24f1944cb405f9bb61d1c03fd952b8eae7df14ea"

root = Path(sys.argv[1]).resolve()
workflow = root / ".github/workflows/ops-truely-full-launch-audit-20260729.yml"

head = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
blob = subprocess.check_output(["git", "-C", str(root), "hash-object", str(workflow)], text=True).strip()
if head != AUDIT_HEAD:
    raise SystemExit(f"Audit head moved: {head}")
if blob != AUDIT_BLOB:
    raise SystemExit(f"Audit workflow blob moved: {blob}")

source = workflow.read_text()
runtime_old = '''      - name: Run read-only Production integration and data audit
        shell: bash
        run: |
          set +e
          node --env-file=.audit-production.env scripts/run-truely-launch-audit-20260729.mjs runtime
          status=$?
          set -e
          rm -f .audit-production.env
          exit "$status"
'''
runtime_new = '''      - name: Run read-only Production integration and data audit
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
          set +e
          node scripts/run-truely-launch-audit-20260729.mjs runtime
          status=$?
          set -e
          rm -f .audit-production.env
          exit "$status"
'''
lighthouse_old = '''          const rows = [];
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
'''
lighthouse_new = '''          const rows = [];
          let blocker = false;
          const intentionallyPrivate = new Set(['cart', 'signup']);
          for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
            const report = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            const row = {
              page: file.replace('.json', ''),
              canonical: report.audits.canonical?.score ?? null,
              crawlable: report.audits['is-crawlable']?.score ?? null,
            };
            for (const key of ['performance', 'accessibility', 'best-practices', 'seo']) {
              row[key] = Math.round((report.categories[key]?.score || 0) * 100);
            }
            const categoryFailure = row.accessibility < 90 || row['best-practices'] < 85;
            const seoFailure = intentionallyPrivate.has(row.page)
              ? row.canonical !== 1 || row.crawlable !== 0
              : row.seo < 90;
            if (categoryFailure || seoFailure) blocker = true;
            rows.push(row);
          }
'''

if source.count(runtime_old) != 1:
    raise SystemExit("Runtime audit anchor mismatch")
if source.count(lighthouse_old) != 1:
    raise SystemExit("Lighthouse audit anchor mismatch")
source = source.replace(runtime_old, runtime_new, 1)
source = source.replace(lighthouse_old, lighthouse_new, 1)
workflow.write_text(source)

subprocess.run(["git", "-C", str(root), "diff", "--check"], check=True)
changed = subprocess.check_output(["git", "-C", str(root), "diff", "--name-only"], text=True).strip()
if changed != ".github/workflows/ops-truely-full-launch-audit-20260729.yml":
    raise SystemExit(f"Unexpected changed files: {changed}")
print("Audit workflow runtime and Lighthouse repair prepared successfully.")
