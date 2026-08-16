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

# Repair historical release-source duplicates first because the writer also uses
# an explicit ON CONFLICT target for release provenance.
run_query \
  writer-index-repair \
  supabase/migrations/20260807033000_checklist_registry_writer_repair.sql

# Production's identity table predates the final core unique constraint. Safely
# repoint all dependent foreign keys, dedupe identities, and install/verify the
# exact uniqueness contract required by the writer.
run_query \
  writer-identity-uniqueness-repair \
  supabase/migrations/20260807111500_checklist_identity_uniqueness_repair.sql

# Reinstall the transactional writer from the exact source in this checkout, but
# replace the quadratic JSONB source-key maps with transaction-local indexed temp
# maps first. Panini releases contain thousands of cards; repeatedly concatenating
# an ever-growing JSONB object made the otherwise-correct atomic writer exceed the
# Supabase request window. Temp primary-key maps preserve identical semantics while
# making source-key lookup O(log n) and keep the import atomic/fail-closed.
writer_source="supabase/migrations/20260731161500_checklist_registry_transactional_writer.sql"
optimized_writer="$work_dir/checklist-registry-transactional-writer-optimized.sql"
python3 - "$writer_source" "$optimized_writer" <<'PY'
from pathlib import Path
import sys

source_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
source = source_path.read_text(encoding="utf-8")

release_target = "on conflict (release_id, source_type, source_url) do update"
identity_target = "on conflict (identity_schema, fingerprint_sha256) do nothing;"
if source.count(release_target) != 1:
    raise SystemExit("Transactional writer does not contain the expected release-source conflict target.")
if source.count(identity_target) != 1:
    raise SystemExit("Transactional writer does not contain the expected identity conflict target.")

replacements = [
    (
        "  v_set_map jsonb := '{}'::jsonb;\n  v_card_map jsonb := '{}'::jsonb;\n  v_parallel_map jsonb := '{}'::jsonb;\n",
        "",
    ),
    (
        "  ) returning id into v_import_run_id;\n\n  for v_set in select value from jsonb_array_elements(coalesce(p_plan->'sets','[]'::jsonb))\n",
        "  ) returning id into v_import_run_id;\n\n"
        "  create temporary table tcos_checklist_set_map (\n"
        "    source_key text primary key,\n"
        "    object_id uuid not null\n"
        "  ) on commit drop;\n"
        "  create temporary table tcos_checklist_card_map (\n"
        "    source_key text primary key,\n"
        "    object_id uuid not null,\n"
        "    set_id uuid not null\n"
        "  ) on commit drop;\n"
        "  create temporary table tcos_checklist_parallel_map (\n"
        "    source_key text primary key,\n"
        "    object_id uuid not null\n"
        "  ) on commit drop;\n\n"
        "  for v_set in select value from jsonb_array_elements(coalesce(p_plan->'sets','[]'::jsonb))\n",
    ),
    (
        "    v_set_map := v_set_map || jsonb_build_object(v_set->>'sourceKey', v_set_id::text);\n",
        "    insert into pg_temp.tcos_checklist_set_map(source_key, object_id)\n"
        "    values (v_set->>'sourceKey', v_set_id);\n",
    ),
    (
        "    v_set_id := nullif(v_set_map->>(v_card->>'setSourceKey'), '')::uuid;\n",
        "    select object_id into v_set_id\n"
        "    from pg_temp.tcos_checklist_set_map\n"
        "    where source_key = v_card->>'setSourceKey';\n",
    ),
    (
        "    v_card_map := v_card_map || jsonb_build_object(v_card->>'sourceKey', v_card_id::text);\n",
        "    insert into pg_temp.tcos_checklist_card_map(source_key, object_id, set_id)\n"
        "    values (v_card->>'sourceKey', v_card_id, v_set_id);\n",
    ),
    (
        "    v_set_id := nullif(v_set_map->>(v_parallel->>'setSourceKey'), '')::uuid;\n",
        "    select object_id into v_set_id\n"
        "    from pg_temp.tcos_checklist_set_map\n"
        "    where source_key = v_parallel->>'setSourceKey';\n",
    ),
    (
        "    v_parallel_map := v_parallel_map || jsonb_build_object(v_parallel->>'sourceKey', v_parallel_id::text);\n",
        "    insert into pg_temp.tcos_checklist_parallel_map(source_key, object_id)\n"
        "    values (v_parallel->>'sourceKey', v_parallel_id);\n",
    ),
    (
        "    v_card_id := nullif(v_card_map->>(v_identity->>'cardSourceKey'), '')::uuid;\n"
        "    if v_card_id is null then\n"
        "      raise exception 'Checklist identity references unknown card source key %', v_identity->>'cardSourceKey';\n"
        "    end if;\n\n"
        "    select set_id into v_set_id from public.checklist_cards where id = v_card_id;\n",
        "    select object_id, set_id into v_card_id, v_set_id\n"
        "    from pg_temp.tcos_checklist_card_map\n"
        "    where source_key = v_identity->>'cardSourceKey';\n"
        "    if v_card_id is null then\n"
        "      raise exception 'Checklist identity references unknown card source key %', v_identity->>'cardSourceKey';\n"
        "    end if;\n",
    ),
    (
        "      v_parallel_id := nullif(v_parallel_map->>(v_identity->>'parallelSourceKey'), '')::uuid;\n",
        "      select object_id into v_parallel_id\n"
        "      from pg_temp.tcos_checklist_parallel_map\n"
        "      where source_key = v_identity->>'parallelSourceKey';\n",
    ),
]

for before, after in replacements:
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"Checklist writer optimization expected one match, found {count}: {before[:90]!r}")
    source = source.replace(before, after, 1)

# Guard against accidentally leaving the quadratic maps in the installed writer.
for forbidden in ("v_set_map :=", "v_card_map :=", "v_parallel_map :="):
    if forbidden in source:
        raise SystemExit(f"Optimized writer still contains quadratic map operation: {forbidden}")

out_path.write_text(source, encoding="utf-8")
PY
run_query writer-conflict-target-reinstall "$optimized_writer"

# Large but fully validated releases still need a bounded window. The optimized
# writer normally completes well inside this budget; keeping the cap prevents a
# malformed import from monopolizing a Production connection.
run_query \
  writer-bounded-timeout \
  supabase/migrations/20260807124500_checklist_registry_writer_timeout.sql

sleep 5
echo "Checklist Registry uniqueness contracts, optimized atomic writer, and bounded timeouts are ready."
