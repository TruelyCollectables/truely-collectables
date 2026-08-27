begin;

-- Deal scores are allowed to exist before an exact-card market value has been
-- calculated. The original observation trigger used an untyped record for the
-- optional market-value row and dereferenced it even when market_value_id was
-- null, causing PostgreSQL to raise: record "v_market" is not assigned yet.
create or replace function public.tcos_mi_capture_deal_score_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.tcos_mi_listings%rowtype;
  v_subject_id uuid;
  v_identity_display_name text;
  v_market_value numeric;
  v_market_sample_size integer := 0;
  v_market_seven_day_change_pct numeric;
  v_market_thirty_day_change_pct numeric;
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

  if v_listing.collectible_identity_id is not null then
    select subject_id, display_name
      into v_subject_id, v_identity_display_name
    from public.tcos_mi_collectible_identities
    where id = v_listing.collectible_identity_id;

    select count(*)::integer into v_comp_count
    from public.tcos_mi_sold_comps
    where collectible_identity_id = v_listing.collectible_identity_id
      and verified = true
      and excluded = false
      and outlier_flag = false;
  end if;

  if new.market_value_id is not null then
    select
      conservative_value,
      coalesce(sample_size, 0),
      seven_day_change_pct,
      thirty_day_change_pct
    into
      v_market_value,
      v_market_sample_size,
      v_market_seven_day_change_pct,
      v_market_thirty_day_change_pct
    from public.tcos_mi_market_values
    where id = new.market_value_id;
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
    v_subject_id,
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
    v_market_value,
    v_comp_count,
    coalesce(v_market_sample_size, 0),
    new.confidence_score,
    new.liquidity_score,
    v_market_seven_day_change_pct,
    v_market_thirty_day_change_pct,
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
      'identity_display_name', v_identity_display_name,
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

comment on function public.tcos_mi_capture_deal_score_observation() is
  'Captures deal-score observations whether or not an optional market-value row exists.';

notify pgrst, 'reload schema';

commit;
