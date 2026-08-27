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

-- Capture every broad discovery candidate once per Denver calendar day. Repeated scans
-- update that day instead of creating noise, while the next day starts a new history point.
create or replace function public.tcos_mi_capture_discovery_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_observed_at timestamptz := coalesce(new.last_seen_at, new.first_seen_at, now());
  v_observed_on date := (v_observed_at at time zone 'America/Denver')::date;
  v_quantity integer := greatest(1, coalesce(new.quantity, 1));
  v_asking numeric := greatest(0, coalesce(new.asking_price, 0));
  v_shipping numeric := greatest(0, coalesce(new.shipping_price, 0));
  v_delivered numeric := v_asking + v_shipping;
  v_source_id text := coalesce(new.external_listing_id, new.direct_url, new.id::text);
  v_key text := md5(v_observed_on::text || '|discovery_candidate|' || new.marketplace_id::text || '|' || v_source_id);
begin
  insert into public.tcos_mi_market_observations (
    observation_key,
    observed_at,
    observed_on,
    subject_id,
    marketplace_id,
    source_type,
    external_listing_id,
    source_url,
    title,
    quantity,
    asking_price,
    shipping_price,
    buyer_fee,
    delivered_price,
    unit_delivered_price,
    confidence_score,
    metadata
  ) values (
    v_key,
    v_observed_at,
    v_observed_on,
    new.subject_id,
    new.marketplace_id,
    'discovery_candidate',
    new.external_listing_id,
    new.direct_url,
    new.original_title,
    v_quantity,
    v_asking,
    v_shipping,
    0,
    v_delivered,
    v_delivered / v_quantity,
    new.parse_confidence,
    jsonb_build_object(
      'candidate_id', new.id,
      'candidate_status', new.status,
      'detected_year', new.detected_year,
      'detected_manufacturer', new.detected_manufacturer,
      'detected_product_line', new.detected_product_line,
      'detected_set_name', new.detected_set_name,
      'detected_card_number', new.detected_card_number,
      'detected_parallel_name', new.detected_parallel_name,
      'detected_insert_name', new.detected_insert_name,
      'detected_variation_name', new.detected_variation_name,
      'serial_numbered_to', new.serial_numbered_to,
      'autograph', new.autograph,
      'memorabilia', new.memorabilia,
      'evidence_class', 'live_market_observation',
      'verified_sold_comp', false
    )
  )
  on conflict (observation_key) do update set
    observed_at = excluded.observed_at,
    subject_id = excluded.subject_id,
    external_listing_id = excluded.external_listing_id,
    source_url = excluded.source_url,
    title = excluded.title,
    quantity = excluded.quantity,
    asking_price = excluded.asking_price,
    shipping_price = excluded.shipping_price,
    delivered_price = excluded.delivered_price,
    unit_delivered_price = excluded.unit_delivered_price,
    confidence_score = excluded.confidence_score,
    metadata = excluded.metadata;

  return new;
end;
$$;

-- Every score is a historical snapshot of what TCOS knew at that moment: live price,
-- exact-card sold-comp market, confidence, movement, discount, profit, and buy score.
create or replace function public.tcos_mi_capture_deal_score_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_identity record;
  v_market record;
  v_observed_at timestamptz := coalesce(new.calculated_at, now());
  v_observed_on date := (v_observed_at at time zone 'America/Denver')::date;
  v_quantity integer;
  v_delivered numeric;
  v_comp_count integer := 0;
  v_key text;
begin
  select * into v_listing
  from public.tcos_mi_listings
  where id = new.listing_id;

  if not found then
    return new;
  end if;

  select id, subject_id, display_name into v_identity
  from public.tcos_mi_collectible_identities
  where id = v_listing.collectible_identity_id;

  if new.market_value_id is not null then
    select * into v_market
    from public.tcos_mi_market_values
    where id = new.market_value_id;
  end if;

  if v_listing.collectible_identity_id is not null then
    select count(*)::integer into v_comp_count
    from public.tcos_mi_sold_comps
    where collectible_identity_id = v_listing.collectible_identity_id
      and verified = true
      and excluded = false
      and outlier_flag = false;
  end if;

  v_quantity := greatest(1, coalesce(v_listing.quantity, 1));
  v_delivered := greatest(0, coalesce(v_listing.delivered_price, 0));
  v_key := md5(v_observed_on::text || '|deal_score|' || new.listing_id::text);

  insert into public.tcos_mi_market_observations (
    observation_key,
    observed_at,
    observed_on,
    subject_id,
    collectible_identity_id,
    marketplace_id,
    source_type,
    external_listing_id,
    source_url,
    title,
    quantity,
    asking_price,
    shipping_price,
    buyer_fee,
    delivered_price,
    unit_delivered_price,
    market_value,
    verified_comp_count,
    market_sample_size,
    confidence_score,
    liquidity_score,
    seven_day_change_pct,
    thirty_day_change_pct,
    deal_label,
    discount_pct,
    expected_net_profit,
    buy_score,
    metadata
  ) values (
    v_key,
    v_observed_at,
    v_observed_on,
    v_identity.subject_id,
    v_listing.collectible_identity_id,
    v_listing.marketplace_id,
    'deal_score',
    v_listing.external_listing_id,
    v_listing.direct_url,
    v_listing.original_title,
    v_quantity,
    greatest(0, coalesce(v_listing.asking_price, 0)),
    greatest(0, coalesce(v_listing.shipping_price, 0)),
    greatest(0, coalesce(v_listing.buyer_fee, 0)),
    v_delivered,
    v_delivered / v_quantity,
    v_market.conservative_value,
    v_comp_count,
    coalesce(v_market.sample_size, 0),
    new.confidence_score,
    new.liquidity_score,
    v_market.seven_day_change_pct,
    v_market.thirty_day_change_pct,
    new.deal_label,
    new.discount_pct,
    new.expected_net_profit,
    new.buy_score,
    jsonb_build_object(
      'deal_score_id', new.id,
      'market_value_id', new.market_value_id,
      'actionable', new.actionable,
      'risk_score', new.risk_score,
      'reason', new.reason,
      'risk_notes', new.risk_notes,
      'identity_display_name', v_identity.display_name,
      'evidence_class', 'scored_exact_market_observation',
      'verified_sold_comp', false
    )
  )
  on conflict (observation_key) do update set
    observed_at = excluded.observed_at,
    subject_id = excluded.subject_id,
    collectible_identity_id = excluded.collectible_identity_id,
    marketplace_id = excluded.marketplace_id,
    external_listing_id = excluded.external_listing_id,
    source_url = excluded.source_url,
    title = excluded.title,
    quantity = excluded.quantity,
    asking_price = excluded.asking_price,
    shipping_price = excluded.shipping_price,
    buyer_fee = excluded.buyer_fee,
    delivered_price = excluded.delivered_price,
    unit_delivered_price = excluded.unit_delivered_price,
    market_value = excluded.market_value,
    verified_comp_count = excluded.verified_comp_count,
    market_sample_size = excluded.market_sample_size,
    confidence_score = excluded.confidence_score,
    liquidity_score = excluded.liquidity_score,
    seven_day_change_pct = excluded.seven_day_change_pct,
    thirty_day_change_pct = excluded.thirty_day_change_pct,
    deal_label = excluded.deal_label,
    discount_pct = excluded.discount_pct,
    expected_net_profit = excluded.expected_net_profit,
    buy_score = excluded.buy_score,
    metadata = excluded.metadata;

  return new;
