-- Large, fully validated checklist releases can legitimately contain thousands of
-- cards and identities. Production's default statement timeout is too short for
-- the atomic Registry writer, so give this one function a bounded import window.
-- The function remains transactional and all existing validation gates remain in
-- force; this changes execution time only.

alter function public.tcos_apply_checklist_import_plan(
  jsonb,
  text,
  text,
  bigint,
  text,
  text,
  text
)
set statement_timeout = '45s';

do $$
declare
  v_config text[];
begin
  select p.proconfig
    into v_config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'tcos_apply_checklist_import_plan'
    and pg_get_function_identity_arguments(p.oid) = 'p_plan jsonb, p_original_filename text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_storage_bucket text, p_storage_object_path text';

  if v_config is null or not ('statement_timeout=45s' = any(v_config)) then
    raise exception 'Checklist Registry writer statement timeout was not installed';
  end if;
end
$$;
