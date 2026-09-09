#!/bin/bash
set -uo pipefail

ROOT="/Users/davidbakanas/Developer/truely-collectables"
SERVICE="$ROOT/services/instacomp-ai"
API_SERVICE="$SERVICE"
TRAINING="$SERVICE"
WALLPAPER="/Users/davidbakanas/Movies/MiamiWallpaper"
LOG_ROOT="$HOME/Library/Logs/Unsworth"
STATE_ROOT="$HOME/Library/Application Support/Unsworth"
TRAINING_BUNDLE="/Volumes/5TB/InstaCompAI-1.5TB.sparsebundle"
TRAINING_VOLUME="/Volumes/InstaCompAI"
TRAINING_AVAILABLE=0

if [ ! -d "$TRAINING_VOLUME/training" ]; then
  if [ ! -d "$TRAINING_BUNDLE" ]; then
    echo "InstaComp training workspace is unavailable: $TRAINING_BUNDLE" >&2
  else
    /usr/bin/hdiutil attach "$TRAINING_BUNDLE" -nobrowse >/dev/null || {
      echo "Could not mount InstaComp training workspace: $TRAINING_BUNDLE" >&2
    }
  fi
fi

if [ -d "$TRAINING_VOLUME/training/adapters" ]; then
  TRAINING_AVAILABLE=1
else
  echo "Mounted InstaComp training workspace is unavailable; core workers will keep running without training lanes." >&2
fi

mkdir -p "$LOG_ROOT" "$STATE_ROOT"

LOCKFILE="$STATE_ROOT/unsworth.lock"
LOCKDIR="$STATE_ROOT/unsworth.lockdir"

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  OLD_PID=$(cat "$LOCKDIR/pid" 2>/dev/null || cat "$LOCKFILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Unsworth already running PID $OLD_PID"
    exit 0
  fi
  rm -rf "$LOCKDIR"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    echo "Unsworth could not acquire its supervisor lock" >&2
    exit 1
  fi
fi
printf '%s\n' "$$" > "$LOCKDIR/pid"
printf '%s\n' "$$" > "$LOCKFILE"
# A prior Deal Hunter run can leave this transient flag behind if Unsworth is restarted.
# No Deal Hunter job from the prior supervisor can remain authoritative after this lock is acquired.
rm -f "$STATE_ROOT/deal-hunter-active" "$STATE_ROOT/lora-training-active"

MASTER_LOG="$LOG_ROOT/unsworth.log"
PIDS=()

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$MASTER_LOG"
}