end;
$$;

-- Verified sold comps already create tcos_mi_market_values snapshots. Preserve each
-- calendar day's exact-card market state even when there is no purchase or live deal.
create or replace function public.tcos_mi_capture_market_value_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject_id uuid;
  v_display_name text;
  v_observed_at timestamptz := coalesce(new.calculated_at, now());
  v_observed_on date := (v_observed_at at time zone 'America/Denver')::date;
  v_key text := md5(v_observed_on::text || '|market_snapshot|' || new.collectible_identity_id::text);
begin
  select subject_id, display_name
    into v_subject_id, v_display_name
  from public.tcos_mi_collectible_identities
  where id = new.collectible_identity_id;

  insert into public.tcos_mi_market_observations (
    observation_key,
    observed_at,
    observed_on,
    subject_id,
    collectible_identity_id,
    source_type,
    title,
    market_value,
    verified_comp_count,
    market_sample_size,
    confidence_score,
    liquidity_score,
    seven_day_change_pct,
    thirty_day_change_pct,
    metadata
  ) values (
    v_key,
    v_observed_at,
    v_observed_on,
    v_subject_id,
    new.collectible_identity_id,
    'market_snapshot',
    v_display_name,
    new.conservative_value,
    coalesce(new.sample_size, 0),
    coalesce(new.sample_size, 0),
    new.confidence_score,
    new.liquidity_score,
    new.seven_day_change_pct,
    new.thirty_day_change_pct,
    jsonb_build_object(
      'market_value_id', new.id,
      'median_value', new.median_value,
      'average_value', new.average_value,
      'low_value', new.low_value,
      'high_value', new.high_value,
      'window_days', new.window_days,
      'calculation_notes', new.calculation_notes,
      'evidence_class', 'verified_sold_comp_market_snapshot',
      'verified_sold_comp', true
    )
  )
  on conflict (observation_key) do update set
    observed_at = excluded.observed_at,
    subject_id = excluded.subject_id,
    title = excluded.title,
    market_value = excluded.market_value,
    verified_comp_count = excluded.verified_comp_count,
    market_sample_size = excluded.market_sample_size,
    confidence_score = excluded.confidence_score,
    liquidity_score = excluded.liquidity_score,
    seven_day_change_pct = excluded.seven_day_change_pct,
    thirty_day_change_pct = excluded.thirty_day_change_pct,
    metadata = excluded.metadata;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.tcos_mi_identity_candidates') is not null then
    execute 'drop trigger if exists tcos_mi_identity_candidate_observation_trigger on public.tcos_mi_identity_candidates';
    execute 'create trigger tcos_mi_identity_candidate_observation_trigger after insert or update of asking_price, shipping_price, quantity, last_seen_at, status on public.tcos_mi_identity_candidates for each row execute function public.tcos_mi_capture_discovery_observation()';
  end if;

  if to_regclass('public.tcos_mi_deal_scores') is not null then
    execute 'drop trigger if exists tcos_mi_deal_score_observation_trigger on public.tcos_mi_deal_scores';
    execute 'create trigger tcos_mi_deal_score_observation_trigger after insert on public.tcos_mi_deal_scores for each row execute function public.tcos_mi_capture_deal_score_observation()';
  end if;

  if to_regclass('public.tcos_mi_market_values') is not null then
    execute 'drop trigger if exists tcos_mi_market_value_observation_trigger on public.tcos_mi_market_values';
    execute 'create trigger tcos_mi_market_value_observation_trigger after insert on public.tcos_mi_market_values for each row execute function public.tcos_mi_capture_market_value_observation()';
  end if;
end;
$$;

notify pgrst, 'reload schema';
