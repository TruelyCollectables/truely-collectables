begin;

alter table public.products
  add column if not exists sold_at timestamptz,
  add column if not exists sold_price numeric(12,2),
  add column if not exists sold_source text,
  add column if not exists sold_reference text,
  add column if not exists sold_price_status text not null default 'unresolved',
  add column if not exists sold_evidence jsonb not null default '{}'::jsonb,
  add column if not exists archive_after timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.inventory_items
  add column if not exists sold_at timestamptz,
  add column if not exists sold_price numeric(12,2),
  add column if not exists sold_source text,
  add column if not exists sold_reference text,
  add column if not exists sold_price_status text not null default 'unresolved',
  add column if not exists sold_evidence jsonb not null default '{}'::jsonb,
  add column if not exists archive_after timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.collectible_assets
  add column if not exists sold_source text,
  add column if not exists sold_reference text,
  add column if not exists sold_currency text not null default 'USD',
  add column if not exists sold_quantity integer,
  add column if not exists sold_price_status text not null default 'unresolved',
  add column if not exists sold_price_evidence jsonb not null default '{}'::jsonb,
  add column if not exists archive_after timestamptz,
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_sold_price_status_check'
  ) then
    alter table public.products
      add constraint products_sold_price_status_check
      check (sold_price_status in ('verified','manual','unresolved'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_sold_price_status_check'
  ) then
    alter table public.inventory_items
      add constraint inventory_items_sold_price_status_check
      check (sold_price_status in ('verified','manual','unresolved'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'collectible_assets_sold_price_status_check'
  ) then
    alter table public.collectible_assets
      add constraint collectible_assets_sold_price_status_check
      check (sold_price_status in ('verified','manual','unresolved'));
  end if;
end
$$;

create table if not exists public.collectible_sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  asset_id uuid not null references public.collectible_assets(id) on delete restrict,
  legacy_product_id bigint not null,
  inventory_item_id uuid,
  sku text,
  ebay_item_id text,
  event_key text not null,
  source_marketplace text not null,
  source_reference text,
  sold_quantity integer not null default 1 check (sold_quantity > 0),
  sold_price numeric(12,2) check (sold_price is null or sold_price >= 0),
  currency text not null default 'USD',
  sold_at timestamptz not null,
  evidence_status text not null default 'unresolved'
    check (evidence_status in ('verified','manual','unresolved')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, event_key)
);

create index if not exists collectible_sales_product_time_idx
  on public.collectible_sales (store_id, legacy_product_id, sold_at desc);

create index if not exists collectible_sales_asset_time_idx
  on public.collectible_sales (asset_id, sold_at desc);

create index if not exists collectible_sales_verified_comp_idx
  on public.collectible_sales (store_id, sold_at desc)
  where sold_price is not null and evidence_status in ('verified','manual');

alter table public.collectible_sales enable row level security;
revoke all on table public.collectible_sales from anon, authenticated;
grant select, insert on table public.collectible_sales to service_role;

create or replace function public.reject_collectible_append_only_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

drop trigger if exists collectible_sales_append_only on public.collectible_sales;
create trigger collectible_sales_append_only
before update or delete on public.collectible_sales
for each row execute function public.reject_collectible_append_only_mutation();

create or replace function public.ensure_collectible_asset_for_product(
  p_store_id uuid,
  p_legacy_product_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products%rowtype;
  inventory_row public.inventory_items%rowtype;
  existing_asset_id uuid;
  created_asset_id uuid;
  mapped_status text;
begin
  select * into product_row
  from public.products
  where store_id = p_store_id and id = p_legacy_product_id;

  if not found then
    raise exception 'Product % was not found for store %', p_legacy_product_id, p_store_id
      using errcode = 'P0002';
  end if;

  select * into inventory_row
  from public.inventory_items
  where store_id = p_store_id
    and (legacy_product_id = p_legacy_product_id or (product_row.sku is not null and sku = product_row.sku))
  order by case when legacy_product_id = p_legacy_product_id then 0 else 1 end, created_at asc
  limit 1;

  select id into existing_asset_id
  from public.collectible_assets
  where store_id = p_store_id
    and (
      legacy_product_id = p_legacy_product_id
      or (inventory_row.id is not null and inventory_item_id = inventory_row.id)
    )
  order by created_at asc
  limit 1;

  mapped_status := case
    when product_row.archived_at is not null then 'archived'
    when coalesce(inventory_row.status, '') = 'archived' then 'archived'
    when coalesce(product_row.quantity, 0) <= 0 or coalesce(inventory_row.status, '') = 'sold' then 'sold'
    when coalesce(inventory_row.status, '') = 'reserved' then 'reserved'
    when coalesce(inventory_row.status, '') = 'draft' then 'pending_listing'
    else 'active'
  end;

  if existing_asset_id is not null then
    update public.collectible_assets
       set legacy_product_id = coalesce(legacy_product_id, p_legacy_product_id),
           inventory_item_id = coalesce(inventory_item_id, inventory_row.id),
           listing_price = coalesce(listing_price, product_row.price),
           lifecycle_status = case
             when lifecycle_status in ('pending_listing','active','reserved') then mapped_status
             else lifecycle_status
           end,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
             'legacy_product_id', p_legacy_product_id,
             'ebay_item_id', product_row.ebay_item_id,
             'image_url', product_row.image_url
           ))
     where id = existing_asset_id;
    return existing_asset_id;
  end if;

  insert into public.collectible_assets (
    store_id,
    seller_account_id,
    inventory_item_id,
    legacy_product_id,
    source_system,
    source_record_key,
    lifecycle_status,
    title,
    player,
    sport,
    condition,
    listing_price,
    sold_price,
    sold_at,
    sold_source,
    sold_reference,
    sold_price_status,
    archive_after,
    archived_at,
    metadata
  ) values (
    p_store_id,
    coalesce(inventory_row.seller_account_id, product_row.seller_account_id),
    inventory_row.id,
    p_legacy_product_id,
    'legacy_product_backfill',
    'legacy-product:' || p_legacy_product_id::text,
    mapped_status,
    product_row.title,
    product_row.player,
    product_row.sport,
    coalesce(inventory_row.condition, 'unknown'),
    product_row.price,
    product_row.sold_price,
    product_row.sold_at,
    product_row.sold_source,
    product_row.sold_reference,
    product_row.sold_price_status,
    product_row.archive_after,
    product_row.archived_at,
    jsonb_strip_nulls(jsonb_build_object(
      'legacy_product_id', p_legacy_product_id,
      'ebay_item_id', product_row.ebay_item_id,
      'image_url', product_row.image_url
    ))
  )
  on conflict (store_id, source_record_key) do update
    set inventory_item_id = coalesce(public.collectible_assets.inventory_item_id, excluded.inventory_item_id),
        legacy_product_id = coalesce(public.collectible_assets.legacy_product_id, excluded.legacy_product_id)
  returning id into created_asset_id;

  return created_asset_id;
