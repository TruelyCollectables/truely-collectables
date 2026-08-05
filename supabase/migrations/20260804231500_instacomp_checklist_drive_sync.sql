create table if not exists public.instacomp_checklist_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_type text not null check (trigger_type in ('cron','manual')),
  status text not null check (status in ('running','completed','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  files_discovered integer not null default 0,
  files_new integer not null default 0,
  files_changed integer not null default 0,
  files_unchanged integer not null default 0,
  files_quarantined integer not null default 0,
  files_queued integer not null default 0,
  error_message text,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.instacomp_checklist_drive_files (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  parent_folder_id text,
  name text not null,
  mime_type text not null,
  modified_time timestamptz,
  md5_checksum text,
  content_sha256 text,
  source_url text,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_synced_at timestamptz,
  sync_status text not null default 'discovered' check (sync_status in ('discovered','unchanged','queued','imported','quarantined','unsupported','failed')),
  validation_errors jsonb not null default '[]'::jsonb,
  import_receipt jsonb not null default '{}'::jsonb,
  latest_sync_run_id uuid references public.instacomp_checklist_sync_runs(id) on delete set null
);

create index if not exists instacomp_checklist_drive_files_status_idx
  on public.instacomp_checklist_drive_files(sync_status, modified_time desc);
create index if not exists instacomp_checklist_sync_runs_started_idx
  on public.instacomp_checklist_sync_runs(started_at desc);

alter table public.instacomp_checklist_sync_runs enable row level security;
alter table public.instacomp_checklist_drive_files enable row level security;

comment on table public.instacomp_checklist_drive_files is
  'Versioned Google Drive checklist discovery ledger for InstaComp AI. Service-role only.';
