import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

const [appDirInput, evidenceDirInput] = process.argv.slice(2);
if (!appDirInput || !evidenceDirInput) {
  throw new Error("Usage: node launch2-final-b30f084-resume.mjs <exactAppDir> <evidenceDir>");
}

const appDir = path.resolve(appDirInput);
const evidenceDir = path.resolve(evidenceDirInput);
const expectedSha = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const vercelToken = String(process.env.VERCEL_TOKEN || "").trim();
const supabaseAccessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "").trim();
const vercelScope = String(process.env.VERCEL_SCOPE || "").trim();

if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error("EXPECTED_MAIN_SHA is invalid.");
if (!vercelToken || !supabaseAccessToken || !vercelScope) {
  throw new Error("Required guarded Production credentials are unavailable.");
}

fs.mkdirSync(evidenceDir, { recursive: true });

const redact = (value) => String(value || "")
  .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
  .replace(new RegExp(vercelToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]")
  .replace(new RegExp(supabaseAccessToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]")
  .slice(0, 8000);

function sanitize(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redact(value).slice(0, 3000);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = /token|secret|password|authorization|credential|cookie/i.test(key)
      ? "[REDACTED]"
      : sanitize(child, depth + 1);
  }
  return output;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(value, null, 2));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const projectLinkPath = path.join(appDir, ".vercel", "project.json");
if (!fs.existsSync(projectLinkPath)) throw new Error("Vercel project link is missing from exact app worktree.");
const projectLink = JSON.parse(fs.readFileSync(projectLinkPath, "utf8"));
const projectId = String(projectLink.projectId || "").trim();
const orgId = String(projectLink.orgId || "").trim();
if (!projectId || !orgId) throw new Error("Vercel project linkage is incomplete.");

const envResponse = await fetch(
  `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?teamId=${encodeURIComponent(orgId)}&decrypt=true`,
  { headers: { Authorization: `Bearer ${vercelToken}` }, signal: AbortSignal.timeout(60_000) },
);
const envText = await envResponse.text();
if (!envResponse.ok) throw new Error(`Vercel environment query failed with HTTP ${envResponse.status}.`);
const envPayload = JSON.parse(envText);
const envRows = Array.isArray(envPayload?.envs) ? envPayload.envs : [];
const productionEnv = {};
for (const row of envRows) {
  if (!Array.isArray(row?.target) || !row.target.includes("production")) continue;
  const key = String(row?.key || "").trim();
  if (key && typeof row?.value === "string") productionEnv[key] = row.value;
}

const productionSupabaseUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const adminSessionSecret = String(productionEnv.ADMIN_SESSION_SECRET || "").trim();
if (!/^https:\/\//.test(productionSupabaseUrl)) throw new Error("Production Supabase URL is unavailable.");
if (adminSessionSecret.length < 32) throw new Error("Production ADMIN_SESSION_SECRET is unavailable or too short.");

const projectRef = new URL(productionSupabaseUrl).hostname.split(".")[0];
if (!projectRef) throw new Error("Unable to derive the Production Supabase project reference.");
const supabaseEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function supabaseQuery(query, readOnly = false) {
  const response = await fetch(supabaseEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Production query failed with HTTP ${response.status}: ${redact(body)}`);
  }
  return body ? JSON.parse(body) : [];
}

const grantMigration = fs.readFileSync(
  path.join(appDir, "supabase", "migrations", "20260730050000_grant_platform_fee_delete_service_role.sql"),
  "utf8",
);
await supabaseQuery(grantMigration, false);
const grantRows = await supabaseQuery(`
  select json_build_object(
    'service_role_delete', has_table_privilege('service_role', 'public.platform_fee_ledger_entries', 'DELETE'),
    'anon_delete', has_table_privilege('anon', 'public.platform_fee_ledger_entries', 'DELETE'),
    'authenticated_delete', has_table_privilege('authenticated', 'public.platform_fee_ledger_entries', 'DELETE'),
    'captured_at', now()
  ) receipt;
`, true);
const grant = grantRows?.[0]?.receipt;
if (!grant || grant.service_role_delete !== true || grant.anon_delete === true || grant.authenticated_delete === true) {
  throw new Error(`Invalid Production platform-fee privilege state: ${JSON.stringify(grant)}`);
}
writeJson("platform-fee-grant-production.json", { ok: true, exactMainSha: expectedSha, ...grant });

const orderRows = await supabaseQuery("select id from public.orders order by created_at desc limit 1;", true);
const latestOrderId = orderRows?.[0]?.id;
if (!latestOrderId) throw new Error("No Production order exists for guarded read-only admin navigation proof.");

const deployment = spawnSync(
  "npx",
  [
    "vercel@56.2.0", "deploy", "--prod", "--yes", "--force", "--archive=tgz",
    "--meta", `githubCommitSha=${expectedSha}`,
    "--meta", "launchPurpose=launch2-issue253-b30f084-resume",
    "--scope", vercelScope,
    "--token", vercelToken,
  ],
  {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
    timeout: 25 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  },
);
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) throw new Error(`Vercel Production deployment failed: ${redact(deployment.stderr)}`);
const deploymentOutput = `${deployment.stdout || ""}\n${deployment.stderr || ""}`;
const deploymentUrl = (deploymentOutput.match(/https:\/\/[A-Za-z0-9.-]+\.vercel\.app/g) || []).at(-1);
if (!deploymentUrl) throw new Error("Vercel did not return a Production deployment URL.");
const deploymentHost = new URL(deploymentUrl).hostname;

let deploymentReceipt = null;
let lastDeploymentState = null;
for (let attempt = 1; attempt <= 90; attempt += 1) {
  const response = await fetch(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentHost)}?teamId=${encodeURIComponent(orgId)}`,
    { headers: { Authorization: `Bearer ${vercelToken}` }, signal: AbortSignal.timeout(60_000) },
  );
  const body = await response.text();
  if (response.ok) {
    const candidate = JSON.parse(body);
    const aliases = [
      ...(Array.isArray(candidate.alias) ? candidate.alias : []),
      ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
    ].map((value) => String(value).replace(/^https?:\/\//, "").replace(/\/$/, ""));
    lastDeploymentState = {
      deploymentId: candidate.id,
      deploymentHost: candidate.url,
      target: candidate.target,
      readyState: candidate.readyState,
      metadataSha: candidate.meta?.githubCommitSha || null,
      customDomainAliasVerified: aliases.includes("truelycollectables.com"),
    };
    if (
      candidate.readyState === "READY" &&
      candidate.target === "production" &&
      candidate.url === deploymentHost &&
      candidate.meta?.githubCommitSha === expectedSha &&
      aliases.includes("truelycollectables.com")
    ) {
      deploymentReceipt = { ok: true, exactMainSha: expectedSha, deploymentUrl, ...lastDeploymentState, verifiedAt: new Date().toISOString() };
      break;
    }
  }
  await sleep(10_000);
}
if (!deploymentReceipt) {
  writeJson("deployment-last-state.json", lastDeploymentState || { unavailable: true });
  throw new Error("Exact current-main Production deployment metadata or custom-domain alias did not verify.");
}
writeJson("exact-production.json", deploymentReceipt);
fs.writeFileSync(path.join(evidenceDir, "deployment-url.txt"), `${deploymentUrl}\n`);

async function http(url, options = {}) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(180_000), ...options });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

const issuedAt = String(Math.floor(Date.now() / 1000));
const signature = createHmac("sha256", adminSessionSecret).update(issuedAt).digest("base64url");
const adminCookie = `tcos_admin_auth_v3=${encodeURIComponent(`${issuedAt}.${signature}`)}`;

let boundaryReceipt = null;
for (let attempt = 1; attempt <= 60; attempt += 1) {
  try {
    const [home, shop, unsignedAdmin, unsignedHealth, unsignedMarketplace, oldAdminSelfTest, buildInfo] = await Promise.all([
      http("https://truelycollectables.com/"),
      http("https://truelycollectables.com/shop"),
      http("https://truelycollectables.com/admin"),
      http("https://truelycollectables.com/api/admin-orders-health"),
      http("https://truelycollectables.com/api/release/issue253-marketplace-self-test?step=sold-archive", { method: "POST" }),
      http("https://truelycollectables.com/api/release/admin-orders-self-test", { method: "POST" }),
      http("https://truelycollectables.com/api/build-info"),
    ]);
    const state = {
      home: home.status,
      shop: shop.status,
      unsignedAdmin: unsignedAdmin.status,
      unsignedHealth: unsignedHealth.status,
      unsignedMarketplace: unsignedMarketplace.status,
      removedAdminSelfTest: oldAdminSelfTest.status,
      removedBuildInfo: buildInfo.status,
      verifiedAt: new Date().toISOString(),
    };
    if (
      home.status === 200 &&
      shop.status === 200 &&
      [302, 307, 308].includes(unsignedAdmin.status) &&
      unsignedHealth.status === 401 &&
      unsignedMarketplace.status === 401 &&
      oldAdminSelfTest.status === 404 &&
      buildInfo.status === 404
    ) {
      boundaryReceipt = { ok: true, ...state };
      break;
    }
    writeJson("boundary-last-state.json", state);
  } catch (error) {
    writeJson("boundary-last-state.json", { error: redact(error?.message || error), checkedAt: new Date().toISOString() });
  }
  await sleep(10_000);
}
if (!boundaryReceipt) throw new Error("Cleaned live storefront, auth boundaries, or temporary-route removal did not verify.");
writeJson("live-boundary-receipt.json", boundaryReceipt);

const adminPaths = [
  "/admin",
  "/admin/orders?tab=all",
  `/admin/orders/${latestOrderId}`,
  `/admin/orders/${latestOrderId}/packing-slip`,
  "/admin/products",
];
const adminNavigation = [];
let refreshCookieSeen = false;
for (const adminPath of adminPaths) {
  const response = await http(`https://truelycollectables.com${adminPath}`, { headers: { Cookie: adminCookie } });
  const setCookie = response.headers.get("set-cookie") || "";
  if (setCookie.includes("tcos_admin_auth_v3=")) refreshCookieSeen = true;
  adminNavigation.push({ path: adminPath, status: response.status, sessionRefreshHeader: setCookie.includes("tcos_admin_auth_v3=") });
  if (response.status !== 200) throw new Error(`Protected admin navigation failed for ${adminPath}: HTTP ${response.status}.`);
}
if (!refreshCookieSeen) throw new Error("Protected admin navigation did not refresh the canonical signed session.");

const feeResponse = await http("https://truelycollectables.com/api/admin/reconcile-platform-fees", {
  method: "POST",
  headers: { Cookie: adminCookie },
});
const feePayload = (() => { try { return JSON.parse(feeResponse.text); } catch { return {}; } })();
if (feeResponse.status !== 200 || feePayload.success !== true) {
  throw new Error(`Production platform-fee cleanup failed: HTTP ${feeResponse.status}: ${redact(feeResponse.text)}`);
}

const refundResponse = await http("https://truelycollectables.com/api/orders/refund", {
  method: "POST",
  headers: { Cookie: adminCookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    orderId: latestOrderId,
    reason: "Launch audit safety check; confirmation intentionally withheld.",
    confirmed: false,
  }),
});
if (refundResponse.status !== 400 || !/confirm/i.test(refundResponse.text)) {
  throw new Error(`Refund confirmation guard failed: HTTP ${refundResponse.status}: ${redact(refundResponse.text)}`);
}
writeJson("admin-runtime-receipt.json", {
  ok: true,
  exactMainSha: expectedSha,
  latestOrderId,
  adminNavigation,
  platformFeeCleanup: "passed",
  removedDirectStoreFeeRows: Number(feePayload.removedCount || 0),
  refundConfirmationGuard: "passed",
  refundIssued: false,
  verifiedAt: new Date().toISOString(),
});

const marketplaceSteps = ["ebay-order-sales", "ebay-full-sync", "seller-reconciliation", "sold-archive"];
const marketplaceReceipts = [];
for (const step of marketplaceSteps) {
  let passed = null;
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await http(
      `https://truelycollectables.com/api/release/issue253-marketplace-self-test?step=${encodeURIComponent(step)}`,
      { method: "POST", headers: { Authorization: `Bearer ${vercelToken}` } },
    );
    let payload = {};
    try { payload = JSON.parse(response.text); } catch { payload = { raw: redact(response.text) }; }
    last = { step, status: response.status, payload: sanitize(payload), verifiedAt: new Date().toISOString() };
    if (
      response.status === 200 &&
      payload?.success === true &&
      payload?.cronSecretConfigured === true &&
      Number(payload?.upstreamStatus) === 200
    ) {
      passed = last;
      break;
    }
    await sleep(30_000);
  }
  if (!passed) {
    marketplaceReceipts.push(last || { step, unavailable: true });
    writeJson("marketplace-runtime-receipts.json", marketplaceReceipts);
    throw new Error(`Protected Production marketplace convergence failed at ${step}.`);
  }
  marketplaceReceipts.push(passed);
}
writeJson("marketplace-runtime-receipts.json", marketplaceReceipts);

