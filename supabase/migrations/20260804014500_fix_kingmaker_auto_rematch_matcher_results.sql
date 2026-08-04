-- Fix the PL/pgSQL variable/column collision in the KINGMAKER Beckett
-- release rematcher. The original function used matcher_results for both a
-- local JSON accumulator and the audit-table column, making the final UPDATE
-- ambiguous in PostgreSQL.

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
    raise exception 'Patched KINGMAKER rematch function is incomplete.';
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
