import { mkdir, writeFile } from "node:fs/promises";

const origin = String(
  process.env.NEXT_PUBLIC_SITE_URL || "https://truelycollectables.com",
).replace(/\/$/, "");
const secret = String(process.env.PENDING_RECEIVING_READ_SECRET || "").trim();
if (!secret) throw new Error("The protected receiving secret is unavailable.");

const statusUrl = `${origin}/api/internal/pending-receiving?statusOnly=1`;
let statusPayload = null;
for (let attempt = 1; attempt <= 30; attempt += 1) {
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
  if (attempt === 30) {
    throw new Error(
      `Production receiving route did not become ready: ${response.status} ${JSON.stringify(statusPayload)}`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const response = await fetch(
  `${origin}/api/internal/pending-receiving?receiveAll=1&ts=${Date.now()}`,
  {
    method: "POST",
    headers: {
      "x-market-intel-key": secret,
      Authorization: `Bearer ${secret}`,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "receive_all_pending" }),
  },
);
const payload = await response.json().catch(() => null);
if (!response.ok || !payload?.ok || !payload?.portfolio) {
  throw new Error(
    `Receive-all Production request failed: ${response.status} ${JSON.stringify(payload)}`,
  );
}
if (Number(payload.receipt?.remainingPendingLots || 0) !== 0) {
  throw new Error(
    `Receipt verification failed: ${payload.receipt?.remainingPendingLots} pending lots remain.`,
  );
}

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (value) => `$${n(value).toFixed(2)}`;
const pct = (value) =>
  value === null || value === undefined
    ? "Not available"
    : `${n(value) > 0 ? "+" : ""}${n(value).toFixed(1)}%`;
const totals = payload.portfolio.totals || {};
const lines = [
  "# TCOS Received Purchases and Portfolio — Production Verification",
  "",
  `Generated: ${payload.generatedAt}`,
  `Production commit: ${payload.deployment?.commitSha || "Unknown"}`,
  `Result: ${payload.code}`,
  "",
  "## Receipt completion",
  "",
  `- Lots received: ${payload.receipt?.lotsReceived ?? 0}`,
  `- Units received: ${payload.receipt?.unitsReceived ?? 0}`,
  `- Delivered cost received: ${money(payload.receipt?.deliveredCostReceived)}`,
  `- Pending lots remaining: ${payload.receipt?.remainingPendingLots ?? 0}`,
  `- Received at: ${payload.receipt?.receivedAt || "Unknown"}`,
  "",
];

for (const row of payload.receipt?.receivedLots || []) {
  lines.push(
    `- Purchase #${row.purchaseNumber}: ${row.title} — ${row.quantity} unit${row.quantity === 1 ? "" : "s"}, ${money(row.deliveredCost)}, ${row.previousStatus} → ${row.newStatus}`,
  );
}

lines.push(
  "",
  "## Portfolio totals",
  "",
  `- Positions: ${totals.positions ?? 0}`,
  `- Units purchased: ${totals.unitsPurchased ?? 0}`,
  `- Units remaining: ${totals.unitsRemaining ?? 0}`,
  `- Units sold: ${totals.unitsSold ?? 0}`,
  `- Total invested: ${money(totals.invested)}`,
  `- Estimated market value: ${money(totals.estimatedMarketValue)}`,
  `- Positions with current market values: ${totals.marketValuedPositions ?? 0}`,
  `- Realized net proceeds: ${money(totals.realizedNetProceeds)}`,
  `- Realized gross profit: ${money(totals.realizedGrossProfit)}`,
  `- Resale cost basis: ${money(totals.strategyCostBasis?.resale)}`,
  `- Hold / investment cost basis: ${money(totals.strategyCostBasis?.hold)}`,
  `- Personal collection cost basis: ${money(totals.strategyCostBasis?.pc)}`,
  "",
  "## Portfolio positions",
  "",
);

for (const position of payload.portfolio.positions || []) {
  lines.push(
    `### Purchase #${position.purchaseNumber} — ${position.title}`,
    `- Status: ${position.status}`,
    `- Strategy: ${String(position.strategy || "unknown").toUpperCase()}`,
    `- Source: ${position.source || "Unknown"}`,
    `- Quantity: ${position.quantityRemaining} remaining of ${position.quantityPurchased}`,
    `- Cost basis: ${money(position.totalCostBasis)} total / ${money(position.unitCostBasis)} each`,
    `- Current market: ${position.currentUnitMarketValue === null ? "No defensible exact-card value" : `${money(position.currentUnitMarketValue)} each / ${money(position.estimatedRemainingMarketValue)} remaining value`}`,
    `- Market evidence: ${position.marketSampleSize || 0} comps / ${n(position.marketConfidence).toFixed(0)}% confidence`,
    `- 7-day move: ${pct(position.weeklyChangePct)}`,
    `- Since purchase: ${pct(position.sincePurchaseChangePct)}`,
    `- TCOS signal: ${position.signal?.label || "Not available"}`,
    `- Realized net proceeds: ${money(position.realizedNetProceeds)}`,
    `- Realized gross profit: ${money(position.realizedGrossProfit)}`,
    "",
  );
}

await mkdir("audit", { recursive: true });
await writeFile(
  "audit/received-and-portfolio-current.json",
  `${JSON.stringify(payload, null, 2)}\n`,
);
await writeFile(
  "audit/received-and-portfolio-current.md",
  `${lines.join("\n")}\n`,
);
console.log(
  JSON.stringify({
    ok: true,
    lotsReceived: payload.receipt?.lotsReceived ?? 0,
    unitsReceived: payload.receipt?.unitsReceived ?? 0,
    pendingLotsRemaining: payload.receipt?.remainingPendingLots ?? null,
    positions: totals.positions ?? 0,
    invested: totals.invested ?? 0,
  }),
);
