#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "The unseen learning cycle must run on the Apple Silicon Mac." >&2
  exit 2
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
service_python="$service_root/.venv/bin/python"
benchmark_launcher="$service_root/scripts/run-unseen-holdout-benchmark-from-main.sh"
curriculum="$service_root/scripts/train_lora_from_unseen_benchmarks.py"
inventory_sync="$service_root/scripts/sync_all_inventory_training_truth_guarded.py"
finisher="$service_root/scripts/finish_deal_hunter_ai_learning.py"
staged="$service_root/scripts/run-staged-learning-from-main.sh"
enable_candidate="$service_root/scripts/enable-lora-candidate-macos.sh"
completion_receipt="$service_root/data/training/deal-hunter-ai-learning-latest.json"
training_receipt="$service_root/data/training/full-inventory-lora-latest.json"
stage_manifest="$service_root/data/lora-candidate/staged-promotion-fixtures-latest.json"
benchmark_dir="$service_root/data/lora-candidate/benchmarks"
max_learning_rounds="${INSTACOMP_UNSEEN_MAX_LEARNING_ROUNDS:-3}"

if [[ -z "$repo_root" || "$service_root" != "$repo_root/services/instacomp-ai" ]]; then
  echo "Refusing learning cycle: unexpected repository layout." >&2
  exit 2
