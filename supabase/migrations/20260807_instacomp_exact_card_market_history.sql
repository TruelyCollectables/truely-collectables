create table if not exists public.tcos_card_market_identities (
  registry_identity_id uuid primary key,
  registry_fingerprint_sha256 text not null unique,
  identity_json jsonb not null default '{}'::jsonb,
  verification_source text not null default 'checklist_registry',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists tcos_card_market_identities_last_seen_idx
  on public.tcos_card_market_identities(last_seen_at desc);

create table if not exists public.tcos_card_market_observations (
  id uuid primary key default gen_random_uuid(),
  registry_identity_id uuid not null references public.tcos_card_market_identities(registry_identity_id) on delete restrict,
  observation_fingerprint text not null unique,
  observation_kind text not null check (observation_kind in ('ASK', 'SOLD', 'PURCHASE', 'OWN_SALE')),
  marketplace text not null,
  provider_source text,
  listing_item_id text,
  listing_url text,
  title text,
  item_price numeric(12,2),
  shipping_price numeric(12,2),
  buyer_fees numeric(12,2),
  tax numeric(12,2),
  delivered_price numeric(12,2),
  currency text not null default 'USD',
  condition_text text,
  match_score numeric(8,4),
  effective_at timestamptz,
  observed_at timestamptz not null default now(),
  scan_id text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tcos_card_market_observations_identity_time_idx
  on public.tcos_card_market_observations(registry_identity_id, observed_at desc);
create index if not exists tcos_card_market_observations_identity_kind_time_idx
  on public.tcos_card_market_observations(registry_identity_id, observation_kind, effective_at desc nulls last, observed_at desc);
create index if not exists tcos_card_market_observations_listing_idx
  on public.tcos_card_market_observations(marketplace, listing_item_id)
  where listing_item_id is not null;

create or replace function public.tcos_block_market_observation_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'tcos_card_market_observations is append-only; insert a new timestamped observation instead';
end;
$$;

drop trigger if exists tcos_card_market_observations_no_update on public.tcos_card_market_observations;
create trigger tcos_card_market_observations_no_update
before update on public.tcos_card_market_observations
for each row execute function public.tcos_block_market_observation_mutation();

drop trigger if exists tcos_card_market_observations_no_delete on public.tcos_card_market_observations;
create trigger tcos_card_market_observations_no_delete
before delete on public.tcos_card_market_observations
for each row execute function public.tcos_block_market_observation_mutation();

comment on table public.tcos_card_market_identities is
  'Canonical Checklist Registry identities with trusted longitudinal market history.';
comment on table public.tcos_card_market_observations is
  'Append-only exact-card asks, sold comps, purchases and owned sales; active asks never substitute for sold value.';
