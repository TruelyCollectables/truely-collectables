-- Allow staged hockey reconciliation to repair identity-only corruption on an
-- already-active version without taking the currently live checklist offline.
-- Other count mismatches remain fail-closed.

do $migration$
declare
  v_def text;
  v_start integer;
  v_tail_relative integer;
  v_tail integer;
  v_new text;
  v_replacement text := $patch$    if v_version_active and v_version_status in ('live','revised') then
      if v_sets = coalesce((v_expected->>'sets')::integer,0)
         and v_cards = coalesce((v_expected->>'cards')::integer,0)
         and v_parallels = coalesce((v_expected->>'parallels')::integer,0)
         and v_identities < coalesce((v_expected->>'identities')::integer,0) then
        return jsonb_build_object(
          'ok',true,'complete',false,'identityRepair',true,'idempotent',false,
          'releaseId',v_release_id,'sourceFileId',v_source_file_id,'versionId',v_version_id,
          'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities),
          'expectedCounts',v_expected
        );
      end if;

      if v_sets <> coalesce((v_expected->>'sets')::integer,0)
         or v_cards <> coalesce((v_expected->>'cards')::integer,0)
         or v_parallels <> coalesce((v_expected->>'parallels')::integer,0)
         or v_identities <> coalesce((v_expected->>'identities')::integer,0) then
        raise exception 'Existing live Checklist Registry version does not match validated expected counts';
      end if;

      return jsonb_build_object(
        'ok',true,'complete',true,'idempotent',true,'releaseId',v_release_id,
        'sourceFileId',v_source_file_id,'versionId',v_version_id,
        'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities)
      );
    end if;

