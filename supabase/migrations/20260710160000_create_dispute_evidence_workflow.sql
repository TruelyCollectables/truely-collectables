begin;

create table if not exists public.order_review_case_packets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  case_id uuid not null
    references public.order_review_cases(id) on delete cascade,
  order_id bigint not null
    references public.orders(id) on delete cascade,
  seller_account_id uuid
    references public.account_profiles(id) on delete set null,
  status text not null default 'ready',
  emailed_to text,
  email_sent_at timestamptz,
  email_error text,
  report_text text not null,
  report_html text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_review_case_packets_status_check
    check (status in ('ready', 'email_sent', 'email_error')),
  unique(store_id, case_id)
);

alter table public.order_review_case_packets
  add column if not exists provider_dispute_id text,
  add column if not exists provider_evidence_status text not null default 'not_staged',
  add column if not exists provider_evidence_file_id text,
  add column if not exists provider_evidence_due_by timestamptz,
  add column if not exists provider_evidence_staged_at timestamptz,
  add column if not exists provider_evidence_submitted_at timestamptz,
  add column if not exists provider_evidence_error text,
  add column if not exists provider_evidence_payload jsonb not null default '{}'::jsonb,
  add column if not exists last_provider_event_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_review_case_packets_provider_evidence_status_check'
  ) then
    alter table public.order_review_case_packets
      add constraint order_review_case_packets_provider_evidence_status_check
      check (provider_evidence_status in (
        'not_staged',
        'staged',
        'submitted',
        'won',
        'lost',
        'failed'
      ));
  end if;
end $$;

create index if not exists order_review_case_packets_store_created_idx
  on public.order_review_case_packets(store_id, created_at desc);

create index if not exists order_review_case_packets_store_order_idx
  on public.order_review_case_packets(store_id, order_id, created_at desc);

create index if not exists order_review_case_packets_store_status_idx
  on public.order_review_case_packets(store_id, status, updated_at desc);

create unique index if not exists order_review_case_packets_provider_dispute_idx
  on public.order_review_case_packets(store_id, provider_dispute_id)
  where provider_dispute_id is not null;

alter table public.order_review_case_packets enable row level security;

revoke all privileges on table public.order_review_case_packets
  from anon, authenticated, service_role;

grant usage on schema public to service_role;

grant select, insert, update on table public.orders to service_role;
grant select, insert, update on table public.order_items to service_role;
grant select, insert, update on table public.order_review_cases to service_role;
grant select, insert on table public.order_review_case_events to service_role;
grant select, insert, update on table public.transaction_evidence_reports to service_role;
grant select, insert, update on table public.order_review_case_packets to service_role;

do $$
begin
  if to_regclass('public.orders_id_seq') is not null then
    grant usage, select on sequence public.orders_id_seq to service_role;
  end if;

  if to_regclass('public.order_items_id_seq') is not null then
    grant usage, select on sequence public.order_items_id_seq to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
