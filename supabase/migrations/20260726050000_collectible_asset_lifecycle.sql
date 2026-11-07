begin;

create table if not exists public.collectible_assets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_account_id uuid,
  inventory_item_id uuid,
  legacy_product_id bigint,
  source_system text not null default 'instacomp_verified_reference',
  source_record_key text not null,
  lifecycle_status text not null default 'pending_listing'
    check (lifecycle_status in ('pending_listing','active','reserved','sold','returned','archived')),
  title text not null,
  player text,
  card_year integer,
  manufacturer text,
  product_set text,
  insert_subset text,
  card_number text,
  parallel_variant text,
  team text,
  sport text,
  rookie_status text,
  autograph_status text,
  memorabilia_status text,
  condition text,
  exact_serial_number text,
  serial_copy_number integer,
  serial_print_run integer,
  grading_company text,
  grading_grade text,
  grading_cert_number text,
  grader_verification_status text not null default 'not_applicable'
    check (grader_verification_status in ('not_applicable','pending','verified','manual_verified','conflict','not_supported','failed')),
  grader_verification_url text,
  grader_verified_at timestamptz,
  grader_verification_payload jsonb not null default '{}'::jsonb,
  front_storage_path text,
  back_storage_path text,
  front_sha256 text,
  back_sha256 text,
  acquisition_cost numeric(12,2),
  acquisition_date date,
  listing_price numeric(12,2),
  listed_at timestamptz,
  sold_price numeric(12,2),
  sold_at timestamptz,
  sold_order_id text,
  current_market_value numeric(12,2),
  last_market_checked_at timestamptz,
  post_sale_tracking_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, source_record_key)
);

create unique index if not exists collectible_assets_store_inventory_uidx
  on public.collectible_assets (store_id, inventory_item_id)
  where inventory_item_id is not null;

create unique index if not exists collectible_assets_store_grader_cert_uidx
  on public.collectible_assets (
    store_id,
    lower(grading_company),
    grading_cert_number
  )
  where grading_company is not null
    and grading_cert_number is not null
    and btrim(grading_cert_number) <> '';

create index if not exists collectible_assets_store_lifecycle_idx
  on public.collectible_assets (store_id, lifecycle_status, updated_at desc);

create index if not exists collectible_assets_legacy_product_idx
  on public.collectible_assets (store_id, legacy_product_id)
  where legacy_product_id is not null;

create table if not exists public.collectible_asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.collectible_assets(id) on delete cascade,
  store_id uuid not null,
  event_type text not null,
  previous_status text,
  new_status text,
  event_at timestamptz not null default now(),
  source text not null,
  source_reference text,
  event_payload jsonb not null default '{}'::jsonb
);

create index if not exists collectible_asset_events_asset_time_idx
  on public.collectible_asset_events (asset_id, event_at desc);

create table if not exists public.collectible_grader_verifications (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.collectible_assets(id) on delete cascade,
  store_id uuid not null,
  provider text not null,
  cert_number text not null,
  status text not null
    check (status in ('verified','manual_verified','conflict','not_supported','failed')),
  verification_url text,
  checked_at timestamptz not null default now(),
  expected_identity jsonb not null default '{}'::jsonb,
  observed_identity jsonb not null default '{}'::jsonb,
  mismatch_reasons text[] not null default '{}'::text[],
  provider_scan_urls text[] not null default '{}'::text[],
  raw_evidence jsonb not null default '{}'::jsonb
);

create index if not exists collectible_grader_verifications_asset_time_idx
  on public.collectible_grader_verifications (asset_id, checked_at desc);

create table if not exists public.collectible_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.collectible_assets(id) on delete cascade,
  store_id uuid not null,
  checked_at timestamptz not null default now(),
  market_value numeric(12,2),
  sold_median numeric(12,2),
  active_market_low numeric(12,2),
  active_market_high numeric(12,2),
  sold_comp_count integer not null default 0,
  active_comp_count integer not null default 0,
  trusted_for_pricing boolean not null default false,
  source text not null default 'instacomp',
  evidence jsonb not null default '{}'::jsonb
);

