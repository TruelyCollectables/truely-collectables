alter table public.ebay_quantity_sync_outbox
  drop constraint if exists ebay_quantity_sync_outbox_store_id_source_type_source_id_key;

alter table public.ebay_quantity_sync_outbox
  add constraint ebay_quantity_sync_outbox_source_product_key
  unique (store_id, source_type, source_id, legacy_product_id);

create or replace function public.truely_enqueue_ebay_quantity_sync_from_order_consumption()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_card_uuid uuid;
  target record;
begin
  select coalesce(product.card_uuid, inventory.card_uuid)
    into v_card_uuid
    from public.products product
    left join public.inventory_items inventory
      on inventory.store_id = product.store_id
     and inventory.legacy_product_id = product.id
   where product.store_id = new.store_id
     and product.id = new.legacy_product_id
   order by inventory.updated_at desc nulls last
   limit 1;

  for target in
    select product.id as legacy_product_id,
           product.sku,
           product.ebay_item_id,
           inventory.id as inventory_item_id
      from public.products product
      left join public.inventory_items inventory
        on inventory.store_id = product.store_id
       and inventory.legacy_product_id = product.id
     where product.store_id = new.store_id
       and (
         (v_card_uuid is null and product.id = new.legacy_product_id)
         or (v_card_uuid is not null and product.card_uuid = v_card_uuid)
       )
       and nullif(btrim(coalesce(product.ebay_item_id, '')), '') is not null
  loop
    insert into public.ebay_quantity_sync_outbox as existing(
      store_id, source_type, source_id, order_id, legacy_product_id,
      inventory_item_id, sku, ebay_item_id, desired_quantity,
      status, next_attempt_at, updated_at
    ) values (
      new.store_id, 'order_inventory_consumption', new.id, new.order_id,
      target.legacy_product_id, target.inventory_item_id,
      nullif(btrim(coalesce(target.sku, '')), ''),
      nullif(btrim(coalesce(target.ebay_item_id, '')), ''),
      greatest(coalesce(new.new_quantity, 0), 0),
      'pending', now(), now()
    )
    on conflict (store_id, source_type, source_id, legacy_product_id)
    do update set
      order_id = excluded.order_id,
      inventory_item_id = coalesce(excluded.inventory_item_id, existing.inventory_item_id),
      sku = excluded.sku,
      ebay_item_id = excluded.ebay_item_id,
      desired_quantity = least(existing.desired_quantity, excluded.desired_quantity),
      status = case
        when existing.status = 'synced' and existing.desired_quantity <= excluded.desired_quantity
          then existing.status
        else 'pending'
      end,
      next_attempt_at = now(),
      last_error = null,
      updated_at = now();
  end loop;

  return new;
end;
$function$;

create or replace function public.truely_enqueue_ebay_quantity_sync_from_reservation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_card_uuid uuid;
  v_quantity integer;
  v_order_id bigint;
  target record;
