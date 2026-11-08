create or replace function public.tcos_decrement_inventory_after_sale(
  p_store_id uuid,
  p_legacy_product_id bigint,
  p_quantity integer
)
returns table(
  legacy_product_id bigint,
  sku text,
  previous_quantity integer,
  new_quantity integer,
  inventory_item_id uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_product public.products%rowtype;
  v_mutation record;
begin
  select * into v_product
    from public.products
   where store_id = p_store_id and id = p_legacy_product_id;
  if not found then
    raise exception 'inventory_product_not_found' using errcode = 'P0002';
  end if;

  select * into v_mutation
    from public.truely_decrement_shared_or_legacy_inventory(
      p_store_id,
      p_legacy_product_id,
      p_quantity
    );

  legacy_product_id := v_product.id;
  sku := v_product.sku;
  previous_quantity := v_mutation.previous_quantity;
  new_quantity := v_mutation.new_quantity;
  inventory_item_id := v_mutation.inventory_item_id;
  return next;
end;
$function$;

create or replace function public.tcos_consume_checkout_reservation_after_sale(
  p_store_id uuid,
  p_checkout_attempt_id uuid,
  p_legacy_product_id bigint,
  p_quantity integer,
  p_stripe_session_id text
)
returns table(
  inventory_item_id uuid,
  previous_quantity integer,
  new_quantity integer,
  already_consumed boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_reservation public.checkout_inventory_reservations%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_card_uuid uuid;
  v_current integer;
  v_mutation record;
begin
  if p_store_id is null or p_checkout_attempt_id is null or p_legacy_product_id is null then
    raise exception 'reservation_consume_not_found:%', p_legacy_product_id;
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'reservation_consume_quantity_invalid';
  end if;
  if p_stripe_session_id is null or btrim(p_stripe_session_id) = '' then
    raise exception 'reservation_consume_session_missing';
  end if;

  select coalesce(product.card_uuid, inventory.card_uuid)
    into v_card_uuid
    from public.products product
    left join public.inventory_items inventory
      on inventory.store_id = product.store_id
     and inventory.legacy_product_id = product.id
   where product.store_id = p_store_id
     and product.id = p_legacy_product_id
   order by inventory.updated_at desc nulls last
   limit 1;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text || ':' ||
      case when v_card_uuid is not null
        then 'card:' || v_card_uuid::text
        else 'product:' || p_legacy_product_id::text
      end,
      0
    )
  );

  select reservation.* into v_reservation
    from public.checkout_inventory_reservations reservation
   where reservation.store_id = p_store_id
     and reservation.checkout_attempt_id = p_checkout_attempt_id
     and reservation.legacy_product_id = p_legacy_product_id
   for update;
  if not found then
    raise exception 'reservation_consume_not_found:%', p_legacy_product_id;
  end if;

  if v_reservation.stripe_session_id is distinct from p_stripe_session_id then
    raise exception 'reservation_consume_session_mismatch:%', p_legacy_product_id;
  end if;
  if v_reservation.quantity <> p_quantity then
    raise exception 'reservation_consume_quantity_mismatch:%', p_legacy_product_id;
  end if;

  select inventory.* into v_inventory
    from public.inventory_items inventory
   where inventory.id = v_reservation.inventory_item_id
     and inventory.store_id = p_store_id
     and inventory.legacy_product_id = p_legacy_product_id
   for update;
  if not found then
    raise exception 'inventory_product_not_found:%', p_legacy_product_id;
  end if;

  if v_reservation.status = 'consumed' then
    if v_card_uuid is not null then
      select stock.quantity into v_current
        from public.inventory_shared_stock stock
       where stock.store_id = p_store_id and stock.card_uuid = v_card_uuid;
    end if;
    v_current := coalesce(v_current, v_inventory.quantity, 0);
    inventory_item_id := v_inventory.id;
    previous_quantity := v_current;
    new_quantity := v_current;
    already_consumed := true;
    return next;
    return;
  end if;

  if v_reservation.status not in ('active', 'expired') then
    raise exception 'reservation_consume_not_active:%', p_legacy_product_id;
  end if;

  select * into v_mutation
    from public.truely_decrement_shared_or_legacy_inventory(
      p_store_id,
      p_legacy_product_id,
      p_quantity
    );

  update public.checkout_inventory_reservations
     set status = 'consumed',
         consumed_at = now(),
         released_at = null,
         updated_at = now()
   where id = v_reservation.id;

  inventory_item_id := v_mutation.inventory_item_id;
  previous_quantity := v_mutation.previous_quantity;
  new_quantity := v_mutation.new_quantity;
  already_consumed := false;
  return next;
