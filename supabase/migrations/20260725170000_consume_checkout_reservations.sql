begin;

create or replace function public.tcos_consume_checkout_reservation_after_sale(
  p_store_id uuid,
  p_checkout_attempt_id uuid,
  p_legacy_product_id bigint,
  p_quantity integer,
  p_stripe_session_id text
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
  v_reservation public.checkout_inventory_reservations%rowtype;
  v_inventory public.inventory_items%rowtype;
  v_previous integer;
  v_new integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'reservation_consume_quantity_invalid';
  end if;

  if p_stripe_session_id is null or btrim(p_stripe_session_id) = '' then
    raise exception 'reservation_consume_session_missing';
  end if;

  select reservation.*
    into v_reservation
    from public.checkout_inventory_reservations as reservation
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

  select inventory.*
    into v_inventory
    from public.inventory_items as inventory
   where inventory.id = v_reservation.inventory_item_id
     and inventory.store_id = p_store_id
     and inventory.legacy_product_id = p_legacy_product_id
   for update;

  if not found then
    raise exception 'inventory_product_not_found:%', p_legacy_product_id;
  end if;

  if v_reservation.status = 'consumed' then
    inventory_item_id := v_inventory.id;
    previous_quantity := coalesce(v_inventory.quantity, 0);
    new_quantity := coalesce(v_inventory.quantity, 0);
    already_consumed := true;
    return next;
    return;
  end if;

  if v_reservation.status not in ('active', 'expired') then
    raise exception 'reservation_consume_not_active:%', p_legacy_product_id;
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

  inventory_item_id := v_inventory.id;
  previous_quantity := v_previous;
  new_quantity := v_new;
  already_consumed := false;
  return next;
end;
$$;

revoke all on function public.tcos_consume_checkout_reservation_after_sale(uuid, uuid, bigint, integer, text)
  from public, anon, authenticated;
grant execute on function public.tcos_consume_checkout_reservation_after_sale(uuid, uuid, bigint, integer, text)
  to service_role;

commit;
