create table if not exists public.store_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  support_email text,
  sales_email text,
  offers_email text,
  evidence_email text,
  evidence_from_email text,
  order_from_email text,
  stripe_mode text not null default 'env',
  stripe_account_id text,
  ebay_environment text not null default 'production',
  ebay_account_label text,
  seller_commission_rate numeric(6, 5) not null default 0.05,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.store_settings (
  store_id,
  support_email,
  sales_email,
  offers_email,
  evidence_email,
  evidence_from_email,
  order_from_email,
  stripe_mode,
  ebay_environment,
  ebay_account_label,
  seller_commission_rate
)
values (
  '00000000-0000-4000-8000-000000000001',
  'support@truelycollectables.com',
  'sales@truelycollectables.com',
  'offers@truelycollectables.com',
  null,
  'Truely Collectables Evidence <sales@truelycollectables.com>',
  'Truely Collectables <sales@truelycollectables.com>',
  'env',
  'production',
  'Truely Collectables eBay',
  0.05
)
on conflict (store_id) do update set
  support_email = coalesce(public.store_settings.support_email, excluded.support_email),
  sales_email = coalesce(public.store_settings.sales_email, excluded.sales_email),
  offers_email = coalesce(public.store_settings.offers_email, excluded.offers_email),
  evidence_from_email = coalesce(public.store_settings.evidence_from_email, excluded.evidence_from_email),
  order_from_email = coalesce(public.store_settings.order_from_email, excluded.order_from_email),
  stripe_mode = coalesce(public.store_settings.stripe_mode, excluded.stripe_mode),
  ebay_environment = coalesce(public.store_settings.ebay_environment, excluded.ebay_environment),
  ebay_account_label = coalesce(public.store_settings.ebay_account_label, excluded.ebay_account_label),
  seller_commission_rate = coalesce(public.store_settings.seller_commission_rate, excluded.seller_commission_rate),
  updated_at = now();

create index if not exists store_settings_ebay_environment_idx
  on public.store_settings(ebay_environment);
