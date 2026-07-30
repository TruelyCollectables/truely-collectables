begin;

create or replace function public.truely_enqueue_ebay_quantity_sync_from_collectible_sale()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inventory_row public.inventory_items%rowtype;
  product_row public.products%rowtype;
begin
  if new.source_marketplace in (
    'website',
    'ebay',
    'ebay_or_collx_via_ebay'
  ) then
    return new;
  end if;

  select * into product_row
  from public.products
  where store_id = new.store_id and id = new.legacy_product_id;

  if not found or (
    nullif(btrim(coalesce(product_row.sku, '')), '') is null
    and nullif(btrim(coalesce(product_row.ebay_item_id, '')), '') is null
  ) then
    return new;
  end if;

  select * into inventory_row
  from public.inventory_items
  where store_id = new.store_id
    and (
      id = new.inventory_item_id
      or legacy_product_id = new.legacy_product_id
      or (product_row.sku is not null and sku = product_row.sku)
    )
  order by case when id = new.inventory_item_id then 0 else 1 end, created_at asc
  limit 1;

  if inventory_row.id is null then
    return new;
  end if;

  insert into public.ebay_quantity_sync_outbox as existing (
    store_id,
    source_type,
    source_id,
    order_id,
    legacy_product_id,
    inventory_item_id,
    sku,
    ebay_item_id,
    desired_quantity,
    status,
    next_attempt_at,
    updated_at
  ) values (
    new.store_id,
    'manual_sale',
    new.id,
    null,
    new.legacy_product_id,
    inventory_row.id,
    nullif(btrim(coalesce(product_row.sku, '')), ''),
    nullif(btrim(coalesce(product_row.ebay_item_id, '')), ''),
    0,
    'pending',
    now(),
    now()
  )
  on conflict (store_id, source_type, source_id)
  do update set
    desired_quantity = 0,
    status = case when existing.status = 'synced' and existing.desired_quantity = 0
      then existing.status else 'pending' end,
    next_attempt_at = now(),
    last_error = null,
    updated_at = now();

  return new;
end;
$$;

create or replace function public.apply_ebay_order_collectible_sale(
  p_store_id uuid,
  p_legacy_product_id bigint,
  p_event_key text,
  p_source_reference text,
  p_sold_quantity integer,
  p_sold_price numeric,
  p_currency text,
  p_sold_at timestamptz,
  p_evidence_status text,
  p_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_event_key text;
  existing_sale_id uuid;
  product_row public.products%rowtype;
  inventory_row public.inventory_items%rowtype;
  sold_quantity_value integer;
  next_product_quantity integer;
  next_inventory_quantity integer;
begin
  normalized_event_key := btrim(coalesce(p_event_key, ''));
  sold_quantity_value := greatest(coalesce(p_sold_quantity, 1), 1);

  if normalized_event_key = '' then
    raise exception 'A stable eBay sale event key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || normalized_event_key, 0)
  );

  select id into existing_sale_id
  from public.collectible_sales
  where store_id = p_store_id
    and event_key = normalized_event_key;
  if existing_sale_id is not null then
    return existing_sale_id;
  end if;

  select * into product_row
  from public.products
  where store_id = p_store_id
    and id = p_legacy_product_id
  for update;
  if not found then
    raise exception 'Product % was not found for store %', p_legacy_product_id, p_store_id
      using errcode = 'P0002';
  end if;

  select * into inventory_row
  from public.inventory_items
  where store_id = p_store_id
    and (
      legacy_product_id = p_legacy_product_id
      or (product_row.sku is not null and sku = product_row.sku)
    )
  order by case when legacy_product_id = p_legacy_product_id then 0 else 1 end, created_at asc
  limit 1
  for update;

  next_product_quantity := greatest(
    coalesce(product_row.quantity, 0) - sold_quantity_value,
    0
  );
  update public.products
     set quantity = next_product_quantity
   where store_id = p_store_id
     and id = p_legacy_product_id;

  if inventory_row.id is not null then
    next_inventory_quantity := greatest(
      coalesce(inventory_row.quantity, 0) - sold_quantity_value,
      0
    );
    update public.inventory_items
       set quantity = next_inventory_quantity,
           status = case when next_inventory_quantity > 0 then 'active' else 'sold' end
     where store_id = p_store_id
       and id = inventory_row.id;
  end if;

  return public.record_collectible_sale_unsafe_20260730(
    p_store_id,
    p_legacy_product_id,
    normalized_event_key,
    'ebay',
    p_source_reference,
    sold_quantity_value,
    p_sold_price,
    p_currency,
    p_sold_at,
    p_evidence_status,
    coalesce(p_evidence, '{}'::jsonb),
    false
  );
end;
$$;

revoke all on function public.apply_ebay_order_collectible_sale(
  uuid,
  bigint,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.apply_ebay_order_collectible_sale(
  uuid,
  bigint,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb
) to service_role;

comment on function public.apply_ebay_order_collectible_sale(
  uuid,
  bigint,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb
) is
  'Serializes one paid eBay order line, decrements product and inventory once, and appends exact sale evidence in the same transaction.';

commit;
