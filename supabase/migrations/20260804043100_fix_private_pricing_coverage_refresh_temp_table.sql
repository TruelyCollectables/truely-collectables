-- Allow repeated private pricing coverage refreshes in the same database
-- session or outer transaction by removing the prior session-local staging
-- table before rebuilding the snapshot.

begin;

do $migration$
declare
  function_signature constant regprocedure :=
    'public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)'::regprocedure;
  definition text;
  patched_definition text;
  create_marker constant text :=
    '  create temporary table tcos_private_pricing_coverage_refresh';
  drop_statement constant text :=
    '  drop table if exists pg_temp.tcos_private_pricing_coverage_refresh;';
begin
  select pg_get_functiondef(function_signature)
  into definition;

  if definition is null then
    raise exception 'Private pricing coverage refresh function is missing.';
  end if;

  if position(lower(drop_statement) in lower(definition)) = 0 then
    patched_definition := replace(
      definition,
      create_marker,
      drop_statement || E'\n\n' || create_marker
    );

    if patched_definition = definition then
      raise exception 'Private pricing coverage refresh temp-table marker was not found.';
    end if;

    execute patched_definition;
  end if;
end;
$migration$;

revoke all on function public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)
  from public, anon, authenticated;
grant execute on function public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(boolean)
  to service_role;

commit;
