create table if not exists public.tcos_card_market_observation_retractions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.tcos_card_market_observations(id) on delete restrict,
  reason text not null check (length(btrim(reason)) > 0),
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  retracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (observation_id)
);

create index if not exists idx_tcos_card_market_observation_retractions_observation_id
  on public.tcos_card_market_observation_retractions(observation_id);

alter table public.tcos_card_market_observation_retractions enable row level security;

revoke all on table public.tcos_card_market_observation_retractions from anon, authenticated;
grant select, insert on table public.tcos_card_market_observation_retractions to service_role;

create or replace function public.tcos_block_market_observation_retraction_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'tcos_card_market_observation_retractions is append-only; insert a retraction once and preserve the audit trail';
end;
$$;

drop trigger if exists trg_tcos_card_market_observation_retractions_immutable
  on public.tcos_card_market_observation_retractions;
create trigger trg_tcos_card_market_observation_retractions_immutable
before update or delete on public.tcos_card_market_observation_retractions
for each row execute function public.tcos_block_market_observation_retraction_mutation();

comment on table public.tcos_card_market_observation_retractions is
  'Append-only retraction ledger for immutable exact-card market observations that were later proven unsafe or misbound.';
comment on column public.tcos_card_market_observation_retractions.observation_id is
  'Immutable market observation excluded from trusted history after this retraction is recorded.';
