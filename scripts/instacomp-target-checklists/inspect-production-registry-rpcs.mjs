import { managementQuery } from './management-staged-registry-writer.mjs';

const stale = await managementQuery(`
  select
    r.slug,
    r.product_name,
    r.release_year,
    r.season,
    v.id as version_id,
    v.version_number,
    v.parser_version,
    v.status,
    v.is_active,
    v.created_at,
    sf.original_filename,
    sf.sha256,
    (select count(*) from public.checklist_sets s where s.version_id=v.id) as sets,
    (select count(*) from public.checklist_cards c where c.version_id=v.id) as cards,
    (select count(*) from public.checklist_parallels p where p.version_id=v.id) as parallels,
    (select count(*) from public.checklist_card_identities i where i.version_id=v.id) as identities,
    (select jsonb_agg(jsonb_build_object('name',s.name,'sourceKey',s.metadata->>'sourceKey') order by s.name)
       from public.checklist_sets s where s.version_id=v.id) as set_keys
  from public.checklist_versions v
  join public.checklist_releases r on r.id=v.release_id
  join public.checklist_source_files sf on sf.id=v.source_file_id
  where v.status='importing'
    and v.is_active=false
    and coalesce((v.metadata->>'stagedImport')::boolean,false)=true
    and lower(r.sport_id::text) is not null
  order by v.created_at desc;
`, 'Inspect stale staged Checklist Registry versions');
console.log('===== STALE STAGED IMPORTING VERSIONS =====');
console.log(JSON.stringify(stale, null, 2));

const versionIndexes = await managementQuery(`
  select indexname,indexdef
  from pg_indexes
  where schemaname='public' and tablename in ('checklist_versions','checklist_source_files')
  order by tablename,indexname;
`, 'Inspect Checklist Registry version indexes');
console.log('===== VERSION/SOURCE INDEXES =====');
console.log(JSON.stringify(versionIndexes, null, 2));
