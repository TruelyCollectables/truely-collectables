#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${SUPABASE_PROJECT_REF:=${RESOLVED_SUPABASE_PROJECT_REF:-}}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF or RESOLVED_SUPABASE_PROJECT_REF is required}"

SQL_FILE="supabase/migrations/20260816134500_checklist_registry_chunked_writer.sql"
ROOT="${RUNNER_TEMP:-/tmp}/checklist-chunked-writer-install"
mkdir -p "$ROOT"

jq -Rs '{query: .}' < "$SQL_FILE" > "$ROOT/query.json"

curl --silent --show-error --fail --retry 4 --retry-all-errors --max-time 120 \
  -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @"$ROOT/query.json" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -o "$ROOT/result.json"

cat "$ROOT/result.json"

curl --silent --show-error --fail --retry 4 --retry-all-errors --max-time 60 \
  -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"query":"NOTIFY pgrst, '\''reload schema'\'';"}' \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -o "$ROOT/reload.json"

cat "$ROOT/reload.json"
echo "Checklist Registry chunked writer installed for $SUPABASE_PROJECT_REF."