end;
$function$;

create or replace function public.tcos_decrement_order_inventory_once(
  p_store_id uuid,
  p_order_id bigint,
  p_legacy_product_id bigint,
  p_quantity integer
)
returns table(
  inventory_item_id uuid,
  previous_quantity integer,
  new_quantity integer,
  already_consumed boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_existing public.order_inventory_consumptions%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_reservation public.checkout_inventory_reservations%rowtype;
  v_order_stripe_session_id text;
  v_card_uuid uuid;
  v_owned_quantity integer;
  v_other_reserved integer;
  v_mutation record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'order_inventory_quantity_invalid';
  end if;

  select coalesce(product.card_uuid, inventory.card_uuid)
    into v_card_uuid
    from public.products product
    left join public.inventory_items inventory
      on inventory.store_id = product.store_id
     and inventory.legacy_product_id = product.id
   where product.store_id = p_store_id
     and product.id = p_legacy_product_id
   order by inventory.updated_at desc nulls last
   limit 1;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text || ':' ||
      case when v_card_uuid is not null
        then 'card:' || v_card_uuid::text
        else 'product:' || p_legacy_product_id::text
      end,
      0
    )
  );

  select consumption.* into v_existing
    from public.order_inventory_consumptions consumption
   where consumption.store_id = p_store_id
     and consumption.order_id = p_order_id
     and consumption.legacy_product_id = p_legacy_product_id;
  if found then
    if v_existing.quantity <> p_quantity then
      raise exception 'order_inventory_quantity_mismatch:%', p_legacy_product_id;
    end if;
    inventory_item_id := v_existing.inventory_item_id;
    previous_quantity := v_existing.previous_quantity;
    new_quantity := v_existing.new_quantity;
    already_consumed := true;
    return next;
    return;
  end if;

  select inventory.* into v_inventory
    from public.inventory_items inventory
   where inventory.store_id = p_store_id
     and inventory.legacy_product_id = p_legacy_product_id
   order by inventory.updated_at desc nulls last, inventory.id desc
   limit 1
   for update;
  if not found then
    raise exception 'inventory_product_not_found:%', p_legacy_product_id;
  end if;

  select orders.stripe_session_id into v_order_stripe_session_id
    from public.orders orders
   where orders.store_id = p_store_id and orders.id = p_order_id;

  if nullif(btrim(coalesce(v_order_stripe_session_id, '')), '') is not null then
    select reservation.* into v_reservation
      from public.checkout_inventory_reservations reservation
     where reservation.store_id = p_store_id
       and reservation.legacy_product_id = p_legacy_product_id
       and reservation.stripe_session_id = v_order_stripe_session_id
       and reservation.status in ('active', 'expired')
     order by reservation.created_at asc
     limit 1
     for update;

    if found then
      if v_reservation.quantity <> p_quantity then
        raise exception 'reservation_consume_quantity_mismatch:%', p_legacy_product_id;
      end if;

      select * into v_mutation
        from public.truely_decrement_shared_or_legacy_inventory(
          p_store_id,
          p_legacy_product_id,
          p_quantity
        );

      update public.checkout_inventory_reservations
         set status = 'consumed', consumed_at = now(), released_at = null, updated_at = now()
       where id = v_reservation.id;

      insert into public.order_inventory_consumptions(
        store_id, order_id, legacy_product_id, inventory_item_id,
        quantity, previous_quantity, new_quantity
      ) values (
        p_store_id, p_order_id, p_legacy_product_id, v_mutation.inventory_item_id,
        p_quantity, v_mutation.previous_quantity, v_mutation.new_quantity
      );

      inventory_item_id := v_mutation.inventory_item_id;
      previous_quantity := v_mutation.previous_quantity;
      new_quantity := v_mutation.new_quantity;
      already_consumed := false;
      return next;
      return;
    end if;
  end if;

  if v_card_uuid is not null then
    select stock.quantity into v_owned_quantity
      from public.inventory_shared_stock stock
     where stock.store_id = p_store_id and stock.card_uuid = v_card_uuid
     for update;

    select coalesce(sum(reservation.quantity), 0)::integer into v_other_reserved
      from public.checkout_inventory_reservations reservation
      join public.products reserved_product
        on reserved_product.store_id = reservation.store_id
       and reserved_product.id = reservation.legacy_product_id
     where reservation.store_id = p_store_id
       and reserved_product.card_uuid = v_card_uuid
       and reservation.status = 'active'
       and (reservation.expires_at > now() or reservation.stripe_session_id is not null);
  else
    v_owned_quantity := coalesce(v_inventory.quantity, 0);
    select coalesce(sum(reservation.quantity), 0)::integer into v_other_reserved
      from public.checkout_inventory_reservations reservation
     where reservation.store_id = p_store_id
       and reservation.legacy_product_id = p_legacy_product_id
       and reservation.status = 'active'
       and (reservation.expires_at > now() or reservation.stripe_session_id is not null);
  end if;

  v_owned_quantity := coalesce(v_owned_quantity, v_inventory.quantity, 0);
  if v_owned_quantity - coalesce(v_other_reserved, 0) < p_quantity then
    raise exception 'insufficient_inventory:%', p_legacy_product_id;
  end if;

  select * into v_mutation
    from public.truely_decrement_shared_or_legacy_inventory(
      p_store_id,
      p_legacy_product_id,
      p_quantity
    );

  insert into public.order_inventory_consumptions(
    store_id, order_id, legacy_product_id, inventory_item_id,
    quantity, previous_quantity, new_quantity
  ) values (
    p_store_id, p_order_id, p_legacy_product_id, v_mutation.inventory_item_id,
    p_quantity, v_mutation.previous_quantity, v_mutation.new_quantity
  );

  inventory_item_id := v_mutation.inventory_item_id;
  previous_quantity := v_mutation.previous_quantity;
  new_quantity := v_mutation.new_quantity;
  already_consumed := false;
  return next;
