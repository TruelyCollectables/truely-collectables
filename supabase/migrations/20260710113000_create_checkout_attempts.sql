begin;

create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  checkout_attempt_id uuid not null,
  account_id uuid references public.account_profiles(id) on delete set null,
  request_fingerprint text not null,
  stripe_idempotency_key text not null,
  request_status text not null default 'processing',
  attempt_count integer not null default 1,
  stripe_session_id text,
  tos_acceptance_event_id uuid references public.tos_acceptance_events(id) on delete set null,
  tos_accepted_at timestamptz not null default now(),
  identity_metadata jsonb not null default '{}'::jsonb,
  last_error text,
  lease_expires_at timestamptz,
  session_created_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint checkout_attempts_status_check
    check (request_status in ('processing', 'session_created', 'failed')),
  constraint checkout_attempts_attempt_count_check
    check (attempt_count >= 1),
  constraint checkout_attempts_fingerprint_check
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  unique (store_id, checkout_attempt_id),
  unique (stripe_idempotency_key)
);

create index if not exists checkout_attempts_status_idx
  on public.checkout_attempts(store_id, request_status, last_attempt_at desc);

alter table public.checkout_attempts enable row level security;

revoke all privileges on table public.checkout_attempts
  from anon, authenticated, service_role;

grant select, insert, update on table public.checkout_attempts
  to service_role;

create or replace function public.tcos_claim_checkout_attempt(
  p_store_id uuid,
  p_checkout_attempt_id uuid,
  p_account_id uuid,
  p_request_fingerprint text,
  p_stripe_idempotency_key text,
  p_identity_metadata jsonb
)
returns table (
  checkout_attempt_row_id uuid,
  request_status text,
  fingerprint_matches boolean,
  claimed boolean,
  attempt_count integer,
  stripe_session_id text,
  tos_acceptance_event_id uuid,
  tos_accepted_at timestamptz,
  identity_metadata jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.checkout_attempts%rowtype;
  v_claimed boolean := false;
  v_fingerprint_matches boolean := false;
  v_now timestamptz := now();
begin
  select *
    into v_attempt
    from public.checkout_attempts
   where store_id = p_store_id
     and checkout_attempt_id = p_checkout_attempt_id
   for update;

  if not found then
    insert into public.checkout_attempts (
      store_id,
      checkout_attempt_id,
      account_id,
      request_fingerprint,
      stripe_idempotency_key,
      request_status,
      attempt_count,
      identity_metadata,
      lease_expires_at,
      last_attempt_at
    ) values (
      p_store_id,
      p_checkout_attempt_id,
      p_account_id,
      p_request_fingerprint,
      p_stripe_idempotency_key,
      'processing',
      1,
      coalesce(p_identity_metadata, '{}'::jsonb),
      v_now + interval '2 minutes',
      v_now
    )
    on conflict do nothing
    returning * into v_attempt;

    if found then
      v_claimed := true;
      v_fingerprint_matches := true;
    else
      select *
        into v_attempt
        from public.checkout_attempts
       where store_id = p_store_id
         and checkout_attempt_id = p_checkout_attempt_id
       for update;
    end if;
  end if;

  if not v_claimed then
    v_fingerprint_matches :=
      v_attempt.request_fingerprint = p_request_fingerprint
      and v_attempt.stripe_idempotency_key = p_stripe_idempotency_key;

    v_claimed :=
      v_fingerprint_matches
      and (
        v_attempt.request_status = 'failed'
        or (
          v_attempt.request_status = 'processing'
          and coalesce(v_attempt.lease_expires_at, v_attempt.updated_at) <= v_now
        )
      );

    update public.checkout_attempts as ca
       set attempt_count = ca.attempt_count + 1,
           last_attempt_at = v_now,
           request_status = case when v_claimed then 'processing' else ca.request_status end,
           lease_expires_at = case
             when v_claimed then v_now + interval '2 minutes'
             else ca.lease_expires_at
           end,
           last_error = case when v_claimed then null else ca.last_error end,
           updated_at = v_now
     where ca.id = v_attempt.id
     returning ca.* into v_attempt;
  end if;

  return query
  select
    v_attempt.id,
    v_attempt.request_status,
    v_fingerprint_matches,
    v_claimed,
    v_attempt.attempt_count,
    v_attempt.stripe_session_id,
    v_attempt.tos_acceptance_event_id,
    v_attempt.tos_accepted_at,
    v_attempt.identity_metadata;
end;
$$;

revoke all on function public.tcos_claim_checkout_attempt(
  uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.tcos_claim_checkout_attempt(
  uuid, uuid, uuid, text, text, jsonb
) to service_role;

commit;