end;
$$;

create or replace function public.record_collectible_sale(
  p_store_id uuid,
  p_legacy_product_id bigint,
  p_event_key text,
  p_source_marketplace text,
  p_source_reference text default null,
  p_sold_quantity integer default 1,
  p_sold_price numeric default null,
  p_currency text default 'USD',
  p_sold_at timestamptz default now(),
  p_evidence_status text default 'unresolved',
  p_evidence jsonb default '{}'::jsonb,
  p_force_zero boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  product_row public.products%rowtype;
  inventory_row public.inventory_items%rowtype;
  asset_id_value uuid;
  sale_id_value uuid;
  normalized_source text;
  normalized_status text;
  effective_sold_at timestamptz;
  final_sold boolean;
  should_replace_price boolean;
begin
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'A stable sale event key is required.' using errcode = '22023';
  end if;
  if p_sold_quantity is null or p_sold_quantity <= 0 then
    raise exception 'Sold quantity must be greater than zero.' using errcode = '22023';
  end if;
  if p_sold_price is not null and p_sold_price < 0 then
    raise exception 'Sold price cannot be negative.' using errcode = '22023';
  end if;

  normalized_source := lower(coalesce(nullif(btrim(p_source_marketplace), ''), 'unknown'));
  normalized_status := lower(coalesce(nullif(btrim(p_evidence_status), ''), 'unresolved'));
  if normalized_status not in ('verified','manual','unresolved') then
    raise exception 'Unsupported sale evidence status: %', normalized_status using errcode = '22023';
  end if;
  effective_sold_at := coalesce(p_sold_at, now());

  select * into product_row
  from public.products
  where store_id = p_store_id and id = p_legacy_product_id
  for update;
  if not found then
    raise exception 'Product % was not found for store %', p_legacy_product_id, p_store_id
      using errcode = 'P0002';
  end if;

  select * into inventory_row
  from public.inventory_items
  where store_id = p_store_id
    and (legacy_product_id = p_legacy_product_id or (product_row.sku is not null and sku = product_row.sku))
  order by case when legacy_product_id = p_legacy_product_id then 0 else 1 end, created_at asc
  limit 1
  for update;

  asset_id_value := public.ensure_collectible_asset_for_product(p_store_id, p_legacy_product_id);

  insert into public.collectible_sales (
    store_id,
    asset_id,
    legacy_product_id,
    inventory_item_id,
    sku,
    ebay_item_id,
    event_key,
    source_marketplace,
    source_reference,
    sold_quantity,
    sold_price,
    currency,
    sold_at,
    evidence_status,
    evidence
  ) values (
    p_store_id,
    asset_id_value,
    p_legacy_product_id,
    inventory_row.id,
    product_row.sku,
    product_row.ebay_item_id,
    btrim(p_event_key),
    normalized_source,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    p_sold_quantity,
    p_sold_price,
    upper(coalesce(nullif(btrim(p_currency), ''), 'USD')),
    effective_sold_at,
    normalized_status,
    coalesce(p_evidence, '{}'::jsonb)
  )
  on conflict (store_id, event_key) do nothing
  returning id into sale_id_value;

  if sale_id_value is null then
    select id into sale_id_value
    from public.collectible_sales
    where store_id = p_store_id and event_key = btrim(p_event_key);
  end if;

  final_sold := p_force_zero
    or coalesce(product_row.quantity, 0) <= 0
    or (inventory_row.id is not null and coalesce(inventory_row.quantity, 0) <= 0);

  should_replace_price := p_sold_price is not null and (
    product_row.sold_price is null
    or product_row.sold_price_status = 'unresolved'
    or normalized_status in ('verified','manual')
  );

  if p_force_zero then
    update public.products
       set quantity = 0
     where store_id = p_store_id and id = p_legacy_product_id;

    if inventory_row.id is not null then
      update public.inventory_items
         set quantity = 0,
             status = 'sold'
       where id = inventory_row.id and store_id = p_store_id;
    end if;
    final_sold := true;
  end if;

  if final_sold then
    update public.products
       set sold_at = coalesce(sold_at, effective_sold_at),
           sold_price = case when should_replace_price then p_sold_price else sold_price end,
           sold_source = case
             when should_replace_price or sold_source is null then normalized_source
             else sold_source
           end,
           sold_reference = case
             when should_replace_price or sold_reference is null then nullif(btrim(coalesce(p_source_reference, '')), '')
             else sold_reference
           end,
           sold_price_status = case
             when should_replace_price then normalized_status
             when sold_price is null then 'unresolved'
             else sold_price_status
           end,
           sold_evidence = case
             when should_replace_price or sold_evidence = '{}'::jsonb then coalesce(p_evidence, '{}'::jsonb)
             else sold_evidence
           end,
           archive_after = coalesce(archive_after, effective_sold_at + interval '7 days')
     where store_id = p_store_id and id = p_legacy_product_id;

    if inventory_row.id is not null then
      update public.inventory_items
         set sold_at = coalesce(sold_at, effective_sold_at),
             sold_price = case when should_replace_price then p_sold_price else sold_price end,
             sold_source = case
               when should_replace_price or sold_source is null then normalized_source
               else sold_source
             end,
             sold_reference = case
               when should_replace_price or sold_reference is null then nullif(btrim(coalesce(p_source_reference, '')), '')
               else sold_reference
             end,
             sold_price_status = case
               when should_replace_price then normalized_status
               when sold_price is null then 'unresolved'
               else sold_price_status
             end,
             sold_evidence = case
               when should_replace_price or sold_evidence = '{}'::jsonb then coalesce(p_evidence, '{}'::jsonb)
               else sold_evidence
             end,
             archive_after = coalesce(archive_after, effective_sold_at + interval '7 days')
       where id = inventory_row.id and store_id = p_store_id;
    end if;

    update public.collectible_assets
       set lifecycle_status = 'sold',
           sold_price = case
             when p_sold_price is not null and (
               sold_price is null or sold_price_status = 'unresolved' or normalized_status in ('verified','manual')
             ) then p_sold_price
             else sold_price
           end,
           sold_at = coalesce(sold_at, effective_sold_at),
           sold_source = case
             when p_sold_price is not null or sold_source is null then normalized_source
             else sold_source
           end,
           sold_reference = case
             when p_sold_price is not null or sold_reference is null then nullif(btrim(coalesce(p_source_reference, '')), '')
             else sold_reference
           end,
           sold_currency = upper(coalesce(nullif(btrim(p_currency), ''), 'USD')),
           sold_quantity = coalesce(sold_quantity, 0) + p_sold_quantity,
           sold_price_status = case
             when p_sold_price is not null then normalized_status
             when sold_price is null then 'unresolved'
             else sold_price_status
           end,
           sold_price_evidence = case
             when p_sold_price is not null or sold_price_evidence = '{}'::jsonb then coalesce(p_evidence, '{}'::jsonb)
             else sold_price_evidence
           end,
           archive_after = coalesce(archive_after, effective_sold_at + interval '7 days'),
           sold_order_id = coalesce(sold_order_id, nullif(btrim(coalesce(p_source_reference, '')), ''))
     where id = asset_id_value;
  end if;

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
    asset_id_value,
    p_store_id,
    case when final_sold then 'sold' else 'partial_sale' end,
    null,
    case when final_sold then 'sold' else null end,
    effective_sold_at,
    normalized_source,
    nullif(btrim(coalesce(p_source_reference, '')), ''),
    jsonb_build_object(
      'sale_id', sale_id_value,
      'event_key', btrim(p_event_key),
      'legacy_product_id', p_legacy_product_id,
      'quantity', p_sold_quantity,
      'sold_price', p_sold_price,
      'currency', upper(coalesce(nullif(btrim(p_currency), ''), 'USD')),
      'evidence_status', normalized_status,
      'force_zero', p_force_zero
    ) || coalesce(p_evidence, '{}'::jsonb)
  );

  return sale_id_value;
