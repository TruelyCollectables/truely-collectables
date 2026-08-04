begin;

alter table public.tcos_kingmaker_pricing_saved_views
  add column if not exists version integer not null default 1;

create or replace function public.tcos_create_kingmaker_pricing_saved_view_atomic(
  p_store_id uuid,
  p_seller_account_id uuid,
  p_name text,
  p_filters jsonb,
  p_is_default boolean
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
    raise exception 'Saved view store is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_store_id::text),
    hashtext('pricing-view:' || coalesce(p_seller_account_id::text, 'admin'))
  );

  if coalesce(p_is_default, false) then
    update public.tcos_kingmaker_pricing_saved_views
    set is_default = false,
        updated_at = now()
    where store_id = p_store_id
      and seller_account_id is not distinct from p_seller_account_id
      and archived_at is null
      and is_default = true;
  end if;

  insert into public.tcos_kingmaker_pricing_saved_views (
    store_id,
    seller_account_id,
    name,
    filters,
    is_default
  ) values (
    p_store_id,
    p_seller_account_id,
    p_name,
    coalesce(p_filters, '{}'::jsonb),
    coalesce(p_is_default, false)
  )
  returning id, version into v_id, v_version;

  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

create or replace function public.tcos_retire_kingmaker_pricing_saved_view_atomic(
  p_store_id uuid,
  p_seller_account_id uuid,
  p_view_id uuid,
  p_expected_version integer
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
  if p_store_id is null or p_view_id is null then
    raise exception 'Saved view owner and id are required.' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Saved view expectedVersion is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_store_id::text),
    hashtext('pricing-view:' || coalesce(p_seller_account_id::text, 'admin'))
  );

  select version
  into v_current_version
  from public.tcos_kingmaker_pricing_saved_views
  where id = p_view_id
    and store_id = p_store_id
    and seller_account_id is not distinct from p_seller_account_id
    and archived_at is null
  for update;

  if not found then
    raise exception 'Saved view not found.' using errcode = 'P0002';
  end if;
  if v_current_version <> p_expected_version then
    raise exception 'Saved view changed; reload before retiring.' using errcode = '55000';
  end if;

  update public.tcos_kingmaker_pricing_saved_views
  set archived_at = now(),
      is_default = false,
      version = version + 1,
      updated_at = now()
  where id = p_view_id
  returning version into v_version;

  return jsonb_build_object('id', p_view_id, 'version', v_version, 'retired', true);
end;
$$;

revoke all on function public.tcos_create_kingmaker_pricing_saved_view_atomic(
  uuid, uuid, text, jsonb, boolean
) from public, anon, authenticated;
revoke all on function public.tcos_retire_kingmaker_pricing_saved_view_atomic(
  uuid, uuid, uuid, integer
) from public, anon, authenticated;

grant execute on function public.tcos_create_kingmaker_pricing_saved_view_atomic(
  uuid, uuid, text, jsonb, boolean
) to service_role;
grant execute on function public.tcos_retire_kingmaker_pricing_saved_view_atomic(
  uuid, uuid, uuid, integer
) to service_role;

commit;
