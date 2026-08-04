create table if not exists public.instacomp_catalog_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null,
  source_url text,
  license_status text not null default 'unreviewed',
  commercial_use_allowed boolean not null default false,
  storage_allowed boolean not null default false,
  attribution_required boolean not null default false,
  terms_reviewed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.instacomp_catalog_sets (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.instacomp_catalog_sources(id),
  source_record_id text,
  sport text not null,
  release_year text not null,
  manufacturer text not null,
  brand text,
  set_name text not null,
  country text,
  language_code text,
  issue_type text,
  parent_set_id uuid references public.instacomp_catalog_sets(id),
  verification_status text not null default 'imported',
  canonical_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.instacomp_catalog_cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.instacomp_catalog_sets(id) on delete cascade,
  source_id uuid not null references public.instacomp_catalog_sources(id),
  source_record_id text,
  card_number text not null,
  card_number_normalized text not null,
  player text not null,
  player_normalized text not null,
  team text,
  subset text,
  parallel text,
  variation text,
  serial_run integer check (serial_run is null or serial_run > 0),
  is_rookie boolean not null default false,
  is_auto boolean not null default false,
  is_relic boolean not null default false,
  verification_status text not null default 'imported',
  canonical_fingerprint text not null unique,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists instacomp_catalog_sets_lookup_idx
  on public.instacomp_catalog_sets (release_year, manufacturer, set_name);

create index if not exists instacomp_catalog_cards_fast_identity_idx
  on public.instacomp_catalog_cards (card_number_normalized, player_normalized, is_auto, is_relic, serial_run);

create index if not exists instacomp_catalog_cards_set_identity_idx
  on public.instacomp_catalog_cards (set_id, card_number_normalized, player_normalized);

comment on table public.instacomp_catalog_cards is
  'Universal multi-sport checklist catalog used before AI. Exact checklist matches must set aiRequired=false.';

alter table public.instacomp_catalog_sources enable row level security;
alter table public.instacomp_catalog_sets enable row level security;
alter table public.instacomp_catalog_cards enable row level security;
