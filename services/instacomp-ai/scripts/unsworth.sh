#!/bin/bash
set -uo pipefail

ROOT="/Users/davidbakanas/Developer/truely-collectables"
SERVICE="$ROOT/services/instacomp-ai"
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

if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE" 2>/dev/null || true)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Unsworth already running PID $OLD_PID"
    exit 0
  fi
fi

echo $$ > "$LOCKFILE"


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
    if /usr/bin/curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then
      sleep 10
      continue
    fi
    local listeners
    listeners=$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$listeners" ]; then
      log "instacomp-api unhealthy; terminating stale listener(s): ${listeners//$'\n'/ }"
      for pid in $listeners; do kill -TERM "$pid" 2>/dev/null || true; done
      sleep 3
      for pid in $listeners; do kill -KILL "$pid" 2>/dev/null || true; done
    fi
    local started rc runtime
    started=$(date +%s); log "Starting instacomp-api"
    /bin/bash "$SERVICE/scripts/run-local.sh" >>"$out" 2>>"$err" &
    local api_pid=$!
    local ready=0
    for _attempt in $(seq 1 45); do
      if /usr/bin/curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then ready=1; break; fi
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
  "$SERVICE/.venv-lora/bin/python" - "$SERVICE/data/training/adapters" 37964 <<'PYCHK'
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
lora_training_watch() {
  local target=37964
  local runner="$SERVICE/scripts/run_safe2048_supervised_runner.sh"
  local progress="$SERVICE/data/logs/lora-safe2048-supervised-progress.txt"
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
    /bin/bash "$runner" "$current" "$adapter" >>"$LOG_ROOT/lora-training.log" 2>>"$LOG_ROOT/lora-training.err.log"
    local rc=$?
    log "LoRA training runner exited rc=$rc"
    [ "$rc" -ne 0 ] && notify_restart "lora-training" "$rc"
    sleep 15
  done
}

checklist_verified_today() {
  (
    cd "$ROOT" || exit 90
    /opt/homebrew/bin/node --env-file=.env.local --input-type=module - <<'JS'
import { createClient } from '@supabase/supabase-js';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const start=new Date(); start.setHours(0,0,0,0);
const end=new Date(start); end.setDate(end.getDate()+1);
let lastError=null;
for(let attempt=1;attempt<=6;attempt++){
  const {count,error}=await db.from('checklist_releases').select('id',{count:'exact',head:true}).eq('resolution_eligible',true).gte('verified_at',start.toISOString()).lt('verified_at',end.toISOString());
  if(!error){ console.log(Number(count||0)); process.exit(0); }
  lastError=error;
  await new Promise(r=>setTimeout(r,Math.min(8000,500*2**(attempt-1))));
}
console.error(lastError?.message||'daily verified count failed'); process.exit(1);
JS
  )
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
      log "Checklist: could not read daily verified total; waiting for Supabase and retrying"
      notify_restart "checklist-daily-goal" 93
      sleep 30
      continue
    fi
    if [ "$verified" -ge "$goal" ]; then
      printf '%s\n' "$today" > "$STATE_ROOT/checklist-last-run-date"
      log "Checklist: daily goal reached ${verified}/${goal} for $today"
      /usr/bin/osascript -e "display notification \"Daily checklist goal reached: ${verified}/${goal} resolver-live sets.\" with title \"Unsworth\" sound name \"Glass\"" >/dev/null 2>&1 || true
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
  rm -f "$LOCKFILE"
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
  start_loop "lora-candidate" "$TRAINING/.venv-lora/bin/python" "$TRAINING/scripts/run_lora_candidate_server.py" --adapter "$TRAINING_VOLUME/training/adapters/instacomp-20260814T135158Z" --port 8791
  start_loop "lora-training-watch" lora_training_watch
else
  log "Training lanes skipped because the mounted adapter workspace is unavailable"
fi

# Checklist Sentinel is owned by the local InstaComp API and its SQLite-backed
# scheduler. Do not start the legacy Supabase queue worker here.
log "Checklist: using Mac-local Sentinel SQLite scheduler"
start_loop "deal-hunter-scheduler" deal_hunter_scheduler

log "Unsworth launched managed workers: ${PIDS[*]}"
while true; do sleep 300; done