fi
[[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
  echo "Refusing learning cycle: Mac checkout must be on main." >&2
  exit 2
}
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing learning cycle: tracked working tree changes are present." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi
[[ -x "$service_python" ]] || { echo "Missing service Python: $service_python" >&2; exit 2; }
for required in "$benchmark_launcher" "$curriculum" "$inventory_sync" "$finisher" "$staged" "$enable_candidate"; do
  [[ -f "$required" ]] || { echo "Missing learning-cycle component: $required" >&2; exit 2; }
done
if ! [[ "$max_learning_rounds" =~ ^[0-9]+$ ]] || (( max_learning_rounds < 1 || max_learning_rounds > 5 )); then
  echo "INSTACOMP_UNSEEN_MAX_LEARNING_ROUNDS must be an integer from 1 through 5." >&2
  exit 2
fi

echo "INFO Syncing complete unseen learning cycle from origin/main"
git -C "$repo_root" fetch --prune origin main
current="$(git -C "$repo_root" rev-parse HEAD)"
remote_main="$(git -C "$repo_root" rev-parse origin/main)"
git -C "$repo_root" merge-base --is-ancestor "$current" "$remote_main" || {
  echo "Refusing learning cycle: local main cannot fast-forward to origin/main." >&2
  exit 2
}
git -C "$repo_root" merge --ff-only origin/main
updated="$(git -C "$repo_root" rev-parse HEAD)"
if [[ "$updated" != "$current" && "${INSTACOMP_UNSEEN_CYCLE_REEXECED:-0}" != "1" ]]; then
  echo "INFO Learning-cycle source advanced to $updated; restarting from updated code"
  exec env INSTACOMP_UNSEEN_CYCLE_REEXECED=1 bash "$service_root/scripts/run-unseen-learning-cycle-from-main.sh"
fi

echo "PASS unseen learning-cycle source synchronized at $updated"
bash "$service_root/scripts/ensure-runtime-dependencies.sh" "$service_python"
if [[ -f "$service_root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$service_root/.env"
  set +a
fi
export PYTHONPATH="$service_root:$service_root/scripts${PYTHONPATH:+:$PYTHONPATH}"

"$service_python" "$service_root/scripts/benchmark_lora_unseen_holdout.py" --self-test
"$service_python" "$curriculum" --self-test

echo "INFO Learning policy: never train on a partial benchmark; never rescore a previously used image as unseen."
echo "INFO Misses are trainable only when current trusted truth still matches the benchmark Registry UUID + fingerprint."
echo "INFO Every new adapter must pass locked validation and Frozen 10 -> 15 -> 25 before the next disjoint 100-card exam."

latest_benchmark_receipt() {
  "$service_python" - "$benchmark_dir" <<'PY'
import sys
from pathlib import Path
root = Path(sys.argv[1])
paths = sorted(root.glob("unseen-holdout-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
print(paths[0] if paths else "")
PY
}

current_validated_adapter() {
  "$service_python" - "$completion_receipt" <<'PY'
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
if not path.is_file():
    print("")
else:
    payload = json.loads(path.read_text("utf-8"))
    print(str(payload.get("adapter_directory") or ""))
PY
}

backup_known_good() {
  local dir="$1"
  mkdir -p "$dir"
  [[ -f "$completion_receipt" ]] && cp -p "$completion_receipt" "$dir/completion.json"
  [[ -f "$training_receipt" ]] && cp -p "$training_receipt" "$dir/training.json"
  [[ -f "$stage_manifest" ]] && cp -p "$stage_manifest" "$dir/stage-manifest.json"
  current_validated_adapter > "$dir/adapter.txt"
}

restore_known_good() {
  local dir="$1"
  echo "ROLLBACK restoring last certified adapter receipts after failed learning generation" >&2
  [[ -f "$dir/completion.json" ]] && cp -p "$dir/completion.json" "$completion_receipt"
  [[ -f "$dir/training.json" ]] && cp -p "$dir/training.json" "$training_receipt"
  [[ -f "$dir/stage-manifest.json" ]] && cp -p "$dir/stage-manifest.json" "$stage_manifest"
  local old_adapter=""
  [[ -f "$dir/adapter.txt" ]] && old_adapter="$(cat "$dir/adapter.txt")"
  if [[ -n "$old_adapter" && -d "$old_adapter" ]]; then
    bash "$enable_candidate" "$old_adapter" || true
    echo "ROLLBACK re-enabled prior certified runtime candidate: $old_adapter" >&2
  fi
}

run_exam() {
  bash "$benchmark_launcher" --target 100 --registry-call-budget 1500
}

# The initial exam belongs entirely to the currently certified adapter.
echo "===== UNSEEN 100-CARD EXAM: CURRENT CERTIFIED ADAPTER ====="
set +e
run_exam
exam_code=$?
set -e

if (( exam_code == 0 )); then
  echo "PASS current adapter already graduated the complete disjoint 100-card benchmark. No retraining performed."
  exit 0
fi
if (( exam_code != 5 )); then
  echo "STOP initial 100-card exam did not complete cleanly (exit=$exam_code). No training was allowed." >&2
  exit "$exam_code"
fi

for (( round=1; round<=max_learning_rounds; round++ )); do
  echo "===== LEARNING GENERATION ${round}/${max_learning_rounds} ====="
  rollback_dir="$(mktemp -d "${TMPDIR:-/tmp}/instacomp-unseen-rollback.XXXXXX")"
  backup_known_good "$rollback_dir"

  echo "INFO Refreshing authoritative inventory/checklist-backed trusted corpus before training"
  if ! "$service_python" "$inventory_sync"; then
    restore_known_good "$rollback_dir"
    rm -rf "$rollback_dir"
    exit 20
  fi

  echo "INFO Training a new warm-start adapter from Registry-verified misses across completed 100-card exams"
  if ! "$service_python" "$curriculum" --epochs 1 --learning-rate 0.00005 --curriculum-multiplier 3; then
    restore_known_good "$rollback_dir"
    rm -rf "$rollback_dir"
    exit 21
  fi

  echo "INFO Running canonical locked held-out validation for the new adapter"
  if ! "$service_python" "$finisher" --validation-only --required-examples 30; then
    restore_known_good "$rollback_dir"
    rm -rf "$rollback_dir"
    exit 22
  fi

  echo "INFO Running full V20 staged certification Frozen 10 -> 15 -> 25"
  if ! bash "$staged" --stage-target 25; then
    restore_known_good "$rollback_dir"
    rm -rf "$rollback_dir"
    exit 23
  fi

  rm -rf "$rollback_dir"
  echo "PASS learning generation $round certified; starting a different untouched 100-card exam"
  echo "===== DISJOINT 100-CARD EXAM AFTER LEARNING GENERATION $round ====="
  set +e
  run_exam
  exam_code=$?
  set -e

  if (( exam_code == 0 )); then
    receipt="$(latest_benchmark_receipt)"
    echo "PASS INSTACOMP UNSEEN LEARNING CYCLE GRADUATED after generation $round"
    echo "FINAL 100-CARD RECEIPT: $receipt"
    exit 0
  fi
  if (( exam_code != 5 )); then
    echo "STOP post-training 100-card exam did not complete cleanly (exit=$exam_code). Certified adapter remains intact; no further training allowed." >&2
    exit "$exam_code"
  fi

done

receipt="$(latest_benchmark_receipt)"
echo "NOT YET: completed ${max_learning_rounds} safe learning generations without reaching the >=95% 100-card gate." >&2
echo "LATEST 100-CARD RECEIPT: $receipt" >&2
echo "The latest adapter remains fully locked-validation + Frozen-25 certified; no unsafe promotion occurred." >&2
exit 5
