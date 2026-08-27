-- TCOS Market Intel™ Beta One
-- Alert outbox and daily intelligence report persistence.

create extension if not exists pgcrypto;

create table if not exists public.tcos_mi_alerts (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.tcos_mi_listings(id) on delete cascade,
  deal_score_id uuid references public.tcos_mi_deal_scores(id) on delete set null,
  alert_fingerprint text not null unique,
  alert_type text not null default 'deal'
    check (alert_type in ('deal','price_change','mislisted','wholesale','auction_ending','system')),
  status text not null default 'pending'
    check (status in ('pending','sent','dismissed','expired')),
  deal_label text,
  title text not null,
  summary text,
  direct_url text not null,
  delivered_cost numeric(12,2),
  market_value numeric(12,2),
  expected_net_profit numeric(12,2),
  buy_score numeric(5,2),
  first_qualified_at timestamptz not null default now(),
  last_qualified_at timestamptz not null default now(),
  sent_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_mi_alerts_status_created_idx
  on public.tcos_mi_alerts(status, created_at desc);
create index if not exists tcos_mi_alerts_listing_idx
  on public.tcos_mi_alerts(listing_id, last_qualified_at desc);

create table if not exists public.tcos_mi_report_runs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null default current_date,
  report_type text not null default 'daily_intelligence'
    check (report_type in ('daily_intelligence','hourly_deals','portfolio','system_health')),
  status text not null default 'generated'
    check (status in ('generated','delivered','failed')),
  headline text,
  report_markdown text not null,
  report_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  delivered_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, report_type)
);

create index if not exists tcos_mi_report_runs_generated_idx
  on public.tcos_mi_report_runs(report_type, generated_at desc);

create or replace function public.tcos_mi_touch_alert_report_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tcos_mi_alerts_touch on public.tcos_mi_alerts;
create trigger tcos_mi_alerts_touch
before update on public.tcos_mi_alerts
for each row execute function public.tcos_mi_touch_alert_report_updated_at();

drop trigger if exists tcos_mi_report_runs_touch on public.tcos_mi_report_runs;
create trigger tcos_mi_report_runs_touch
before update on public.tcos_mi_report_runs
for each row execute function public.tcos_mi_touch_alert_report_updated_at();

alter table public.tcos_mi_alerts enable row level security;
alter table public.tcos_mi_report_runs enable row level security;

grant select, insert, update, delete on table
  public.tcos_mi_alerts,
  public.tcos_mi_report_runs
to service_role;
