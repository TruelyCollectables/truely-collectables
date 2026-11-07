alter table if exists public.account_profiles
  add column if not exists card_verified boolean not null default false,
  add column if not exists card_verified_at timestamptz,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_setup_intent_id text,
  add column if not exists stripe_payment_method_id text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_exp_month integer,
  add column if not exists card_exp_year integer,
  add column if not exists card_funding text,
  add column if not exists billing_name text,
  add column if not exists billing_country text,
  add column if not exists billing_postal_code text;

create index if not exists account_profiles_status_card_idx
  on public.account_profiles(account_status, card_verified, card_verified_at desc);

create index if not exists account_profiles_stripe_customer_idx
  on public.account_profiles(stripe_customer_id)
  where stripe_customer_id is not null;
