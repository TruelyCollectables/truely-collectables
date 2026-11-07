begin;

grant usage on schema public to service_role;

alter table if exists public.sales_comp_snapshots
  add column if not exists store_id uuid
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.orders
  add column if not exists account_id uuid references public.account_profiles(id);

alter table if exists public.offers
  add column if not exists account_id uuid references public.account_profiles(id);

alter table if exists public.account_auth_events
  add column if not exists failure_reason text,
  add column if not exists lockout_until timestamptz;

alter table if exists public.account_profiles
  add column if not exists card_verified boolean not null default false,
  add column if not exists card_verified_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_setup_intent_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_exp_month integer,
  add column if not exists card_exp_year integer,
  add column if not exists card_funding text,
  add column if not exists billing_name text,
  add column if not exists billing_country text,
  add column if not exists billing_postal_code text,
  add column if not exists billing_line1 text,
  add column if not exists billing_line2 text,
  add column if not exists billing_city text,
  add column if not exists billing_state text,
  add column if not exists card_verification_failure_reason text,
  add column if not exists card_verification_checked_at timestamptz;

create table if not exists public.admin_login_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  ip_address text,
  user_agent text,
  success boolean not null default false,
  failure_reason text,
  lockout_until timestamptz,
  identity_risk text,
  identity_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

create table if not exists public.account_collection_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  linked_product_id bigint,
  inventory_item_id uuid,
  source_order_id bigint,
  source_order_item_id bigint,
  title text not null,
  category text,
  item_type text not null default 'collectable',
  image_url text,
  acquisition_source text,
  acquisition_price numeric,
  estimated_value numeric,
  value_confidence text,
  grade_company text,
  grade_value text,
  certification_number text,
  condition text,
  ownership_status text not null default 'owned',
  visibility text not null default 'private',
  is_favorite boolean not null default false,
  is_active boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_collection_items_ownership_status_check
    check (ownership_status in ('owned', 'incoming', 'sold', 'traded', 'archived')),
  constraint account_collection_items_visibility_check
    check (visibility in ('private', 'community', 'public', 'admin_review'))
);

create table if not exists public.account_wish_list_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  wish_type text not null default 'wish_list',
  title text not null,
  category text,
  item_type text not null default 'collectable',
  search_query text,
  player_name text,
  team_name text,
  brand text,
  set_name text,
  release_year text,
  card_number text,
  variant text,
  desired_condition text,
  desired_grade text,
  budget_min numeric,
  budget_max numeric,
  priority text not null default 'normal',
  status text not null default 'active',
  visibility text not null default 'private',
  expires_at timestamptz,
  auto_renew boolean not null default false,
  matched_product_id bigint,
  matched_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_wish_list_items_wish_type_check
    check (wish_type in ('wish_list', 'want_ad', 'set_need', 'trade_target')),
  constraint account_wish_list_items_priority_check
    check (priority in ('low', 'normal', 'high', 'grail')),
  constraint account_wish_list_items_status_check
    check (status in ('active', 'matched', 'fulfilled', 'expired', 'canceled', 'renewed')),
  constraint account_wish_list_items_visibility_check
    check (visibility in ('private', 'community', 'public', 'admin_review'))
);

create table if not exists public.account_wish_list_matches (
  id uuid primary key default gen_random_uuid(),
  wish_list_item_id uuid not null references public.account_wish_list_items(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  product_id bigint,
  inventory_item_id uuid,
  match_source text not null default 'manual',
  match_score numeric,
  status text not null default 'candidate',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_wish_list_matches_status_check
    check (status in ('candidate', 'notified', 'dismissed', 'saved', 'purchased'))
);

create table if not exists public.account_collector_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  collector_handle text,
  bio text,
  collecting_focus text,
  location_label text,
  website_url text,
  instagram_url text,
  facebook_url text,
  x_url text,
  tiktok_url text,
  youtube_url text,
  whatnot_url text,
  ebay_url text,
  visibility text not null default 'private',
  allow_messages boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, store_id),
  constraint account_collector_profiles_visibility_check
    check (visibility in ('private', 'community', 'public', 'admin_review'))
);

