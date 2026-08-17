#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Staged InstaComp learning must run on the Apple Silicon Mac." >&2
  exit 2
fi

original_args=("$@")
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
service_root="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$service_root" rev-parse --show-toplevel 2>/dev/null || true)"
expected_service_root="$repo_root/services/instacomp-ai"
launcher="$service_root/scripts/run_staged_pinned_promotion.sh"

if [[ -z "$repo_root" || "$service_root" != "$expected_service_root" ]]; then
  echo "Refusing staged learning: unexpected repository layout." >&2
  exit 2
fi

origin="$(git -C "$repo_root" remote get-url origin 2>/dev/null || true)"
case "$origin" in
  https://github.com/TruelyCollectables/truely-collectables|https://github.com/TruelyCollectables/truely-collectables.git|git@github.com:TruelyCollectables/truely-collectables.git) ;;
  *) echo "Refusing staged learning: unexpected Git origin '$origin'." >&2; exit 2 ;;
esac

[[ "$(git -C "$repo_root" branch --show-current)" == "main" ]] || {
  echo "Refusing staged learning: Mac checkout must be on main." >&2
  exit 2
}

if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ]]; then
  echo "Refusing staged learning: tracked working tree changes are present." >&2
  git -C "$repo_root" status --short --untracked-files=no >&2
  exit 2
fi

[[ -f "$launcher" ]] || {
  echo "Refusing staged learning: promotion launcher is missing: $launcher" >&2
  exit 2
}

echo "INFO Syncing staged learner directly from origin/main"
git -C "$repo_root" fetch --prune origin main
current="$(git -C "$repo_root" rev-parse HEAD)"
remote_main="$(git -C "$repo_root" rev-parse origin/main)"
git -C "$repo_root" merge-base --is-ancestor "$current" "$remote_main" || {
  echo "Refusing staged learning: local main cannot fast-forward to origin/main." >&2
  exit 2
}
git -C "$repo_root" merge --ff-only origin/main
updated="$(git -C "$repo_root" rev-parse HEAD)"

if [[ "$updated" != "$current" && "${INSTACOMP_STAGED_REEXECED:-0}" != "1" ]]; then
  echo "INFO Staged learner source advanced to $updated; restarting from updated orchestration code"
  exec env INSTACOMP_STAGED_REEXECED=1 bash "$service_root/scripts/run-staged-learning-from-main.sh" "${original_args[@]}"
fi

echo "PASS staged learner source synchronized at $updated"
echo "INFO Running the isolated promotion contract self-test before live preflight"
bash "$launcher" --self-test

echo "PASS staged learner contract self-test"

requested_target=10
passthrough=()
while (( $# > 0 )); do
  case "$1" in
    --stage-target)
      (( $# >= 2 )) || { echo "--stage-target requires 10, 15, or 25" >&2; exit 2; }
      requested_target="$2"
      shift 2
      ;;
    --stage-target=*)
      requested_target="${1#*=}"
      shift
      ;;
    *)
      passthrough+=("$1")
      shift
      ;;
  esac
done

case "$requested_target" in
  10) stages=(10) ;;
  15) stages=(10 15) ;;
  25) stages=(10 15 25) ;;
  *)
    echo "Unsupported staged learning target '$requested_target'; allowed: 10, 15, 25" >&2
    exit 2
    ;;
esac

echo "INFO Starting live staged promotion ladder ${stages[*]}; Cloudflare Sentinel deployment status is not a learning prerequisite"
for stage in "${stages[@]}"; do
  echo "INFO Certifying Frozen $stage with current v17 Registry/physical-card gates"
  bash "$launcher" "${passthrough[@]}" --stage-target "$stage"
  echo "PASS Frozen $stage certification completed"
done

echo "PASS staged learning ladder completed through Frozen $requested_target"