end;
$function$;

create or replace function public.tcos_reserve_checkout_inventory(
  p_store_id uuid,
  p_checkout_attempt_id uuid,
  p_items jsonb,
  p_ttl_minutes integer default 32
)
returns table(
  reservation_id uuid,
  legacy_product_id bigint,
  inventory_item_id uuid,
  reserved_quantity integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_item jsonb;
  v_product_id bigint;
  v_requested integer;
  v_inventory public.inventory_items%rowtype;
  v_reservation public.checkout_inventory_reservations%rowtype;
  v_has_reservation boolean;
  v_card_uuid uuid;
  v_owned_quantity integer;
  v_other_reserved integer;
  v_expires_at timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_ttl_minutes, 32), 32), 60));
begin
  if p_store_id is null or p_checkout_attempt_id is null then
    raise exception 'reservation_cart_invalid';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'reservation_cart_empty';
  end if;

  update public.checkout_inventory_reservations reservation
     set status = 'expired', updated_at = now()
   where reservation.store_id = p_store_id
     and reservation.status = 'active'
     and reservation.expires_at <= now()
     and reservation.stripe_session_id is null;

  for v_item in select item.value from jsonb_array_elements(p_items) item loop
    begin
      v_product_id := nullif(v_item ->> 'id', '')::bigint;
      v_requested := nullif(v_item ->> 'quantity', '')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'reservation_cart_invalid';
    end;

    if v_product_id is null or v_requested is null or v_requested <= 0 then
      raise exception 'reservation_cart_invalid';
    end if;

    select coalesce(product.card_uuid, inventory.card_uuid)
      into v_card_uuid
      from public.products product
      left join public.inventory_items inventory
        on inventory.store_id = product.store_id
       and inventory.legacy_product_id = product.id
     where product.store_id = p_store_id and product.id = v_product_id
     order by inventory.updated_at desc nulls last
     limit 1;

    perform pg_advisory_xact_lock(
      hashtextextended(
        p_store_id::text || ':' ||
        case when v_card_uuid is not null
          then 'card:' || v_card_uuid::text
          else 'product:' || v_product_id::text
        end,
        0
      )
    );

    v_has_reservation := false;
    select reservation.* into v_reservation
      from public.checkout_inventory_reservations reservation
     where reservation.store_id = p_store_id
       and reservation.checkout_attempt_id = p_checkout_attempt_id
       and reservation.legacy_product_id = v_product_id
     for update;
    v_has_reservation := found;

    if v_has_reservation then
      if v_reservation.status = 'consumed' then
        raise exception 'reservation_cart_consumed:%', v_product_id;
      end if;
      if v_reservation.status = 'active' and v_reservation.stripe_session_id is not null then
        raise exception 'reservation_cart_session_attached:%', v_product_id;
      end if;
      if v_reservation.status = 'expired' and v_reservation.stripe_session_id is not null then
        raise exception 'reservation_cart_expired_session_attached:%', v_product_id;
      end if;
    end if;

    select inventory.* into v_inventory
      from public.inventory_items inventory
     where inventory.store_id = p_store_id
       and inventory.legacy_product_id = v_product_id
     order by inventory.updated_at desc nulls last, inventory.id desc
     limit 1
     for update;
    if not found then
      raise exception 'inventory_product_not_found:%', v_product_id;
    end if;
    if v_inventory.status <> 'active' then
      raise exception 'inventory_not_active:%', v_product_id;
    end if;

    if v_card_uuid is not null then
      select stock.quantity into v_owned_quantity
        from public.inventory_shared_stock stock
       where stock.store_id = p_store_id and stock.card_uuid = v_card_uuid
       for update;

      select coalesce(sum(reservation.quantity), 0)::integer into v_other_reserved
        from public.checkout_inventory_reservations reservation
        join public.products reserved_product
          on reserved_product.store_id = reservation.store_id
         and reserved_product.id = reservation.legacy_product_id
       where reservation.store_id = p_store_id
         and reserved_product.card_uuid = v_card_uuid
         and reservation.status = 'active'
         and (reservation.expires_at > now() or reservation.stripe_session_id is not null)
         and reservation.checkout_attempt_id <> p_checkout_attempt_id;
    else
      v_owned_quantity := coalesce(v_inventory.quantity, 0);
      select coalesce(sum(reservation.quantity), 0)::integer into v_other_reserved
        from public.checkout_inventory_reservations reservation
       where reservation.store_id = p_store_id
         and reservation.legacy_product_id = v_product_id
         and reservation.status = 'active'
         and (reservation.expires_at > now() or reservation.stripe_session_id is not null)
         and reservation.checkout_attempt_id <> p_checkout_attempt_id;
    end if;

    v_owned_quantity := coalesce(v_owned_quantity, v_inventory.quantity, 0);
    if v_owned_quantity - coalesce(v_other_reserved, 0) < v_requested then
      raise exception 'insufficient_inventory:%', v_product_id;
    end if;

    if v_has_reservation then
      update public.checkout_inventory_reservations reservation
         set inventory_item_id = v_inventory.id,
             quantity = v_requested,
             status = 'active',
             stripe_session_id = null,
             expires_at = v_expires_at,
             consumed_at = null,
             released_at = null,
             updated_at = now()
       where reservation.id = v_reservation.id
       returning reservation.* into v_reservation;
    else
      insert into public.checkout_inventory_reservations(
        store_id, checkout_attempt_id, legacy_product_id, inventory_item_id,
        quantity, status, expires_at, updated_at
      ) values (
        p_store_id, p_checkout_attempt_id, v_product_id, v_inventory.id,
        v_requested, 'active', v_expires_at, now()
      ) returning * into v_reservation;
    end if;

    reservation_id := v_reservation.id;
    legacy_product_id := v_reservation.legacy_product_id;
    inventory_item_id := v_reservation.inventory_item_id;
    reserved_quantity := v_reservation.quantity;
    expires_at := v_reservation.expires_at;
    return next;
  end loop;