create table if not exists public.account_conversations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  created_by_account_id uuid not null references public.account_profiles(id) on delete cascade,
  recipient_account_id uuid references public.account_profiles(id) on delete set null,
  related_product_id bigint,
  related_collection_item_id uuid references public.account_collection_items(id) on delete set null,
  related_wish_list_item_id uuid references public.account_wish_list_items(id) on delete set null,
  subject text,
  status text not null default 'open',
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_conversations_status_check
    check (status in ('open', 'archived', 'blocked', 'closed'))
);

create table if not exists public.account_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.account_conversations(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  sender_account_id uuid not null references public.account_profiles(id) on delete cascade,
  message_type text not null default 'message',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_conversation_messages_type_check
    check (message_type in ('message', 'binding_offer', 'system'))
);

create table if not exists public.account_binding_offers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  conversation_id uuid references public.account_conversations(id) on delete set null,
  buyer_account_id uuid not null references public.account_profiles(id) on delete cascade,
  seller_account_id uuid references public.account_profiles(id) on delete set null,
  product_id bigint,
  collection_item_id uuid references public.account_collection_items(id) on delete set null,
  wish_list_item_id uuid references public.account_wish_list_items(id) on delete set null,
  offer_amount numeric not null,
  shipping_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  total_amount numeric not null,
  currency text not null default 'usd',
  status text not null default 'payment_required',
  payment_requirement text not null default 'card_required_before_submission',
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_payment_method_id text,
  stripe_setup_intent_id text,
  stripe_payment_intent_id text,
  accepted_at timestamptz,
  declined_at timestamptz,
  canceled_at timestamptz,
  expires_at timestamptz,
  tos_acceptance_event_id uuid,
  tos_version text,
  client_ip_address text,
  client_user_agent text,
  client_identity_risk text,
  client_identity_evidence jsonb not null default '{}'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_binding_offers_amount_check
    check (offer_amount > 0 and shipping_amount >= 0 and tax_amount >= 0 and total_amount > 0),
  constraint account_binding_offers_status_check
    check (status in (
      'payment_required',
      'payment_method_authorized',
      'submitted',
      'accepted',
      'declined',
      'canceled',
      'expired',
      'paid',
      'failed'
    ))
);

create table if not exists public.account_collection_export_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  export_type text not null,
  status text not null default 'completed',
  file_name text,
  file_url text,
  item_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint account_collection_export_jobs_type_check
    check (export_type in ('csv', 'catalog_json', 'media_archive')),
  constraint account_collection_export_jobs_status_check
    check (status in ('queued', 'processing', 'completed', 'failed'))
);

create table if not exists public.account_collection_import_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  import_type text not null default 'csv',
  source_marketplace text,
  status text not null default 'processing',
  file_name text,
  row_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint account_collection_import_jobs_type_check
    check (import_type in ('csv', 'catalog_json', 'provider')),
  constraint account_collection_import_jobs_status_check
    check (status in ('processing', 'completed', 'completed_with_errors', 'failed'))
);

create index if not exists sales_comp_snapshots_store_id_created_at_idx
  on public.sales_comp_snapshots(store_id, created_at desc);
create index if not exists admin_login_attempts_store_created_at_idx
  on public.admin_login_attempts(store_id, created_at desc);
create index if not exists admin_login_attempts_store_ip_created_at_idx
  on public.admin_login_attempts(store_id, ip_address, created_at desc);
create index if not exists admin_login_attempts_lockout_until_idx
  on public.admin_login_attempts(lockout_until)
  where lockout_until is not null;
create index if not exists account_profiles_status_card_idx
  on public.account_profiles(account_status, card_verified, card_verified_at desc);
