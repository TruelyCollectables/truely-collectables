create table if not exists public.tcos_kingmaker_delivery_runs (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  delivery_date date not null,
  fingerprint text not null,
  mode text not null check (mode in ('full', 'compact', 'withheld')),
  status text not null check (status in ('claimed', 'sent', 'failed', 'dry_run', 'suppressed')),
  claim_token uuid,
  claimed_at timestamptz,
  delivered_at timestamptz,
  email_id text,
  error_code text,
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_delivery_runs_delivery_date_idx
  on public.tcos_kingmaker_delivery_runs (delivery_date desc, created_at desc);

create index if not exists tcos_kingmaker_delivery_runs_fingerprint_idx
  on public.tcos_kingmaker_delivery_runs (fingerprint, created_at desc);

alter table public.tcos_kingmaker_delivery_runs enable row level security;
revoke all on public.tcos_kingmaker_delivery_runs from anon, authenticated;

drop function if exists public.tcos_claim_kingmaker_delivery(text, date, text, text, uuid, integer);
create function public.tcos_claim_kingmaker_delivery(
  p_delivery_key text,
  p_delivery_date date,
  p_fingerprint text,
  p_mode text,
  p_claim_token uuid,
  p_claim_ttl_seconds integer default 900
)
returns table (
  id uuid,
  delivery_key text,
  status text,
  claim_token uuid,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.tcos_kingmaker_delivery_runs%rowtype;
begin
  if coalesce(trim(p_delivery_key), '') = '' then
    raise exception 'delivery key is required';
  end if;
  if coalesce(trim(p_fingerprint), '') = '' then
    raise exception 'fingerprint is required';
  end if;
  if p_mode not in ('full', 'compact', 'withheld') then
    raise exception 'unsupported KINGMAKER delivery mode';
  end if;
  if p_claim_token is null then
    raise exception 'claim token is required';
  end if;

  insert into public.tcos_kingmaker_delivery_runs (
    delivery_key,
    delivery_date,
    fingerprint,
    mode,
    status,
    claim_token,
    claimed_at,
    updated_at
  ) values (
    p_delivery_key,
    p_delivery_date,
    p_fingerprint,
    p_mode,
    'claimed',
    p_claim_token,
    now(),
    now()
  )
  on conflict (delivery_key) do update
    set status = 'claimed',
        claim_token = excluded.claim_token,
        claimed_at = now(),
        updated_at = now(),
        error_code = null
    where public.tcos_kingmaker_delivery_runs.status = 'failed'
       or (
         public.tcos_kingmaker_delivery_runs.status = 'claimed'
         and public.tcos_kingmaker_delivery_runs.claimed_at < now() - make_interval(secs => greatest(60, p_claim_ttl_seconds))
       )
  returning public.tcos_kingmaker_delivery_runs.* into claimed;

  if claimed.id is null then
    return;
  end if;

  return query select claimed.id, claimed.delivery_key, claimed.status, claimed.claim_token, claimed.claimed_at;
end;
$$;

revoke all on function public.tcos_claim_kingmaker_delivery(text, date, text, text, uuid, integer) from public;
grant execute on function public.tcos_claim_kingmaker_delivery(text, date, text, text, uuid, integer) to service_role;

comment on table public.tcos_kingmaker_delivery_runs is
  'Append-oriented Project KINGMAKER delivery ledger and idempotency boundary.';
comment on function public.tcos_claim_kingmaker_delivery(text, date, text, text, uuid, integer) is
  'Atomically claims one KINGMAKER delivery key, allowing only failed or expired claims to be retried.';
