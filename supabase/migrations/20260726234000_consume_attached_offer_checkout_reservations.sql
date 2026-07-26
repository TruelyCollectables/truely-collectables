begin;

create or replace function public.tcos_decrement_order_inventory_once(
  p_store_id uuid,
  p_order_id bigint,
  p_legacy_product_id bigint,
  p_quantity integer
)
returns table (
  inventory_item_id uuid,
  previous_quantity integer,
  new_quantity integer,
  already_consumed boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.order_inventory_consumptions%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_reservation public.checkout_inventory_reservations%rowtype;
  v_order_stripe_session_id text;
  v_previous integer;
  v_new integer;
  v_other_reserved integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'order_inventory_quantity_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_store_id::text || ':' || p_order_id::text || ':' || p_legacy_product_id::text,
      0
    )
  );

  select consumption.*
    into v_existing
    from public.order_inventory_consumptions as consumption
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

  select inventory.*
    into v_inventory
    from public.inventory_items as inventory
   where inventory.store_id = p_store_id
     and inventory.legacy_product_id = p_legacy_product_id
   order by inventory.updated_at desc nulls last, inventory.id desc
   limit 1
   for update;

  if not found then
    raise exception 'inventory_product_not_found:%', p_legacy_product_id;
  end if;

  select orders.stripe_session_id
    into v_order_stripe_session_id
    from public.orders as orders
   where orders.store_id = p_store_id
     and orders.id = p_order_id;

  if nullif(btrim(coalesce(v_order_stripe_session_id, '')), '') is not null then
    select reservation.*
      into v_reservation
      from public.checkout_inventory_reservations as reservation
     where reservation.store_id = p_store_id
       and reservation.legacy_product_id = p_legacy_product_id
       and reservation.stripe_session_id = v_order_stripe_session_id
       and reservation.status = 'active'
       and reservation.expires_at > now()
     order by reservation.created_at asc
     limit 1
     for update;

    if found then
      if v_reservation.quantity <> p_quantity then
        raise exception 'reservation_consume_quantity_mismatch:%', p_legacy_product_id;
      end if;

      v_previous := coalesce(v_inventory.quantity, 0);
      if v_previous < p_quantity then
        raise exception 'insufficient_inventory:%', p_legacy_product_id;
      end if;
      v_new := v_previous - p_quantity;

      update public.inventory_items
         set quantity = v_new,
             status = case when v_new > 0 then 'active' else 'sold' end,
             updated_at = now()
       where id = v_inventory.id
         and store_id = p_store_id;

      update public.products
         set quantity = v_new
       where id = p_legacy_product_id
         and store_id = p_store_id;

      if not found then
        raise exception 'inventory_legacy_product_not_found:%', p_legacy_product_id;
      end if;

      update public.checkout_inventory_reservations
         set status = 'consumed',
             consumed_at = now(),
             updated_at = now()
       where id = v_reservation.id;

      insert into public.order_inventory_consumptions (
        store_id,
        order_id,
        legacy_product_id,
        inventory_item_id,
        quantity,
        previous_quantity,
        new_quantity
      ) values (
        p_store_id,
        p_order_id,
        p_legacy_product_id,
        v_inventory.id,
        p_quantity,
        v_previous,
        v_new
      );

      inventory_item_id := v_inventory.id;
      previous_quantity := v_previous;
      new_quantity := v_new;
      already_consumed := false;
      return next;
      return;
    end if;
  end if;

  select coalesce(sum(reservation.quantity), 0)::integer
    into v_other_reserved
    from public.checkout_inventory_reservations as reservation
   where reservation.store_id = p_store_id
     and reservation.legacy_product_id = p_legacy_product_id
     and reservation.status = 'active'
     and reservation.expires_at > now();

  v_previous := coalesce(v_inventory.quantity, 0);

  if v_previous - v_other_reserved < p_quantity then
    raise exception 'insufficient_inventory:%', p_legacy_product_id;
  end if;

  v_new := v_previous - p_quantity;

  update public.inventory_items
     set quantity = v_new,
         status = case when v_new > 0 then 'active' else 'sold' end,
         updated_at = now()
   where id = v_inventory.id
     and store_id = p_store_id;

  update public.products
     set quantity = v_new
   where id = p_legacy_product_id
     and store_id = p_store_id;

  if not found then
    raise exception 'inventory_legacy_product_not_found:%', p_legacy_product_id;
  end if;

  insert into public.order_inventory_consumptions (
    store_id,
    order_id,
    legacy_product_id,
    inventory_item_id,
    quantity,
    previous_quantity,
    new_quantity
  ) values (
    p_store_id,
    p_order_id,
    p_legacy_product_id,
    v_inventory.id,
    p_quantity,
    v_previous,
    v_new
  );

  inventory_item_id := v_inventory.id;
  previous_quantity := v_previous;
  new_quantity := v_new;
  already_consumed := false;
  return next;
end;
$$;

revoke all on function public.tcos_decrement_order_inventory_once(uuid, bigint, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.tcos_decrement_order_inventory_once(uuid, bigint, bigint, integer)
  to service_role;

commit;