begin
  if new.status <> 'consumed' or old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(product.card_uuid, inventory.card_uuid),
         inventory.quantity,
         order_row.id
    into v_card_uuid, v_quantity, v_order_id
    from public.products product
    join public.inventory_items inventory
      on inventory.store_id = product.store_id
     and inventory.id = new.inventory_item_id
    left join public.orders order_row
      on order_row.store_id = new.store_id
     and order_row.stripe_session_id = new.stripe_session_id
   where product.store_id = new.store_id
     and product.id = new.legacy_product_id;

  if not found then
    return new;
  end if;

  if v_card_uuid is not null then
    select stock.quantity into v_quantity
      from public.inventory_shared_stock stock
     where stock.store_id = new.store_id
       and stock.card_uuid = v_card_uuid;
  end if;
  v_quantity := greatest(coalesce(v_quantity, 0), 0);

  for target in
    select product.id as legacy_product_id,
           product.sku,
           product.ebay_item_id,
           inventory.id as inventory_item_id
      from public.products product
      left join public.inventory_items inventory
        on inventory.store_id = product.store_id
       and inventory.legacy_product_id = product.id
     where product.store_id = new.store_id
       and (
         (v_card_uuid is null and product.id = new.legacy_product_id)
         or (v_card_uuid is not null and product.card_uuid = v_card_uuid)
       )
       and nullif(btrim(coalesce(product.ebay_item_id, '')), '') is not null
  loop
    insert into public.ebay_quantity_sync_outbox as existing(
      store_id, source_type, source_id, order_id, legacy_product_id,
      inventory_item_id, sku, ebay_item_id, desired_quantity,
      status, next_attempt_at, updated_at
    ) values (
      new.store_id, 'checkout_reservation', new.id, v_order_id,
      target.legacy_product_id, target.inventory_item_id,
      nullif(btrim(coalesce(target.sku, '')), ''),
      nullif(btrim(coalesce(target.ebay_item_id, '')), ''),
      v_quantity, 'pending', now(), now()
    )
    on conflict (store_id, source_type, source_id, legacy_product_id)
    do update set
      order_id = excluded.order_id,
      inventory_item_id = coalesce(excluded.inventory_item_id, existing.inventory_item_id),
      sku = excluded.sku,
      ebay_item_id = excluded.ebay_item_id,
      desired_quantity = least(existing.desired_quantity, excluded.desired_quantity),
      status = case
        when existing.status = 'synced' and existing.desired_quantity <= excluded.desired_quantity
          then existing.status
        else 'pending'
      end,
      next_attempt_at = now(),
      last_error = null,
      updated_at = now();
  end loop;

  return new;
end;
$function$;

create or replace function public.truely_enqueue_ebay_quantity_sync_from_collectible_sale()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_card_uuid uuid;
  v_quantity integer;
  target record;
begin
  if new.source_marketplace in ('website', 'ebay', 'ebay_or_collx_via_ebay') then
    return new;
  end if;

  select coalesce(product.card_uuid, inventory.card_uuid),
         inventory.quantity
    into v_card_uuid, v_quantity
    from public.products product
    left join public.inventory_items inventory
      on inventory.store_id = product.store_id
     and inventory.legacy_product_id = product.id
   where product.store_id = new.store_id
     and product.id = new.legacy_product_id
   order by inventory.updated_at desc nulls last
   limit 1;

  if not found then
    return new;
  end if;

  if v_card_uuid is not null then
    select stock.quantity into v_quantity
      from public.inventory_shared_stock stock
     where stock.store_id = new.store_id
       and stock.card_uuid = v_card_uuid;
  end if;
  v_quantity := greatest(coalesce(v_quantity, 0), 0);

  for target in
    select product.id as legacy_product_id,
           product.sku,
           product.ebay_item_id,
           inventory.id as inventory_item_id
      from public.products product
      left join public.inventory_items inventory
        on inventory.store_id = product.store_id
       and inventory.legacy_product_id = product.id
     where product.store_id = new.store_id
       and (
         (v_card_uuid is null and product.id = new.legacy_product_id)
         or (v_card_uuid is not null and product.card_uuid = v_card_uuid)
       )
       and nullif(btrim(coalesce(product.ebay_item_id, '')), '') is not null
  loop
    insert into public.ebay_quantity_sync_outbox as existing(
      store_id, source_type, source_id, order_id, legacy_product_id,
      inventory_item_id, sku, ebay_item_id, desired_quantity,
      status, next_attempt_at, updated_at
    ) values (
      new.store_id, 'manual_sale', new.id, null,
      target.legacy_product_id, target.inventory_item_id,
      nullif(btrim(coalesce(target.sku, '')), ''),
      nullif(btrim(coalesce(target.ebay_item_id, '')), ''),
      v_quantity, 'pending', now(), now()
    )
    on conflict (store_id, source_type, source_id, legacy_product_id)
    do update set
      inventory_item_id = coalesce(excluded.inventory_item_id, existing.inventory_item_id),
      sku = excluded.sku,
      ebay_item_id = excluded.ebay_item_id,
      desired_quantity = least(existing.desired_quantity, excluded.desired_quantity),
      status = case
        when existing.status = 'synced' and existing.desired_quantity <= excluded.desired_quantity
          then existing.status
        else 'pending'
      end,
      next_attempt_at = now(),
      last_error = null,
      updated_at = now();
  end loop;

  return new;
end;
$function$;
