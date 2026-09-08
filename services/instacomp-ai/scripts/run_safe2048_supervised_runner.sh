#!/bin/bash
set -uo pipefail

SERVICE="/Users/davidbakanas/Developer/truely-collectables/services/instacomp-ai"
PY="$SERVICE/.venv-lora/bin/python"
DATASET="/Volumes/InstaCompAI/training/exports/teacher-20260821T111629Z-SAFE2048"
ADAPTER_ROOT="/Volumes/InstaCompAI/training/adapters"
LOG_ROOT="/Volumes/InstaCompAI/training/logs"
PROGRESS="/Volumes/InstaCompAI/training/lora-safe2048-supervised-progress.txt"
export HF_DATASETS_CACHE="/Volumes/InstaCompAI/training/hf-datasets-cache-safe2048"
TARGET=37964
MAX_CHUNK=50
MAX_ZERO_RETRIES=3
CURRENT="${1:-}"
CURRENT_ADAPTER="${2:-}"

mkdir -p "$ADAPTER_ROOT/resume-bundles" "$LOG_ROOT"
fail(){ echo "STOP: $*" >&2; exit 1; }
[[ "$CURRENT" =~ ^[0-9]+$ ]] || fail "invalid starting cumulative: $CURRENT"
test -s "$CURRENT_ADAPTER" || fail "starting adapter missing: $CURRENT_ADAPTER"
CURRENT_CONFIG="$(dirname "$CURRENT_ADAPTER")/adapter_config.json"
test -s "$CURRENT_CONFIG" || fail "adapter config missing: $CURRENT_CONFIG"
test -s "$DATASET/train.jsonl" || fail "SAFE2048 dataset missing"
finite_check(){
  "$PY" - "$1" <<'PY'
import sys
import numpy as np
import safetensors.numpy as st
p=sys.argv[1]
try:
    weights=st.load_file(p)
except Exception as exc:
    print(f"LOAD_FAIL {exc}", file=sys.stderr); raise SystemExit(2)
bad=sum(int((~np.isfinite(np.asarray(v))).sum()) for v in weights.values())
if bad:
    print(f"NONFINITE {bad}", file=sys.stderr); raise SystemExit(3)
print(f"FINITE_OK tensors={len(weights)}")
PY
}

finite_check "$CURRENT_ADAPTER" >/dev/null || fail "starting adapter failed finite-weight validation"
printf '%s\n' "$CURRENT" > "$PROGRESS"
ATTEMPT_SERIAL=0
ZERO_RETRIES=0
echo "SUPERVISED SAFE2048 RUNNER starting at $CURRENT / $TARGET"
while [ "$CURRENT" -lt "$TARGET" ]; do
  REMAINING=$((TARGET-CURRENT))
  if [ "$REMAINING" -gt "$MAX_CHUNK" ]; then STEPS="$MAX_CHUNK"; else STEPS="$REMAINING"; fi
  NEXT=$((CURRENT+STEPS))
  ATTEMPT_SERIAL=$((ATTEMPT_SERIAL+1))
  STAMP=$(date +%Y%m%dT%H%M%S)
  RUN_ID="c${CURRENT}-${STAMP}-p$$-a${ATTEMPT_SERIAL}"
  RESUME="$ADAPTER_ROOT/resume-bundles/safe2048-supervised-${RUN_ID}"
  OUT="$ADAPTER_ROOT/instacomp-safe2048-supervised-${RUN_ID}"
  LOG="$LOG_ROOT/lora-safe2048-supervised-${RUN_ID}.log"
  [ ! -e "$RESUME" ] || fail "resume collision: $RESUME"
  [ ! -e "$OUT" ] || fail "output collision: $OUT"
  mkdir -p "$RESUME" "$OUT"
  cp "$CURRENT_ADAPTER" "$RESUME/adapters.safetensors" || fail "resume adapter copy failed"
  cp "$CURRENT_CONFIG" "$RESUME/adapter_config.json" || fail "resume config copy failed"
  cp "$CURRENT_CONFIG" "$OUT/adapter_config.json" || fail "output config copy failed"
  echo "ATTEMPT cumulative $CURRENT -> $NEXT ($STEPS steps)"

  set +e
  caffeinate -dims "$PY" -m mlx_vlm.lora \
    --model-path mlx-community/Qwen3-VL-2B-Instruct-4bit \
    --dataset "$DATASET" --split train --batch-size 1 --iters "$STEPS" \
    --learning-rate 0.0002 --lora-rank 16 --lora-alpha 32 --lora-dropout 0.05 \
    --gradient-accumulation-steps 4 --grad-checkpoint --train-on-completions \
    --image-resize-shape 512 512 --max-seq-length 2048 \
    --steps-per-report 1 --steps-per-eval 25 --steps-per-save 20 \
    --output-path "$OUT/adapters.safetensors" --adapter-path "$RESUME" \
    2>&1 | tee "$LOG"
  STATUS=${PIPESTATUS[0]}
  set -e

  ACCEPTED=""
  ADVANCE=0
  if [ "$STATUS" -eq 0 ] && grep -q 'Training completed!' "$LOG" \
     && [ -s "$OUT/adapters.safetensors" ] \
     && finite_check "$OUT/adapters.safetensors" >>"$LOG" 2>&1; then
    ACCEPTED="$OUT/adapters.safetensors"
    ADVANCE="$STEPS"
  else
    BEST_FILE=""
    BEST_STEP=0
    for CP in "$OUT"/0*_adapters.safetensors; do
      [ -f "$CP" ] || continue
      BASE=$(basename "$CP")
      NUM=${BASE%%_*}
      STEP=$((10#$NUM))
      if [ "$STEP" -gt "$BEST_STEP" ] && finite_check "$CP" >>"$LOG" 2>&1; then
        BEST_STEP="$STEP"
        BEST_FILE="$CP"
      fi
    done
    if [ "$BEST_STEP" -gt 0 ] && [ -n "$BEST_FILE" ]; then
      ACCEPTED="$BEST_FILE"
      ADVANCE="$BEST_STEP"
    fi
  fi

  if [ "$ADVANCE" -gt 0 ] && [ -n "$ACCEPTED" ]; then
    OLD_CURRENT="$CURRENT"
    CURRENT=$((CURRENT+ADVANCE))
    CURRENT_ADAPTER="$ACCEPTED"
    CURRENT_CONFIG="$OUT/adapter_config.json"
    ZERO_RETRIES=0
    printf '%s\n' "$CURRENT" > "$PROGRESS"
    echo "VERIFIED PROGRESS: $OLD_CURRENT + $ADVANCE = $CURRENT / $TARGET"
  else
    ZERO_RETRIES=$((ZERO_RETRIES+1))
    echo "ZERO-PROGRESS FAILURE at $CURRENT; retry $ZERO_RETRIES / $MAX_ZERO_RETRIES" >&2
    if [ "$ZERO_RETRIES" -ge "$MAX_ZERO_RETRIES" ]; then
      fail "too many consecutive zero-progress failures at cumulative $CURRENT"
    fi
  fi
  echo "Recycling MLX/Metal before next process..."
  sleep 15
done

echo "ALL NOMINAL TRAINING ITERATIONS COMPLETE"
echo "FINAL CUMULATIVE: $CURRENT / $TARGET"
echo "FINAL ADAPTER: $CURRENT_ADAPTER"
printf '%s\n' "$CURRENT" > "$PROGRESS"
finite_check "$CURRENT_ADAPTER" || fail "final adapter failed finite-weight validation"
