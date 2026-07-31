-- Preserve source-specific checklist metadata while keeping the validated v1
-- transactional writer as the single atomic normalization path.

create or replace function public.tcos_apply_checklist_import_plan_v2(
  p_plan jsonb,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_storage_bucket text,
  p_storage_object_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_release_id uuid;
  v_source_file_id uuid;
  v_version_id uuid;
  v_entry jsonb;
  v_metadata jsonb;
begin
  v_result := public.tcos_apply_checklist_import_plan(
    p_plan,
    p_original_filename,
    p_mime_type,
    p_size_bytes,
    p_sha256,
    p_storage_bucket,
    p_storage_object_path
  );

  v_release_id := nullif(v_result->>'releaseId', '')::uuid;
  v_source_file_id := nullif(v_result->>'sourceFileId', '')::uuid;
  v_version_id := nullif(v_result->>'versionId', '')::uuid;

  if v_release_id is null or v_source_file_id is null or v_version_id is null then
    raise exception 'Checklist Registry v1 writer did not return persistence identifiers';
  end if;

  v_metadata := case
    when jsonb_typeof(p_plan #> '{release,metadata}') = 'object'
      then p_plan #> '{release,metadata}'
    else '{}'::jsonb
  end;

  update public.checklist_releases
  set metadata = metadata || v_metadata
  where id = v_release_id;

  v_metadata := case
    when jsonb_typeof(p_plan #> '{source,metadata}') = 'object'
      then p_plan #> '{source,metadata}'
    else '{}'::jsonb
  end;

  update public.checklist_source_files
  set metadata = metadata || jsonb_build_object('sourceMetadata', v_metadata)
  where id = v_source_file_id;

  update public.checklist_versions
  set metadata = metadata || jsonb_build_object(
    'sourceMetadata', v_metadata,
    'metadataWriterVersion', 'tcos.checklist.metadataWriter.v2'
  )
  where id = v_version_id;

  for v_entry in
    select value
    from jsonb_array_elements(coalesce(p_plan->'sets', '[]'::jsonb))
  loop
    v_metadata := case
      when jsonb_typeof(v_entry->'metadata') = 'object'
        then v_entry->'metadata'
      else '{}'::jsonb
    end;

    update public.checklist_sets
    set metadata = metadata || v_metadata
    where version_id = v_version_id
      and metadata->>'sourceKey' = v_entry->>'sourceKey';
  end loop;

  for v_entry in
    select value
    from jsonb_array_elements(coalesce(p_plan->'cards', '[]'::jsonb))
  loop
    v_metadata := case
      when jsonb_typeof(v_entry->'metadata') = 'object'
        then v_entry->'metadata'
      else '{}'::jsonb
    end;

    update public.checklist_cards
    set metadata = metadata || v_metadata
    where version_id = v_version_id
      and metadata->>'sourceKey' = v_entry->>'sourceKey';
  end loop;

  for v_entry in
    select value
    from jsonb_array_elements(coalesce(p_plan->'parallels', '[]'::jsonb))
  loop
    v_metadata := case
      when jsonb_typeof(v_entry->'metadata') = 'object'
        then v_entry->'metadata'
      else '{}'::jsonb
    end;

    update public.checklist_parallels
    set metadata = metadata || v_metadata
    where version_id = v_version_id
      and metadata->>'sourceKey' = v_entry->>'sourceKey';
  end loop;

  return v_result || jsonb_build_object(
    'metadataApplied', true,
    'metadataWriterVersion', 'tcos.checklist.metadataWriter.v2'
  );
end;
$$;

revoke all on function public.tcos_apply_checklist_import_plan_v2(
  jsonb,text,text,bigint,text,text,text
) from public, anon, authenticated;

grant execute on function public.tcos_apply_checklist_import_plan_v2(
  jsonb,text,text,bigint,text,text,text
) to service_role;
