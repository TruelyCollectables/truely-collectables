begin;

alter table public.order_items
  add column if not exists seller_account_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'order_items_seller_account_id_fkey'
       and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_seller_account_id_fkey
      foreign key (seller_account_id)
      references public.account_profiles(id)
      on delete set null;
  end if;
end;
$$;

alter table public.orders
  add column if not exists contains_seller_items boolean not null default false,
  add column if not exists seller_item_count integer not null default 0,
  add column if not exists store_item_count integer not null default 0;

create index if not exists order_items_store_seller_account_idx
  on public.order_items(store_id, seller_account_id, order_id)
  where seller_account_id is not null;

create index if not exists orders_store_contains_seller_items_idx
  on public.orders(store_id, contains_seller_items, created_at desc);

notify pgrst, 'reload schema';

commit;
