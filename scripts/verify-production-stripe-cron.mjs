import fs from "node:fs";

const secret = String(process.env.TCOS_CRON_SECRET || "").trim();
const outputFile = process.env.STRIPE_CRON_VERIFY_OUTPUT || "production-stripe-cron-verification.json";

if (!secret) {
  throw new Error("TCOS_CRON_SECRET is missing.");
}

const response = await fetch(
  "https://truelycollectables.com/api/cron/stripe-reconciliation",
  {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(90_000),
  },
);

const raw = await response.text();
let body = null;
try {
  body = raw ? JSON.parse(raw) : null;
} catch {
  body = null;
}

const evidence = {
  checkedAt: new Date().toISOString(),
  httpStatus: response.status,
  success: body?.success === true,
  error: typeof body?.error === "string" ? body.error : null,
  runIdPresent: Boolean(body?.runId || body?.run_id),
  itemCount: Number(body?.itemCount ?? body?.item_count ?? body?.items?.length ?? 0),
  discrepancyCount: Number(
    body?.discrepancyCount ?? body?.discrepancy_count ?? 0,
  ),
  secretValuesIncluded: false,
};

fs.writeFileSync(outputFile, `${JSON.stringify(evidence, null, 2)}\n`, {
  mode: 0o600,
});

console.log(
  `Protected Production Stripe verification returned HTTP ${response.status}; success=${evidence.success}.`,
);

if (!response.ok || body?.success !== true) {
  process.exitCode = 1;
}
