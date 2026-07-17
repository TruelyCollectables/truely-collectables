create table if not exists public.instacomp_price_radar_ignores (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  legacy_product_id bigint not null references public.products(id) on delete cascade,
  ignore_until timestamptz,
  ignore_forever boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instacomp_price_radar_ignores_window_check
    check (ignore_forever = true or ignore_until is not null),
  constraint instacomp_price_radar_ignores_unique_product
    unique (store_id, legacy_product_id)
);

create index if not exists instacomp_price_radar_ignores_active_idx
  on public.instacomp_price_radar_ignores(store_id, legacy_product_id, ignore_until, ignore_forever);

grant select, insert, update, delete on table public.instacomp_price_radar_ignores
  to authenticated, service_role;

alter table public.instacomp_price_radar_ignores enable row level security;

drop policy if exists instacomp_price_radar_ignores_service_role_all
  on public.instacomp_price_radar_ignores;

create policy instacomp_price_radar_ignores_service_role_all
  on public.instacomp_price_radar_ignores
  for all
  to service_role
  using (true)
  with check (true);
