#!/bin/bash
set -Eeuo pipefail
umask 077

WORKER="$HOME/Library/Application Support/SharedProjectBackups/run-full-encrypted-backup.sh"
PLIST="$HOME/Library/LaunchAgents/com.dagdanky.full-encrypted-backups.plist"
LOG_FILE="$HOME/Library/Logs/SharedProjectBackups.log"
RUN_NOW=false

if [ "${1:-}" = "--run-now" ]; then
  RUN_NOW=true
elif [ -n "${1:-}" ]; then
  echo "Usage: $0 [--run-now]" >&2
  exit 2
fi

[ "$(uname -s)" = "Darwin" ] || { echo "ERROR: macOS required." >&2; exit 1; }
[ -f "$WORKER" ] || { echo "ERROR: installed backup worker not found: $WORKER" >&2; exit 1; }
[ -f "$PLIST" ] || { echo "ERROR: backup LaunchAgent not found: $PLIST" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required." >&2; exit 1; }

stamp="$(date '+%Y%m%dT%H%M%S')"
cp -p "$WORKER" "$WORKER.before-truely-path-fix-$stamp"

python3 - "$WORKER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old_candidates = '''  for candidate in \\
    "$HOME/Documents/Truely-Collectables" \\
    "$HOME/Documents/Truely Collectables" \\
    "$HOME/Documents/truely-collectables" \\
    "$HOME/Documents/truelycollectables" \\
    "$HOME/Documents/Truely-Collectables-Website"; do'''
new_candidates = '''  for candidate in \\
    "$HOME/Developer/truely-collectables" \\
    "$HOME/TruelyCollectables/truely-collectables" \\
    "$HOME/Documents/Truely-Collectables" \\
    "$HOME/Documents/Truely Collectables" \\
    "$HOME/Documents/truely-collectables" \\
    "$HOME/Documents/truelycollectables" \\
    "$HOME/Documents/Truely-Collectables-Website"; do'''

if old_candidates in text:
    text = text.replace(old_candidates, new_candidates, 1)
elif new_candidates not in text:
    raise SystemExit("ERROR: could not safely patch Truely repository search locations")

old_start = '''TRUELY_REPO="$(find_truely_repo || true)"\n\ncreate_encrypted_vault \\
  "$DAG_PROJECT"'''
new_start = '''TRUELY_REPO="$(find_truely_repo || true)"\nif [ -z "$TRUELY_REPO" ]; then\n  log "Truely Collectables backup FAILED: repository not found in approved local locations (including $HOME/Developer/truely-collectables)."\n  exit 1\nfi\n\ncreate_encrypted_vault \\
  "$DAG_PROJECT"'''
if old_start in text:
    text = text.replace(old_start, new_start, 1)
elif new_start not in text:
    raise SystemExit("ERROR: could not safely add fail-closed repository check")

old_finish = '''if [ -n "$TRUELY_REPO" ]; then\n  create_encrypted_vault \\
    "$TRUELY_PROJECT" \\
    "$TRUELY_REPO" \\
    "$TRUELY_SCOPE" \\
    "truely-db"\nelse\n  log "Truely Collectables skipped: local repository not found."\nfi\n\nlog "All available full encrypted project backups completed."'''
new_finish = '''create_encrypted_vault \\
  "$TRUELY_PROJECT" \\
  "$TRUELY_REPO" \\
  "$TRUELY_SCOPE" \\
  "truely-db"\n\nlog "All required full encrypted project backups completed, including Truely Collectables."'''
if old_finish in text:
    text = text.replace(old_finish, new_finish, 1)
elif new_finish not in text:
    raise SystemExit("ERROR: could not safely replace false-success completion block")

old_db = '''  elif [ "$data_mode" = "truely-db" ]; then\n    export_truely_database "$stage/data"\n  fi\n\n  write_restore_readme'''
new_db = '''  elif [ "$data_mode" = "truely-db" ]; then\n    export_truely_database "$stage/data"\n    if ! grep -q '^PASSED:' "$stage/data/DATABASE_EXPORT_STATUS.txt" 2>/dev/null; then\n      log "$project backup FAILED: complete PostgreSQL database export was not created."\n      rm -rf "$stage"\n      return 1\n    fi\n  fi\n\n  write_restore_readme'''
if old_db in text:
    text = text.replace(old_db, new_db, 1)
elif new_db not in text:
    raise SystemExit("ERROR: could not safely add complete-database gate")

path.write_text(text)
PY

bash -n "$WORKER"
grep -Fq '$HOME/Developer/truely-collectables' "$WORKER"
grep -Fq 'backup FAILED: repository not found' "$WORKER"
grep -Fq 'complete PostgreSQL database export was not created' "$WORKER"
if grep -Fq 'Truely Collectables skipped: local repository not found.' "$WORKER"; then
  echo "ERROR: old skip-on-missing behavior is still present." >&2
  exit 1
fi

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.dagdanky.full-encrypted-backups"

echo "PASS: Truely full-backup worker repaired and 2:00 AM LaunchAgent reloaded."
echo "Worker backup: $WORKER.before-truely-path-fix-$stamp"

if [ "$RUN_NOW" = true ]; then
  echo "Starting immediate full encrypted backup..."
  "$WORKER"
  base="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Shared Project Backups/Truely-Collectables"
  vault="$(ls -1t "$base"/checkpoints/Truely-Collectables_Checkpoint_*.dmg 2>/dev/null | head -1 || true)"
  checksum="$(ls -1t "$base"/exports/Truely-Collectables_Checksums_*.sha256 2>/dev/null | head -1 || true)"
  [ -n "$vault" ] || { echo "ERROR: no Truely encrypted DMG was produced." >&2; exit 1; }
  [ -n "$checksum" ] || { echo "ERROR: no Truely checksum file was produced." >&2; exit 1; }
  (cd "$base" && shasum -a 256 -c "exports/$(basename "$checksum")")
  echo "PASS: immediate Truely backup completed and checksum verification passed."
  echo "Vault: $vault"
  echo "Checksum: $checksum"
fi