create index if not exists account_profiles_stripe_customer_idx
  on public.account_profiles(stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists account_auth_events_store_lockout_idx
  on public.account_auth_events(store_id, lockout_until desc)
  where lockout_until is not null;
create index if not exists orders_store_account_created_at_idx
  on public.orders(store_id, account_id, created_at desc)
  where account_id is not null;
create index if not exists offers_store_account_created_at_idx
  on public.offers(store_id, account_id, created_at desc)
  where account_id is not null;
create index if not exists account_sports_favorites_account_idx
  on public.account_sports_favorites(account_id, store_id, display_order, created_at desc);
create index if not exists sports_event_snapshots_team_idx
  on public.sports_event_snapshots(store_id, league_key, event_start_at desc);
create index if not exists sports_odds_snapshots_event_idx
  on public.sports_odds_snapshots(store_id, league_key, external_event_id, fetched_at desc);
create index if not exists account_market_watchlist_items_account_idx
  on public.account_market_watchlist_items(account_id, store_id, display_order, created_at desc);
create index if not exists market_price_snapshots_symbol_idx
  on public.market_price_snapshots(store_id, asset_type, upper(symbol), fetched_at desc);
create index if not exists account_collection_items_account_idx
  on public.account_collection_items(account_id, store_id, is_active, created_at desc);
create index if not exists account_wish_list_items_account_idx
  on public.account_wish_list_items(account_id, store_id, status, created_at desc);
create index if not exists account_wish_list_matches_account_idx
  on public.account_wish_list_matches(account_id, store_id, status, created_at desc);
create index if not exists account_collector_profiles_store_visibility_idx
  on public.account_collector_profiles(store_id, visibility, updated_at desc);
create index if not exists account_conversations_created_by_idx
  on public.account_conversations(created_by_account_id, store_id, status, updated_at desc);
create index if not exists account_binding_offers_buyer_idx
  on public.account_binding_offers(buyer_account_id, store_id, status, created_at desc);
create index if not exists account_collection_export_jobs_account_idx
  on public.account_collection_export_jobs(account_id, store_id, created_at desc);
create index if not exists account_collection_import_jobs_account_idx
  on public.account_collection_import_jobs(account_id, store_id, created_at desc);

revoke all privileges on table
  public.sales_comp_snapshots,
  public.admin_login_attempts,
  public.security_ip_investigations,
  public.account_sports_favorites,
  public.sports_data_sources,
  public.sports_event_snapshots,
  public.sports_news_snapshots,
  public.sports_odds_snapshots,
  public.account_market_watchlist_items,
  public.market_data_sources,
  public.market_price_snapshots,
  public.market_news_snapshots,
  public.account_collection_items,
  public.account_wish_list_items,
  public.account_wish_list_matches,
  public.account_collector_profiles,
  public.account_conversations,
  public.account_conversation_messages,
  public.account_binding_offers,
  public.account_collection_export_jobs,
  public.account_collection_import_jobs
from public, anon, authenticated;

grant select, insert, update on table
  public.sales_comp_snapshots,
  public.admin_login_attempts,
  public.security_ip_investigations,
  public.account_sports_favorites,
  public.sports_data_sources,
  public.sports_event_snapshots,
  public.sports_news_snapshots,
  public.sports_odds_snapshots,
  public.account_market_watchlist_items,
  public.market_data_sources,
  public.market_price_snapshots,
  public.market_news_snapshots,
  public.account_collection_items,
  public.account_wish_list_items,
  public.account_wish_list_matches,
  public.account_collector_profiles,
  public.account_conversations,
  public.account_conversation_messages,
  public.account_binding_offers,
  public.account_collection_export_jobs,
  public.account_collection_import_jobs
to service_role;

grant select, insert, update on table public.account_profiles to service_role;
grant select, insert, update on table public.account_auth_events to service_role;
grant select, insert, update on table public.orders to service_role;
grant select, insert, update on table public.offers to service_role;

do $$
begin
  if to_regclass('public.sales_comp_snapshots_id_seq') is not null then
    grant usage, select on sequence public.sales_comp_snapshots_id_seq to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
