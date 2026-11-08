#!/usr/bin/env bash
set -euo pipefail

: "${GH_SUPABASE_ACCESS_TOKEN:?Supabase Management API token is required}"
: "${RESOLVED_SUPABASE_PROJECT_REF:?Resolved Supabase project ref is required}"

work_dir="$RUNNER_TEMP/mainstream-checklist-schema"
mkdir -p "$work_dir"

apply_sql() {
  local label="$1"
  local commit="$2"
  local path="$3"
  local sql_file="$work_dir/${label}.sql"
  local body_file="$work_dir/${label}.json"
  local response_file="$work_dir/${label}-response.json"
  local raw_url="https://raw.githubusercontent.com/TruelyCollectables/truely-collectables/${commit}/${path}"

  echo "Applying ${label} from immutable commit ${commit}."
  curl --silent --show-error --fail --location \
    --retry 5 --retry-delay 2 --retry-all-errors \
    --output "$sql_file" "$raw_url"
  test -s "$sql_file"
  jq -Rs '{query: ., read_only: false}' "$sql_file" > "$body_file"
  curl --silent --show-error --fail \
    --retry 5 --retry-delay 2 --retry-all-errors \
    --request POST \
    --header "Authorization: Bearer $GH_SUPABASE_ACCESS_TOKEN" \
    --header "Content-Type: application/json" \
    --data-binary "@$body_file" \
    --output "$response_file" \
    "https://api.supabase.com/v1/projects/$RESOLVED_SUPABASE_PROJECT_REF/database/query"
  jq -e 'if type == "object" and (.error? // null) then error(.error) else true end' \
    "$response_file" >/dev/null
}

apply_sql \
  registry-core \
  61656f2624523aa197b3676bbb5b29ef5ba191c4 \
  supabase/migrations/20260725_tcos_checklist_registry_core.sql
apply_sql \
  registry-source-storage \
  61656f2624523aa197b3676bbb5b29ef5ba191c4 \
  supabase/migrations/20260725_tcos_checklist_source_storage.sql
apply_sql \
  registry-transactional-writer \
  61656f2624523aa197b3676bbb5b29ef5ba191c4 \
  supabase/migrations/20260731161500_checklist_registry_transactional_writer.sql
apply_sql \
  checklist-source-catalog \
  459408fb0d78e25a05b2eff0c1f775cd4b3cbb08 \
  supabase/migrations/20260803110000_checklist_source_catalog.sql

verification_file="$work_dir/verify.sql"
cat > "$verification_file" <<'SQL'
do $$
declare
  registry_tables integer;
  writer_functions integer;
begin
  select count(*) into registry_tables
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and relation.relname like 'checklist\_%' escape '\';

  if registry_tables < 26 then
    raise exception 'Checklist Registry bootstrap expected at least 26 tables, found %', registry_tables;
  end if;

  if to_regclass('public.checklist_source_catalog') is null then
    raise exception 'checklist_source_catalog is missing after bootstrap';
  end if;

  select count(*) into writer_functions
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'tcos_apply_checklist_import_plan';

  if writer_functions < 1 then
    raise exception 'tcos_apply_checklist_import_plan is missing after bootstrap';
  end if;

  perform pg_notify('pgrst', 'reload schema');
end;
$$;
SQL

jq -Rs '{query: ., read_only: false}' "$verification_file" > "$work_dir/verify.json"
curl --silent --show-error --fail \
  --retry 5 --retry-delay 2 --retry-all-errors \
  --request POST \
  --header "Authorization: Bearer $GH_SUPABASE_ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data-binary "@$work_dir/verify.json" \
  --output "$work_dir/verify-response.json" \
  "https://api.supabase.com/v1/projects/$RESOLVED_SUPABASE_PROJECT_REF/database/query"
jq -e 'if type == "object" and (.error? // null) then error(.error) else true end' \
  "$work_dir/verify-response.json" >/dev/null

sleep 5
echo "Checklist Registry production schema is installed and PostgREST reload was requested."
