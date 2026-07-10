begin;

create table if not exists public.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  stripe_event_id text not null,
  event_type text not null,
  object_id text,
  dedupe_key text,
  stripe_account_id text,
  api_version text,
  livemode boolean not null default false,
  payload_sha256 text not null,
  endpoint_path text not null,
  event_status text not null default 'processing',
  attempt_count integer not null default 1,
  last_error text,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint stripe_webhook_events_status_check
    check (event_status in ('processing', 'processed', 'ignored', 'failed')),
  constraint stripe_webhook_events_attempt_count_check
    check (attempt_count >= 1),
  constraint stripe_webhook_events_payload_sha256_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  unique (store_id, stripe_event_id)
);

alter table public.stripe_webhook_events
  add column if not exists dedupe_key text;

create index if not exists stripe_webhook_events_status_idx
  on public.stripe_webhook_events(
    store_id,
    event_status,
    last_received_at desc
  );

create unique index if not exists stripe_webhook_events_dedupe_idx
  on public.stripe_webhook_events(store_id, dedupe_key)
  where dedupe_key is not null;

alter table public.stripe_webhook_events enable row level security;

revoke all privileges on table public.stripe_webhook_events
  from anon, authenticated, service_role;

grant select, insert, update on table public.stripe_webhook_events
  to service_role;

drop function if exists public.tcos_claim_stripe_webhook_event(
  uuid, text, text, text, text, text, boolean, text, text
);

create or replace function public.tcos_claim_stripe_webhook_event(
  p_store_id uuid,
  p_stripe_event_id text,
  p_event_type text,
  p_object_id text,
  p_dedupe_key text,
  p_stripe_account_id text,
  p_api_version text,
  p_livemode boolean,
  p_payload_sha256 text,
  p_endpoint_path text
)
returns table (
  webhook_event_id uuid,
  event_status text,
  claimed boolean,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.stripe_webhook_events%rowtype;
  v_claimed boolean := false;
  v_now timestamptz := now();
begin
  if p_stripe_event_id is null or btrim(p_stripe_event_id) = '' then
    raise exception 'Stripe event id is required' using errcode = '22023';
  end if;

  select *
    into v_event
    from public.stripe_webhook_events
   where store_id = p_store_id
     and (
       stripe_event_id = p_stripe_event_id
       or (p_dedupe_key is not null and dedupe_key = p_dedupe_key)
     )
   for update;

  if not found then
    insert into public.stripe_webhook_events (
      store_id,
      stripe_event_id,
      event_type,
      object_id,
      dedupe_key,
      stripe_account_id,
      api_version,
      livemode,
      payload_sha256,
      endpoint_path,
      event_status,
      attempt_count,
      lease_expires_at,
      metadata
    ) values (
      p_store_id,
      left(p_stripe_event_id, 255),
      left(coalesce(p_event_type, 'unknown'), 255),
      left(p_object_id, 255),
      left(p_dedupe_key, 600),
      left(p_stripe_account_id, 255),
      left(p_api_version, 120),
      coalesce(p_livemode, false),
      p_payload_sha256,
      left(coalesce(p_endpoint_path, 'unknown'), 500),
      'processing',
      1,
      v_now + interval '5 minutes',
      jsonb_build_object('first_endpoint_path', p_endpoint_path)
    )
    on conflict do nothing
    returning * into v_event;

    if found then
      v_claimed := true;
    else
      select *
        into v_event
        from public.stripe_webhook_events
       where store_id = p_store_id
         and (
           stripe_event_id = p_stripe_event_id
           or (p_dedupe_key is not null and dedupe_key = p_dedupe_key)
         )
       for update;
    end if;
  end if;

  if not v_claimed then
    v_claimed :=
      v_event.event_status = 'failed'
      or (
        v_event.event_status = 'processing'
        and coalesce(v_event.lease_expires_at, v_event.updated_at) <= v_now
      );

    update public.stripe_webhook_events as swe
       set attempt_count = swe.attempt_count + 1,
           last_received_at = v_now,
           endpoint_path = left(coalesce(p_endpoint_path, swe.endpoint_path), 500),
           event_status = case when v_claimed then 'processing' else swe.event_status end,
           lease_expires_at = case
             when v_claimed then v_now + interval '5 minutes'
             else swe.lease_expires_at
           end,
           last_error = case when v_claimed then null else swe.last_error end,
           metadata = case
             when swe.stripe_event_id <> p_stripe_event_id
             then swe.metadata || jsonb_build_object(
               'latest_duplicate_stripe_event_id', p_stripe_event_id
             )
             else swe.metadata
           end,
           updated_at = v_now
     where swe.id = v_event.id
     returning swe.* into v_event;
  end if;

  return query
  select v_event.id, v_event.event_status, v_claimed, v_event.attempt_count;
end;
$$;

revoke all on function public.tcos_claim_stripe_webhook_event(
  uuid, text, text, text, text, text, text, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.tcos_claim_stripe_webhook_event(
  uuid, text, text, text, text, text, text, boolean, text, text
) to service_role;

commit;
