#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"
CERTIFIED_COMMIT="04d927fe9b845eac3902ce1e88b720eb0fb8cb6e"
CERTIFIED_RUNTIME_FP="d1f81dfa0054a5b1ca36f32c0f32c5c03f09a2de507e69041815861385878be3"
BACKUP_DIR="$HOME/Backups/InstaComp-AI-GOLDEN-2026-08-07"
SERVICE_DIR="services/instacomp-ai"

echo "============================================================"
echo " InstaComp AI - CERTIFIED GOLDEN BACKUP"
echo "============================================================"
echo ""
echo "This creates TWO local backups:"
echo "  1) InstaComp AI native FULL ZIP (service data + .env + SQLite + images)"
echo "  2) Whole-repository emergency TAR.GZ (.git + repo + local .env files)"
echo ""
echo "Nothing is uploaded anywhere. Treat the backup as sensitive."
echo ""

for cmd in git npm shasum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: $cmd"
    read "?Press Return to close..."
    exit 1
  fi
done

if [ ! -f package.json ] || [ ! -d "$SERVICE_DIR/app" ]; then
  echo "ERROR: This file must be run from the Truely Collectables/InstaComp AI repository root."
  read "?Press Return to close..."
  exit 1
fi

# The recovery branch may add only the recovery helper files. Application code
# must still be byte-identical to the certified Production application commit.
UNEXPECTED_COMMITTED="$(git diff --name-only "$CERTIFIED_COMMIT"..HEAD | grep -Ev '^INSTACOMP_AI_(RECOVERY_MANIFEST\.json|BACKUP_NOW\.command|RESTORE\.command|RECOVERY_GUIDE\.md|SIMPLE_BACKUP\.txt)$' || true)"
if [ -n "$UNEXPECTED_COMMITTED" ]; then
  echo "ERROR: application source differs from the certified InstaComp AI commit."
  echo "$UNEXPECTED_COMMITTED"
  echo "Golden backup REFUSED."
  read "?Press Return to close..."
  exit 1
fi

LOCAL_SOURCE_DRIFT="$(git status --porcelain --untracked-files=all -- \
  src \
  "$SERVICE_DIR/app" \
  "$SERVICE_DIR/scripts" \
  "$SERVICE_DIR/requirements.txt" \
  package.json package-lock.json \
  'next.config.*' 'tsconfig*.json' \
  supabase/migrations | head -100)"
if [ -n "$LOCAL_SOURCE_DRIFT" ]; then
  echo "ERROR: local application/source files have uncommitted or untracked changes:"
  echo "$LOCAL_SOURCE_DRIFT"
  echo "Golden backup REFUSED so a modified state cannot be mislabeled as certified."
  read "?Press Return to close..."
  exit 1
fi

ACTUAL_RUNTIME_FP="$(python3 - <<'PY'
from hashlib import sha256
from pathlib import Path
root=Path('services/instacomp-ai')
d=sha256()
for rel in ('app/main.py','app/local_vision.py','app/ollama.py'):
    d.update(rel.encode()); d.update(b'\0'); d.update((root/rel).read_bytes()); d.update(b'\0')
print(d.hexdigest())
PY
)"
if [ "$ACTUAL_RUNTIME_FP" != "$CERTIFIED_RUNTIME_FP" ]; then
  echo "ERROR: Mac runtime fingerprint does not match the certified working runtime."
  echo "Expected: $CERTIFIED_RUNTIME_FP"
  echo "Actual:   $ACTUAL_RUNTIME_FP"
  echo "Golden backup REFUSED."
  read "?Press Return to close..."
  exit 1
fi

echo "PASS: certified application source boundary"
echo "PASS: certified Mac runtime fingerprint $ACTUAL_RUNTIME_FP"

PYTHON_BIN="$SERVICE_DIR/.venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
  echo "ERROR: working InstaComp AI virtual environment was not found at:"
  echo "  $PYTHON_BIN"
  echo "Run the certified Mac installer/repair first; backup is refused until the working runtime exists."
  read "?Press Return to close..."
  exit 1
fi

mkdir -p "$BACKUP_DIR/native-full"

echo ""
echo "STEP 1/4 - Creating InstaComp AI native FULL backup..."
(
  cd "$SERVICE_DIR"
  PYTHONPATH=. .venv/bin/python scripts/backup-now.py
)
LATEST_NATIVE="$(ls -1t "$SERVICE_DIR"/backups/InstaComp-AI-FULL-*.zip 2>/dev/null | head -1 || true)"
if [ -z "$LATEST_NATIVE" ]; then
  echo "ERROR: native InstaComp AI backup was not created."
  read "?Press Return to close..."
  exit 1
fi

echo ""
echo "STEP 2/4 - Verifying native FULL backup checksum/manifest/archive safety..."
(
  cd "$SERVICE_DIR"
  .venv/bin/python scripts/restore-full-backup.py "$(basename "$LATEST_NATIVE")" 2>/dev/null || \
  .venv/bin/python scripts/restore-full-backup.py "backups/$(basename "$LATEST_NATIVE")"
)
cp -f "$LATEST_NATIVE" "$BACKUP_DIR/native-full/"
cp -f "${LATEST_NATIVE}.manifest.json" "$BACKUP_DIR/native-full/"
cp -f "${LATEST_NATIVE}.sha256" "$BACKUP_DIR/native-full/"

echo ""
echo "STEP 3/4 - Creating whole-repository emergency backup..."
npm run backup:nightly -- --backup-dir "$BACKUP_DIR" --skip-prune --local-only

echo ""
echo "STEP 4/4 - Verifying whole-repository archive, SHA-256, .git, and captured root .env files..."
npm run verify:nightly-backup -- --backup-dir "$BACKUP_DIR"

cp -f INSTACOMP_AI_RECOVERY_MANIFEST.json "$BACKUP_DIR/"

echo ""
echo "============================================================"
echo " SUCCESS - InstaComp AI golden backup is VERIFIED."
echo "============================================================"
echo ""
echo "Backup folder:"
echo "  $BACKUP_DIR"
echo ""
echo "IMPORTANT: Copy that ENTIRE folder to an external SSD/USB drive."
echo "Do NOT upload it to a public site because it can contain .env secrets."
echo ""
read "?Press Return to close..."
