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

create index if not exists order_review_case_packets_store_created_idx
  on public.order_review_case_packets(store_id, created_at desc);

create index if not exists order_review_case_packets_store_order_idx
  on public.order_review_case_packets(store_id, order_id, created_at desc);

create index if not exists order_review_case_packets_store_status_idx
  on public.order_review_case_packets(store_id, status, updated_at desc);
