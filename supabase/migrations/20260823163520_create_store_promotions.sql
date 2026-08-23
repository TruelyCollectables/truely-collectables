create table if not exists public.store_promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  percent_off numeric(5,2) not null check (percent_off > 0 and percent_off <= 100),
  first_order_only boolean not null default false,
  active boolean not null default true,
  expires_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null,
  stripe_livemode boolean not null default false,
  times_redeemed integer not null default 0 check (times_redeemed >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_promotions_code_format check (code ~ '^[A-Za-z0-9-]{3,32}$'),
  constraint store_promotions_stripe_promotion_unique unique (stripe_promotion_code_id)
);

create unique index if not exists store_promotions_store_code_unique
  on public.store_promotions (store_id, lower(code));

create index if not exists store_promotions_store_active_created_idx
  on public.store_promotions (store_id, active, created_at desc);

alter table public.store_promotions enable row level security;
revoke all on table public.store_promotions from anon, authenticated;
grant select, insert, update, delete on table public.store_promotions to service_role;

comment on table public.store_promotions is
  'Server-managed Stripe promotion codes for Truely Collectables checkout.';

alter table public.orders
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists discount_code text;

alter table public.orders
  drop constraint if exists orders_discount_amount_nonnegative;
alter table public.orders
  add constraint orders_discount_amount_nonnegative
  check (discount_amount >= 0);