end;
$$;

create or replace function public.mark_collectible_asset_sold_from_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_collectible_sale(
    new.store_id,
    new.product_id,
    'website:order:' || new.order_id::text || ':product:' || new.product_id::text,
    'website',
    new.order_id::text,
    greatest(coalesce(new.quantity, 1), 1),
    new.price,
    'USD',
    now(),
    'verified',
    jsonb_build_object(
      'order_id', new.order_id,
      'product_id', new.product_id,
      'quantity', new.quantity,
      'unit_price', new.price,
      'evidence_source', 'order_items'
    ),
    false
  );
  return new;
end;
$$;

drop trigger if exists mark_collectible_asset_sold_from_order_item on public.order_items;
create trigger mark_collectible_asset_sold_from_order_item
after insert on public.order_items
for each row execute function public.mark_collectible_asset_sold_from_order_item();

create or replace function public.archive_expired_collectible_sales(
  p_store_id uuid default null
)
returns table (
  archived_products integer,
  archived_inventory_items integer,
  archived_assets integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  product_count integer := 0;
  inventory_count integer := 0;
  asset_count integer := 0;
begin
  update public.products
     set archived_at = coalesce(archived_at, now())
   where quantity <= 0
     and sold_at is not null
     and archive_after is not null
     and archive_after <= now()
     and archived_at is null
     and (p_store_id is null or store_id = p_store_id);
  get diagnostics product_count = row_count;

  update public.inventory_items
     set status = 'archived',
         archived_at = coalesce(archived_at, now())
   where quantity <= 0
     and status = 'sold'
     and sold_at is not null
     and archive_after is not null
     and archive_after <= now()
     and archived_at is null
     and (p_store_id is null or store_id = p_store_id);
  get diagnostics inventory_count = row_count;

  update public.collectible_assets
     set lifecycle_status = 'archived',
         archived_at = coalesce(archived_at, now())
   where lifecycle_status = 'sold'
     and sold_at is not null
     and archive_after is not null
     and archive_after <= now()
     and archived_at is null
     and (p_store_id is null or store_id = p_store_id);
  get diagnostics asset_count = row_count;

  return query select product_count, inventory_count, asset_count;
end;
$$;

revoke all on function public.ensure_collectible_asset_for_product(uuid,bigint) from public, anon, authenticated;
revoke all on function public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.archive_expired_collectible_sales(uuid) from public, anon, authenticated;
grant execute on function public.ensure_collectible_asset_for_product(uuid,bigint) to service_role;
grant execute on function public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean) to service_role;
grant execute on function public.archive_expired_collectible_sales(uuid) to service_role;

