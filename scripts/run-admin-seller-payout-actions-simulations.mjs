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
  page: await readFile(
    new URL("../src/app/admin/seller-payouts/page.tsx", import.meta.url),
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
    "function payoutActionReadyTitle(nextStatus: PayoutStatus)",
    "function payoutActionTitle(nextStatus: PayoutStatus)",
    "Approve this seller payout request after account and review checks pass.",
    "Mark this processing payout request paid with provider payout proof.",
    "Reject this payout request with an audit note.",
    'title={payoutActionTitle("approved")}',
    'title={payoutActionTitle("paid")}',
    'title={payoutActionTitle("cancelled")}',
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
    "function ledgerActionReadyTitle(nextStatus: LedgerStatus)",
    "function ledgerActionTitle(nextStatus: LedgerStatus)",
    "Release this payout ledger row after fulfillment and review checks pass.",
    "Move this payout ledger row onto review hold with an audit note.",
    "Reverse this payout ledger row with an audit note.",
    'title={ledgerActionTitle("eligible")}',
    'title={ledgerActionTitle("hold_pending_fulfillment")}',
    'title={ledgerActionTitle("cancelled")}',
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
    "connectRefreshRunningRef",
    "disabledReason?: string;",
    "Finish the current Stripe Connect refresh first.",
    "Stripe Connect refresh is unavailable until payout accounts load.",
    "Refresh seller Stripe Connect onboarding and payout statuses.",
    "Refreshing Stripe Connect statuses...",
    'aria-busy={loading}',
    "aria-disabled={disabled || loading}",
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
  ]) {
    assert(
      sources.connect.includes(fragment),
      `Expected connect refresh feedback fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "disabledReason={",
    "Fix the seller payout account load error before refreshing Stripe Connect statuses.",
    "No seller Connect accounts have started payout onboarding yet.",
  ]) {
    assert(
      sources.page.includes(fragment),
      `Expected seller payout page to wire connect refresh reason ${fragment}.`,
    );
  }
});

scenario("seller payout page does not show false-empty payout queues", () => {
  for (const fragment of [
    "function safeErrorMessage",
    "const payoutLedgerUnavailable = Boolean(error)",
    "const platformFeeLedgerUnavailable = Boolean(platformFeeError)",
    "const payoutRequestsUnavailable = Boolean(payoutRequestError)",
    "const payoutAccountsUnavailable = Boolean(payoutAccountError)",
    "const payoutAdminEventsUnavailable = Boolean(adminEventError)",
    "safeErrorMessage(error)",
    "safeErrorMessage(platformFeeError)",
    "safeErrorMessage(payoutRequestError)",
    "safeErrorMessage(payoutAccountError)",
    "safeErrorMessage(adminEventError)",
    "Seller Connect account list unavailable",
    "Payout audit trail unavailable",
    "Seller cash-out requests unavailable",
    "Platform fee ledger unavailable",
    "Seller payout ledger unavailable",
    "Protection reserve unavailable",
    "sourceUnavailable={payoutLedgerUnavailable}",
    '? "Unavailable"',
    "whether payout accounts exist",
    "whether release, hold, or cash-out audit events exist",
    "whether sellers are waiting on payout review",
    "whether TCOS checkout fee rows exist",
    "whether held, eligible, paid, or reversed payout rows",
  ]) {
    assert(
      sources.page.includes(fragment),
      `Expected seller payout unavailable-state fragment ${fragment}.`,
    );
  }

  for (const [unavailable, empty, label] of [
    [
      "Seller Connect account list unavailable",
      "No seller Connect accounts have started payout onboarding yet.",
      "Connect accounts",
    ],
    [
      "Payout audit trail unavailable",
      "No payout audit events recorded yet.",
      "audit events",
    ],
    [
      "Seller cash-out requests unavailable",
      "No seller cash-out requests found.",
      "cash-out requests",
    ],
    [
      "Platform fee ledger unavailable",
      "No platform fee ledger entries found yet.",
      "platform fees",
    ],
    [
      "Seller payout ledger unavailable",
      "No seller payout ledger entries found yet.",
      "payout ledger",
    ],
  ]) {
    const unavailableIndex = sources.page.indexOf(unavailable);
    const emptyIndex = sources.page.indexOf(empty, unavailableIndex);

    assert(unavailableIndex >= 0, `Expected ${label} unavailable state.`);
    assert(emptyIndex >= 0, `Expected ${label} empty state.`);
    assert(
      unavailableIndex < emptyIndex,
      `Expected ${label} unavailable state to render before its empty state.`,
    );
  }
});

scenario("seller payout page uses professional money-desk presentation", () => {
  for (const fragment of [
    "Seller Money Desk",
    "Connect readiness",
    "Cash-out controls",
    "Audit protected",
    "rounded-full bg-amber-300",
    "transition hover:-translate-y-0.5",
    "rounded-3xl border border-amber-200 bg-amber-50",
    "rounded-2xl border border-neutral-200 bg-white/90",
    "overflow-hidden rounded-3xl border border-neutral-200 bg-white/90",
    "shadow-sm ring-1 ring-black/[0.02]",
    "rounded-full border border-current/20",
  ]) {
    assert(
      sources.page.includes(fragment),
      `Expected seller payout professional presentation fragment ${fragment}.`,
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
