begin;

create or replace function public.tcos_create_kingmaker_pricing_profile_atomic(
  p_store_id uuid,
  p_seller_account_id uuid,
  p_name text,
  p_marketplace_fee_pct numeric,
  p_payment_fee_pct numeric,
  p_payment_fixed_fee numeric,
  p_estimated_shipping_cost numeric,
  p_target_margin_pct numeric,
  p_is_default boolean,
  p_audit_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_version integer;
begin
  if p_store_id is null then
    raise exception 'Pricing profile store is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_store_id::text),
    hashtext(coalesce(p_seller_account_id::text, 'admin'))
  );

  if coalesce(p_is_default, false) then
    update public.tcos_kingmaker_pricing_profiles
    set is_default = false,
        updated_at = now()
    where store_id = p_store_id
      and seller_account_id is not distinct from p_seller_account_id
      and archived_at is null
      and is_default = true;
  end if;

  insert into public.tcos_kingmaker_pricing_profiles (
    store_id,
    seller_account_id,
    name,
    marketplace_fee_pct,
    payment_fee_pct,
    payment_fixed_fee,
    estimated_shipping_cost,
    target_margin_pct,
    is_default
  ) values (
    p_store_id,
    p_seller_account_id,
    p_name,
    p_marketplace_fee_pct,
    p_payment_fee_pct,
    p_payment_fixed_fee,
    p_estimated_shipping_cost,
    p_target_margin_pct,
    coalesce(p_is_default, false)
  )
  returning id, version into v_id, v_version;

  insert into public.tcos_kingmaker_pricing_profile_audit (
    store_id,
    seller_account_id,
    profile_id,
    action,
    profile_name,
    snapshot
  ) values (
    p_store_id,
    p_seller_account_id,
    v_id,
    'created',
    p_name,
    coalesce(p_audit_snapshot, '{}'::jsonb)
  );

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

create or replace function public.tcos_update_kingmaker_pricing_profile_atomic(
  p_store_id uuid,
  p_seller_account_id uuid,
  p_profile_id uuid,
  p_expected_version integer,
  p_name text,
  p_marketplace_fee_pct numeric,
  p_payment_fee_pct numeric,
  p_payment_fixed_fee numeric,
  p_estimated_shipping_cost numeric,
  p_target_margin_pct numeric,
  p_is_default boolean,
  p_audit_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version integer;
  v_version integer;
begin
  if p_store_id is null or p_profile_id is null then
    raise exception 'Pricing profile owner and id are required.' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Pricing profile expectedVersion is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_store_id::text),
    hashtext(coalesce(p_seller_account_id::text, 'admin'))
  );

  select version
  into v_current_version
  from public.tcos_kingmaker_pricing_profiles
  where id = p_profile_id
    and store_id = p_store_id
    and seller_account_id is not distinct from p_seller_account_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Pricing profile not found.' using errcode = 'P0002';
  end if;
  if v_current_version <> p_expected_version then
    raise exception 'Pricing profile changed; reload before saving.' using errcode = '55000';
  end if;

  if coalesce(p_is_default, false) then
    update public.tcos_kingmaker_pricing_profiles
    set is_default = false,
        updated_at = now()
    where store_id = p_store_id
      and seller_account_id is not distinct from p_seller_account_id
      and id <> p_profile_id
      and archived_at is null
      and is_default = true;
  end if;

  update public.tcos_kingmaker_pricing_profiles
  set name = p_name,
      marketplace_fee_pct = p_marketplace_fee_pct,
      payment_fee_pct = p_payment_fee_pct,
      payment_fixed_fee = p_payment_fixed_fee,
      estimated_shipping_cost = p_estimated_shipping_cost,
      target_margin_pct = p_target_margin_pct,
      is_default = coalesce(p_is_default, false),
      version = version + 1,
      updated_at = now()
  where id = p_profile_id
  returning version into v_version;

  insert into public.tcos_kingmaker_pricing_profile_audit (
    store_id,
    seller_account_id,
    profile_id,
    action,
    profile_name,
    snapshot
  ) values (
    p_store_id,
    p_seller_account_id,
    p_profile_id,
    case when coalesce(p_is_default, false) then 'defaulted' else 'updated' end,
    p_name,
    coalesce(p_audit_snapshot, '{}'::jsonb)
  );

  return jsonb_build_object('id', p_profile_id, 'version', v_version);
end;
$$;