end;
$function$;

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
set search_path to 'public'
as $function$
declare
  normalized_event_key text;
  existing_sale_id uuid;
  sale_id_value uuid;
  product_row public.products%rowtype;
  inventory_row public.inventory_items%rowtype;
  sold_quantity_value integer;
  current_owned_quantity integer;
  consumed_quantity integer;
  protected_quantity_value integer;
  shared_uuid uuid;
  mutation record;
begin
  normalized_event_key := btrim(coalesce(p_event_key, ''));
  sold_quantity_value := greatest(coalesce(p_sold_quantity, 1), 1);
  if normalized_event_key = '' then
    raise exception 'A stable eBay sale event key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || ':' || normalized_event_key, 0));

  select id into existing_sale_id
    from public.collectible_sales
   where store_id = p_store_id and event_key = normalized_event_key;
  if existing_sale_id is not null then
    return existing_sale_id;
  end if;

  select * into product_row
    from public.products
   where store_id = p_store_id and id = p_legacy_product_id
   for update;
  if not found then
    raise exception 'Product % was not found for store %', p_legacy_product_id, p_store_id using errcode = 'P0002';
  end if;

  select * into inventory_row
    from public.inventory_items inventory
   where inventory.store_id = p_store_id
     and (inventory.legacy_product_id = p_legacy_product_id or (product_row.sku is not null and inventory.sku = product_row.sku))
   order by case when inventory.legacy_product_id = p_legacy_product_id then 0 else 1 end, inventory.created_at asc
   limit 1
   for update;

  shared_uuid := coalesce(product_row.card_uuid, inventory_row.card_uuid);
  if shared_uuid is not null then
    select stock.quantity into current_owned_quantity
      from public.inventory_shared_stock stock
     where stock.store_id = p_store_id and stock.card_uuid = shared_uuid
     for update;
  end if;
  current_owned_quantity := coalesce(
    current_owned_quantity,
    least(coalesce(product_row.quantity, 0), coalesce(inventory_row.quantity, product_row.quantity, 0)),
    0
  );

  sale_id_value := public.record_collectible_sale_unsafe_20260730(
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

  consumed_quantity := least(current_owned_quantity, sold_quantity_value);
  if consumed_quantity > 0 then
    select * into mutation
      from public.truely_decrement_shared_or_legacy_inventory(
        p_store_id,
        p_legacy_product_id,
        consumed_quantity
      );
    protected_quantity_value := mutation.new_quantity;
  else
    protected_quantity_value := 0;
  end if;

  if shared_uuid is not null and protected_quantity_value = 0 then
    update public.products
       set sold_at = coalesce(sold_at, p_sold_at, now()),
           sold_source = coalesce(sold_source, 'ebay'),
           sold_reference = coalesce(sold_reference, nullif(btrim(coalesce(p_source_reference, '')), ''))
     where store_id = p_store_id and card_uuid = shared_uuid;
    update public.inventory_items
       set sold_at = coalesce(sold_at, p_sold_at, now()),
           sold_source = coalesce(sold_source, 'ebay'),
           sold_reference = coalesce(sold_reference, nullif(btrim(coalesce(p_source_reference, '')), ''))
     where store_id = p_store_id and card_uuid = shared_uuid;
  end if;

  insert into public.ebay_inbound_sale_guards as existing(
    store_id, legacy_product_id, inventory_item_id, source_sale_id,
    protected_quantity, active, release_reason, released_at, updated_at
  ) values (
    p_store_id, p_legacy_product_id, inventory_row.id, sale_id_value,
    protected_quantity_value, true, null, null, now()
  )
  on conflict (store_id, legacy_product_id)
  do update set
    inventory_item_id = coalesce(excluded.inventory_item_id, existing.inventory_item_id),
    source_sale_id = excluded.source_sale_id,
    protected_quantity = least(existing.protected_quantity, excluded.protected_quantity),
    active = true,
    release_reason = null,
    released_at = null,
    updated_at = now();

  return sale_id_value;
end;
$function$;
