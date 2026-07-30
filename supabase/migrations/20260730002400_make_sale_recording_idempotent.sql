begin;

do $$
declare
  public_function_oid oid := to_regprocedure(
    'public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamp with time zone,text,jsonb,boolean)'
  );
  unsafe_function_oid oid := to_regprocedure(
    'public.record_collectible_sale_unsafe_20260730(uuid,bigint,text,text,text,integer,numeric,text,timestamp with time zone,text,jsonb,boolean)'
  );
  current_definition text;
begin
  if public_function_oid is null and unsafe_function_oid is null then
    raise exception 'record_collectible_sale prerequisite function is missing.'
      using errcode = '42883';
  end if;

  if public_function_oid is not null then
    current_definition := pg_get_functiondef(public_function_oid);

    if unsafe_function_oid is null then
      if position('record_collectible_sale_unsafe_20260730' in current_definition) > 0 then
        raise exception 'record_collectible_sale wrapper exists but its unsafe implementation is missing.'
          using errcode = '42883';
      end if;

      execute 'alter function public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean) rename to record_collectible_sale_unsafe_20260730';
    elsif position('record_collectible_sale_unsafe_20260730' in current_definition) = 0 then
      execute 'drop function public.record_collectible_sale_unsafe_20260730(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean)';
      execute 'alter function public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean) rename to record_collectible_sale_unsafe_20260730';
    end if;
  end if;
end
$$;

create or replace function public.record_collectible_sale(
  p_store_id uuid,
  p_legacy_product_id bigint,
  p_event_key text,
  p_source_marketplace text,
  p_source_reference text default null,
  p_sold_quantity integer default 1,
  p_sold_price numeric default null,
  p_currency text default 'USD',
  p_sold_at timestamptz default now(),
  p_evidence_status text default 'unresolved',
  p_evidence jsonb default '{}'::jsonb,
  p_force_zero boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_sale_id uuid;
  normalized_event_key text;
begin
  normalized_event_key := btrim(coalesce(p_event_key, ''));
  if normalized_event_key = '' then
    raise exception 'A stable sale event key is required.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_store_id::text || ':' || normalized_event_key, 0)
  );

  select id into existing_sale_id
  from public.collectible_sales
  where store_id = p_store_id
    and event_key = normalized_event_key;

  if existing_sale_id is not null then
    return existing_sale_id;
  end if;

  return public.record_collectible_sale_unsafe_20260730(
    p_store_id,
    p_legacy_product_id,
    normalized_event_key,
    p_source_marketplace,
    p_source_reference,
    p_sold_quantity,
    p_sold_price,
    p_currency,
    p_sold_at,
    p_evidence_status,
    p_evidence,
    p_force_zero
  );
end;
$$;

revoke all on function public.record_collectible_sale_unsafe_20260730(
  uuid,
  bigint,
  text,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb,
  boolean
) from public, anon, authenticated, service_role;

revoke all on function public.record_collectible_sale(
  uuid,
  bigint,
  text,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb,
  boolean
) from public, anon, authenticated;

grant execute on function public.record_collectible_sale(
  uuid,
  bigint,
  text,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb,
  boolean
) to service_role;

comment on function public.record_collectible_sale(
  uuid,
  bigint,
  text,
  text,
  text,
  integer,
  numeric,
  text,
  timestamptz,
  text,
  jsonb,
  boolean
) is
  'Transactionally idempotent sale recorder. A store/event key is serialized before mutation so retries cannot double-count asset quantity or duplicate lifecycle events.';

commit;