const auditRows = await supabaseQuery(`
  select json_build_object(
    'required_relations', (
      select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'collectible_assets','collectible_asset_events','collectible_grader_verifications',
        'collectible_market_snapshots','collectible_sales','instacomp_internal_sold_comps',
        'collx_only_inventory_boundary_violations','ebay_inbound_sale_guards'
      )
    ),
    'sale_records_total', (select count(*) from public.collectible_sales),
    'verified_sales', (select count(*) from public.collectible_sales where evidence_status='verified'),
    'manual_sales', (select count(*) from public.collectible_sales where evidence_status='manual'),
    'unresolved_sales', (select count(*) from public.collectible_sales where evidence_status='unresolved'),
    'verified_or_manual_missing_actual_price', (
      select count(*) from public.collectible_sales
      where evidence_status in ('verified','manual') and sold_price is null
    ),
    'null_price_not_explicitly_unresolved', (
      select count(*) from public.collectible_sales
      where sold_price is null and evidence_status <> 'unresolved'
    ),
    'historical_sold_products_without_sale_record', (
      select count(*) from public.products p
      where p.quantity <= 0 and p.created_at < timestamptz '2026-07-28 00:00:00+00'
        and not exists (select 1 from public.collectible_sales s where s.legacy_product_id=p.id and s.store_id=p.seller_id)
    ),
    'collx_via_linked_ebay_sales', (
      select count(*) from public.collectible_sales where source_marketplace='ebay_or_collx_via_ebay'
    ),
    'chain_evidence_rows', (
      select count(*) from public.collectible_sales
      where source_marketplace='ebay_or_collx_via_ebay'
        and evidence->>'source_chain'='collx_or_ebay_to_ebay_to_truely_collectables'
    ),
    'collx_only_boundary_violations', (select count(*) from public.collx_only_inventory_boundary_violations),
    'duplicate_sale_event_groups', (
      select count(*) from (
        select store_id,event_key from public.collectible_sales group by store_id,event_key having count(*)>1
      ) d
    ),
    'negative_product_quantities', (select count(*) from public.products where quantity<0),
    'negative_inventory_quantities', (select count(*) from public.inventory_items where quantity<0),
    'sold_stock_restoration_violations', (select count(*) from public.products where sold_at is not null and quantity>0),
    'active_zero_guards', (select count(*) from public.ebay_inbound_sale_guards where active and protected_quantity=0),
    'violated_guards', (
      select count(*) from public.ebay_inbound_sale_guards g
      where active and (
        coalesce((select p.quantity from public.products p where p.id=g.legacy_product_id and p.seller_id=g.store_id),0)>g.protected_quantity
        or coalesce((select i.quantity from public.inventory_items i where i.id=g.inventory_item_id),0)>g.protected_quantity
      )
    ),
    'captured_at', now()
  ) receipt;
`, true);
const finalAudit = auditRows?.[0]?.receipt;
if (!finalAudit) throw new Error("Final Production issue #253 data audit returned no receipt.");
const blockers = [];
if (Number(finalAudit.required_relations) !== 8) blockers.push("required sale-history relations are missing");
if (Number(finalAudit.verified_or_manual_missing_actual_price) !== 0) blockers.push("verified/manual sales missing actual sold price");
if (Number(finalAudit.null_price_not_explicitly_unresolved) !== 0) blockers.push("null historical price not explicitly unresolved");
if (Number(finalAudit.historical_sold_products_without_sale_record) !== 0) blockers.push("historical sold product missing sale record");
if (Number(finalAudit.collx_via_linked_ebay_sales) < 1) blockers.push("no persisted indirect eBay/CollX-linked sale evidence");
if (Number(finalAudit.chain_evidence_rows) < 1) blockers.push("no persisted indirect source-chain evidence");
for (const key of [
  "collx_only_boundary_violations",
  "duplicate_sale_event_groups",
  "negative_product_quantities",
  "negative_inventory_quantities",
  "sold_stock_restoration_violations",
  "violated_guards",
]) {
  if (Number(finalAudit[key]) !== 0) blockers.push(`${key}=${finalAudit[key]}`);
}
writeJson("issue253-final-production-data.json", {
  ok: blockers.length === 0,
  exactMainSha: expectedSha,
  receipt: finalAudit,
  maximumPropagationMinutes: {
    completedOrderPoll: 5,
    inactiveFullSync: 15,
    sellerReconciliation: 15,
  },
  failureHandling: {
    manualMarkSoldElsewhereFallback: true,
    inboundSoldStockRestorationBlocked: true,
    directCollxOnlyInventoryExcluded: true,
  },
  blockers,
  realMarketplaceOrderCreatedByAudit: false,
  verifiedAt: new Date().toISOString(),
});
if (blockers.length) throw new Error(`Final issue #253 Production blockers: ${blockers.join("; ")}`);

writeJson("launch2-b30f084-production-certificate.json", {
  ok: true,
  exactMainSha: expectedSha,
  deployment: deploymentReceipt,
  boundaries: boundaryReceipt,
  adminRuntime: {
    navigationPassed: true,
    sessionRefreshPassed: true,
    feeCleanupPassed: true,
    refundConfirmationGuardPassed: true,
    refundIssued: false,
  },
  marketplaceConvergence: marketplaceReceipts.map((entry) => ({ step: entry.step, status: entry.status, success: entry.payload?.success === true })),
  issue253Data: finalAudit,
  prohibitedRealWorldEvidenceCreated: false,
  generatedAt: new Date().toISOString(),
});
fs.writeFileSync(path.join(evidenceDir, "exact-main-sha.txt"), `${expectedSha}\n`);
console.log(`LAUNCH2_B30F084_PRODUCTION_CERTIFICATE=passed:${expectedSha}`);
