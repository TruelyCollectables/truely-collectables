alter table public.orders
  add column if not exists tos_accepted boolean not null default false,
  add column if not exists tos_version text,
  add column if not exists tos_accepted_at timestamptz;

alter table public.offers
  add column if not exists tos_accepted boolean not null default false,
  add column if not exists tos_version text,
  add column if not exists tos_accepted_at timestamptz;

create index if not exists orders_tos_accepted_at_idx
  on public.orders (tos_accepted_at desc);

create index if not exists offers_tos_accepted_at_idx
  on public.offers (tos_accepted_at desc);
