-- Existing source/parser versions may have been activated while the historical
-- global identity fingerprint index was present. Reprocessing those sources must
-- repair and verify identities instead of returning early and preserving a
-- card-complete but identity-incomplete live version.

do $migration$
declare
  v_def text;
  v_new text;
  v_replacement text := $patch$if v_version_id is not null then
    insert into public.checklist_card_identities(
      release_id, version_id, set_id, card_id, parallel_id, identity_schema, canonical_key,
      fingerprint_sha256, serial_number_tier, autograph_status, memorabilia_status,
      variation, configuration_exclusivity, metadata
    )
    select
      v_release_id,
      v_version_id,
      c.set_id,
      c.id,
      p.id,
      coalesce(x.value #>> '{fingerprint,schema}', 'tcos.checklist.identity.v1'),
      x.value #>> '{fingerprint,canonicalKey}',
      x.value #>> '{fingerprint,fingerprintSha256}',
      nullif(x.value #>> '{fingerprint,normalized,serialRun}', ''),
      coalesce(nullif(x.value #>> '{fingerprint,normalized,autographStatus}',''), 'non-auto'),
      coalesce(nullif(x.value #>> '{fingerprint,normalized,memorabiliaStatus}',''), 'non-memorabilia'),
      nullif(x.value #>> '{fingerprint,normalized,variation}', ''),
      nullif(x.value #>> '{fingerprint,normalized,configurationExclusivity}', ''),
      jsonb_build_object(
        'players', coalesce(x.value #> '{fingerprint,normalized,players}', '[]'::jsonb),
        'teams', coalesce(x.value #> '{fingerprint,normalized,teams}', '[]'::jsonb),
        'parallel', x.value #>> '{fingerprint,normalized,parallel}'
      )
    from jsonb_array_elements(coalesce(p_plan->'identities','[]'::jsonb)) x(value)
    join public.checklist_cards c
      on c.version_id = v_version_id
     and c.metadata->>'sourceKey' = x.value->>'cardSourceKey'
    left join public.checklist_parallels p
      on p.version_id = v_version_id
     and p.metadata->>'sourceKey' = nullif(x.value->>'parallelSourceKey','')
    where nullif(x.value->>'parallelSourceKey','') is null or p.id is not null
    on conflict (version_id, identity_schema, fingerprint_sha256) do nothing;

    select count(*)::integer into v_identity_count
    from public.checklist_card_identities
    where version_id = v_version_id;

    if v_identity_count <> coalesce(jsonb_array_length(p_plan->'identities'), 0) then
      raise exception 'Existing Checklist Registry version identity repair is incomplete: expected %, found %',
        coalesce(jsonb_array_length(p_plan->'identities'), 0), v_identity_count;
    end if;

    update public.checklist_versions
    set normalized_identity_count = v_identity_count,
        metadata = metadata || jsonb_build_object('identityRepair', 'set_based_v1')
    where id = v_version_id;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'repairedIdentities', true,
      'identityCount', v_identity_count,
      'releaseId', v_release_id,
      'sourceFileId', v_source_file_id,
      'versionId', v_version_id
    );
  end if;$patch$;
begin
  select pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  ) into v_def;

  v_new := regexp_replace(
    v_def,
    E'if v_version_id is not null then(.|\\n)*?end if;',
    v_replacement
  );

  if v_new = v_def then
    raise exception 'Could not locate Checklist Registry idempotent-return branch for identity repair patch';
  end if;

  execute v_new;
end;
$migration$;

revoke all on function public.tcos_apply_checklist_import_plan(
  jsonb, text, text, bigint, text, text, text
) from public, anon, authenticated;

grant execute on function public.tcos_apply_checklist_import_plan(
  jsonb, text, text, bigint, text, text, text
) to service_role;

select pg_notify('pgrst', 'reload schema');
