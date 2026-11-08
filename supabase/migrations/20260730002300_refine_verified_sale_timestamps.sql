begin;

create or replace function public.refine_collectible_sold_time_from_verified_sale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.evidence_status not in ('verified', 'manual') then
    return new;
  end if;

  update public.products
     set sold_at = case
           when sold_at is null then new.sold_at
           else least(sold_at, new.sold_at)
         end,
         archive_after = case
           when sold_at is null or new.sold_at < sold_at
             then new.sold_at + interval '7 days'
           else coalesce(archive_after, sold_at + interval '7 days')
         end
   where store_id = new.store_id
     and id = new.legacy_product_id
     and quantity <= 0
     and archived_at is null;

  update public.inventory_items
     set sold_at = case
           when sold_at is null then new.sold_at
           else least(sold_at, new.sold_at)
         end,
         archive_after = case
           when sold_at is null or new.sold_at < sold_at
             then new.sold_at + interval '7 days'
           else coalesce(archive_after, sold_at + interval '7 days')
         end
   where store_id = new.store_id
     and (
       id = new.inventory_item_id
       or legacy_product_id = new.legacy_product_id
     )
     and quantity <= 0
     and status = 'sold'
     and archived_at is null;

  update public.collectible_assets
     set sold_at = case
           when sold_at is null then new.sold_at
           else least(sold_at, new.sold_at)
         end,
         archive_after = case
           when sold_at is null or new.sold_at < sold_at
             then new.sold_at + interval '7 days'
           else coalesce(archive_after, sold_at + interval '7 days')
         end
   where id = new.asset_id
     and store_id = new.store_id
     and lifecycle_status = 'sold'
     and archived_at is null;

  return new;
end;
$$;

drop trigger if exists refine_collectible_sold_time_from_verified_sale
  on public.collectible_sales;
create trigger refine_collectible_sold_time_from_verified_sale
after insert on public.collectible_sales
for each row
execute function public.refine_collectible_sold_time_from_verified_sale();

revoke all on function public.refine_collectible_sold_time_from_verified_sale()
  from public, anon, authenticated;

comment on function public.refine_collectible_sold_time_from_verified_sale() is
  'Moves the seven-day SOLD retention clock back to the authoritative transaction time when verified/manual evidence arrives after an earlier marketplace-inactive detection.';

commit;
