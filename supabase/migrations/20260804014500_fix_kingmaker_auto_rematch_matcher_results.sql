-- Fix two defects found by the guarded KINGMAKER Production regression:
-- 1. matcher_results was both a PL/pgSQL variable and an audit-table column.
-- 2. post-rematch counts relied on transaction timestamps, which can precede
--    clock_timestamp() even when the candidate row was updated successfully.
--
-- The patched function uses a distinct JSON accumulator name and counts the
-- exact candidate entry IDs captured before rematching.

begin;

do $migration$
declare
  function_signature constant regprocedure :=
    'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)'::regprocedure;
  definition text;
  patched_definition text;
begin
  select pg_get_functiondef(function_signature)
  into definition;

  if definition is null then
    raise exception 'KINGMAKER checklist rematch function is missing.';
  end if;

  patched_definition := definition;

  -- Rename the JSON accumulator so the audit-table UPDATE is unambiguous.
  if position('matcher_results_payload jsonb' in patched_definition) = 0 then
    patched_definition := replace(
      patched_definition,
      'matcher_results jsonb := ''[]''::jsonb;',
      'matcher_results_payload jsonb := ''[]''::jsonb;'
    );
    patched_definition := replace(
      patched_definition,
      'matcher_results := matcher_results || jsonb_build_array(matcher_result);',
      'matcher_results_payload := matcher_results_payload || jsonb_build_array(matcher_result);'
    );
    patched_definition := replace(
      patched_definition,
      'matcher_results = matcher_results,',
      'matcher_results = matcher_results_payload,'
    );
    patched_definition := replace(
      patched_definition,
      '''matcher_results'', matcher_results',
      '''matcher_results'', matcher_results_payload'
    );
  end if;

  -- Capture the unresolved candidate IDs and count those exact rows afterward.
  if position('candidate_entry_ids uuid[]' in patched_definition) = 0 then
    patched_definition := replace(
      patched_definition,
      'guide_ids uuid[] := ''{}''::uuid[];',
      'guide_ids uuid[] := ''{}''::uuid[];' || E'\n  ' ||
      'candidate_entry_ids uuid[] := ''{}''::uuid[];'
    );
    patched_definition := replace(
      patched_definition,
      'coalesce(array_agg(distinct entry.guide_id), ''{}''::uuid[])',
      'coalesce(array_agg(distinct entry.guide_id), ''{}''::uuid[]),' || E'\n    ' ||
      'coalesce(array_agg(distinct entry.id), ''{}''::uuid[])'
    );
    patched_definition := replace(
      patched_definition,
      'unmatched_before_count,' || E'\n    ' || 'guide_ids',
      'unmatched_before_count,' || E'\n    ' || 'guide_ids,' || E'\n    ' ||
      'candidate_entry_ids'
    );
    patched_definition := replace(
      patched_definition,
      'and entry.updated_at >= run_started_at',
      'and entry.id = any(candidate_entry_ids)'
    );
  end if;

  if position('matcher_results jsonb := ''[]''::jsonb;' in patched_definition) > 0
     or position(
       'matcher_results := matcher_results || jsonb_build_array(matcher_result);'
       in patched_definition
     ) > 0
     or position('matcher_results = matcher_results,' in patched_definition) > 0
     or position('''matcher_results'', matcher_results)' in patched_definition) > 0 then
    raise exception 'Could not safely remove the KINGMAKER matcher_results collision.';
  end if;

  if position('matcher_results_payload jsonb := ''[]''::jsonb;' in patched_definition) = 0
     or position(
       'matcher_results_payload := matcher_results_payload || jsonb_build_array(matcher_result);'
       in patched_definition
     ) = 0
     or position('matcher_results = matcher_results_payload,' in patched_definition) = 0
     or position('''matcher_results'', matcher_results_payload' in patched_definition) = 0 then
    raise exception 'Patched KINGMAKER matcher-results accumulator is incomplete.';
  end if;

  if position('candidate_entry_ids uuid[] := ''{}''::uuid[];' in patched_definition) = 0
     or position(
       'coalesce(array_agg(distinct entry.id), ''{}''::uuid[])'
       in patched_definition
     ) = 0
     or position('and entry.id = any(candidate_entry_ids)' in patched_definition) = 0
     or position('and entry.updated_at >= run_started_at' in patched_definition) > 0 then
    raise exception 'Patched KINGMAKER candidate-based audit counting is incomplete.';
  end if;

  if patched_definition is distinct from definition then
    execute patched_definition;
  end if;
end;
$migration$;

revoke all on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.tcos_rematch_kingmaker_price_entries_for_release(uuid, uuid, text)
  to service_role;

commit;
