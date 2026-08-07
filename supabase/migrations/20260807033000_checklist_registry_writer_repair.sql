-- Repair the first transactional writer conflict target on production schemas
-- that predated the final release-source uniqueness contract.

do $$
declare
  duplicate_group record;
  keeper_id uuid;
begin
  for duplicate_group in
    select
      release_id,
      source_type,
      source_url,
      array_agg(id order by created_at, id) as ids
    from public.checklist_release_sources
    group by release_id, source_type, source_url
    having count(*) > 1
  loop
    keeper_id := duplicate_group.ids[1];

    update public.checklist_release_date_revisions
    set release_source_id = keeper_id
    where release_source_id = any(duplicate_group.ids[2:array_length(duplicate_group.ids, 1)]);

    update public.checklist_release_status_events
    set release_source_id = keeper_id
    where release_source_id = any(duplicate_group.ids[2:array_length(duplicate_group.ids, 1)]);

    update public.checklist_source_files
    set release_source_id = keeper_id
    where release_source_id = any(duplicate_group.ids[2:array_length(duplicate_group.ids, 1)]);

    delete from public.checklist_release_sources
    where id = any(duplicate_group.ids[2:array_length(duplicate_group.ids, 1)]);
  end loop;
end;
$$;

create unique index if not exists checklist_release_sources_release_type_url_repair_unique
  on public.checklist_release_sources(release_id, source_type, source_url);

create unique index if not exists checklist_card_identities_schema_fingerprint_repair_unique
  on public.checklist_card_identities(identity_schema, fingerprint_sha256);

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
