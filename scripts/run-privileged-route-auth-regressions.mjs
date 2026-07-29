import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const proxy = await read("src/proxy.ts");
const actorGuard = await read("src/lib/instacomp-job-server.ts");

for (const fragment of [
  'pathname.startsWith("/api/ebay")',
  'pathname.startsWith("/api/orders")',
  'pathname.startsWith("/admin")',
  "isValidAdminSessionValue",
]) {
  assert.ok(proxy.includes(fragment), `Missing proxy guard fragment: ${fragment}`);
}

for (const fragment of [
  "export async function requireInstaCompJobActor",
  "isValidInstaCompServiceRequest(request)",
  "supabase.auth.getUser(token)",
  '.eq("role", "seller")',
  '.eq("status", "active")',
  'profile?.account_status === "active"',
  "isValidAdminSessionValue(adminSession)",
  "INSTACOMP_JOB_UNAUTHORIZED",
  "401",
  '.eq("store_id", actor.storeId)',
  '.eq("seller_account_id", actor.sellerAccountId)',
]) {
  assert.ok(
    actorGuard.includes(fragment),
    `Missing shared InstaComp authorization control: ${fragment}`,
  );
}

const actorGuardedRoutes = [
  "src/app/api/account/seller/quick-list/route.ts",
  "src/app/api/instacomp/draft-listings/route.ts",
  "src/app/api/instacomp/jobs/route.ts",
  "src/app/api/instacomp/jobs/[id]/route.ts",
  "src/app/api/instacomp/jobs/[id]/items/route.ts",
  "src/app/api/instacomp/jobs/[id]/items/[itemId]/route.ts",
  "src/app/api/instacomp/jobs/[id]/knowledge-base/route.ts",
  "src/app/api/instacomp/trade-items/route.ts",
];

for (const path of actorGuardedRoutes) {
  const source = await read(path);
  assert.ok(
    source.includes("requireInstaCompJobActor") &&
      /await\s+requireInstaCompJobActor\s*\(/.test(source),
    `${path} must invoke the shared active-seller/admin actor guard.`,
  );
}

const proxyGuardedRoutes = [
  {
    path: "src/app/api/ebay/publish/images/route.ts",
    prefix: 'pathname.startsWith("/api/ebay")',
  },
  {
    path: "src/app/api/orders/mark-shipped/route.ts",
    prefix: 'pathname.startsWith("/api/orders")',
  },
  {
    path: "src/app/api/orders/update-tracking/route.ts",
    prefix: 'pathname.startsWith("/api/orders")',
  },
];

for (const { path, prefix } of proxyGuardedRoutes) {
  const source = await read(path);
  assert.ok(
    /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/.test(source),
    `${path} must remain a mutation route covered by the proxy boundary.`,
  );
  assert.ok(proxy.includes(prefix), `${path} is missing proxy protection.`);
}

const sellerPage = await read("src/app/seller/page.tsx");
assert.ok(
  sellerPage.includes("if (!session)") &&
    sellerPage.includes("Log in through your TCOS account first"),
  "The public seller shell must stop before loading private seller data.",
);

console.log(
  "Privileged route authorization regressions passed for all 11 audit-flagged mutation routes and the locked seller shell.",
);