create or replace function public.tcos_clone_kingmaker_pricing_profile_atomic(
  p_store_id uuid,
  p_seller_account_id uuid,
  p_source_profile_id uuid,
  p_name text,
  p_is_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.tcos_kingmaker_pricing_profiles%rowtype;
  v_id uuid;
  v_version integer;
begin
  if p_store_id is null or p_source_profile_id is null then
    raise exception 'Pricing profile owner and source id are required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_store_id::text),
    hashtext(coalesce(p_seller_account_id::text, 'admin'))
  );

  select *
  into v_source
  from public.tcos_kingmaker_pricing_profiles
  where id = p_source_profile_id
    and store_id = p_store_id
    and seller_account_id is not distinct from p_seller_account_id
    and archived_at is null
  for share;

  if not found then
    raise exception 'Pricing profile not found.' using errcode = 'P0002';
  end if;

  if coalesce(p_is_default, false) then
    update public.tcos_kingmaker_pricing_profiles
    set is_default = false,
        updated_at = now()
    where store_id = p_store_id
      and seller_account_id is not distinct from p_seller_account_id
      and archived_at is null
      and is_default = true;
  end if;

  insert into public.tcos_kingmaker_pricing_profiles (
    store_id,
    seller_account_id,
    name,
    marketplace_fee_pct,
    payment_fee_pct,
    payment_fixed_fee,
    estimated_shipping_cost,
    target_margin_pct,
    is_default
  ) values (
    p_store_id,
    p_seller_account_id,
    p_name,
    v_source.marketplace_fee_pct,
    v_source.payment_fee_pct,
    v_source.payment_fixed_fee,
    v_source.estimated_shipping_cost,
    v_source.target_margin_pct,
    coalesce(p_is_default, false)
  )
  returning id, version into v_id, v_version;

  insert into public.tcos_kingmaker_pricing_profile_audit (
    store_id,
    seller_account_id,
    profile_id,
    action,
    profile_name,
    snapshot
  ) values (
    p_store_id,
    p_seller_account_id,
    v_id,
    'cloned',
    p_name,
    jsonb_build_object('sourceProfileId', p_source_profile_id)
  );

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

create or replace function public.tcos_retire_kingmaker_pricing_profile_atomic(
  p_store_id uuid,
  p_seller_account_id uuid,
  p_profile_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_current_version integer;
  v_version integer;
begin
  if p_store_id is null or p_profile_id is null then
    raise exception 'Pricing profile owner and id are required.' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Pricing profile expectedVersion is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_store_id::text),
    hashtext(coalesce(p_seller_account_id::text, 'admin'))
  );

  select name, version
  into v_name, v_current_version
  from public.tcos_kingmaker_pricing_profiles
  where id = p_profile_id
    and store_id = p_store_id
    and seller_account_id is not distinct from p_seller_account_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Pricing profile not found.' using errcode = 'P0002';
  end if;
  if v_current_version <> p_expected_version then
    raise exception 'Pricing profile changed; reload before retiring.' using errcode = '55000';
  end if;

  update public.tcos_kingmaker_pricing_profiles
  set archived_at = now(),
      is_default = false,
      version = version + 1,
      updated_at = now()
  where id = p_profile_id
  returning version into v_version;

  insert into public.tcos_kingmaker_pricing_profile_audit (
    store_id,
    seller_account_id,
    profile_id,
    action,
    profile_name,
    snapshot
  ) values (
    p_store_id,
    p_seller_account_id,
    p_profile_id,
    'retired',
    v_name,
    jsonb_build_object('expectedVersion', p_expected_version)
  );

  return jsonb_build_object('id', p_profile_id, 'version', v_version, 'retired', true);
end;
$$;

revoke all on function public.tcos_create_kingmaker_pricing_profile_atomic(
  uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.tcos_update_kingmaker_pricing_profile_atomic(
  uuid, uuid, uuid, integer, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.tcos_clone_kingmaker_pricing_profile_atomic(
  uuid, uuid, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function public.tcos_retire_kingmaker_pricing_profile_atomic(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;

grant execute on function public.tcos_create_kingmaker_pricing_profile_atomic(
  uuid, uuid, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb
) to service_role;
grant execute on function public.tcos_update_kingmaker_pricing_profile_atomic(
  uuid, uuid, uuid, integer, text, numeric, numeric, numeric, numeric, numeric, boolean, jsonb
) to service_role;
grant execute on function public.tcos_clone_kingmaker_pricing_profile_atomic(
  uuid, uuid, uuid, text, boolean
) to service_role;
grant execute on function public.tcos_retire_kingmaker_pricing_profile_atomic(
  uuid, uuid, uuid, integer
) to service_role;

commit;
