-- TCOS Checklist Registry™ private source archive contract.
-- Creates an auditable application-level storage contract and, when running
-- inside Supabase, provisions the matching non-public Storage bucket.

create table if not exists public.checklist_source_storage_contracts (
  id text primary key,
  bucket_name text not null unique,
  path_schema text not null,
  is_public boolean not null default false check (is_public = false),
  max_size_bytes bigint not null check (max_size_bytes > 0),
  allowed_mime_types text[] not null check (cardinality(allowed_mime_types) > 0),
  archive_originals boolean not null default true check (archive_originals = true),
  expose_public_urls boolean not null default false check (expose_public_urls = false),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.checklist_source_storage_contracts (
  id,
  bucket_name,
  path_schema,
  is_public,
  max_size_bytes,
  allowed_mime_types,
  archive_originals,
  expose_public_urls,
  active,
  metadata
) values (
  'tcos-checklist-source-files-v1',
  'tcos-checklist-source-files',
  'tcos.checklist.sourcePath.v1',
  false,
  52428800,
  array[
    'text/csv',
    'text/tab-separated-values',
    'text/html',
    'application/json',
    'application/xml',
    'text/xml',
    'application/pdf',
    'application/zip',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[],
  true,
  false,
  true,
  jsonb_build_object(
    'purpose', 'private manufacturer checklist and odds source archive',
    'normalized_facts_internal_only', true,
    'redistribute_original_files', false
  )
)
on conflict (id) do update set
  bucket_name = excluded.bucket_name,
  path_schema = excluded.path_schema,
  is_public = excluded.is_public,
  max_size_bytes = excluded.max_size_bytes,
  allowed_mime_types = excluded.allowed_mime_types,
  archive_originals = excluded.archive_originals,
  expose_public_urls = excluded.expose_public_urls,
  active = excluded.active,
  metadata = excluded.metadata,
  updated_at = now();

alter table public.checklist_source_files
  add column if not exists storage_contract_id text;

update public.checklist_source_files
set storage_contract_id = 'tcos-checklist-source-files-v1'
where storage_contract_id is null;

alter table public.checklist_source_files
  alter column storage_contract_id set default 'tcos-checklist-source-files-v1';

alter table public.checklist_source_files
  alter column storage_contract_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checklist_source_files_storage_contract_fk'
      and conrelid = 'public.checklist_source_files'::regclass
  ) then
    alter table public.checklist_source_files
      add constraint checklist_source_files_storage_contract_fk
      foreign key (storage_contract_id)
      references public.checklist_source_storage_contracts(id)
      on delete restrict;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checklist_source_files_private_bucket_match'
      and conrelid = 'public.checklist_source_files'::regclass
  ) then
    alter table public.checklist_source_files
      add constraint checklist_source_files_private_bucket_match
      check (storage_bucket = 'tcos-checklist-source-files');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checklist_source_files_path_schema_v1'
      and conrelid = 'public.checklist_source_files'::regclass
  ) then
    alter table public.checklist_source_files
      add constraint checklist_source_files_path_schema_v1
      check (storage_object_path like 'tcos/checklist/sourcePath/v1/%');
  end if;
end;
$$;

drop trigger if exists checklist_source_storage_contracts_touch
  on public.checklist_source_storage_contracts;
create trigger checklist_source_storage_contracts_touch
before update on public.checklist_source_storage_contracts
for each row execute function public.tcos_checklist_touch_updated_at();

alter table public.checklist_source_storage_contracts enable row level security;
revoke all on table public.checklist_source_storage_contracts from anon, authenticated;
grant select, insert, update, delete
  on table public.checklist_source_storage_contracts
  to service_role;

-- Supabase provides storage.buckets. Plain PostgreSQL test environments may not.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    ) values (
      'tcos-checklist-source-files',
      'tcos-checklist-source-files',
      false,
      52428800,
      array[
        'text/csv',
        'text/tab-separated-values',
        'text/html',
        'application/json',
        'application/xml',
        'text/xml',
        'application/pdf',
        'application/zip',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]::text[]
    )
    on conflict (id) do update set
      name = excluded.name,
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'storage.buckets not present; application storage contract created without provisioning a bucket';
  end if;
end;
$$;
