#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"
CERTIFIED_COMMIT="7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9"
BACKUP_DIR="$HOME/Backups/KINGMAKER-GOLDEN-2026-08-07"
PRODUCTION_RELEASE="https://truelycollectables.com/instacomp-release.json"

echo "============================================================"
echo " KINGMAKER - CERTIFIED GOLDEN BACKUP"
echo "============================================================"
echo ""
echo "This makes a verified local disaster-recovery archive of the"
echo "whole Truely Collectables repository, including .git and local"
echo ".env* files. It does NOT publish, deploy, buy, sell, ship, or"
echo "change Production data."
echo ""

for cmd in git node npm curl shasum tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: $cmd"
    read "?Press Return to close..."
    exit 1
  fi
done

if [ ! -f package.json ] || [ ! -d src/app/kingmaker ]; then
  echo "ERROR: Run this from the truely-collectables repository root."
  read "?Press Return to close..."
  exit 1
fi

ALLOWED_HELPERS='^KINGMAKER_(RECOVERY_MANIFEST\.json|BACKUP_NOW\.command|RESTORE\.command|SIMPLE_BACKUP\.txt|RECOVERY_GUIDE\.md)$'
UNEXPECTED_COMMITTED="$(git diff --name-only "$CERTIFIED_COMMIT"..HEAD | grep -Ev "$ALLOWED_HELPERS" || true)"
if [ -n "$UNEXPECTED_COMMITTED" ]; then
  echo "ERROR: committed application source differs from the certified KINGMAKER commit:"
  echo "$UNEXPECTED_COMMITTED"
  echo "Golden backup REFUSED."
  read "?Press Return to close..."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: tracked local files have uncommitted changes."
  echo "Golden backup REFUSED so a dirty tracked state cannot be mislabeled certified."
  git status --short
  read "?Press Return to close..."
  exit 1
fi

SOURCE_DRIFT="$(git status --porcelain --untracked-files=all -- \
  src/app/kingmaker \
  src/app/admin/market-intel/kingmaker \
  src/lib \
  scripts \
  package.json package-lock.json \
  supabase/migrations | grep -Ev '^.. KINGMAKER_(RECOVERY_MANIFEST\.json|BACKUP_NOW\.command|RESTORE\.command|SIMPLE_BACKUP\.txt|RECOVERY_GUIDE\.md)$' || true)"
if [ -n "$SOURCE_DRIFT" ]; then
  echo "ERROR: local KINGMAKER/application source drift exists:"
  echo "$SOURCE_DRIFT"
  echo "Golden backup REFUSED."
  read "?Press Return to close..."
  exit 1
fi

echo "Checking certified dependency repair..."
node - <<'NODE'
const lock=require('./package-lock.json');
const n=lock.packages?.['node_modules/nanoid'];
if (!n || n.version !== '3.3.18') {
  throw new Error(`Expected certified nanoid 3.3.18, got ${n?.version || 'missing'}`);
}
console.log('PASS nanoid 3.3.18');
NODE

grep -Fq 'const timer = window.setTimeout(() => {' src/app/kingmaker/instacomp-audit/page.tsx
echo "PASS certified KINGMAKER audit-effect repair"

node scripts/certify-kingmaker-instacomp-architecture.mjs
node scripts/certify-kingmaker-global-execution-query.mjs

echo "Checking live Production source SHA..."
LIVE_JSON="$(curl --silent --show-error --fail --max-time 30 -H 'Cache-Control: no-cache' "${PRODUCTION_RELEASE}?kingmaker-backup=$(date +%s)")"
LIVE_SHA="$(node -e 'const b=JSON.parse(process.argv[1]);process.stdout.write(String(b.sourceCommit||""));' "$LIVE_JSON")"
PRODUCTION_PROOF="exact-certified-sha"

if [ "$LIVE_SHA" = "$CERTIFIED_COMMIT" ]; then
  echo "PASS live Production exact certified SHA $LIVE_SHA"
