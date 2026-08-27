-- Keep INSERT trigger execution from touching OLD, which is undefined for inserts.

begin;

create or replace function public.tcos_trigger_kingmaker_beckett_rematch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  should_rematch boolean := false;
begin
  if new.is_active
     and new.status in ('live','revised')
     and new.activated_at is not null then
    if tg_op = 'INSERT' then
      should_rematch := true;
    elsif tg_op = 'UPDATE' then
      should_rematch :=
        old.is_active is distinct from new.is_active
        or old.status is distinct from new.status
        or old.activated_at is distinct from new.activated_at;
    end if;
  end if;

  if should_rematch then
    perform public.tcos_rematch_kingmaker_price_entries_for_release(
      new.release_id,
      new.id,
      'checklist_version_activation'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.tcos_trigger_kingmaker_beckett_rematch()
  from public, anon, authenticated;

commit;
