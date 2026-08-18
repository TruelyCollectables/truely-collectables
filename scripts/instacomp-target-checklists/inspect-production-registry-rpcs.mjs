import { managementQuery } from './management-staged-registry-writer.mjs';

const names = [
  'tcos_begin_checklist_import_plan',
  'tcos_append_checklist_import_chunk',
  'tcos_finalize_checklist_import_plan',
];

const quoted = names.map((name) => `'${name.replaceAll("'", "''")}'`).join(',');
const rows = await managementQuery(`
  select
    p.proname as name,
    pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (${quoted})
  order by p.proname, pg_get_function_identity_arguments(p.oid);
`, 'Inspect Production Checklist Registry RPC definitions');

if (!Array.isArray(rows) || rows.length < 3) {
  throw new Error(`Expected at least 3 Registry RPC definitions, found ${Array.isArray(rows) ? rows.length : 'invalid payload'}`);
}

for (const row of rows) {
  console.log(`===== ${row.name}(${row.args}) =====`);
  console.log(row.definition);
}
