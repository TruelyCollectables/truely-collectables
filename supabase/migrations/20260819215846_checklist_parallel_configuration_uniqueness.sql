-- Upper Deck can publish the same parallel name and serial run for the same set
-- with different configuration exclusivity (for example Hobby vs e-Pack).
-- Configuration exclusivity is part of the Registry identity fingerprint and the
-- parser's parallel source key, so it must also participate in parallel uniqueness.

drop index if exists public.checklist_parallels_version_set_name_serial_unique;

create unique index checklist_parallels_version_set_name_serial_unique
  on public.checklist_parallels(
    version_id,
    coalesce(set_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_name,
    coalesce(serial_run, 0),
    coalesce(configuration_exclusivity, '')
  );

select pg_notify('pgrst','reload schema');
