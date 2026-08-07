-- Repair the first transactional writer conflict target on production schemas
-- that predated the final release-source uniqueness contract.

do $$
begin
  if exists (
    select 1
    from public.checklist_release_sources
    group by release_id, source_type, source_url
    having count(*) > 1
  ) then
    raise exception 'Duplicate checklist release-source rows require manual reconciliation before writer repair';
  end if;

  if exists (
    select 1
    from public.checklist_card_identities
    group by identity_schema, fingerprint_sha256
    having count(*) > 1
  ) then
    raise exception 'Duplicate checklist identity fingerprints require manual reconciliation before writer repair';
  end if;
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