notify_restart() {
  local name rc stamp
  name="$1"
  rc="$2"
  stamp="$STATE_ROOT/notify-${name}"
  local now last=0
  now=$(date +%s)
  [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
  if [ $((now-last)) -ge 600 ]; then
    /usr/bin/osascript -e "display notification \"$name exited ($rc); Unsworth is restarting it.\" with title \"Unsworth\"" >/dev/null 2>&1 || true
    printf '%s\n' "$now" > "$stamp"
  fi
}
run_loop() {
  local name="$1"
  shift
  local out="$LOG_ROOT/${name}.log"
  local err="$LOG_ROOT/${name}.err.log"
  while true; do
    local started ended runtime rc
    started=$(date +%s)
    log "Starting $name"
    "$@" >>"$out" 2>>"$err"
    rc=$?
    ended=$(date +%s)
    runtime=$((ended-started))
    log "$name exited rc=$rc after ${runtime}s"
    notify_restart "$name" "$rc"
    if [ "$runtime" -lt 15 ]; then sleep 15; else sleep 5; fi
  done
}

start_loop() {
  run_loop "$@" &
  PIDS+=("$!")
}

instacomp_api_watch() {
  local out="$LOG_ROOT/instacomp-api.log" err="$LOG_ROOT/instacomp-api.err.log"
  while true; do
    if /usr/bin/curl -fsS --connect-timeout 2 --max-time 15 http://127.0.0.1:8787/health >/dev/null 2>&1; then
      sleep 10
      continue
    fi
    local listeners
    listeners=$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$listeners" ]; then
      # A long card evaluation can temporarily make /health miss its response
      # window even though uvicorn is alive and owns 8787. Never kill a live
      # listener just because one health probe timed out; that used to abort
      # Deal Hunter in the middle of real WNBA evaluations.
      log "instacomp-api health probe missed while listener(s) still own 8787: ${listeners//$'\n'/ }; preserving live API"
      sleep 10
      continue
    fi
    local started rc runtime
    started=$(date +%s); log "Starting instacomp-api"
    /bin/bash "$API_SERVICE/scripts/run-local.sh" >>"$out" 2>>"$err" &
    local api_pid=$!
    local ready=0
    for _attempt in $(seq 1 45); do
      if /usr/bin/curl -fsS --connect-timeout 2 --max-time 15 http://127.0.0.1:8787/health >/dev/null 2>&1; then ready=1; break; fi
      if ! kill -0 "$api_pid" 2>/dev/null; then break; fi
      sleep 1
    done
    if [ "$ready" -ne 1 ] && kill -0 "$api_pid" 2>/dev/null; then
      log "instacomp-api failed health readiness; terminating pid=$api_pid"
      kill -TERM "$api_pid" 2>/dev/null || true
    fi
    wait "$api_pid" 2>/dev/null; rc=$?; runtime=$(($(date +%s)-started))
    log "instacomp-api exited rc=$rc after ${runtime}s"; notify_restart "instacomp-api" "$rc"
    [ "$runtime" -lt 15 ] && sleep 15 || sleep 2
  done
}

find_best_checkpoint() {
  "$SERVICE/.venv-lora/bin/python" - "$TRAINING_VOLUME/training/adapters" 37964 <<'PYCHK'
from pathlib import Path
import re, sys
import numpy as np
import safetensors.numpy as st
root=Path(sys.argv[1]); target=int(sys.argv[2]); candidates=[]
for p in root.glob('instacomp-safe2048-*/0*_adapters.safetensors'):
    if not p.is_file() or p.stat().st_size <= 0: continue
    m=re.search(r'-c(\d+)(?:-|$)', p.parent.name)
    n=re.match(r'0*(\d+)_adapters\.safetensors$', p.name)
    if not m or not n: continue
    total=int(m.group(1))+int(n.group(1))
    if total > target: continue
    cfg=p.parent/'adapter_config.json'
    if not cfg.is_file() or cfg.stat().st_size <= 0: continue
    candidates.append((total, p.stat().st_mtime, p))
candidates.sort(key=lambda x:(x[0],x[1]), reverse=True)
for total, _mtime, p in candidates:
    try:
        weights=st.load_file(str(p))
        bad=sum(int((~np.isfinite(np.asarray(v))).sum()) for v in weights.values())
        if bad:
            continue
        del weights
    except Exception:
        continue
    print(f'{total}|{p.resolve()}')
    raise SystemExit(0)
raise SystemExit(2)
PYCHK
}
lora_candidate_watch() {
  local active_flag="$STATE_ROOT/lora-training-active"
  while true; do
    if [ -f "$active_flag" ] || pgrep -f 'python.*mlx_vlm.lora' >/dev/null 2>&1; then
      sleep 10
      continue
    fi
    "$TRAINING/.venv-lora/bin/python" "$TRAINING/scripts/run_lora_candidate_server.py" \
      --adapter "$TRAINING_VOLUME/training/adapters/instacomp-20260814T135158Z" --port 8791
    local rc=$?
    log "LoRA candidate exited rc=$rc"
    sleep 5
  done
}

lora_training_watch() {
  local target=37964
  local runner="$SERVICE/scripts/run_safe2048_supervised_runner.sh"
  local progress="$TRAINING_VOLUME/training/lora-safe2048-supervised-progress.txt"
  while true; do
    if [ -f "$STATE_ROOT/lora-training-pause" ]; then
      sleep 60
      continue
    fi
    local discovery current adapter
    if [ -f "$STATE_ROOT/deal-hunter-active" ]; then
      sleep 30
      continue
    fi
    if [ -s "$progress" ] && [ "$(tail -1 "$progress" 2>/dev/null || echo 0)" -ge "$target" ] 2>/dev/null; then
      sleep 300
      continue
    fi
    if pgrep -f 'python.*mlx_vlm.lora' >/dev/null 2>&1; then
      sleep 60
      continue
    fi
    discovery=$(find_best_checkpoint 2>/dev/null || true)
    if [ -z "$discovery" ] || [[ "$discovery" != *'|'* ]]; then
      log "LoRA training: no recoverable checkpoint yet"
      sleep 60
      continue
    fi
    current=${discovery%%|*}
    adapter=${discovery#*|}
    if ! [[ "$current" =~ ^[0-9]+$ ]]; then sleep 60; continue; fi
    if [ "$current" -ge "$target" ]; then
      printf '%s\n' "$current" > "$progress"
      sleep 300
      continue
    fi
    log "LoRA training: resuming from cumulative $current"
    : > "$STATE_ROOT/lora-training-active"
    pkill -TERM -f 'run_lora_candidate_server.py' >/dev/null 2>&1 || true
    for _wait in $(seq 1 20); do
      pgrep -f 'run_lora_candidate_server.py' >/dev/null 2>&1 || break
      sleep 1
    done
    /bin/bash "$runner" "$current" "$adapter" >>"$LOG_ROOT/lora-training.log" 2>>"$LOG_ROOT/lora-training.err.log"
    local rc=$?
    rm -f "$STATE_ROOT/lora-training-active"
    log "LoRA training runner exited rc=$rc"
    [ "$rc" -ne 0 ] && notify_restart "lora-training" "$rc"
    sleep 15
  done
}

checklist_verified_today() {
  local registry="$SERVICE/data/database/checklist_registry.sqlite3"
  "$SERVICE/.venv/bin/python" - "$registry" <<'PYLOCAL'
import sqlite3, sys
from pathlib import Path
registry = Path(sys.argv[1])
if not registry.is_file():
    raise SystemExit(2)
db = sqlite3.connect(f"file:{registry}?mode=ro", uri=True, timeout=10)
try:
    row = db.execute("""
        SELECT COUNT(DISTINCT source_sha256)
        FROM checklist_registry_imports
        WHERE import_status='imported'
          AND date(imported_at, 'localtime') = date('now', 'localtime')
    """).fetchone()
    print(int((row or [0])[0] or 0))
finally:
    db.close()
PYLOCAL
}
run_checklist_discovery_once() {
  local today="$1" stamp="$STATE_ROOT/checklist-last-discovery-date" last="" rc=0
  [ -f "$stamp" ] && last=$(tail -1 "$stamp" 2>/dev/null || true)
  [ "$last" = "$today" ] && return 0
  log "Checklist: discovering fresh official manufacturer sources"
  if [ ! -f "$ROOT/scripts/discover-official-checklists.ts" ]; then
    log "Checklist: discovery script missing; skipping official discovery"
    return 0
  fi
  (
    cd "$ROOT" || exit 90
    OFFICIAL_DISCOVERY_PAGE_LIMIT="${OFFICIAL_DISCOVERY_PAGE_LIMIT:-250}" /opt/homebrew/bin/node --import tsx scripts/discover-official-checklists.ts
    if [ -f "scripts/sync-official-manufacturer-seeds.mjs" ]; then
      /opt/homebrew/bin/node --env-file=.env.local scripts/sync-official-manufacturer-seeds.mjs
    else
      log "Checklist: sync-official-manufacturer-seeds.mjs missing; skipping queue sync"
    fi
  ) >>"$LOG_ROOT/checklist-discovery.log" 2>>"$LOG_ROOT/checklist-discovery.err.log"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$today" > "$stamp"
    log "Checklist: official discovery and queue sync completed"
  else
    log "Checklist: official discovery failed rc=$rc; backlog processing will continue"
  fi
  return "$rc"
}

run_checklist_once() {
  local today="$1" goal="${CHECKLIST_DAILY_GOAL:-100}" override_goal=""
  local goal_file="$STATE_ROOT/checklist-daily-goal-$today"
  local verified=0 rc=0 attempted=0
  if [ -s "$goal_file" ]; then
    override_goal=$(tail -1 "$goal_file" 2>/dev/null || true)
    if [[ "$override_goal" =~ ^[0-9]+$ ]] && [ "$override_goal" -gt 0 ]; then
      goal="$override_goal"
    fi
  fi
  while [ "$(date +%F)" = "$today" ]; do
    verified=$(checklist_verified_today 2>>"$LOG_ROOT/checklist-nightly.err.log" || echo -1)
    if ! [[ "$verified" =~ ^[0-9]+$ ]]; then
      log "Checklist: could not read Mac-local daily verified total; waiting for the local Registry and retrying"
      notify_restart "checklist-daily-goal" 93
      sleep 30
      continue
    fi
    if [ "$verified" -ge "$goal" ]; then
      printf '%s\n' "$today" > "$STATE_ROOT/checklist-last-run-date"
      log "Checklist: daily goal reached ${verified}/${goal} for $today"
      /usr/bin/osascript -e "display notification \"Daily Mac Registry goal reached: ${verified}/${goal} locally imported verified sets.\" with title \"Unsworth\" sound name \"Glass\"" >/dev/null 2>&1 || true
      return 0
    fi
    log "Checklist: daily progress ${verified}/${goal}; draining eligible checklist queue"
    (
      cd "$ROOT" || exit 90
      export CHECKLIST_NIGHTLY_LIMIT=10000
      export CHECKLIST_NIGHTLY_WORKERS=4
      export CHECKLIST_NIGHTLY_WORKER_ID="$(hostname)-tcos-checklist"
      if [ -f "$ROOT/scripts/nightly-checklist-queue-worker.mjs" ]; then
        /opt/homebrew/bin/node --import tsx --env-file="$ROOT/.env.local" "$ROOT/scripts/nightly-checklist-queue-worker.mjs"
      else
        log "Checklist: nightly queue worker missing; skipping batch run"
        exit 95
      fi
    ) >>"$LOG_ROOT/checklist-nightly.log" 2>>"$LOG_ROOT/checklist-nightly.err.log"
    rc=$?
    if [ "$rc" -ne 0 ]; then
      log "Checklist: batch FAILED rc=$rc at ${verified}/${goal}; retrying later"
      notify_restart "checklist-nightly" "$rc"
      return "$rc"
    fi
    attempted=$(python3 - "$HOME/Library/Application Support/TCOS-Checklist-Nightly/latest-report.json" <<'PYR' 2>/dev/null || echo 0
import json,sys
try: print(int(json.load(open(sys.argv[1])).get('summary',{}).get('attempted',0)))
except Exception: print(0)
PYR
)
    if [ "$attempted" -eq 0 ]; then
      log "Checklist: queue empty; running discovery/repair/requeue instead of stopping"
      run_checklist_discovery_once "$today" || true
      rm -f "$STATE_ROOT/checklist-official-discovery-$today"
      run_checklist_discovery_once "$today" || true
      sleep 30
      continue
    fi
  done
  return 0
}
checklist_scheduler() {
  local stamp="$STATE_ROOT/checklist-last-run-date"
  while true; do
    if [ -f "$STATE_ROOT/checklist-maintenance-pause" ]; then
      sleep 60
      continue
    fi
    local today hour last=""
    today=$(date +%F)
    hour=$(date +%H)
    [ -f "$stamp" ] && last=$(tail -1 "$stamp" 2>/dev/null || true)
    if [ $((10#$hour)) -ge 1 ] && [ "$last" != "$today" ]; then
      run_checklist_discovery_once "$today" &
      run_checklist_once "$today" || sleep 300
    fi
    sleep 60
  done
}

deal_hunter_run_once() {
  local today="$1" slot="$2"
  local api_key response active_flag="$STATE_ROOT/deal-hunter-active"
  printf '%s|%s|%s\n' "$today" "$slot" "$$" > "$active_flag"
  api_key=$(awk -F= '$1=="INSTACOMP_AI_API_KEY" {sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit}' "$SERVICE/.env")
  if [ -z "$api_key" ]; then
    log "Deal Hunter: FAILED missing local API key"
    notify_restart "deal-hunter-schedule" 91
    rm -f "$active_flag"
    return 91
  fi
  local ready=0
  for _attempt in $(seq 1 30); do
    if /usr/bin/curl -fsS --max-time 3 -H "X-InstaComp-AI-Key: $api_key" \
      "http://127.0.0.1:8787/v1/deal-hunter/status" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  if [ "$ready" -ne 1 ]; then
    log "Deal Hunter: FAILED local InstaComp API did not become ready for ${today} ${slot}"
    notify_restart "deal-hunter-schedule" 93
    rm -f "$active_flag"
    return 93
  fi
  log "Deal Hunter: starting consolidated ${today} ${slot} Mountain run"
  response=$(INSTACOMP_AI_API_KEY="$api_key" python3 - <<'PYRUN' 2>>"$LOG_ROOT/deal-hunter-schedule.err.log"
import json, os, urllib.request
key=os.environ.get("INSTACOMP_AI_API_KEY", "")
req=urllib.request.Request(
    "http://127.0.0.1:8787/v1/deal-hunter/run",
    data=b"",
    method="POST",
    headers={"X-InstaComp-AI-Key": key, "Accept": "application/json"},
)
with urllib.request.urlopen(req, timeout=3600) as r:
    print(r.read().decode("utf-8"))
PYRUN
  ) || {
      local rc=$?
      log "Deal Hunter: request FAILED rc=$rc for ${today} ${slot}"
      notify_restart "deal-hunter-schedule" "$rc"
      rm -f "$active_flag"
      return "$rc"
    }
  printf '%s\n' "$response" >>"$LOG_ROOT/deal-hunter-schedule.log"
  python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("accepted") is True and d.get("status") == "completed" else 1)' <<<"$response" || {
    log "Deal Hunter: run did not complete cleanly for ${today} ${slot}"
    notify_restart "deal-hunter-schedule" 92
    rm -f "$active_flag"
    return 92
  }
  log "Deal Hunter: completed consolidated ${today} ${slot} Mountain run"
  local receipt
  receipt=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(f"discovered={d.get("discovery",0)} evaluated={d.get("evaluated",0)} actionable={d.get("actionable",0)} review={d.get("manual_review",0)} failures={d.get("failure",0)}")' <<<"$response" 2>/dev/null || echo "completed")
  /usr/bin/osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Deal Hunter completed" sound name "Glass"' -e 'end run' -- "${today} ${slot} — ${receipt}" >/dev/null 2>&1 || true
  rm -f "$active_flag"
  return 0
}

dagdanky_inventory_sync_once() {
  local repo="/Users/davidbakanas/dagdankyshoes"
  local response rc
  log "DagDanky Inventory: running production marketplace sold-item sync"
  response=$(cd "$repo" && /bin/bash scripts/unsworth-marketplace-sync.sh)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "DagDanky Inventory: sync FAILED rc=$rc"
    notify_restart "dagdanky-inventory" "$rc"
    return "$rc"
  fi
  printf '%s\n' "$response" >>"$LOG_ROOT/dagdanky-inventory.log"
  log "DagDanky Inventory: sync completed"
  return 0
}

dagdanky_inventory_scheduler() {
  local stamp="$STATE_ROOT/dagdanky-inventory-last-run" interval=21600
  while true; do
    local now last=0
    now=$(date +%s)
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    if [ $((now-last)) -ge "$interval" ]; then
      if dagdanky_inventory_sync_once; then date +%s > "$stamp"; else sleep 300; continue; fi
    fi
    sleep 60
  done
}

external_learning_run_once() {
  local rc
  log "External Learning: pulling approved source manifests into Mac-local staging"
  "$SERVICE/.venv/bin/python" "$SERVICE/scripts/external_learning_worker.py" \
    >>"$LOG_ROOT/external-learning.log" 2>>"$LOG_ROOT/external-learning.err.log"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "External Learning: worker FAILED rc=$rc"
    notify_restart "external-learning" "$rc"
    return "$rc"
  fi
  log "External Learning: pull completed; no outside record was auto-promoted"
  return 0
}

external_learning_scheduler() {
  local stamp="$STATE_ROOT/external-learning-last-run" interval=21600
  local catalog="$SERVICE/data/datasets/external-learning/sources.json"
  while true; do
    local now last=0 catalog_mtime=0
    now=$(date +%s)
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    [ -f "$catalog" ] && catalog_mtime=$(stat -f %m "$catalog" 2>/dev/null || echo 0)
    [[ "$catalog_mtime" =~ ^[0-9]+$ ]] || catalog_mtime=0
    if [ $((now-last)) -ge "$interval" ] || [ "$catalog_mtime" -gt "$last" ]; then
      if external_learning_run_once; then
        date +%s > "$stamp"
      else
        sleep 300
        continue
      fi
    fi
    sleep 60
  done
}

checklist_registry_bridge_run_once() {
  local rc
  log "Checklist Registry Bridge: resolving trusted Sentinel downloads into Mac-local Registry"
  "$SERVICE/.venv/bin/python" "$SERVICE/scripts/sentinel_pending_registry_bridge.py" --limit 50 --min-age-seconds 120 \
    >>"$LOG_ROOT/checklist-registry-bridge.log" 2>>"$LOG_ROOT/checklist-registry-bridge.err.log"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "Checklist Registry Bridge: worker FAILED rc=$rc"
    notify_restart "checklist-registry-bridge" "$rc"
    return "$rc"
  fi
  log "Checklist Registry Bridge: pass completed"
  return 0
}

checklist_registry_bridge_scheduler() {
  local stamp="$STATE_ROOT/checklist-registry-bridge-last-run-epoch" interval=300
  while true; do
    local now last=0
    now=$(date +%s)
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    if [ $((now-last)) -ge "$interval" ]; then
      if checklist_registry_bridge_run_once; then
        date +%s > "$stamp"
      else
        sleep 120
        continue
      fi
    fi
    sleep 30
  done
}


checklist_learning_run_once() {
  local rc
  log "Checklist Learning: ingesting new/changed Mac-local registry releases"
  "$SERVICE/.venv/bin/python" "$SERVICE/scripts/checklist_learning_worker.py" \
    >>"$LOG_ROOT/checklist-learning.log" 2>>"$LOG_ROOT/checklist-learning.err.log"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "Checklist Learning: worker FAILED rc=$rc"
    notify_restart "checklist-learning" "$rc"
    return "$rc"
  fi
  log "Checklist Learning: ingestion completed"
  return 0
}

teacher_student_run_once() {
  local rc
  log "Teacher Student: checking Mac-local curriculum + frozen graduation readiness"
  "$SERVICE/.venv/bin/python" "$SERVICE/scripts/teacher_student_employee.py" --launch-if-ready \
    >>"$LOG_ROOT/teacher-student.log" 2>>"$LOG_ROOT/teacher-student.err.log"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "Teacher Student: employee FAILED rc=$rc"
    notify_restart "teacher-student" "$rc"
    return "$rc"
  fi
  log "Teacher Student: readiness pass completed; promotion remains fail-closed"
  return 0
}

teacher_student_scheduler() {
  local stamp="$STATE_ROOT/teacher-student-last-run" interval=21600
  while true; do
    local now last=0
    now=$(date +%s)
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    if [ $((now-last)) -ge "$interval" ]; then
      if teacher_student_run_once; then
        date +%s > "$stamp"
      else
        sleep 300
        continue
      fi
    fi
    sleep 60
  done
}

checklist_learning_scheduler() {
  local stamp="$STATE_ROOT/checklist-learning-last-run-epoch"
  local registry="$SERVICE/data/database/checklist_registry.sqlite3"
  local registry_wal="${registry}-wal" interval=3600
  while true; do
    local now last=0 registry_mtime=0 wal_mtime=0
    now=$(date +%s)
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    [[ "$last" =~ ^[0-9]+$ ]] || last=0
    [ -f "$registry" ] && registry_mtime=$(stat -f %m "$registry" 2>/dev/null || echo 0)
    [ -f "$registry_wal" ] && wal_mtime=$(stat -f %m "$registry_wal" 2>/dev/null || echo 0)
    [[ "$registry_mtime" =~ ^[0-9]+$ ]] || registry_mtime=0
    [[ "$wal_mtime" =~ ^[0-9]+$ ]] || wal_mtime=0
    [ "$wal_mtime" -gt "$registry_mtime" ] && registry_mtime="$wal_mtime"
    if [ "$registry_mtime" -gt "$last" ] && [ $((now-last)) -ge "$interval" ]; then
      if checklist_learning_run_once; then
        date +%s > "$stamp"
      else
        sleep 300
        continue
      fi
    fi
    sleep 60
  done
}

deal_hunter_scheduler() {
  local stamp="$STATE_ROOT/deal-hunter-last-slot"
  local slots=("07:00" "12:55" "19:30")
  while true; do
    local today now current="" last=""
    today=$(date +%F)
    now=$(date +%H:%M)
    for candidate in "${slots[@]}"; do
      if [ "$now" = "$candidate" ]; then current="$candidate"; fi
    done
    [ -f "$stamp" ] && last=$(tail -1 "$stamp" 2>/dev/null || true)
    if [ -n "$current" ] && [ "$last" != "${today}|${current}" ]; then
      if deal_hunter_run_once "$today" "$current"; then
        printf '%s|%s\n' "$today" "$current" > "$stamp"
      else
        sleep 300
      fi
    fi
    sleep 60
  done
}

kill_tree() {
  local pid="$1"
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM HUP
  log "Unsworth stopping; terminating managed children"
  if [ "$(cat "$LOCKDIR/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -rf "$LOCKDIR"
    rm -f "$LOCKFILE"
  fi
  rm -f "$STATE_ROOT/deal-hunter-active" "$STATE_ROOT/lora-training-active"
  for pid in "${PIDS[@]}"; do kill_tree "$pid"; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM HUP

log "Unsworth starting"
start_loop "instacomp-api" instacomp_api_watch
start_loop "cloudflare-tunnel" /opt/homebrew/bin/cloudflared tunnel --no-autoupdate --config "$HOME/.cloudflared/instacomp-ai.yml" run abdb0162-27fa-4b10-9189-c8cfdcc4d37e
start_loop "wallpaper" /opt/homebrew/bin/python3 "$WALLPAPER/playlist_server.py"

if [ "$TRAINING_AVAILABLE" -eq 1 ]; then
  start_loop "lora-candidate" lora_candidate_watch
  start_loop "lora-training-watch" lora_training_watch
else
  log "Training lanes skipped because the mounted adapter workspace is unavailable"
fi

# Checklist Sentinel is owned by the local InstaComp API and its SQLite-backed
# scheduler. Do not start the legacy Supabase queue worker here.
log "Checklist: using Mac-local Sentinel SQLite scheduler"
start_loop "deal-hunter-scheduler" deal_hunter_scheduler
start_loop "truely-ebay-inventory" /bin/bash "$STATE_ROOT/truely-ebay-inventory-employee.sh"
start_loop "dagdanky-inventory-scheduler" dagdanky_inventory_scheduler
start_loop "external-learning-scheduler" external_learning_scheduler
start_loop "checklist-registry-bridge-scheduler" checklist_registry_bridge_scheduler
start_loop "checklist-learning-scheduler" checklist_learning_scheduler
start_loop "teacher-student-scheduler" teacher_student_scheduler
start_loop "daily-operations-report" /bin/bash "$STATE_ROOT/unsworth-daily-report-employee.sh"

log "Unsworth launched managed workers: ${PIDS[*]}"
while true; do sleep 300; done
