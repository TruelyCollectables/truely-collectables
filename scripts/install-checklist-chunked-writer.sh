#!/usr/bin/env bash
set -euo pipefail

: "${GH_SUPABASE_ACCESS_TOKEN:?Supabase Management API token is required}"
: "${RESOLVED_SUPABASE_PROJECT_REF:?Resolved Supabase project ref is required}"

sql_file="supabase/migrations/20260816134500_checklist_registry_chunked_writer.sql"
work_dir="$RUNNER_TEMP/checklist-chunked-writer-install"
mkdir -p "$work_dir"
request_file="$work_dir/request.json"
response_file="$work_dir/response.json"
reload_file="$work_dir/reload.json"

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
  echo "Checklist Registry chunked-writer install returned HTTP ${http_code}." >&2
  cat "$response_file" >&2 || true
  exit 1
fi
jq -e 'if type == "object" and (.error? // null) then error(.error) else true end' "$response_file" >/dev/null

jq -n '{query: "NOTIFY pgrst, '\''reload schema'\'';", read_only: false}' > "$work_dir/reload-request.json"
reload_code="$(curl --silent --show-error \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --request POST \
  --header "Authorization: Bearer $GH_SUPABASE_ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary "@$work_dir/reload-request.json" \
  --output "$reload_file" \
  --write-out '%{http_code}' \
  "https://api.supabase.com/v1/projects/$RESOLVED_SUPABASE_PROJECT_REF/database/query")"
if [[ ! "$reload_code" =~ ^2 ]]; then
  echo "PostgREST schema reload returned HTTP ${reload_code}." >&2
  cat "$reload_file" >&2 || true
  exit 1
fi

echo "Checklist Registry resumable chunked writer installed."
