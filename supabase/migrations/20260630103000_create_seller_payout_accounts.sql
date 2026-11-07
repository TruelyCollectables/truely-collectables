create table if not exists public.seller_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  provider text not null default 'stripe_connect',
  provider_account_id text not null,
  onboarding_status text not null default 'not_started',
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  requirements_currently_due text[] not null default '{}'::text[],
  requirements_past_due text[] not null default '{}'::text[],
  disabled_reason text,
  seller_tos_accepted boolean not null default false,
  seller_tos_version text,
  seller_tos_accepted_at timestamptz,
  tos_acceptance_event_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payout_accounts_provider_check
    check (provider in ('stripe_connect')),
  constraint seller_payout_accounts_status_check
    check (onboarding_status in (
      'not_started',
      'payout_verification_required',
      'pending_provider_review',
      'active',
      'restricted',
      'disabled'
    )),
  unique(store_id, account_id, provider),
  unique(provider, provider_account_id)
);

create index if not exists seller_payout_accounts_account_idx
  on public.seller_payout_accounts(account_id, store_id, provider);

create index if not exists seller_payout_accounts_status_idx
  on public.seller_payout_accounts(store_id, onboarding_status, updated_at desc);
