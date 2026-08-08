#!/bin/zsh
set -euo pipefail

CERTIFIED_COMMIT="7f20e5d3d5eb078ae9a6ffff5c19af92f1ab29d9"
BACKUP_DIR="$HOME/Backups/KINGMAKER-GOLDEN-2026-08-07"
STAMP="$(date +%Y%m%d-%H%M%S)"
RESTORE_PARENT="$HOME/KINGMAKER-Recovery-$STAMP"

echo "============================================================"
echo " KINGMAKER - SAFE DISASTER RESTORE"
echo "============================================================"
echo ""
echo "This NEVER overwrites your current repository."
echo "A new recovery folder will be created at:"
echo "  $RESTORE_PARENT"
echo ""

for cmd in git node npm tar shasum curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: $cmd"
    echo "Read KINGMAKER_RECOVERY_GUIDE.md under NEW MAC prerequisites."
    read "?Press Return to close..."
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" != "22" ]; then
  echo "ERROR: Certified recovery uses Node 22. Current Node major is $NODE_MAJOR."
  echo "Install/use Node 22, then run this file again."
  read "?Press Return to close..."
  exit 1
fi

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup folder not found:"
  echo "  $BACKUP_DIR"
  echo "Copy the complete KINGMAKER-GOLDEN-2026-08-07 folder there first."
  read "?Press Return to close..."
  exit 1
fi

LATEST_ARCHIVE="$(ls -1t "$BACKUP_DIR"/truely-collectables-nightly-*.tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST_ARCHIVE" ]; then
  echo "ERROR: No KINGMAKER repository archive was found in $BACKUP_DIR"
  read "?Press Return to close..."
  exit 1
fi

SHA_FILE="${LATEST_ARCHIVE}.sha256"
if [ ! -f "$SHA_FILE" ]; then
  echo "ERROR: Missing SHA-256 file: $SHA_FILE"
  read "?Press Return to close..."
  exit 1
fi

EXPECTED_SHA="$(awk '{print $1}' "$SHA_FILE")"
ACTUAL_SHA="$(shasum -a 256 "$LATEST_ARCHIVE" | awk '{print $1}')"
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "ERROR: BACKUP CHECKSUM FAILED."
  echo "DO NOT restore this copy. Use another copy from the external drive."
  echo "Expected: $EXPECTED_SHA"
  echo "Actual:   $ACTUAL_SHA"
  read "?Press Return to close..."
  exit 1
fi

echo "PASS: backup SHA-256 verified"

mkdir -p "$RESTORE_PARENT"
tar -xzf "$LATEST_ARCHIVE" -C "$RESTORE_PARENT"
RESTORED_REPO="$RESTORE_PARENT/truely-collectables"

if [ ! -f "$RESTORED_REPO/package.json" ] || [ ! -d "$RESTORED_REPO/.git" ]; then
  echo "ERROR: restored repository is incomplete."
  echo "package.json or .git is missing."
  read "?Press Return to close..."
  exit 1
fi

echo "PASS: repository extracted with .git"
cd "$RESTORED_REPO"

if ! git cat-file -e "${CERTIFIED_COMMIT}^{commit}" 2>/dev/null; then
  echo "ERROR: certified KINGMAKER commit is not present in the backup Git history."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: restored archive contains tracked file modifications."
  echo "The restore will not discard them automatically."
  git status --short
  exit 1
fi

# Move the restored working tree to the byte-exact certified application source.
# Ignored/untracked .env files remain in place.
git checkout --detach "$CERTIFIED_COMMIT"
ACTUAL_HEAD="$(git rev-parse HEAD)"
if [ "$ACTUAL_HEAD" != "$CERTIFIED_COMMIT" ]; then
  echo "ERROR: failed to select the certified KINGMAKER source."
  exit 1
fi

echo "PASS: exact certified source $ACTUAL_HEAD"

echo "Checking certified security repair..."
node - <<'NODE'
const lock=require('./package-lock.json');
const n=lock.packages?.['node_modules/nanoid'];
if (!n || n.version !== '3.3.18') throw new Error(`Expected nanoid 3.3.18, got ${n?.version || 'missing'}`);
console.log('PASS nanoid 3.3.18');
NODE

grep -Fq 'const timer = window.setTimeout(() => {' src/app/kingmaker/instacomp-audit/page.tsx
echo "PASS certified audit initial-load repair"

echo ""
echo "STEP 1/6 - Reinstall exact Node dependencies..."
npm ci

echo ""
echo "STEP 2/6 - Production dependency security audit..."
npm audit --omit=dev --audit-level=high

echo ""
echo "STEP 3/6 - KINGMAKER architecture and execution contracts..."
node scripts/certify-kingmaker-instacomp-architecture.mjs
node scripts/certify-kingmaker-global-execution-query.mjs

echo ""
echo "STEP 4/6 - Run every KINGMAKER regression suite..."
SUITE_COUNT=0
for suite in scripts/run-kingmaker-*-regressions.ts; do
  if [ -f "$suite" ]; then
    SUITE_COUNT=$((SUITE_COUNT + 1))
    echo "== $suite =="
    npx tsx "$suite"
  fi
done
if [ "$SUITE_COUNT" -ne 61 ]; then
  echo "ERROR: Expected 61 KINGMAKER regression suites, found $SUITE_COUNT."
  exit 1
fi
echo "PASS: all 61 KINGMAKER regression suites"

echo ""
echo "STEP 5/6 - TypeScript and focused KINGMAKER lint..."
npx eslint \
  src/app/kingmaker \
  src/app/admin/market-intel/kingmaker \
  src/lib/instacomp-capabilities.ts \
  src/lib/instacomp-evidence-contract.ts \
  src/lib/instacomp-research-contract.ts \
  src/lib/kingmaker-instacomp-boundaries.ts \
  src/lib/kingmaker-private-pricing-work-order-execution-server.ts \
  src/lib/kingmaker-phase-18-disaster-recovery-business-continuity.ts \
  src/app/api/instacomp/pricing/coverage/work-orders/execution/route.ts \
  src/app/admin/instacomp/pricing/_components/private-pricing-work-order-execution.tsx \
  src/app/admin/instacomp/pricing/coverage/work-orders/page.tsx \
  scripts/certify-kingmaker-instacomp-architecture.mjs \
  scripts/certify-kingmaker-global-execution-query.mjs
npx tsc --noEmit

echo ""
echo "STEP 6/6 - Full certified Production build..."
TCOS_RELEASE_COMMIT="$CERTIFIED_COMMIT" npm run build

cat > "$RESTORE_PARENT/RESTORE-SUCCESS.txt" <<EOF
KINGMAKER local disaster restore passed.
Certified source: $CERTIFIED_COMMIT
Recovered repository: $RESTORED_REPO
Production was NOT changed automatically.
Next: follow KINGMAKER_RECOVERY_GUIDE.md section FINAL PRODUCTION RECOVERY.
EOF

echo ""
echo "============================================================"
echo " LOCAL KINGMAKER RECOVERY SUCCESS"
echo "============================================================"
echo ""
echo "Recovered repository:"
echo "  $RESTORED_REPO"
echo ""
echo "Production has NOT been changed automatically."
echo "Follow KINGMAKER_RECOVERY_GUIDE.md for the final Production recovery."
echo ""
read "?Press Return to close..."
