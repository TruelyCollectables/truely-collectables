import fs from "node:fs";

const envFile = process.env.LAUNCH_ENV_FILE || ".env.storefront.production";
const outputFile = process.env.LIVE_MONEY_DB_PREFLIGHT_OUTPUT || "live-money-database-preflight.json";
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();

function parseDotEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}
function rows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}
async function query(projectRef, sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: sql, parameters: [] }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`Supabase read-only query failed with HTTP ${response.status}.`);
  return rows(body);
}

if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is missing.");
const env = parseDotEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "");
let projectRef = null;
try { projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]; } catch {}
if (!projectRef) throw new Error("Could not derive Supabase project ref.");

const result = await query(projectRef, `
with active_store as (
  select id, seller_commission_rate
    from public.store_settings
   order by created_at asc nulls last
   limit 1
), latest_e2e as (
  select run_status, scenario_count, passed_count, failed_count, completed_at
    from public.payment_simulation_runs
   where store_id = (select id from active_store)
     and run_mode = 'checkout_e2e'
   order by created_at desc
   limit 1
), gate as (
  select gate_status, approval_version, approved_at, approved_by
    from public.live_payment_launch_gates
   where store_id = (select id from active_store)
   limit 1
)
select
  (select id::text from active_store) as store_id,
  (select seller_commission_rate from active_store) as seller_commission_rate,
  (select count(*) from public.stripe_reconciliation_items where store_id = (select id from active_store) and item_status = 'open') as open_reconciliation_items,
  (select count(*) from public.orders where store_id = (select id from active_store) and is_test = true) as test_orders,
  (select count(*) from public.products where store_id = (select id from active_store) and title like '[TCOS TEST]%') as test_products,
  (select count(*) from public.order_shipping_labels where store_id = (select id from active_store) and (coalesce(provider_label_id,'') like 'dry_run:%' or coalesce(provider_shipment_id,'') like 'dry_run:%' or coalesce(tracking_number,'') like 'DRYRUN-%' or coalesce(coverage_policy_id,'') like 'dry_run:%')) as dry_run_labels,
  (select count(*) from public.order_shipping_tracking_events where store_id = (select id from active_store) and (event_type = 'provider_purchase_simulated' or coalesce(tracking_number,'') like 'DRYRUN-%')) as dry_run_events,
  (select count(*) from public.orders where store_id = (select id from active_store) and coalesce(tracking_number,'') like 'DRYRUN-%') as dry_run_orders,
  (select count(*) from public.seller_payout_accounts where store_id = (select id from active_store) and provider = 'stripe_connect' and provider_account_id like 'acct_%' and not (onboarding_status = 'complete' and payouts_enabled = true and details_submitted = true)) as incomplete_external_sellers,
  (select run_status from latest_e2e) as e2e_run_status,
  (select scenario_count from latest_e2e) as e2e_scenario_count,
  (select passed_count from latest_e2e) as e2e_passed_count,
  (select failed_count from latest_e2e) as e2e_failed_count,
  (select completed_at from latest_e2e) as e2e_completed_at,
  (select gate_status from gate) as gate_status,
  (select approval_version from gate) as approval_version,
  (select approved_at from gate) as approved_at,
  (select approved_by from gate) as approved_by,
  (select count(*) from public.live_payment_launch_events where store_id = (select id from active_store)) as gate_event_count,
  (select relrowsecurity from pg_class where oid = 'public.public_endpoint_rate_limit_events'::regclass) as rate_limit_rls_enabled,
  (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='public_endpoint_rate_limit_events' and grantee in ('anon','authenticated','PUBLIC')) as public_rate_limit_grant_count,
  to_regclass('public.checkout_inventory_reservations') is not null as reservations_table_ready,
  to_regclass('public.order_inventory_consumptions') is not null as consumption_table_ready,
  to_regclass('public.order_notification_deliveries') is not null as notification_outbox_ready,
  to_regclass('public.order_buyer_protections') is not null as buyer_protection_ready;
`);
if (result.length !== 1) throw new Error(`Expected one preflight row, received ${result.length}.`);
const row = result[0];
const number = (value) => Number(value || 0);
const fee = Number(row.seller_commission_rate || 0);
const checks = [
  { key: "platform_fee", passed: Math.abs(fee - 0.08) < 0.000001, detail: `seller_commission_rate=${fee}` },
  { key: "reconciliation", passed: number(row.open_reconciliation_items) === 0, detail: `${number(row.open_reconciliation_items)} open item(s)` },
  { key: "test_orders", passed: number(row.test_orders) === 0, detail: `${number(row.test_orders)} test order(s)` },
  { key: "test_products", passed: number(row.test_products) === 0, detail: `${number(row.test_products)} test product(s)` },
  { key: "dry_run_shipping", passed: number(row.dry_run_labels) + number(row.dry_run_events) + number(row.dry_run_orders) === 0, detail: `${number(row.dry_run_labels)} label(s), ${number(row.dry_run_events)} event(s), ${number(row.dry_run_orders)} order(s)` },
  { key: "external_sellers", passed: number(row.incomplete_external_sellers) === 0, detail: `${number(row.incomplete_external_sellers)} incomplete external seller(s)` },
  { key: "checkout_e2e", passed: row.e2e_run_status === "passed" && number(row.e2e_scenario_count) >= 8 && number(row.e2e_failed_count) === 0, detail: `${row.e2e_run_status || "none"}; ${number(row.e2e_passed_count)}/${number(row.e2e_scenario_count)} passed; ${number(row.e2e_failed_count)} failed` },
  { key: "approval_tables", passed: number(row.gate_event_count) >= 0 && Boolean(row.approval_version || row.gate_status), detail: `gate=${row.gate_status || "missing"}; version=${row.approval_version || "missing"}; events=${number(row.gate_event_count)}` },
  { key: "rate_limit_privacy", passed: row.rate_limit_rls_enabled === true && number(row.public_rate_limit_grant_count) === 0, detail: `rls=${row.rate_limit_rls_enabled}; public_grants=${number(row.public_rate_limit_grant_count)}` },
  { key: "reservation_schema", passed: row.reservations_table_ready === true && row.consumption_table_ready === true, detail: `reservations=${row.reservations_table_ready}; consumptions=${row.consumption_table_ready}` },
  { key: "notification_outbox", passed: row.notification_outbox_ready === true, detail: `ready=${row.notification_outbox_ready}` },
  { key: "buyer_protection", passed: row.buyer_protection_ready === true, detail: `ready=${row.buyer_protection_ready}` },
];
const payload = {
  schema: "truelyCollectables.liveMoneyDatabasePreflight.v1",
  generatedAt: new Date().toISOString(),
  storeIdFingerprint: row.store_id ? `${String(row.store_id).slice(0,4)}...${String(row.store_id).slice(-4)}` : null,
  passedCount: checks.filter((item) => item.passed).length,
  failedCount: checks.filter((item) => !item.passed).length,
  checks,
  gate: { status: row.gate_status || null, approvalVersion: row.approval_version || null, approvedAt: row.approved_at || null, approvedBy: row.approved_by || null },
  readyForStripeVerification: checks.filter((item) => !["checkout_e2e", "approval_tables"].includes(item.key)).every((item) => item.passed),
  secretValuesIncluded: false,
  readOnlyGuarantee: "This preflight performs read-only SQL only. No cleanup, approval, migration, deployment, payment, refund, payout, postage purchase, or runtime switch occurs.",
};
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`Live-money database preflight: ${payload.passedCount} passed, ${payload.failedCount} failed.`);
