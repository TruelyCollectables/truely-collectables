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

# Production uses the core Registry identity uniqueness contract. Reinstall the
# immutable transactional writer unchanged rather than adding a predicate for a
# column that is not part of checklist_card_identities.
writer_source="$work_dir/transactional-writer.sql"
curl --silent --show-error --fail --location \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --output "$writer_source" \
  "https://raw.githubusercontent.com/TruelyCollectables/truely-collectables/61656f2624523aa197b3676bbb5b29ef5ba191c4/supabase/migrations/20260731161500_checklist_registry_transactional_writer.sql"

python3 - "$writer_source" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
plain = "on conflict (identity_schema, fingerprint_sha256) do nothing;"
if source.count(plain) != 1:
    raise SystemExit("Transactional writer does not contain the expected identity conflict target.")
PY

run_query writer-identity-conflict-repair "$writer_source"

sleep 5
echo "Checklist Registry writer uniqueness, identity conflict target, and bounded timeout are ready."
