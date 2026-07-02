alter table if exists public.products
  add column if not exists seller_account_id uuid
    references public.account_profiles(id) on delete set null;

alter table if exists public.inventory_items
  add column if not exists seller_account_id uuid
    references public.account_profiles(id) on delete set null;

create index if not exists products_store_seller_account_idx
  on public.products(store_id, seller_account_id, created_at desc)
  where seller_account_id is not null;

create index if not exists inventory_items_store_seller_account_idx
  on public.inventory_items(store_id, seller_account_id, created_at desc)
  where seller_account_id is not null;
