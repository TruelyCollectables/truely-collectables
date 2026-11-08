begin;

create or replace function public.truely_apply_offer_paid_price_to_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paid_offer_price numeric(12,2);
begin
  select coalesce(offer_row.counter_amount, offer_row.offer_amount)
  into paid_offer_price
  from public.orders order_row
  join public.offers offer_row
    on offer_row.store_id = order_row.store_id
   and offer_row.stripe_session_id = order_row.stripe_session_id
   and offer_row.product_id = new.product_id
  where order_row.store_id = new.store_id
    and order_row.id = new.order_id
  order by offer_row.updated_at desc nulls last, offer_row.id desc
  limit 1;

  if paid_offer_price is not null and paid_offer_price > 0 then
    new.price := paid_offer_price;
  end if;

  return new;
end;
$$;

drop trigger if exists truely_apply_offer_paid_price_to_order_item
  on public.order_items;
create trigger truely_apply_offer_paid_price_to_order_item
before insert or update of order_id, product_id, price on public.order_items
for each row
execute function public.truely_apply_offer_paid_price_to_order_item();

update public.order_items order_item
set price = coalesce(offer_row.counter_amount, offer_row.offer_amount)
from public.orders order_row
join public.offers offer_row
  on offer_row.store_id = order_row.store_id
 and offer_row.stripe_session_id = order_row.stripe_session_id
where order_item.store_id = order_row.store_id
  and order_item.order_id = order_row.id
  and offer_row.product_id = order_item.product_id
  and coalesce(offer_row.counter_amount, offer_row.offer_amount) > 0
  and order_item.price is distinct from coalesce(
    offer_row.counter_amount,
    offer_row.offer_amount
  );

revoke all on function public.truely_apply_offer_paid_price_to_order_item()
  from public, anon, authenticated;

comment on function public.truely_apply_offer_paid_price_to_order_item() is
  'Makes order_items.price the actual accepted/counter offer amount when the order Stripe session is linked to an offer; normal cart prices remain unchanged.';

commit;
