\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

\ir ../supabase/migrations/20260803200000_kingmaker_pricing_decision_receipts.sql
\ir ../supabase/migrations/20260803233000_kingmaker_pricing_command_center.sql
\ir ../supabase/migrations/20260804011000_kingmaker_pricing_saved_view_atomic_lifecycle.sql
\ir ../supabase/migrations/20260804011000_kingmaker_pricing_saved_view_atomic_lifecycle.sql

set role service_role;

select public.tcos_create_kingmaker_pricing_saved_view_atomic(
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'First View',
  '{"status":"ready"}'::jsonb,
  true
);

select public.tcos_create_kingmaker_pricing_saved_view_atomic(
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'Second View',
  '{"status":"review_required"}'::jsonb,
  true
);

-- The duplicate insert must roll back the default reset inside the function.
do $$
declare
  v_default_count integer;
  v_default_name text;
begin
  begin
    perform public.tcos_create_kingmaker_pricing_saved_view_atomic(
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      'First View',
      '{}'::jsonb,
      true
    );
    raise exception 'Duplicate saved view unexpectedly succeeded.';
  exception when unique_violation then
    null;
  end;

  select count(*), min(name)
  into v_default_count, v_default_name
  from public.tcos_kingmaker_pricing_saved_views
  where store_id = '30000000-0000-4000-8000-000000000001'
    and seller_account_id = '40000000-0000-4000-8000-000000000001'
    and archived_at is null
    and is_default;
  if v_default_count <> 1 or v_default_name <> 'Second View' then
    raise exception 'Failed create did not preserve the prior default.';
  end if;
end;
$$;

-- Wrong-owner and stale retire attempts must fail without changing the row.
do $$
declare
  v_view_id uuid;
begin
  select id into v_view_id
  from public.tcos_kingmaker_pricing_saved_views
  where name = 'Second View';

  begin
    perform public.tcos_retire_kingmaker_pricing_saved_view_atomic(
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000099',
      v_view_id,
      1
    );
    raise exception 'Cross-owner saved-view retirement unexpectedly succeeded.';
  exception when no_data_found then
    null;
  end;

  begin
    perform public.tcos_retire_kingmaker_pricing_saved_view_atomic(
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      v_view_id,
      99
    );
    raise exception 'Stale saved-view retirement unexpectedly succeeded.';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end;
$$;

insert into public.tcos_kingmaker_pricing_decision_receipts (
  store_id,
  seller_account_id,
  identity_id,
  profile_name,
  profile_selection,
  decision_status,
  confidence,
  sold_comp_count,
  marketplace_fee_pct,
  payment_fee_pct,
  payment_fixed_fee,
  shipping_cost,
  target_margin_pct,
  expected_profit
) values
(
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'identity-owner-one',
  'Second View Profile',
  'default',
  'ready',
  0.98,
  4,
  0.08,
  0.029,
  0.30,
  6.99,
  0.30,
  25.00
),
(
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002',
  'identity-owner-two',
  'Other Seller Profile',
  'default',
  'review_required',
  0.50,
  1,
  0.08,
  0.029,
  0.30,
  6.99,
  0.30,
  999.00
);

reset role;

do $$
declare
  v_real_table regclass;
  v_old_table regclass;
  v_count integer;
  v_profit numeric;
begin
  v_real_table := to_regclass('public.tcos_kingmaker_pricing_decision_receipts');
  v_old_table := to_regclass('public.tcos_kingmaker_pricing_receipts');
  if v_real_table is null or v_old_table is not null then
    raise exception 'Pricing receipt schema drift fixture is invalid.';
  end if;

  select count(*), sum(expected_profit)
  into v_count, v_profit
  from public.tcos_kingmaker_pricing_decision_receipts
  where store_id = '30000000-0000-4000-8000-000000000001'
    and seller_account_id = '40000000-0000-4000-8000-000000000001'
    and decision_status = 'ready';
  if v_count <> 1 or v_profit <> 25.00 then
    raise exception 'Owner-scoped decision receipt read returned incorrect results.';
  end if;
end;
$$;

select
  has_function_privilege('service_role', 'public.tcos_create_kingmaker_pricing_saved_view_atomic(uuid,uuid,text,jsonb,boolean)', 'EXECUTE') as service_create,
  not has_function_privilege('anon', 'public.tcos_create_kingmaker_pricing_saved_view_atomic(uuid,uuid,text,jsonb,boolean)', 'EXECUTE') as anon_blocked,
  not has_function_privilege('authenticated', 'public.tcos_retire_kingmaker_pricing_saved_view_atomic(uuid,uuid,uuid,integer)', 'EXECUTE') as authenticated_blocked;
