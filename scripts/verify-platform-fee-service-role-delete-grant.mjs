import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260730050000_grant_platform_fee_delete_service_role.sql",
    import.meta.url,
  ),
  "utf8",
);
const cleanupRoute = await readFile(
  new URL(
    "../src/app/api/admin/reconcile-platform-fees/route.ts",
    import.meta.url,
  ),
  "utf8",
);

assert.match(migration, /^begin;\s/i, "Migration must begin transactionally.");
assert.match(migration, /commit;\s*$/i, "Migration must commit transactionally.");
assert.match(
  migration,
  /grant\s+delete\s+on\s+table\s+public\.platform_fee_ledger_entries\s+to\s+service_role\s*;/i,
  "Migration must grant DELETE only to service_role on the platform fee ledger.",
);
assert.doesNotMatch(
  migration,
  /grant[\s\S]*delete[\s\S]*to\s+(?:anon|authenticated)/i,
  "Migration must not grant platform fee deletion to public roles.",
);
assert.doesNotMatch(
  migration,
  /delete\s+on\s+table\s+public\.seller_payout_ledger_entries/i,
  "Migration must not add delete access to seller payout ledger rows.",
);
assert.match(
  migration,
  /notify\s+pgrst\s*,\s*'reload schema'\s*;/i,
  "Migration must reload the PostgREST schema cache.",
);

assert.match(
  cleanupRoute,
  /createSupabaseServerClient\(\{\s*admin:\s*true\s*\}\)/,
  "Fee cleanup must use the server-only admin Supabase client.",
);
assert.match(
  cleanupRoute,
  /\.from\("platform_fee_ledger_entries"\)[\s\S]*\.delete\(\)[\s\S]*\.eq\("source_type",\s*"tcos_website_checkout"\)[\s\S]*\.is\("seller_account_id",\s*null\)/,
  "Fee cleanup must delete only legacy direct-store fee rows.",
);

console.log("Platform fee service-role DELETE grant contract passed.");
