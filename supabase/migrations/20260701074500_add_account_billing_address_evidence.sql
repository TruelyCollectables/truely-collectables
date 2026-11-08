alter table if exists public.account_profiles
  add column if not exists billing_line1 text,
  add column if not exists billing_line2 text,
  add column if not exists billing_city text,
  add column if not exists billing_state text,
  add column if not exists card_verification_failure_reason text,
  add column if not exists card_verification_checked_at timestamptz;

create index if not exists account_profiles_card_failure_idx
  on public.account_profiles(account_status, card_verification_failure_reason, card_verification_checked_at desc)
  where card_verification_failure_reason is not null;
