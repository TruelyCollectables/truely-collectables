begin;

create table if not exists public.checklist_source_catalog (
  id uuid primary key default gen_random_uuid(),
  manufacturer text not null,
  sport text,
  source_url text not null,
  source_sha256 text,
  release_slug text,
  release_name text,
  adapter_id text,
  adapter_version text,
  status text not null default 'discovered'
    check (status in ('discovered','unchanged','validated','imported','quarantined','failed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  imported_at timestamptz,
  validation_counts jsonb,
  issue_summary jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_url)
);

create index if not exists checklist_source_catalog_status_idx
  on public.checklist_source_catalog (status, last_checked_at desc nulls last);
create index if not exists checklist_source_catalog_sport_idx
  on public.checklist_source_catalog (sport, last_seen_at desc);
create index if not exists checklist_source_catalog_sha_idx
  on public.checklist_source_catalog (source_sha256)
  where source_sha256 is not null;

alter table public.checklist_source_catalog enable row level security;
revoke all on table public.checklist_source_catalog from anon, authenticated;
grant all on table public.checklist_source_catalog to service_role;

create or replace function public.tcos_touch_checklist_source_catalog_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists checklist_source_catalog_touch_updated_at
  on public.checklist_source_catalog;
create trigger checklist_source_catalog_touch_updated_at
before update on public.checklist_source_catalog
for each row execute function public.tcos_touch_checklist_source_catalog_updated_at();

commit;
