begin;

create table if not exists public.account_buyer_protection_preferences (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  account_id uuid not null,
  mode text not null check (mode in ('always_on', 'always_off')),
  policy_version text,
  terms_accepted_at timestamptz,
  opted_out_at timestamptz,
  acceptance_ip_address text,
  acceptance_user_agent text,
  acceptance_ip_risk text,
  acceptance_ip_block_reason text,
  acceptance_ip_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, account_id),
  check (
    (mode = 'always_on' and policy_version is not null and terms_accepted_at is not null)
    or mode = 'always_off'
  )
);

create table if not exists public.order_buyer_protections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id bigint not null,
  account_id uuid,
  status text not null default 'active' check (
    status in ('active', 'claim_submitted', 'approved', 'denied', 'expired', 'reimbursed', 'cancelled')
  ),
  fee_amount numeric(12,2) not null default 0.75 check (fee_amount = 0.75),
  covered_item_amount numeric(12,2) not null check (
    covered_item_amount > 0 and covered_item_amount <= 20
  ),
  policy_version text not null,
  terms_accepted_at timestamptz not null,
  consent_source text not null,
  preference_mode text not null check (
    preference_mode in ('always_on', 'one_time')
  ),
  shipping_reimbursable boolean not null default false check (shipping_reimbursable = false),
  protection_fee_reimbursable boolean not null default false check (protection_fee_reimbursable = false),
  shipped_at timestamptz,
  earliest_claim_at timestamptz,
  claim_deadline_at timestamptz,
  consent_ip_address text,
  consent_user_agent text,
  consent_ip_risk text,
  consent_ip_block_reason text,
  consent_ip_evidence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, order_id),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete cascade,
  check (
    (shipped_at is null and earliest_claim_at is null and claim_deadline_at is null)
    or (
      shipped_at is not null
      and earliest_claim_at = shipped_at + interval '7 days'
      and claim_deadline_at = shipped_at + interval '21 days'
    )
  )
);

create table if not exists public.buyer_protection_claims (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  protection_id uuid not null references public.order_buyer_protections(id) on delete cascade,
  order_id bigint not null,
  account_id uuid,
  status text not null default 'submitted' check (
    status in ('submitted', 'under_review', 'approved', 'denied', 'reimbursed')
  ),
  reason text not null default 'not_received' check (reason = 'not_received'),
  buyer_statement text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  decision_note text,
  reimbursement_amount numeric(12,2) not null default 0 check (
    reimbursement_amount >= 0 and reimbursement_amount <= 20
  ),
  stripe_refund_id text,
  reimbursed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, protection_id),
  foreign key (order_id, store_id)
    references public.orders(id, store_id)
    on delete cascade
);

alter table public.offers
  add column if not exists buyer_protection_selected boolean not null default false,
  add column if not exists buyer_protection_fee numeric(12,2) not null default 0,
  add column if not exists buyer_protection_covered_amount numeric(12,2) not null default 0,
  add column if not exists buyer_protection_policy_version text,
  add column if not exists buyer_protection_terms_accepted_at timestamptz,
  add column if not exists buyer_protection_consent_source text,
  add column if not exists buyer_protection_preference_mode text;

alter table public.offers
  drop constraint if exists offers_buyer_protection_fee_check,
  drop constraint if exists offers_buyer_protection_covered_amount_check,
  drop constraint if exists offers_buyer_protection_preference_mode_check,
  add constraint offers_buyer_protection_fee_check check (
    buyer_protection_fee in (0, 0.75)
  ) not valid,
  add constraint offers_buyer_protection_covered_amount_check check (
    buyer_protection_covered_amount >= 0
    and buyer_protection_covered_amount <= 20
  ) not valid,
  add constraint offers_buyer_protection_preference_mode_check check (
    buyer_protection_preference_mode is null
    or buyer_protection_preference_mode in ('always_on', 'one_time')
  ) not valid;

alter table public.offers validate constraint offers_buyer_protection_fee_check;
alter table public.offers validate constraint offers_buyer_protection_covered_amount_check;
alter table public.offers validate constraint offers_buyer_protection_preference_mode_check;

create index if not exists order_buyer_protections_status_idx
  on public.order_buyer_protections(store_id, status, created_at desc);
create index if not exists buyer_protection_claims_status_idx
  on public.buyer_protection_claims(store_id, status, submitted_at asc);

create or replace function public.truely_lock_buyer_protection_claim_window()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.shipped_at is not null then
    new.shipped_at := old.shipped_at;
    new.earliest_claim_at := old.earliest_claim_at;
    new.claim_deadline_at := old.claim_deadline_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.truely_start_buyer_protection_claim_window()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.shipped_at is not null and old.shipped_at is null then
    update public.order_buyer_protections
    set
      shipped_at = coalesce(shipped_at, new.shipped_at),
      earliest_claim_at = coalesce(earliest_claim_at, new.shipped_at + interval '7 days'),
      claim_deadline_at = coalesce(claim_deadline_at, new.shipped_at + interval '21 days'),
      updated_at = now()
    where store_id = new.store_id
      and order_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists truely_lock_buyer_protection_claim_window_trigger
  on public.order_buyer_protections;
create trigger truely_lock_buyer_protection_claim_window_trigger
before update on public.order_buyer_protections
for each row execute function public.truely_lock_buyer_protection_claim_window();

drop trigger if exists truely_start_buyer_protection_claim_window_trigger
  on public.orders;
create trigger truely_start_buyer_protection_claim_window_trigger
after update of shipped_at on public.orders
for each row execute function public.truely_start_buyer_protection_claim_window();

alter table public.account_buyer_protection_preferences enable row level security;
alter table public.order_buyer_protections enable row level security;
alter table public.buyer_protection_claims enable row level security;

revoke all on public.account_buyer_protection_preferences from anon, authenticated;
revoke all on public.order_buyer_protections from anon, authenticated;
revoke all on public.buyer_protection_claims from anon, authenticated;

grant select, insert, update, delete on public.account_buyer_protection_preferences to service_role;
grant select, insert, update, delete on public.order_buyer_protections to service_role;
grant select, insert, update, delete on public.buyer_protection_claims to service_role;

commit;