create index if not exists collectible_market_snapshots_asset_time_idx
  on public.collectible_market_snapshots (asset_id, checked_at desc);

alter table public.collectible_assets enable row level security;
alter table public.collectible_asset_events enable row level security;
alter table public.collectible_grader_verifications enable row level security;
alter table public.collectible_market_snapshots enable row level security;

revoke all on table public.collectible_assets from anon, authenticated;
revoke all on table public.collectible_asset_events from anon, authenticated;
revoke all on table public.collectible_grader_verifications from anon, authenticated;
revoke all on table public.collectible_market_snapshots from anon, authenticated;

grant select, insert, update, delete on table public.collectible_assets to service_role;
grant select, insert, update, delete on table public.collectible_asset_events to service_role;
grant select, insert, update, delete on table public.collectible_grader_verifications to service_role;
grant select, insert, update, delete on table public.collectible_market_snapshots to service_role;

create or replace function public.collectible_assets_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists collectible_assets_set_updated_at on public.collectible_assets;
create trigger collectible_assets_set_updated_at
before update on public.collectible_assets
for each row execute function public.collectible_assets_set_updated_at();

create or replace function public.reject_collectible_append_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = '55000';
end;
$$;

drop trigger if exists collectible_asset_events_append_only on public.collectible_asset_events;
create trigger collectible_asset_events_append_only
before update or delete on public.collectible_asset_events
for each row execute function public.reject_collectible_append_only_mutation();

drop trigger if exists collectible_grader_verifications_append_only on public.collectible_grader_verifications;
create trigger collectible_grader_verifications_append_only
before update or delete on public.collectible_grader_verifications
for each row execute function public.reject_collectible_append_only_mutation();

drop trigger if exists collectible_market_snapshots_append_only on public.collectible_market_snapshots;
create trigger collectible_market_snapshots_append_only
before update or delete on public.collectible_market_snapshots
for each row execute function public.reject_collectible_append_only_mutation();

create or replace function public.sync_collectible_asset_inventory_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_row record;
  mapped_status text;
