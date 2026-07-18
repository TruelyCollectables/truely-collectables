import { readFile } from "node:fs/promises";

const sources = {
  request: await readFile(
    new URL("../src/app/admin/seller-payouts/PayoutRequestActions.tsx", import.meta.url),
    "utf8",
  ),
  ledger: await readFile(
    new URL("../src/app/admin/seller-payouts/PayoutLedgerActions.tsx", import.meta.url),
    "utf8",
  ),
  connect: await readFile(
    new URL("../src/app/admin/seller-payouts/ConnectRefreshActions.tsx", import.meta.url),
    "utf8",
  ),
};

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("payout request actions expose specific busy labels", () => {
  for (const fragment of [
    "const actionLabel = (nextStatus: PayoutStatus)",
    "Marking paid",
    "Moving to",
    'aria-busy={loading === "approved"}',
    'aria-busy={loading === "paid"}',
    "function payoutActionBlockedReason(nextStatus: PayoutStatus)",
    "function showPayoutActionBlocked(nextStatus: PayoutStatus)",
    "function guardedUpdateStatus(nextStatus: PayoutStatus)",
    "const payoutActionRunningRef = useRef(false)",
    "payoutActionRunningRef.current = true",
    "payoutActionRunningRef.current = false",
    "Finish the current payout request action before starting another one.",
    "Only requested payout requests can be approved.",
    "Only approved payout requests can move to processing.",
    "Only processing payout requests can be marked paid.",
    "aria-disabled={",
    'onClick={() => guardedUpdateStatus("approved")}',
    'onClick={() => guardedUpdateStatus("paid")}',
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
  ]) {
    assert(
      sources.request.includes(fragment),
      `Expected payout request feedback fragment ${fragment}.`,
    );
  }
});

scenario("payout ledger actions expose specific busy labels", () => {
  for (const fragment of [
    "const actionLabel = (nextStatus: LedgerStatus)",
    'nextStatus.replaceAll("_", " ")',
    'aria-busy={loading === "eligible"}',
    'aria-busy={loading === "reversed"}',
    "function ledgerActionBlockedReason(nextStatus: LedgerStatus)",
    "function showLedgerActionBlocked(nextStatus: LedgerStatus)",
    "function guardedUpdateStatus(nextStatus: LedgerStatus)",
    "const ledgerActionRunningRef = useRef(false)",
    "ledgerActionRunningRef.current = true",
    "ledgerActionRunningRef.current = false",
    "Finish the current payout ledger action before starting another one.",
    "This payout ledger row is already eligible.",
    "This payout ledger row is already on review hold.",
    "This payout ledger row is already held for fulfillment.",
    "aria-disabled={",
    'onClick={() => guardedUpdateStatus("eligible")}',
    'onClick={() => guardedUpdateStatus("reversed")}',
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
  ]) {
    assert(
      sources.ledger.includes(fragment),
      `Expected payout ledger feedback fragment ${fragment}.`,
    );
  }
});

scenario("connect refresh action exposes accessible busy and live feedback", () => {
  for (const fragment of [
    "Refreshing Stripe Connect statuses...",
    'aria-busy={loading}',
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
  ]) {
    assert(
      sources.connect.includes(fragment),
      `Expected connect refresh feedback fragment ${fragment}.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin seller payout action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
