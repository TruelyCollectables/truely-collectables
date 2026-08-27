import { mkdir, writeFile } from "node:fs/promises";

const origin = String(process.env.NEXT_PUBLIC_SITE_URL || "https://truelycollectables.com")
  .replace(/\/$/, "");
const secret = [
  process.env.PENDING_RECEIVING_READ_SECRET,
  process.env.PROFIT_HUNTER_RUN_SECRET,
  process.env.MARKET_INTEL_INGEST_SECRET,
  process.env.CRON_SECRET,
]
  .map((value) => String(value || "").trim())
  .find(Boolean);

if (!secret) {
  throw new Error("No authorized Production server-read secret is available.");
}

const statusUrl = `${origin}/api/internal/pending-receiving?statusOnly=1`;
let statusPayload = null;
for (let attempt = 1; attempt <= 24; attempt += 1) {
  const response = await fetch(`${statusUrl}&attempt=${attempt}&ts=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  statusPayload = await response.json().catch(() => null);
  if (
    response.ok &&
    statusPayload?.code === "PENDING_RECEIVING_LEDGER_READ_READY"
  ) {
    break;
  }
  if (attempt === 24) {
    throw new Error(
      `Pending receiving Production route did not become ready: ${response.status} ${JSON.stringify(statusPayload)}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const response = await fetch(
  `${origin}/api/internal/pending-receiving?ts=${Date.now()}`,
  {
    headers: {
      "x-market-intel-key": secret,
      Authorization: `Bearer ${secret}`,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  },
);
const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.ok || !Array.isArray(payload.pending)) {
  throw new Error(
    `Protected pending receiving read failed: ${response.status} ${JSON.stringify(payload)}`,
  );
}

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => `$${n(value).toFixed(2)}`;
const lines = [
  "# TCOS Pending Receiving — Production Read",
  "",
  `Generated: ${payload.generatedAt}`,
  `Pending lots: ${payload.totals?.pendingLots ?? payload.pending.length}`,
  `Pending units: ${payload.totals?.pendingUnits ?? 0}`,
  `Pending delivered basis: ${money(payload.totals?.pendingCost)}`,
  `7+ day overdue lots: ${payload.totals?.overdue7DayLots ?? 0}`,
  `Production commit: ${statusPayload?.deployment?.commitSha || "Unknown"}`,
  "",
];

for (const row of payload.pending) {
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

const auditPayload = {
  schema: "TCOS_PENDING_RECEIVING_AUDIT_V2",
  status: statusPayload,
  ...payload,
};
await mkdir("audit", { recursive: true });
await writeFile(
  "audit/pending-receiving-current.json",
  `${JSON.stringify(auditPayload, null, 2)}\n`,
);
await writeFile(
  "audit/pending-receiving-current.md",
  `${lines.join("\n")}\n`,
);
console.log(
  JSON.stringify({
    ok: true,
    pendingLots: payload.totals?.pendingLots ?? payload.pending.length,
    pendingUnits: payload.totals?.pendingUnits ?? 0,
    overdue7DayLots: payload.totals?.overdue7DayLots ?? 0,
    productionCommit: statusPayload?.deployment?.commitSha || null,
  }),
);
