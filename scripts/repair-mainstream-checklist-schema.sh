#!/usr/bin/env bash
set -euo pipefail

: "${GH_SUPABASE_ACCESS_TOKEN:?Supabase Management API token is required}"
: "${RESOLVED_SUPABASE_PROJECT_REF:?Resolved Supabase project ref is required}"

work_dir="$RUNNER_TEMP/mainstream-checklist-writer-repair"
mkdir -p "$work_dir"

run_query() {
  local label="$1"
  local sql_file="$2"
  local request_file="$work_dir/${label}-request.json"
  local response_file="$work_dir/${label}-response.json"
  local http_code

  test -s "$sql_file"
  jq -Rs '{query: ., read_only: false}' "$sql_file" > "$request_file"
  http_code="$(curl --silent --show-error \
    --retry 5 --retry-delay 2 --retry-all-errors \
    --request POST \
    --header "Authorization: Bearer $GH_SUPABASE_ACCESS_TOKEN" \
    --header "Content-Type: application/json" \
    --data-binary "@$request_file" \
    --output "$response_file" \
    --write-out '%{http_code}' \
    "https://api.supabase.com/v1/projects/$RESOLVED_SUPABASE_PROJECT_REF/database/query")"

  if [[ ! "$http_code" =~ ^2 ]]; then
    echo "Checklist Registry ${label} returned HTTP ${http_code}." >&2
    jq -r '
      if type == "object" then
        (.message // .error // .hint // .details // tostring)
      else
        tostring
      end
    ' "$response_file" >&2 || true
    exit 1
  fi

  jq -e 'if type == "object" and (.error? // null) then error(.error) else true end' \
    "$response_file" >/dev/null
}

run_query \
  writer-index-repair \
  supabase/migrations/20260807033000_checklist_registry_writer_repair.sql

writer_source="$work_dir/transactional-writer.sql"
writer_patched="$work_dir/transactional-writer-active-identity.sql"
curl --silent --show-error --fail --location \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --output "$writer_source" \
  "https://raw.githubusercontent.com/TruelyCollectables/truely-collectables/61656f2624523aa197b3676bbb5b29ef5ba191c4/supabase/migrations/20260731161500_checklist_registry_transactional_writer.sql"

python3 - "$writer_source" "$writer_patched" <<'PY'
from pathlib import Path
import sys

source_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
source = source_path.read_text(encoding="utf-8")
old = "on conflict (identity_schema, fingerprint_sha256) do nothing;"
new = "on conflict (identity_schema, fingerprint_sha256) where active do nothing;"
count = source.count(old)
if count != 1:
    raise SystemExit(f"Expected one identity conflict target, found {count}.")
output_path.write_text(source.replace(old, new, 1), encoding="utf-8")
PY

run_query writer-active-identity-repair "$writer_patched"

sleep 5
echo "Checklist Registry writer indexes, active-identity conflict target, and bounded timeout are ready."
