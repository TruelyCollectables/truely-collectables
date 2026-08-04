-- Accept explicit four-digit years and common card-season formats without
-- relying on a fragile mixed-separator regular expression.

begin;

create or replace function public.tcos_kingmaker_private_pricing_valid_period(
  p_value text
)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select
    trim(p_value) ~ '^[12][0-9]{3}$'
    or trim(p_value) ~ '^[12][0-9]{3}-[0-9]{2}$'
    or trim(p_value) ~ '^[12][0-9]{3}-[12][0-9]{3}$'
    or trim(p_value) ~ '^[12][0-9]{3}/[0-9]{2}$'
    or trim(p_value) ~ '^[12][0-9]{3}/[12][0-9]{3}$'
    or trim(p_value) ~ '^[12][0-9]{3} [0-9]{2}$'
    or trim(p_value) ~ '^[12][0-9]{3} [12][0-9]{3}$';
$$;

revoke all on function public.tcos_kingmaker_private_pricing_valid_period(text)
  from public, anon, authenticated;

do $migration$
declare
  function_signature constant regprocedure :=
    'public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)'::regprocedure;
  definition text;
  patched_definition text;
  old_condition constant text :=
    '          and trim(grouped.release_year) !~ ''^[12][0-9]{3}([-/ ][0-9]{2,4})?$''';
  new_condition constant text :=
    '          and not public.tcos_kingmaker_private_pricing_valid_period(grouped.release_year)';
begin
  select pg_get_functiondef(function_signature)
  into definition;

  if definition is null then
    raise exception 'Private pricing quality refresh function is missing.';
  end if;

  if position(new_condition in definition) = 0 then
    patched_definition := replace(definition, old_condition, new_condition);

    if patched_definition = definition then
      raise exception 'Private pricing release-period validation marker was not found.';
    end if;

    execute patched_definition;
  end if;
end;
$migration$;

revoke all on function public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)
  from public, anon, authenticated;
grant execute on function public.tcos_refresh_kingmaker_private_pricing_attack_queue(boolean)
  to service_role;

commit;