else
  echo "Production is newer than the certified KINGMAKER source."
  echo "Certified: $CERTIFIED_COMMIT"
  echo "Live:      $LIVE_SHA"
  echo "Fail-closed check: only the specifically audited InstaComp 25-card stress files may differ."

  git fetch origin --quiet

  if ! git cat-file -e "${LIVE_SHA}^{commit}" 2>/dev/null; then
    echo "ERROR: live Production SHA is not present in fetched repository history."
    echo "Golden backup REFUSED."
    read "?Press Return to close..."
    exit 1
  fi

  if ! git merge-base --is-ancestor "$CERTIFIED_COMMIT" "$LIVE_SHA"; then
    echo "ERROR: live Production is not a descendant of the certified KINGMAKER commit."
    echo "Golden backup REFUSED."
    read "?Press Return to close..."
    exit 1
  fi

  ALLOWED_LIVE_DRIFT='^(\.github/workflows/instacomp-25-live-listing-stress-test\.yml|\.github/workflows/instacomp-25-stress-progress-probe\.yml|src/app/api/release/instacomp-25-card-stress-test/route\.ts|src/app/api/release/instacomp-25-card-stress-test-v2/route\.ts|src/app/api/release/instacomp-25-card-stress-test-v3/route\.ts)$'
  LIVE_CHANGED="$(git diff --name-only "$CERTIFIED_COMMIT" "$LIVE_SHA")"
  UNEXPECTED_LIVE_DRIFT="$(printf '%s\n' "$LIVE_CHANGED" | sed '/^$/d' | grep -Ev "$ALLOWED_LIVE_DRIFT" || true)"

  if [ -n "$UNEXPECTED_LIVE_DRIFT" ]; then
    echo "ERROR: Production contains changes outside the audited non-KINGMAKER drift set:"
    echo "$UNEXPECTED_LIVE_DRIFT"
    echo "Golden backup REFUSED."
    read "?Press Return to close..."
    exit 1
  fi

  echo "Audited Production drift:"
  printf '%s\n' "$LIVE_CHANGED"
  echo "PASS live Production differs only by the audited InstaComp 25-card stress-test files."
  echo "PASS certified KINGMAKER source remains unchanged in live Production ancestry."
  PRODUCTION_PROOF="newer-live-sha-with-only-audited-non-kingmaker-drift"
fi

mkdir -p "$BACKUP_DIR"

echo ""
echo "Creating whole-repository emergency archive..."
npm run backup:nightly -- --backup-dir "$BACKUP_DIR" --skip-prune --local-only

echo ""
echo "Verifying archive, SHA-256, manifest, .git, and captured .env files..."
npm run verify:nightly-backup -- --backup-dir "$BACKUP_DIR"

cp -f KINGMAKER_RECOVERY_MANIFEST.json "$BACKUP_DIR/"
cp -f KINGMAKER_SIMPLE_BACKUP.txt "$BACKUP_DIR/" 2>/dev/null || true
cp -f KINGMAKER_RECOVERY_GUIDE.md "$BACKUP_DIR/" 2>/dev/null || true
cp -f KINGMAKER_RESTORE.command "$BACKUP_DIR/" 2>/dev/null || true

cat > "$BACKUP_DIR/READ-ME-FIRST.txt" <<EOF
KINGMAKER GOLDEN DISASTER-RECOVERY BACKUP
Certified KINGMAKER source: $CERTIFIED_COMMIT
Live Production source at backup time: $LIVE_SHA
Production compatibility proof: $PRODUCTION_PROOF

KEEP THIS ENTIRE FOLDER TOGETHER.
Treat it as sensitive because the archive can contain local .env secrets.
Start with KINGMAKER_SIMPLE_BACKUP.txt or KINGMAKER_RECOVERY_GUIDE.md.
EOF

echo ""
echo "============================================================"
echo " SUCCESS - KINGMAKER GOLDEN BACKUP VERIFIED"
echo "============================================================"
echo ""
echo "Backup folder:"
echo "  $BACKUP_DIR"
echo ""
echo "NEXT: Copy that ENTIRE folder to an external SSD/USB drive."
echo "Do NOT make it public; the archive can contain .env secrets."
echo ""
read "?Press Return to close..."
