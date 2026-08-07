#!/usr/bin/env bash
set -euo pipefail

: "${GH_SUPABASE_ACCESS_TOKEN:?Supabase Management API token is required}"
: "${RESOLVED_SUPABASE_PROJECT_REF:?Resolved Supabase project ref is required}"

sql_file="supabase/migrations/20260807033000_checklist_registry_writer_repair.sql"
test -s "$sql_file"

work_dir="$RUNNER_TEMP/mainstream-checklist-writer-repair"
mkdir -p "$work_dir"
jq -Rs '{query: ., read_only: false}' "$sql_file" > "$work_dir/request.json"

curl --silent --show-error --fail \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --request POST \
  --header "Authorization: Bearer $GH_SUPABASE_ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary "@$work_dir/request.json" \
  --output "$work_dir/response.json" \
  "https://api.supabase.com/v1/projects/$RESOLVED_SUPABASE_PROJECT_REF/database/query"

jq -e 'if type == "object" and (.error? // null) then error(.error) else true end' \
  "$work_dir/response.json" >/dev/null

sleep 5
echo "Checklist Registry writer uniqueness and timeout repair applied."