begin
  mapped_status := case new.status
    when 'draft' then 'pending_listing'
    when 'active' then 'active'
    when 'reserved' then 'reserved'
    when 'sold' then 'sold'
    when 'archived' then 'archived'
    else null
  end;

  if mapped_status is null then
    return new;
  end if;

  for asset_row in
    update public.collectible_assets
       set lifecycle_status = mapped_status,
           listing_price = case
             when new.price is not null and new.price > 0 then new.price
             else listing_price
           end,
           listed_at = case
             when mapped_status = 'active' and listed_at is null then now()
             else listed_at
           end,
           sold_at = case
             when mapped_status = 'sold' and sold_at is null then now()
             else sold_at
           end
     where store_id = new.store_id
       and inventory_item_id = new.id
       and (
         lifecycle_status is distinct from mapped_status
         or (
           new.price is not null
           and new.price > 0
           and listing_price is distinct from new.price
         )
       )
     returning id, lifecycle_status
  loop
    insert into public.collectible_asset_events (
      asset_id,
      store_id,
      event_type,
      previous_status,
      new_status,
      source,
      source_reference,
      event_payload
    ) values (
      asset_row.id,
      new.store_id,
      'inventory_status_changed',
      old.status,
      mapped_status,
      'inventory_items_trigger',
      new.id::text,
      jsonb_build_object(
        'inventory_item_id', new.id,
        'legacy_product_id', new.legacy_product_id,
        'quantity', new.quantity,
        'price', new.price
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists sync_collectible_asset_inventory_lifecycle on public.inventory_items;
create trigger sync_collectible_asset_inventory_lifecycle
after update of status, price, quantity on public.inventory_items
for each row execute function public.sync_collectible_asset_inventory_lifecycle();

create or replace function public.mark_collectible_asset_sold_from_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_row record;
begin
  for asset_row in
    update public.collectible_assets
       set lifecycle_status = 'sold',
           sold_price = new.price,
           sold_at = coalesce(sold_at, now()),
           sold_order_id = new.order_id::text
     where store_id = new.store_id
       and legacy_product_id = new.product_id
       and lifecycle_status <> 'sold'
     returning id
  loop
    insert into public.collectible_asset_events (
      asset_id,
      store_id,
      event_type,
      previous_status,
      new_status,
      source,
      source_reference,
      event_payload
    ) values (
      asset_row.id,
      new.store_id,
      'sold',
      null,
      'sold',
      'order_items_trigger',
      new.order_id::text,
      jsonb_build_object(
        'order_id', new.order_id,
        'product_id', new.product_id,
        'quantity', new.quantity,
        'unit_price', new.price
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists mark_collectible_asset_sold_from_order_item on public.order_items;
create trigger mark_collectible_asset_sold_from_order_item
after insert on public.order_items
for each row execute function public.mark_collectible_asset_sold_from_order_item();


create or replace function public.capture_collectible_market_snapshot_from_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  asset_row record;
  tracking jsonb;
  market_value_numeric numeric;
  checked_at_value timestamptz;
begin
  tracking := coalesce(new.metadata, '{}'::jsonb)
    -> 'instacomp_tracking'
    -> 'current';

  if tracking is null or jsonb_typeof(tracking) <> 'object' then
    return new;
  end if;

  begin
    market_value_numeric := nullif(tracking ->> 'marketPrice', '')::numeric;
  exception when others then
    market_value_numeric := null;
  end;

  begin
    checked_at_value := coalesce(
      nullif(tracking ->> 'updatedAt', '')::timestamptz,
      now()
    );
  exception when others then
    checked_at_value := now();
  end;

  for asset_row in
    select id, last_market_checked_at
      from public.collectible_assets
     where store_id = new.store_id
       and inventory_item_id = new.id
  loop
    if asset_row.last_market_checked_at is not null
       and asset_row.last_market_checked_at >= checked_at_value then
      continue;
    end if;

    insert into public.collectible_market_snapshots (
      asset_id,
      store_id,
      checked_at,
      market_value,
      sold_median,
      active_market_low,
      active_market_high,
      sold_comp_count,
      active_comp_count,
      trusted_for_pricing,
      source,
      evidence
    ) values (
      asset_row.id,
      new.store_id,
      checked_at_value,
      market_value_numeric,
      case
        when nullif(tracking ->> 'soldMedian', '') is null then null
        else (tracking ->> 'soldMedian')::numeric
      end,
      case
        when nullif(tracking ->> 'marketLow', '') is null then null
        else (tracking ->> 'marketLow')::numeric
      end,
      case
        when nullif(tracking ->> 'marketHigh', '') is null then null
        else (tracking ->> 'marketHigh')::numeric
      end,
      coalesce((tracking ->> 'soldCompCount')::integer, 0),
      coalesce((tracking ->> 'marketCompCount')::integer, 0),
      coalesce((tracking ->> 'trustedForPricing')::boolean, false),
      'instacomp_inventory_tracking',
      tracking
    );

    update public.collectible_assets
       set current_market_value = market_value_numeric,
           last_market_checked_at = checked_at_value
     where id = asset_row.id;

    insert into public.collectible_asset_events (
      asset_id,
      store_id,
      event_type,
      previous_status,
      new_status,
      event_at,
      source,
      source_reference,
      event_payload
    ) values (
      asset_row.id,
      new.store_id,
      'market_snapshot_recorded',
      null,
      null,
      checked_at_value,
      'inventory_metadata_trigger',
      new.id::text,
      jsonb_build_object(
        'market_value', market_value_numeric,
        'trusted_for_pricing', coalesce((tracking ->> 'trustedForPricing')::boolean, false)
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists capture_collectible_market_snapshot_from_inventory on public.inventory_items;
create trigger capture_collectible_market_snapshot_from_inventory
after update of metadata on public.inventory_items
for each row execute function public.capture_collectible_market_snapshot_from_inventory();

commit;