$patch$;
begin
  select pg_get_functiondef(
    'public.tcos_begin_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  ) into v_def;

  v_start := position('    if v_version_active and v_version_status in (''live'',''revised'') then' in v_def);
  if v_start = 0 then
    raise exception 'Could not locate staged Checklist Registry live-version branch';
  end if;

  v_tail_relative := position('    if v_version_status = ''importing''' in substring(v_def from v_start));
  if v_tail_relative = 0 then
    raise exception 'Could not locate staged Checklist Registry importing branch';
  end if;
  v_tail := v_start + v_tail_relative - 1;

  v_new := substring(v_def from 1 for v_start - 1)
    || v_replacement
    || substring(v_def from v_tail);

  execute v_new;
end;
$migration$;

create or replace function public.tcos_repair_checklist_identity_chunk(
  p_version_id uuid,
  p_identities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '25s'
set lock_timeout = '10s'
as $$
declare
  v_release_id uuid;
  v_status text;
  v_active boolean;
  v_expected integer := coalesce(jsonb_array_length(coalesce(p_identities,'[]'::jsonb)),0);
  v_resolved integer := 0;
  v_present integer := 0;
begin
  select release_id,status,is_active
    into v_release_id,v_status,v_active
  from public.checklist_versions
  where id=p_version_id;

  if v_release_id is null then
    raise exception 'Unknown Checklist Registry version';
  end if;
  if not v_active or v_status not in ('live','revised') then
    raise exception 'Checklist identity repair requires an active live version';
  end if;

  select count(*)::integer into v_resolved
  from jsonb_to_recordset(coalesce(p_identities,'[]'::jsonb))
    as x("cardSourceKey" text,"parallelSourceKey" text,fingerprint jsonb)
  join public.checklist_cards c
    on c.version_id=p_version_id and c.metadata->>'sourceKey'=x."cardSourceKey"
  left join public.checklist_parallels p
    on nullif(x."parallelSourceKey",'') is not null
   and p.version_id=p_version_id
   and p.metadata->>'sourceKey'=x."parallelSourceKey"
  where nullif(x."parallelSourceKey",'') is null or p.id is not null;

  if v_resolved <> v_expected then
    raise exception 'Checklist identity repair chunk has unresolved card/parallel references: %/%',
      v_resolved,v_expected;
  end if;

  insert into public.checklist_card_identities(
    release_id,version_id,set_id,card_id,parallel_id,identity_schema,canonical_key,
    fingerprint_sha256,serial_number_tier,autograph_status,memorabilia_status,variation,
    configuration_exclusivity,metadata
  )
  select v_release_id,p_version_id,c.set_id,c.id,p.id,
         coalesce(nullif(x.fingerprint->>'schema',''),'tcos.checklist.identity.v1'),
         x.fingerprint->>'canonicalKey',x.fingerprint->>'fingerprintSha256',
         nullif(x.fingerprint #>> '{normalized,serialRun}',''),
         coalesce(nullif(x.fingerprint #>> '{normalized,autographStatus}',''),'non-auto'),
         coalesce(nullif(x.fingerprint #>> '{normalized,memorabiliaStatus}',''),'non-memorabilia'),
         nullif(x.fingerprint #>> '{normalized,variation}',''),
         nullif(x.fingerprint #>> '{normalized,configurationExclusivity}',''),
         jsonb_build_object(
           'players',coalesce(x.fingerprint #> '{normalized,players}','[]'::jsonb),
           'teams',coalesce(x.fingerprint #> '{normalized,teams}','[]'::jsonb),
           'parallel',x.fingerprint #>> '{normalized,parallel}'
         )
  from jsonb_to_recordset(coalesce(p_identities,'[]'::jsonb))
    as x("cardSourceKey" text,"parallelSourceKey" text,fingerprint jsonb)
  join public.checklist_cards c
    on c.version_id=p_version_id and c.metadata->>'sourceKey'=x."cardSourceKey"
  left join public.checklist_parallels p
    on nullif(x."parallelSourceKey",'') is not null
   and p.version_id=p_version_id
   and p.metadata->>'sourceKey'=x."parallelSourceKey"
  where nullif(x."parallelSourceKey",'') is null or p.id is not null
  on conflict (version_id,identity_schema,fingerprint_sha256) do nothing;

  select count(*)::integer into v_present
  from jsonb_to_recordset(coalesce(p_identities,'[]'::jsonb))
    as x("cardSourceKey" text,"parallelSourceKey" text,fingerprint jsonb)
  where exists (
    select 1 from public.checklist_card_identities i
    where i.version_id=p_version_id
      and i.identity_schema=coalesce(nullif(x.fingerprint->>'schema',''),'tcos.checklist.identity.v1')
      and i.fingerprint_sha256=x.fingerprint->>'fingerprintSha256'
  );

  if v_present <> v_expected then
    raise exception 'Checklist identity repair chunk did not persist every fingerprint: %/%',
      v_present,v_expected;
  end if;

  update public.checklist_versions
  set metadata=metadata || jsonb_build_object('identityRepairInProgress',true,'identityRepairAt',now())
  where id=p_version_id;

  return jsonb_build_object(
    'ok',true,'versionId',p_version_id,'rows',v_expected,'resolved',v_resolved,'present',v_present
  );
end;
$$;

create or replace function public.tcos_finalize_checklist_identity_repair(
  p_version_id uuid,
  p_expected_sets integer,
  p_expected_cards integer,
  p_expected_parallels integer,
  p_expected_identities integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '25s'
set lock_timeout = '10s'
as $$
declare
  v_status text;
  v_active boolean;
  v_sets integer;
  v_cards integer;
  v_parallels integer;
  v_identities integer;
begin
  select status,is_active into v_status,v_active
  from public.checklist_versions where id=p_version_id for update;
  if v_status is null then raise exception 'Unknown Checklist Registry version'; end if;
  if not v_active or v_status not in ('live','revised') then
    raise exception 'Checklist identity repair finalize requires an active live version';
  end if;

  select count(*) into v_sets from public.checklist_sets where version_id=p_version_id;
  select count(*) into v_cards from public.checklist_cards where version_id=p_version_id;
  select count(*) into v_parallels from public.checklist_parallels where version_id=p_version_id;
  select count(*) into v_identities from public.checklist_card_identities where version_id=p_version_id;

  if v_sets<>p_expected_sets or v_cards<>p_expected_cards or v_parallels<>p_expected_parallels or v_identities<>p_expected_identities then
    raise exception 'Checklist identity repair final counts mismatch: sets %/%, cards %/%, parallels %/%, identities %/%',
      v_sets,p_expected_sets,v_cards,p_expected_cards,v_parallels,p_expected_parallels,v_identities,p_expected_identities;
  end if;

  update public.checklist_versions
  set normalized_card_count=v_cards,
      normalized_identity_count=v_identities,
      metadata=(metadata - 'identityRepairInProgress') || jsonb_build_object(
        'identityRepairComplete',true,
        'identityRepairCompletedAt',now()
      )
  where id=p_version_id;

  return jsonb_build_object(
    'ok',true,'status','live','identityRepairComplete',true,'versionId',p_version_id,
    'counts',jsonb_build_object('sets',v_sets,'cards',v_cards,'parallels',v_parallels,'identities',v_identities)
  );
end;
$$;

revoke all on function public.tcos_repair_checklist_identity_chunk(uuid,jsonb)
  from public,anon,authenticated;
revoke all on function public.tcos_finalize_checklist_identity_repair(uuid,integer,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.tcos_repair_checklist_identity_chunk(uuid,jsonb) to service_role;
grant execute on function public.tcos_finalize_checklist_identity_repair(uuid,integer,integer,integer,integer) to service_role;

select pg_notify('pgrst','reload schema');
