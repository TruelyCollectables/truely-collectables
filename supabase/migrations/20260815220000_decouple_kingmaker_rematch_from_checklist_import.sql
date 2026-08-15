-- Bulk Checklist Registry ingestion must not synchronously rematch Beckett rows.
-- The existing bounded drain RPC remains the post-import learning path.
begin;

create or replace function public.tcos_trigger_kingmaker_beckett_rematch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Deliberately no synchronous rematch here. Checklist activation commits first.
  -- public.tcos_drain_kingmaker_price_rematch_batch() discovers unresolved rows
  -- for active checklist versions and processes them later in bounded transactions.
  return new;
end;
$$;

revoke all on function public.tcos_trigger_kingmaker_beckett_rematch()
  from public, anon, authenticated;
grant execute on function public.tcos_trigger_kingmaker_beckett_rematch()
  to service_role;

comment on function public.tcos_trigger_kingmaker_beckett_rematch() is
  'Checklist activation no-op trigger. Kingmaker rematching is drained asynchronously in bounded post-import transactions.';

commit;
