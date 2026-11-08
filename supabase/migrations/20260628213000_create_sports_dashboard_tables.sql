create table if not exists public.account_sports_favorites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  favorite_type text not null default 'team',
  sport_key text not null,
  league_key text not null,
  team_name text not null,
  team_abbreviation text,
  external_team_id text,
  data_provider text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  include_news boolean not null default true,
  include_scores boolean not null default true,
  include_schedule boolean not null default true,
  include_odds boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_sports_favorites_type_check
    check (favorite_type in ('team', 'league', 'sport', 'athlete')),
  constraint account_sports_favorites_unique
    unique(account_id, store_id, favorite_type, sport_key, league_key, team_name)
);

create index if not exists account_sports_favorites_account_idx
  on public.account_sports_favorites(account_id, store_id, display_order, created_at desc);

create index if not exists account_sports_favorites_league_team_idx
  on public.account_sports_favorites(store_id, league_key, lower(team_name));

create table if not exists public.sports_data_sources (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  source_type text not null,
  display_name text not null,
  sport_key text,
  league_key text,
  base_url text,
  usage_policy_notes text,
  is_enabled boolean not null default false,
  supports_news boolean not null default false,
  supports_scores boolean not null default false,
  supports_schedule boolean not null default false,
  supports_odds boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sports_data_sources_type_check
    check (source_type in ('league_site', 'news', 'scores', 'schedule', 'odds', 'catalog'))
);

create index if not exists sports_data_sources_enabled_idx
  on public.sports_data_sources(is_enabled, provider_key, source_type);

create unique index if not exists sports_data_sources_provider_unique_idx
  on public.sports_data_sources(provider_key, source_type, coalesce(league_key, 'all'));

create table if not exists public.sports_event_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  sport_key text not null,
  league_key text not null,
  external_event_id text not null,
  source_key text not null,
  source_url text,
  event_start_at timestamptz,
  event_status text,
  home_team text,
  away_team text,
  home_score integer,
  away_score integer,
  venue text,
  broadcast text,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint sports_event_snapshots_unique
    unique(store_id, source_key, external_event_id)
);

create index if not exists sports_event_snapshots_team_idx
  on public.sports_event_snapshots(store_id, league_key, event_start_at desc);

create table if not exists public.sports_news_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  sport_key text not null,
  league_key text not null,
  team_name text,
  source_key text not null,
  source_name text,
  source_url text,
  title text not null,
  summary text,
  published_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sports_news_snapshots_lookup_idx
  on public.sports_news_snapshots(store_id, league_key, lower(team_name), published_at desc);

create table if not exists public.sports_odds_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  sport_key text not null,
  league_key text not null,
  external_event_id text,
  source_key text not null,
  bookmaker text,
  market_type text,
  home_team text,
  away_team text,
  home_line numeric,
  away_line numeric,
  over_under numeric,
  moneyline_home integer,
  moneyline_away integer,
  odds_timestamp timestamptz,
  legal_region text,
  source_url text,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sports_odds_snapshots_event_idx
  on public.sports_odds_snapshots(store_id, league_key, external_event_id, fetched_at desc);

create table if not exists public.account_market_watchlist_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  asset_type text not null,
  symbol text not null,
  display_name text,
  exchange_key text,
  data_provider text,
  external_asset_id text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  include_price boolean not null default true,
  include_news boolean not null default true,
  include_alerts boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_market_watchlist_items_type_check
    check (asset_type in ('stock', 'etf', 'index', 'crypto', 'nft', 'commodity', 'collectable_index', 'other'))
);

create index if not exists account_market_watchlist_items_account_idx
  on public.account_market_watchlist_items(account_id, store_id, display_order, created_at desc);

create index if not exists account_market_watchlist_items_symbol_idx
  on public.account_market_watchlist_items(store_id, asset_type, upper(symbol));

create unique index if not exists account_market_watchlist_items_unique_idx
  on public.account_market_watchlist_items(
    account_id,
    store_id,
    asset_type,
    upper(symbol),
    coalesce(exchange_key, '')
  );

create table if not exists public.market_data_sources (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null,
  source_type text not null,
  display_name text not null,
  asset_type text,
  base_url text,
  usage_policy_notes text,
  is_enabled boolean not null default false,
  supports_price boolean not null default false,
  supports_news boolean not null default false,
  supports_history boolean not null default false,
  supports_alerts boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_data_sources_type_check
    check (source_type in ('quotes', 'news', 'history', 'nft_floor', 'crypto_price', 'collectable_index'))
);

create index if not exists market_data_sources_enabled_idx
  on public.market_data_sources(is_enabled, provider_key, source_type);

create unique index if not exists market_data_sources_provider_unique_idx
  on public.market_data_sources(provider_key, source_type, coalesce(asset_type, 'all'));

create table if not exists public.market_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  asset_type text not null,
  symbol text not null,
  display_name text,
  exchange_key text,
  source_key text not null,
  source_url text,
  price numeric,
  currency text not null default 'USD',
  change_amount numeric,
  change_percent numeric,
  market_cap numeric,
  volume numeric,
  floor_price numeric,
  payload jsonb not null default '{}'::jsonb,
  quoted_at timestamptz,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists market_price_snapshots_symbol_idx
  on public.market_price_snapshots(store_id, asset_type, upper(symbol), fetched_at desc);

create table if not exists public.market_news_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  asset_type text not null,
  symbol text,
  source_key text not null,
  source_name text,
  source_url text,
  title text not null,
  summary text,
  published_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists market_news_snapshots_symbol_idx
  on public.market_news_snapshots(store_id, asset_type, upper(symbol), published_at desc);
