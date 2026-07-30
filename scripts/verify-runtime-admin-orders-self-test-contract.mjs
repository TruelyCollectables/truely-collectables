import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL(
    "../src/app/api/release/admin-orders-self-test/route.ts",
    import.meta.url,
  ),
  "utf8",
);

assert(
  source.includes('fetch("https://api.vercel.com/v2/teams?limit=100"') &&
    source.includes('String(team?.slug || "") === TEAM_SLUG'),
  "The runtime verifier must authenticate the Vercel team token.",
);
assert(
  source.includes("createAdminSessionValue") &&
    source.includes("tcos_admin_auth_v3="),
  "The runtime verifier must use the same signed admin session as Production.",
);
assert(
  source.includes('confirmed: false') &&
    source.includes('refundIssued: false'),
  "The runtime verifier must never issue a refund.",
);
assert(
  source.includes('/api/admin/reconcile-platform-fees') &&
    source.includes('directStoreTcosFeesRemaining: 0'),
  "The runtime verifier must prove direct-store TCOS fee cleanup.",
);
assert(
  source.includes('/admin/orders?tab=all') &&
    source.includes('/packing-slip') &&
    source.includes('/admin/products'),
  "The runtime verifier must test repeated protected admin navigation.",
);

console.log("Runtime admin orders self-test contract passed.");