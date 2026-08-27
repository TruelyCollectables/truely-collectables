-- Repair the first transactional writer conflict target on production schemas
-- that predated the final release-source uniqueness contract.
--
-- Historical release-source rows are provenance records. When an older schema
-- allowed duplicates, preserve the oldest row as the canonical source, repoint
-- every dependent audit/source-file row, then remove only the redundant IDs.

do $$
declare
  duplicate_group record;
  keeper_id uuid;
  duplicate_ids uuid[];
begin
  execute 'alter table public.checklist_release_date_revisions disable trigger checklist_release_date_revisions_append_only';
  execute 'alter table public.checklist_release_status_events disable trigger checklist_release_status_events_append_only';

  begin
    for duplicate_group in
      select
        release_id,
        source_type,
        source_url,
        array_agg(id order by created_at, id) as source_ids
      from public.checklist_release_sources
      group by release_id, source_type, source_url
      having count(*) > 1
    loop
      keeper_id := duplicate_group.source_ids[1];
      duplicate_ids := array_remove(duplicate_group.source_ids, keeper_id);

      update public.checklist_release_date_revisions
      set release_source_id = keeper_id
      where release_source_id = any(duplicate_ids);

      update public.checklist_release_status_events
      set release_source_id = keeper_id
      where release_source_id = any(duplicate_ids);

      update public.checklist_source_files
      set release_source_id = keeper_id
      where release_source_id = any(duplicate_ids);

      delete from public.checklist_release_sources
      where id = any(duplicate_ids);
    end loop;
  exception
    when others then
      execute 'alter table public.checklist_release_date_revisions enable trigger checklist_release_date_revisions_append_only';
      execute 'alter table public.checklist_release_status_events enable trigger checklist_release_status_events_append_only';
      raise;
  end;

  execute 'alter table public.checklist_release_date_revisions enable trigger checklist_release_date_revisions_append_only';
  execute 'alter table public.checklist_release_status_events enable trigger checklist_release_status_events_append_only';
end;
$$;

create unique index if not exists checklist_release_sources_release_type_url_repair_unique
  on public.checklist_release_sources(release_id, source_type, source_url);

alter function public.tcos_apply_checklist_import_plan(
  jsonb,
  text,
  text,
  bigint,
  text,
  text,
  text
) set statement_timeout = '20min';

select pg_notify('pgrst', 'reload schema');
