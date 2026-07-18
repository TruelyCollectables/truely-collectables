-- TCOS Market Intel™ market-observation history
-- Preserves dated live-market evidence separately from verified sold comps.

create table if not exists public.tcos_mi_market_observations (
  id uuid primary key default gen_random_uuid(),
  observation_key text not null unique,
  observed_at timestamptz not null default now(),
  observed_on date not null default ((now() at time zone 'America/Denver')::date),
  subject_id uuid references public.tcos_mi_subjects(id) on delete cascade,
  collectible_identity_id uuid references public.tcos_mi_collectible_identities(id) on delete cascade,
  marketplace_id uuid references public.tcos_mi_marketplaces(id) on delete set null,
  source_type text not null check (
    source_type in ('discovery_candidate', 'deal_score', 'market_snapshot')
  ),
  external_listing_id text,
  source_url text,
  title text,
  quantity integer not null default 1 check (quantity > 0),
  asking_price numeric(12,2) not null default 0 check (asking_price >= 0),
  shipping_price numeric(12,2) not null default 0 check (shipping_price >= 0),
  buyer_fee numeric(12,2) not null default 0 check (buyer_fee >= 0),
  delivered_price numeric(12,2) not null default 0 check (delivered_price >= 0),
  unit_delivered_price numeric(12,2) not null default 0 check (unit_delivered_price >= 0),
  market_value numeric(12,2),
  verified_comp_count integer not null default 0 check (verified_comp_count >= 0),
  market_sample_size integer not null default 0 check (market_sample_size >= 0),
  confidence_score numeric(7,2),
  liquidity_score numeric(7,2),
  seven_day_change_pct numeric(10,4),
  thirty_day_change_pct numeric(10,4),
  deal_label text,
  discount_pct numeric(10,4),
  expected_net_profit numeric(12,2),
  buy_score numeric(7,2),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists tcos_mi_market_observations_subject_date_idx
  on public.tcos_mi_market_observations (subject_id, observed_on desc);

create index if not exists tcos_mi_market_observations_identity_date_idx
  on public.tcos_mi_market_observations (collectible_identity_id, observed_on desc);

create index if not exists tcos_mi_market_observations_listing_date_idx
  on public.tcos_mi_market_observations (external_listing_id, observed_on desc)
  where external_listing_id is not null;

alter table public.tcos_mi_market_observations enable row level security;

comment on table public.tcos_mi_market_observations is
  'Dated TCOS live-market and deal-score observations. These rows are research evidence and are never represented as verified sold comps.';

notify pgrst, 'reload schema';
