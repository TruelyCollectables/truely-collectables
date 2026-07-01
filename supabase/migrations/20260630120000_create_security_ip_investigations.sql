create table if not exists public.security_ip_investigations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  ip_address text not null,
  status text not null default 'watch',
  severity text not null default 'medium',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  resolved_at timestamptz,
  constraint security_ip_investigations_status_check
    check (status in ('watch', 'review', 'resolved')),
  constraint security_ip_investigations_severity_check
    check (severity in ('low', 'medium', 'high', 'critical'))
);

create unique index if not exists security_ip_investigations_store_ip_unique_idx
  on public.security_ip_investigations(store_id, ip_address);

create index if not exists security_ip_investigations_store_status_updated_idx
  on public.security_ip_investigations(store_id, status, updated_at desc);

grant select, insert, update on table public.security_ip_investigations
  to anon, authenticated;
