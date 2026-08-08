#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CERTIFIED_RUNTIME_FP="d1f81dfa0054a5b1ca36f32c0f32c5c03f09a2de507e69041815861385878be3"
BACKUP_DIR="$HOME/Backups/InstaComp-AI-GOLDEN-2026-08-07"
STAMP="$(date +%Y%m%d-%H%M%S)"
RESTORE_PARENT="$HOME/InstaComp-AI-Recovery-$STAMP"

echo "============================================================"
echo " InstaComp AI - SAFE DISASTER RESTORE"
echo "============================================================"
echo ""
echo "This NEVER overwrites your existing repository."
echo "It restores into a brand-new folder:"
echo "  $RESTORE_PARENT"
echo ""

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup folder not found:"
  echo "  $BACKUP_DIR"
  echo "Connect/copy your backup drive so that folder exists, then run again."
  read "?Press Return to close..."
  exit 1
fi

for cmd in tar shasum git npm python3 curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: $cmd"
    read "?Press Return to close..."
    exit 1
  fi
done

LATEST_REPO="$(ls -1t "$BACKUP_DIR"/truely-collectables-nightly-*.tar.gz 2>/dev/null | head -1 || true)"
if [ -z "$LATEST_REPO" ]; then
  echo "ERROR: No whole-repository emergency archive was found in $BACKUP_DIR"
  read "?Press Return to close..."
  exit 1
fi

SHA_FILE="${LATEST_REPO}.sha256"
if [ ! -f "$SHA_FILE" ]; then
  echo "ERROR: Missing SHA-256 sidecar: $SHA_FILE"
  read "?Press Return to close..."
  exit 1
fi

EXPECTED_SHA="$(awk '{print $1}' "$SHA_FILE")"
ACTUAL_SHA="$(shasum -a 256 "$LATEST_REPO" | awk '{print $1}')"
if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "ERROR: Backup checksum FAILED. Do not restore this archive."
  echo "Expected: $EXPECTED_SHA"
  echo "Actual:   $ACTUAL_SHA"
  read "?Press Return to close..."
  exit 1
fi

echo "PASS: whole-repository SHA-256 verified"

mkdir -p "$RESTORE_PARENT"
tar -xzf "$LATEST_REPO" -C "$RESTORE_PARENT"
RESTORED_REPO="$RESTORE_PARENT/truely-collectables"
if [ ! -f "$RESTORED_REPO/package.json" ] || [ ! -d "$RESTORED_REPO/.git" ]; then
  echo "ERROR: restored repository is incomplete. package.json or .git is missing."
  exit 1
fi

cd "$RESTORED_REPO"

echo ""
echo "STEP 1/6 - Verifying certified InstaComp AI runtime bytes..."
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
  echo "ERROR: restored runtime does not match the certified working InstaComp AI runtime."
  echo "Expected: $CERTIFIED_RUNTIME_FP"
  echo "Actual:   $ACTUAL_RUNTIME_FP"
  exit 1
fi
echo "PASS: certified runtime fingerprint $ACTUAL_RUNTIME_FP"


echo ""
echo "STEP 2/6 - Verifying the independent InstaComp AI FULL backup..."
NATIVE_ZIP="$(ls -1t services/instacomp-ai/backups/InstaComp-AI-FULL-*.zip 2>/dev/null | head -1 || true)"
if [ -z "$NATIVE_ZIP" ]; then
  NATIVE_ZIP="$(ls -1t "$BACKUP_DIR"/native-full/InstaComp-AI-FULL-*.zip 2>/dev/null | head -1 || true)"
fi
if [ -z "$NATIVE_ZIP" ]; then
  echo "ERROR: independent InstaComp AI FULL ZIP was not found."
  exit 1
fi
python3 services/instacomp-ai/scripts/restore-full-backup.py "$NATIVE_ZIP" >/tmp/instacomp-ai-native-verify.json
cat /tmp/instacomp-ai-native-verify.json

echo ""
echo "STEP 3/6 - Reinstalling website/Node dependencies..."
npm ci


echo ""
echo "STEP 4/6 - Checking Ollama and the certified model..."
if ! command -v ollama >/dev/null 2>&1; then
  echo "ERROR: Ollama is not installed on this Mac."
  echo "Install Ollama, then run this restore file again. Nothing was overwritten."
  echo "Your restored files are safe at: $RESTORED_REPO"
  exit 1
fi
if ! curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  open -a Ollama >/dev/null 2>&1 || true
  for i in {1..30}; do
    if curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi
if ! curl --silent --fail --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "ERROR: Ollama is installed but its local service is not reachable."
  exit 1
fi
if ! ollama list 2>/dev/null | grep -Fq 'qwen2.5vl:7b'; then
  echo "The certified qwen2.5vl:7b model is missing. Downloading it now..."
  ollama pull qwen2.5vl:7b
fi
echo "PASS: Ollama and qwen2.5vl:7b are present"


echo ""
echo "STEP 5/6 - Reinstalling and starting the Mac LaunchAgent..."
# The certified installer is preserved byte-for-byte. Provide a tiny temporary
# seq shim for stock macOS environments that do not ship GNU seq.
SHIM_DIR="$(mktemp -d)"
cat > "$SHIM_DIR/seq" <<'EOS'
#!/bin/bash
if [ "$#" -eq 1 ]; then start=1; end="$1"; elif [ "$#" -eq 2 ]; then start="$1"; end="$2"; else exit 2; fi
i="$start"
while [ "$i" -le "$end" ]; do echo "$i"; i=$((i+1)); done
EOS
chmod +x "$SHIM_DIR/seq"
PATH="$SHIM_DIR:$PATH" bash services/instacomp-ai/scripts/install-macos.sh
rm -rf "$SHIM_DIR"


echo ""
echo "STEP 6/6 - Running System Doctor and live health proof..."
(
  cd services/instacomp-ai
  .venv/bin/python scripts/run-system-doctor.py
)
HEALTH="$(curl --silent --fail --max-time 10 http://127.0.0.1:8787/health)"
echo "$HEALTH"
python3 - "$HEALTH" <<'PY'
import json, sys
payload=json.loads(sys.argv[1])
if payload.get('ok') is not True:
    raise SystemExit('InstaComp AI /health did not report ok=true')
print('PASS: InstaComp AI local /health reports ok=true')
PY

cat > "$RESTORE_PARENT/RESTORE-SUCCESS.txt" <<EOF
InstaComp AI disaster restore completed successfully.
Restored repository: $RESTORED_REPO
Certified runtime fingerprint: $ACTUAL_RUNTIME_FP
Local health: PASS
Production deployment was NOT performed automatically.
EOF

echo ""
echo "============================================================"
echo " LOCAL RECOVERY SUCCESS"
echo "============================================================"
echo ""
echo "Recovered repo: $RESTORED_REPO"
echo "InstaComp AI local service: http://127.0.0.1:8787/health"
echo ""
echo "Production has NOT been changed. Follow INSTACOMP_AI_RECOVERY_GUIDE.md"
echo "for the final Production verification/deployment steps."
echo ""
read "?Press Return to close..."
