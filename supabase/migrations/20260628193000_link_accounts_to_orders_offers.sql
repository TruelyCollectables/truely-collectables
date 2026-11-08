alter table if exists public.orders
  add column if not exists account_id uuid references public.account_profiles(id);

alter table if exists public.offers
  add column if not exists account_id uuid references public.account_profiles(id);

create index if not exists orders_store_account_created_at_idx
  on public.orders(store_id, account_id, created_at desc)
  where account_id is not null;

create index if not exists offers_store_account_created_at_idx
  on public.offers(store_id, account_id, created_at desc)
  where account_id is not null;
