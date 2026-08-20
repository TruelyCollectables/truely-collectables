#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "The live unseen holdout benchmark must run on the Apple Silicon Mac." >&2
  exit 2
fi

original_args=("$@")
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
expected_service_root="$repo_root/services/instacomp-ai"
service_python="$service_root/.venv/bin/python"
target="$service_root/scripts/benchmark_lora_unseen_holdout_v9.py"

if [[ -z "$repo_root" || "$service_root" != "$expected_service_root" ]]; then
  echo "Refusing unseen benchmark: unexpected repository layout." >&2
  exit 2
fi

origin="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/TruelyCollectables/truely-collectables|https://github.com/TruelyCollectables/truely-collectables.git|git@github.com:TruelyCollectables/truely-collectables.git) ;;
  *) echo "Refusing unseen benchmark: unexpected Git origin '$origin'." >&2; exit 2 ;;
esac

[[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
  echo "Refusing unseen benchmark: Mac checkout must be on main." >&2
  exit 2
}

if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing unseen benchmark: tracked working tree changes are present." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi

[[ -x "$service_python" ]] || {
  echo "InstaComp service Python is missing: $service_python" >&2
  exit 2
}
[[ -f "$target" ]] || {
  echo "Canonical unseen benchmark runner is missing: $target" >&2
  exit 2
}

echo "INFO Syncing canonical unseen benchmark directly from origin/main"
git -C "$repo_root" fetch --prune origin main
current="$(git -C "$repo_root" rev-parse HEAD)"
remote_main="$(git -C "$repo_root" rev-parse origin/main)"
git -C "$repo_root" merge-base --is-ancestor "$current" "$remote_main" || {
  echo "Refusing unseen benchmark: local main cannot fast-forward to origin/main." >&2
  exit 2
}
git -C "$repo_root" merge --ff-only origin/main
updated="$(git -C "$repo_root" rev-parse HEAD)"

if [[ "$updated" != "$current" && "${INSTACOMP_UNSEEN_REEXECED:-0}" != "1" ]]; then
  echo "INFO Unseen benchmark source advanced to $updated; restarting from updated code"
  exec env INSTACOMP_UNSEEN_REEXECED=1 bash "$service_root/scripts/run-unseen-holdout-benchmark-from-main.sh" "${original_args[@]}"
fi

echo "PASS unseen benchmark source synchronized at $updated"
bash "$service_root/scripts/ensure-runtime-dependencies.sh" "$service_python"
cd "$service_root"

if [[ -f "$service_root/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$service_root/.env"
  set +a
fi

if [[ -z "${INSTACOMP_AI_REGISTRY_TOKEN:-}" && -z "${INSTACOMP_AI_SENTINEL_ARCHIVE_TOKEN:-}" ]]; then
  echo "Refusing unseen benchmark: Registry authentication is missing after loading $service_root/.env." >&2
  exit 2
fi

export PYTHONPATH="$service_root:$service_root/scripts${PYTHONPATH:+:$PYTHONPATH}"

echo "INFO Running canonical unseen holdout benchmark contract self-test"
"$service_python" "$target" --self-test
echo "PASS canonical unseen holdout benchmark contract self-test"
echo "INFO Live benchmark is read-only: no training, no adapter mutation, no inventory mutation, no publishing"
echo "INFO Validation truth may be enriched only from the Mac's current trusted exact-ID, exact-image-hash training example"
echo "INFO Fast bootstrap queries active Registry versions only and spends its budget on V20-ready truth before repair rows"
echo "INFO Bootstrap does not use Apple Vision; normal V20 Registry and physical revalidation still runs before admission"
echo "INFO V8 may recover server input_incomplete only through one bounded fast Registry receipt that must pass current canonical receipt revalidation"
echo "INFO V9 aborts fail-closed when the bootstrap sees a sustained systemic Registry transport outage"
echo "INFO Canonical Registry preflight is bounded, parallel, progress-reporting, and wall-clock limited"
echo "INFO Previously scored image rows are excluded from every later exam"
echo "INFO Multiple unseen image pairs may share one Registry identity, capped at five images per exact identity"
echo "INFO Current Registry UUID/fingerprint and physical evidence remain authoritative"
echo "INFO Graduation requires a complete target, >=95% authoritative exact, zero wrong authoritative identities, zero dangerous variant errors, and zero fallback"

exec "$service_python" "$target" "$@"