do $$
declare
  product_row record;
begin
  for product_row in
    select store_id, id from public.products order by id
  loop
    perform public.ensure_collectible_asset_for_product(product_row.store_id, product_row.id);
  end loop;
end
$$;

do $$
declare
  order_row record;
begin
  for order_row in
    select
      oi.store_id,
      oi.product_id,
      oi.order_id,
      oi.quantity,
      oi.price,
      o.created_at
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.store_id = oi.store_id
    where o.created_at < timestamptz '2026-07-28 00:00:00+00'
    order by o.created_at, oi.order_id, oi.product_id
  loop
    perform public.record_collectible_sale(
      order_row.store_id,
      order_row.product_id,
      'website:order:' || order_row.order_id::text || ':product:' || order_row.product_id::text,
      'website',
      order_row.order_id::text,
      greatest(coalesce(order_row.quantity, 1), 1),
      order_row.price,
      'USD',
      order_row.created_at,
      'verified',
      jsonb_build_object(
        'order_id', order_row.order_id,
        'product_id', order_row.product_id,
        'quantity', order_row.quantity,
        'unit_price', order_row.price,
        'evidence_source', 'historical_order_items_backfill'
      ),
      false
    );
  end loop;
end
$$;

update public.products
   set sold_price_status = 'unresolved'
 where quantity <= 0 and sold_price is null;

