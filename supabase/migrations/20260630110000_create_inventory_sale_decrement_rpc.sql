create or replace function public.tcos_decrement_inventory_after_sale(
  p_store_id uuid,
  p_legacy_product_id bigint,
  p_quantity integer
)
returns table (
  legacy_product_id bigint,
  sku text,
  previous_quantity integer,
  new_quantity integer,
  inventory_item_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_inventory_item public.inventory_items%rowtype;
  v_has_inventory_item boolean := false;
  v_previous_quantity integer;
  v_new_quantity integer;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_sale_quantity'
      using errcode = '22023';
  end if;

  select *
    into v_product
    from public.products
    where id = p_legacy_product_id
      and store_id = p_store_id
    for update;

  if not found then
    raise exception 'inventory_product_not_found'
      using errcode = 'P0002';
  end if;

  v_previous_quantity := coalesce(v_product.quantity, 0);

  if v_previous_quantity < p_quantity then
    raise exception 'insufficient_inventory'
      using errcode = 'P0001';
  end if;

  v_new_quantity := v_previous_quantity - p_quantity;

  update public.products
    set quantity = v_new_quantity
    where id = v_product.id
      and store_id = p_store_id;

  select *
    into v_inventory_item
    from public.inventory_items as inventory_item
    where inventory_item.store_id = p_store_id
      and (
        inventory_item.legacy_product_id = p_legacy_product_id
        or (
          v_product.sku is not null
          and inventory_item.sku = v_product.sku
        )
      )
    order by
      case
        when inventory_item.legacy_product_id = p_legacy_product_id then 0
        else 1
      end,
      inventory_item.updated_at desc
    limit 1
    for update;

  v_has_inventory_item := found;

  if v_has_inventory_item then
    update public.inventory_items
      set quantity = v_new_quantity,
        status = case when v_new_quantity > 0 then 'active' else 'sold' end,
        updated_at = now()
      where id = v_inventory_item.id;
  elsif v_product.sku is not null then
    insert into public.inventory_items (
      store_id,
      legacy_product_id,
      sku,
      title,
      description,
      category,
      condition,
      status,
      quantity,
      price,
      currency
    )
    values (
      p_store_id,
      v_product.id,
      v_product.sku,
      coalesce(v_product.title, 'Untitled'),
      v_product.description,
      'other',
      'unknown',
      case when v_new_quantity > 0 then 'active' else 'sold' end,
      v_new_quantity,
      coalesce(v_product.price, 0),
      'USD'
    )
    returning * into v_inventory_item;

    v_has_inventory_item := true;
  end if;

  return query
    select
      v_product.id::bigint,
      v_product.sku,
      v_previous_quantity,
      v_new_quantity,
      case
        when v_has_inventory_item then v_inventory_item.id
        else null::uuid
      end;
end;
$$;

grant execute on function public.tcos_decrement_inventory_after_sale(uuid, bigint, integer)
  to anon, authenticated;
