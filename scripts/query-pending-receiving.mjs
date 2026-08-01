import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const key = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
if (!url || !key) {
  throw new Error("Production Supabase public read credentials are unavailable.");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: lots, error: lotsError } = await supabase
  .from("tcos_mi_purchase_lots")
  .select(
    "id,purchase_number,purchased_at,status,quantity_purchased,total_acquisition_cost,unit_cost_basis,received_at,source_url,deal_label,notes,metadata,collectible_identity_id,marketplace_id",
  )
  .in("status", ["ordered", "awaiting_receipt"])
  .order("purchase_number", { ascending: true });
if (lotsError) {
  throw new Error(`Unable to read pending purchase lots: ${lotsError.message}`);
}
if (!Array.isArray(lots) || lots.length === 0) {
  throw new Error(
    "The Production anon query returned no pending rows; refusing to report an empty list as authoritative.",
  );
}

const identityIds = Array.from(
  new Set(lots.map((row) => row.collectible_identity_id).filter(Boolean)),
);
const marketplaceIds = Array.from(
  new Set(lots.map((row) => row.marketplace_id).filter(Boolean)),
);
const [identityResult, marketplaceResult] = await Promise.all([
  identityIds.length
    ? supabase
        .from("tcos_mi_collectible_identities")
        .select("id,display_name,identity_key")
        .in("id", identityIds)
    : Promise.resolve({ data: [], error: null }),
  marketplaceIds.length
    ? supabase
        .from("tcos_mi_marketplaces")
        .select("id,name,slug")
        .in("id", marketplaceIds)
    : Promise.resolve({ data: [], error: null }),
]);
if (identityResult.error) {
  throw new Error(`Unable to read collectible identities: ${identityResult.error.message}`);
}
if (marketplaceResult.error) {
  throw new Error(`Unable to read marketplaces: ${marketplaceResult.error.message}`);
}

const identities = new Map((identityResult.data || []).map((row) => [row.id, row]));
const marketplaces = new Map((marketplaceResult.data || []).map((row) => [row.id, row]));
const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const meta = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const firstText = (metadata, keys) => {
  for (const keyName of keys) {
    const value = metadata[keyName];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};
const now = Date.now();

const pending = lots.map((lot) => {
  const metadata = meta(lot.metadata);
  const identity = lot.collectible_identity_id
    ? identities.get(lot.collectible_identity_id) || null
    : null;
  const marketplace = lot.marketplace_id
    ? marketplaces.get(lot.marketplace_id) || null
    : null;
  const purchasedAtMs = new Date(lot.purchased_at).getTime();
  const ageDays = Number.isFinite(purchasedAtMs)
    ? Math.floor((now - purchasedAtMs) / 86_400_000)
    : null;
  return {
    id: lot.id,
    purchaseNumber: n(lot.purchase_number),
    purchasedAt: lot.purchased_at,
    ageDays,
    overdue7Days: ageDays !== null && ageDays >= 7,
    status: lot.status,
    quantity: n(lot.quantity_purchased),
    totalAcquisitionCost: n(lot.total_acquisition_cost),
    unitCostBasis: n(lot.unit_cost_basis),
    receivedAt: lot.received_at,
    title:
      identity?.display_name ||
      firstText(metadata, [
        "original_title",
        "item_title",
        "listing_title",
        "purchase_title",
        "title",
      ]) ||
      "Unmatched collectible",
    identityKey: identity?.identity_key || null,
    marketplace:
      marketplace?.name ||
      firstText(metadata, [
        "acquisition_source_name",
        "marketplace_name",
        "source_name",
      ]) ||
      "Unknown source",
    seller: firstText(metadata, [
      "seller_name",
      "seller",
      "ebay_seller",
      "source_seller",
    ]),
    orderNumber: firstText(metadata, [
      "order_number",
      "external_order_id",
      "ebay_order_id",
      "order_id",
    ]),
    itemNumber: firstText(metadata, [
      "item_number",
      "external_listing_id",
      "ebay_item_id",
      "listing_id",
    ]),
    trackingNumber: firstText(metadata, [
      "tracking_number",
      "tracking",
      "shipment_tracking",
    ]),
    sourceUrl: lot.source_url,
    dealLabel: lot.deal_label,
    notes: lot.notes,
  };
});

const totals = {
  pendingLots: pending.length,
  pendingUnits: pending.reduce((sum, row) => sum + row.quantity, 0),
  pendingCost: Number(
    pending.reduce((sum, row) => sum + row.totalAcquisitionCost, 0).toFixed(2),
  ),
  overdue7DayLots: pending.filter((row) => row.overdue7Days).length,
};
const payload = {
  schema: "TCOS_PENDING_RECEIVING_AUDIT_V3",
  generatedAt: new Date().toISOString(),
  source: "Production Supabase anon read",
  totals,
  pending,
};
const money = (value) => `$${n(value).toFixed(2)}`;
const lines = [
  "# TCOS Pending Receiving — Production Read",
  "",
  `Generated: ${payload.generatedAt}`,
  `Pending lots: ${totals.pendingLots}`,
  `Pending units: ${totals.pendingUnits}`,
  `Pending delivered basis: ${money(totals.pendingCost)}`,
  `7+ day overdue lots: ${totals.overdue7DayLots}`,
  "",
];
for (const row of pending) {
  lines.push(
    `## Purchase #${row.purchaseNumber} — ${row.title}`,
    `- Status: ${row.status}`,
    `- Age: ${row.ageDays ?? "Unknown"} days${row.overdue7Days ? " — 7+ DAYS OVERDUE" : ""}`,
    `- Quantity: ${row.quantity}`,
    `- Delivered basis: ${money(row.totalAcquisitionCost)}`,
    `- Unit basis: ${money(row.unitCostBasis)}`,
    `- Marketplace/source: ${row.marketplace}`,
    `- Purchased: ${row.purchasedAt}`,
    `- Seller: ${row.seller || "Not recorded"}`,
    `- Order: ${row.orderNumber || "Not recorded"}`,
    `- Item: ${row.itemNumber || "Not recorded"}`,
    `- Tracking: ${row.trackingNumber || "Not recorded"}`,
    `- URL: ${row.sourceUrl || "Not recorded"}`,
    `- Notes: ${row.notes || "None"}`,
    "",
  );
}
await mkdir("audit", { recursive: true });
await writeFile(
  "audit/pending-receiving-current.json",
  `${JSON.stringify(payload, null, 2)}\n`,
);
await writeFile(
  "audit/pending-receiving-current.md",
  `${lines.join("\n")}\n`,
);
console.log(JSON.stringify({ ok: true, ...totals }));
