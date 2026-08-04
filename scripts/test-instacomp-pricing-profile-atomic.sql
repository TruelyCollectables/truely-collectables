\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

\ir ../supabase/migrations/20260803190000_kingmaker_pricing_profiles.sql
\ir ../supabase/migrations/20260803220000_kingmaker_pricing_profile_lifecycle.sql
\ir ../supabase/migrations/20260804004500_kingmaker_pricing_profile_atomic_lifecycle.sql
\ir ../supabase/migrations/20260804004500_kingmaker_pricing_profile_atomic_lifecycle.sql

set role service_role;

select public.tcos_create_kingmaker_pricing_profile_atomic(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'First Profile', 0.08, 0.029, 0.30, 6.99, 0.30, true,
  '{"fixture":"first"}'::jsonb
);

select public.tcos_create_kingmaker_pricing_profile_atomic(
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Second Profile', 0.08, 0.029, 0.30, 6.99, 0.35, true,
  '{"fixture":"second"}'::jsonb
);

-- The function clears the old default before inserting. A duplicate-name
-- failure must roll back that clear in the same transaction.
do $$
begin
  begin
    perform public.tcos_create_kingmaker_pricing_profile_atomic(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'First Profile', 0.08, 0.029, 0.30, 6.99, 0.40, true,
      '{"fixture":"duplicate"}'::jsonb
    );
    raise exception 'Duplicate profile creation unexpectedly succeeded.';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Wrong-owner mutation must look like a missing row and leave the source row
-- unchanged.
do $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.tcos_kingmaker_pricing_profiles
  where name = 'Second Profile';

  begin
    perform public.tcos_update_kingmaker_pricing_profile_atomic(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000099',
      v_profile_id, 1,
      'Cross Tenant Rewrite', 0.01, 0.01, 0, 0, 0.05, true,
      '{}'::jsonb
    );
    raise exception 'Cross-owner update unexpectedly succeeded.';
  exception when no_data_found then
    null;
  end;
end;
$$;

-- A valid update advances the version; replaying the old version must fail.
do $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id
  from public.tcos_kingmaker_pricing_profiles
  where name = 'Second Profile';

  perform public.tcos_update_kingmaker_pricing_profile_atomic(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    v_profile_id, 1,
    'Second Profile', 0.08, 0.029, 0.30, 7.25, 0.35, true,
    '{"fixture":"updated"}'::jsonb
  );

  begin
    perform public.tcos_update_kingmaker_pricing_profile_atomic(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      v_profile_id, 1,
      'Stale Rewrite', 0.01, 0.01, 0, 0, 0.05, false,
      '{}'::jsonb
    );
    raise exception 'Stale update unexpectedly succeeded.';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end;
$$;

-- Clone and retire also execute under owner locks and immutable version checks.
do $$
declare
  v_source_id uuid;
  v_clone jsonb;
  v_clone_id uuid;
begin
  select id into v_source_id
  from public.tcos_kingmaker_pricing_profiles
  where name = 'Second Profile';

  v_clone := public.tcos_clone_kingmaker_pricing_profile_atomic(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    v_source_id,
    'Cloned Profile',
    true
  );
  v_clone_id := (v_clone->>'id')::uuid;

  begin
    perform public.tcos_retire_kingmaker_pricing_profile_atomic(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      v_clone_id,
      99
    );
    raise exception 'Stale retire unexpectedly succeeded.';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  perform public.tcos_retire_kingmaker_pricing_profile_atomic(
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    v_clone_id,
    1
  );
end;
$$;

reset role;

do $$
declare
  v_defaults integer;
  v_second_version integer;
  v_second_name text;
  v_cross_tenant integer;
  v_audit_count integer;
  v_retired integer;
begin
  select count(*) into v_defaults
  from public.tcos_kingmaker_pricing_profiles
  where store_id = '10000000-0000-4000-8000-000000000001'
    and seller_account_id = '20000000-0000-4000-8000-000000000001'
    and archived_at is null
    and is_default;
  if v_defaults <> 0 then
    raise exception 'Expected zero defaults after retiring the cloned default, found %.', v_defaults;
  end if;

  select version, name into v_second_version, v_second_name
  from public.tcos_kingmaker_pricing_profiles
  where store_id = '10000000-0000-4000-8000-000000000001'
    and seller_account_id = '20000000-0000-4000-8000-000000000001'
    and name = 'Second Profile';
  if v_second_version <> 2 or v_second_name <> 'Second Profile' then
    raise exception 'Stale/cross-tenant update altered the valid row.';
  end if;

  select count(*) into v_cross_tenant
  from public.tcos_kingmaker_pricing_profiles
  where name = 'Cross Tenant Rewrite' or name = 'Stale Rewrite';
  if v_cross_tenant <> 0 then
    raise exception 'Forbidden profile rewrite persisted.';
  end if;

  select count(*) into v_retired
  from public.tcos_kingmaker_pricing_profiles
  where name = 'Cloned Profile' and archived_at is not null and version = 2;
  if v_retired <> 1 then
    raise exception 'Versioned retirement did not persist exactly once.';
  end if;

  select count(*) into v_audit_count
  from public.tcos_kingmaker_pricing_profile_audit;
  if v_audit_count <> 5 then
    raise exception 'Expected five atomic audit receipts, found %.', v_audit_count;
  end if;
end;
$$;

select
  has_function_privilege('service_role', 'public.tcos_create_kingmaker_pricing_profile_atomic(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,boolean,jsonb)', 'EXECUTE') as service_create,
  not has_function_privilege('anon', 'public.tcos_create_kingmaker_pricing_profile_atomic(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,boolean,jsonb)', 'EXECUTE') as anon_blocked,
  not has_function_privilege('authenticated', 'public.tcos_update_kingmaker_pricing_profile_atomic(uuid,uuid,uuid,integer,text,numeric,numeric,numeric,numeric,numeric,boolean,jsonb)', 'EXECUTE') as authenticated_blocked;
