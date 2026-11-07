create table if not exists public.transaction_evidence_reports (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null,
  stripe_session_id text not null unique,
  stripe_event_id text,
  customer_email text,
  total numeric,
  status text not null default 'ready',
  report_json jsonb not null default '{}'::jsonb,
  report_text text not null,
  report_html text not null,
  emailed_to text,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transaction_evidence_reports_order_id_idx
  on public.transaction_evidence_reports (order_id);

create index if not exists transaction_evidence_reports_created_at_idx
  on public.transaction_evidence_reports (created_at desc);
