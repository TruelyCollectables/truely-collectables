alter table public.store_promotions
  add column if not exists free_shipping boolean not null default false,
  add column if not exists category_scope text;

create table if not exists public.store_promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  promotion_id uuid not null references public.store_promotions(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  email_hash text not null,
  address_hash text,
  redeemed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint store_promotion_redemptions_promotion_email_unique unique (promotion_id, email_hash),
  constraint store_promotion_redemptions_promotion_address_unique unique (promotion_id, address_hash)
);

create index if not exists store_promotion_redemptions_store_idx
  on public.store_promotion_redemptions (store_id, redeemed_at desc);

create index if not exists store_promotion_redemptions_email_idx
  on public.store_promotion_redemptions (promotion_id, email_hash);

alter table public.store_promotion_redemptions enable row level security;
revoke all on table public.store_promotion_redemptions from anon, authenticated;
grant select, insert, update on table public.store_promotion_redemptions to service_role;
