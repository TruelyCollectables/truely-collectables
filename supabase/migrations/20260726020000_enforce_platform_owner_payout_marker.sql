begin;

update public.seller_payout_accounts
set
  metadata =
    coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'settlement_mode', 'platform_store_owner',
      'connect_required', false,
      'platform_stripe_account', true,
      'owner_email', 'sales@truelycollectables.com',
      'provider_account_id_kind', 'internal_platform_owner'
    ),
  updated_at = now()
where provider = 'stripe_connect'
  and provider_account_id = 'platform_store_owner:' || store_id::text
  and not (
    coalesce(metadata ->> 'settlement_mode', '') = 'platform_store_owner'
    and coalesce(metadata ->> 'connect_required', '') = 'false'
    and coalesce(metadata ->> 'platform_stripe_account', '') = 'true'
    and coalesce(metadata ->> 'provider_account_id_kind', '') = 'internal_platform_owner'
  );

alter table public.seller_payout_accounts
  drop constraint if exists seller_payout_accounts_internal_owner_contract_check;

alter table public.seller_payout_accounts
  add constraint seller_payout_accounts_internal_owner_contract_check
  check (
    provider_account_id is null
    or provider_account_id not like 'platform_store_owner:%'
    or (
      provider = 'stripe_connect'
      and provider_account_id = 'platform_store_owner:' || store_id::text
      and coalesce(metadata ->> 'settlement_mode', '') = 'platform_store_owner'
      and coalesce(metadata ->> 'connect_required', '') = 'false'
      and coalesce(metadata ->> 'platform_stripe_account', '') = 'true'
      and coalesce(metadata ->> 'provider_account_id_kind', '') = 'internal_platform_owner'
    )
  ) not valid;

alter table public.seller_payout_accounts
  validate constraint seller_payout_accounts_internal_owner_contract_check;

commit;