update public.inventory_items
   set sold_price_status = 'unresolved'
 where quantity <= 0 and sold_price is null;

create or replace view public.instacomp_internal_sold_comps
with (security_invoker = true)
as
select
  s.id as sale_id,
  s.store_id,
  s.asset_id,
  s.legacy_product_id,
  s.inventory_item_id,
  s.sku,
  s.ebay_item_id,
  s.source_marketplace,
  s.source_reference,
  s.sold_quantity,
  s.sold_price,
  s.currency,
  s.sold_at,
  s.evidence_status,
  a.title,
  a.player,
  a.card_year,
  a.manufacturer,
  a.product_set,
  a.insert_subset,
  a.card_number,
  a.parallel_variant,
  a.team,
  a.sport,
  a.rookie_status,
  a.autograph_status,
  a.memorabilia_status,
  a.condition,
  a.exact_serial_number,
  a.serial_copy_number,
  a.serial_print_run,
  a.grading_company,
  a.grading_grade,
  a.grading_cert_number,
  s.evidence
from public.collectible_sales s
join public.collectible_assets a on a.id = s.asset_id
where s.sold_price is not null
  and s.evidence_status in ('verified','manual');

revoke all on table public.instacomp_internal_sold_comps from public, anon, authenticated;
grant select on table public.instacomp_internal_sold_comps to service_role;

comment on table public.collectible_sales is
  'Append-only authoritative sale evidence used by storefront SOLD retention, admin history, and InstaComp internal comps.';
comment on view public.instacomp_internal_sold_comps is
  'Verified/manual internal sold comps only; unresolved prices are intentionally excluded.';

commit;
