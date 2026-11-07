import Link from "next/link";
import { getEbayPurchaseInbox } from "../../../../../lib/market-intel-ebay-purchase-inbox";
import { getPurchaseLedgerIntelligence } from "../../../../../lib/market-intel-purchase-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CapitalDisplayRow = {
  key: string;
  kind: "canonical" | "purchase_inbox";
  purchasedAt: string;
  badge: string;
  title: string;
  cost: number;
  unitCost: number;
  quantity: number;
  signal: string;
  href: string;
  actionLabel: string;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(value: string | null | undefined) {
  const parsed = new Date(String(value || "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mountainDate(value: string | null | undefined, includeTime = false) {
  const parsed = new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime
      ? {
          hour: "numeric" as const,
          minute: "2-digit" as const,
          timeZoneName: "short" as const,
        }
      : {}),
  }).format(parsed);
}

export default async function KingmakerCapitalLedgerPage() {
  const generatedAt = new Date().toISOString();
  const [ledgerResult, inboxResult] = await Promise.all([
    getPurchaseLedgerIntelligence()
      .then((rows) => ({ ok: true as const, rows }))
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      })),
    getEbayPurchaseInbox()
      .then((rows) => ({ ok: true as const, rows }))
      .catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  const rows = ledgerResult.ok ? ledgerResult.rows : [];
  const inboxRows = inboxResult.ok ? inboxResult.rows : [];
  const sourceReady = ledgerResult.ok && inboxResult.ok;

  const linkedInboxIds = new Set(
    rows
      .map((row) => String(row.lot.metadata?.["purchase_inbox_id"] || "").trim())
      .filter(Boolean),
  );

  const unlinkedPurchases = inboxRows.filter(
    (row) =>
      row.target_bucket !== "skip" &&
      row.status !== "skipped" &&
      !row.purchase_lot_id &&
      !linkedInboxIds.has(row.id),
  );

  const canonicalTotals = rows.reduce(
    (sum, row) => {
      const remaining = numberValue(
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
      );
      sum.invested += numberValue(row.lot.total_acquisition_cost);
      sum.realizedNet += numberValue(row.performance?.realized_net_proceeds);
      sum.realizedProfit += numberValue(row.performance?.realized_gross_profit);
      sum.unitsRemaining += remaining;
      if (
        row.current_market?.conservative_value !== null &&
        row.current_market
      ) {
        sum.currentValue +=
          numberValue(row.current_market.conservative_value) * remaining;
      }
      return sum;
    },
    {
      invested: 0,
      realizedNet: 0,
      realizedProfit: 0,
      unitsRemaining: 0,
      currentValue: 0,
    },
  );

  const inboxTotals = unlinkedPurchases.reduce(
    (sum, row) => {
      sum.invested += numberValue(row.total_paid);
      sum.unitsRemaining += numberValue(row.quantity);
      return sum;
    },
    { invested: 0, unitsRemaining: 0 },
  );

  const totals = {
    invested: canonicalTotals.invested + inboxTotals.invested,
    realizedNet: canonicalTotals.realizedNet,
    realizedProfit: canonicalTotals.realizedProfit,
    unitsRemaining: canonicalTotals.unitsRemaining + inboxTotals.unitsRemaining,
    currentValue: canonicalTotals.currentValue,
  };

  const resale =
    rows.filter((row) => row.bucket === "resale").length +
    unlinkedPurchases.filter((row) => row.target_bucket === "resale").length;
  const hold =
    rows.filter((row) => row.bucket === "hold").length +
    unlinkedPurchases.filter((row) => row.target_bucket === "hold").length;
  const personal = rows.filter((row) => row.bucket === "pc").length;
  const researchDebt =
    rows.filter((row) =>
      ["needs_comps", "low_confidence"].includes(row.signal.key),
    ).length + unlinkedPurchases.length;
  const positions = rows.length + unlinkedPurchases.length;

  const latestPurchaseAt = [
    ...rows.map((row) => row.lot.purchased_at),
    ...unlinkedPurchases.map((row) => row.purchased_at),
  ].sort((left, right) => timestamp(right) - timestamp(left))[0];

  const displayRows: CapitalDisplayRow[] = [
    ...rows.map((row): CapitalDisplayRow => {
      const quantity = Math.max(
        1,
        numberValue(
          row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
        ),
      );
      return {
        key: `lot-${row.lot.id}`,
        kind: "canonical",
        purchasedAt: row.lot.purchased_at,
        badge: `Purchase #${row.lot.purchase_number}`,
        title:
          row.lot.collectible?.display_name || "Unresolved collectible position",
        cost: numberValue(row.lot.total_acquisition_cost),
        unitCost: numberValue(row.lot.unit_cost_basis),
        quantity,
        signal: row.signal.label,
        href: `/admin/market-intel/purchases/${row.lot.id}`,
        actionLabel: "Open Position",
      };
    }),
    ...unlinkedPurchases.map((row): CapitalDisplayRow => {
      const quantity = Math.max(1, numberValue(row.quantity));
      const movedToReview = row.status === "moved_to_review";
      return {
        key: `inbox-${row.id}`,
        kind: "purchase_inbox",
        purchasedAt: row.purchased_at,
        badge: movedToReview ? "Purchase Inbox · Exact Review" : "Purchase Inbox",
        title: row.title || `${row.player_name} purchase`,
        cost: numberValue(row.total_paid),
        unitCost: numberValue(row.total_paid) / quantity,
        quantity,
        signal: movedToReview ? "EXACT IDENTITY REVIEW" : "AWAITING EXACT IDENTITY",
        href:
          movedToReview && row.identity_candidate_id
            ? `/admin/market-intel/discovery?from=purchase-inbox#candidate-${row.identity_candidate_id}`
            : "/admin/market-intel/purchases/ebay-intake",
        actionLabel: movedToReview ? "Open Exact Review" : "Open Purchase Inbox",
      };
    }),
  ]
    .sort((left, right) => timestamp(right.purchasedAt) - timestamp(left.purchasedAt))
    .slice(0, 15);

  const sourceErrors = [
    !ledgerResult.ok ? `Purchase Ledger: ${ledgerResult.error}` : null,
    !inboxResult.ok ? `Purchase Inbox: ${inboxResult.error}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <main className="min-h-screen bg-[#05070a] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_5%,rgba(16,185,129,.14),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(217,119,6,.17),transparent_28%),linear-gradient(180deg,#070b10,#020304)]" />
      <div className="relative mx-auto max-w-[1650px]">
        <header className="rounded-[2rem] border border-white/10 bg-black/70 p-6 shadow-2xl backdrop-blur-xl lg:p-9">
          <Link
            href="/admin/market-intel/kingmaker"
            className="inline-flex rounded-full border border-white/15 bg-white/[.06] px-4 py-2 text-xs font-black uppercase tracking-[.16em] text-neutral-200 hover:bg-white/10"
          >
            ← Project KINGMAKER Beta 1.0
          </Link>
          <p className="mt-7 text-xs font-black uppercase tracking-[.3em] text-amber-300">
            Capital Ledger
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-6xl">
            Purchase Ledger Command
          </h1>
          <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">
            Live capital truth across canonical Purchase Ledger positions plus confirmed Purchase
            Inbox rows still waiting for exact-card promotion. Pending identity work can no longer
            make deployed capital look stale.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[.12em]">
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-emerald-200">
              Refreshed {mountainDate(generatedAt, true)}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[.05] px-3 py-2 text-neutral-300">
              Latest purchase {latestPurchaseAt ? mountainDate(latestPurchaseAt) : "none loaded"}
            </span>
            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-amber-200">
              {unlinkedPurchases.length} awaiting canonical promotion
            </span>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Capital Deployed"
              value={sourceReady ? money(totals.invested) : "—"}
            />
            <Metric
              label="Verified Value"
              value={sourceReady ? money(totals.currentValue) : "—"}
            />
            <Metric
              label="Realized Net"
              value={sourceReady ? money(totals.realizedNet) : "—"}
            />
            <Metric
              label="Realized Profit"
              value={sourceReady ? money(totals.realizedProfit) : "—"}
            />
            <Metric
              label="Units Remaining"
              value={sourceReady ? String(totals.unitsRemaining) : "—"}
            />
            <Metric label="Tracked Positions" value={sourceReady ? String(positions) : "—"} />
          </div>
        </header>

        {!sourceReady ? (
          <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5">
            <p className="text-xs font-black uppercase tracking-[.2em] text-rose-300">
              Truth Gate Failure
            </p>
            <h2 className="mt-1 text-2xl font-black">Portfolio totals withheld</h2>
            <p className="mt-2 font-semibold text-rose-100/80">
              The live page now refuses to present an old partial total when either purchase
              source cannot be read.
            </p>
            <div className="mt-3 space-y-1 text-sm font-bold text-rose-100/80">
              {sourceErrors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          </section>
        ) : null}

        {sourceReady ? (
          <section
            className={`mt-5 rounded-2xl border p-5 ${
              unlinkedPurchases.length > 0
                ? "border-amber-300/30 bg-amber-300/10"
                : "border-emerald-400/25 bg-emerald-400/10"
            }`}
          >
            <p
              className={`text-xs font-black uppercase tracking-[.2em] ${
                unlinkedPurchases.length > 0 ? "text-amber-200" : "text-emerald-200"
              }`}
            >
              Live Purchase Bridge
            </p>
            {unlinkedPurchases.length > 0 ? (
              <>
                <h2 className="mt-1 text-2xl font-black">
                  {unlinkedPurchases.length} newer purchased line
                  {unlinkedPurchases.length === 1 ? " is" : "s are"} still outside the canonical
                  ledger
                </h2>
                <p className="mt-2 max-w-5xl font-semibold text-amber-50/80">
                  Their {money(inboxTotals.invested)} of confirmed purchase cost and {inboxTotals.unitsRemaining} unit
                  {inboxTotals.unitsRemaining === 1 ? "" : "s"} are now included in Capital Deployed
                  and Units Remaining immediately. Market value stays excluded until the exact card
                  identity is verified and promoted.
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-1 text-2xl font-black">Purchase sources are reconciled</h2>
                <p className="mt-2 font-semibold text-emerald-50/80">
                  No active Purchase Inbox row is waiting outside the canonical ledger.
                </p>
              </>
            )}
          </section>
        ) : null}

        <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <DeskCard
            title="Resale Positions"
            value={sourceReady ? String(resale) : "—"}
            detail="Canonical resale positions plus purchased resale rows awaiting exact identity."
          />
          <DeskCard
            title="Hold / Investment"
            value={sourceReady ? String(hold) : "—"}
            detail="Longer-duration positions, including purchased rows still in exact review."
          />
          <DeskCard
            title="Personal Collection"
            value={sourceReady ? String(personal) : "—"}
            detail="Tracked without automatic sell pressure."
          />
          <DeskCard
            title="Awaiting Exact ID"
            value={sourceReady ? String(unlinkedPurchases.length) : "—"}
            detail="Real purchases counted in capital now, but not valued until exact identity is verified."
          />
          <DeskCard
            title="Research Debt"
            value={sourceReady ? String(researchDebt) : "—"}
            detail="Positions still missing exact identity or enough decision-grade market evidence."
          />
        </section>

        <section className="mt-5 rounded-[1.75rem] border border-white/10 bg-white/[.035] p-5 lg:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">
                Live Purchase Activity
              </p>
              <h2 className="mt-1 text-3xl font-black">Newest Capital Positions</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/market-intel/purchases/ebay-intake"
                className="w-fit rounded-full border border-white/15 bg-white/[.06] px-4 py-2.5 text-sm font-black hover:bg-white/10"
              >
                Open Purchase Inbox
              </Link>
              <Link
                href="/admin/market-intel/purchases"
                className="w-fit rounded-full bg-amber-300 px-4 py-2.5 text-sm font-black text-black hover:bg-amber-200"
              >
                Open Full Ledger
              </Link>
            </div>
          </div>

          {displayRows.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-6">
              <p className="text-xl font-black">No purchase positions loaded.</p>
              <p className="mt-2 font-semibold text-neutral-400">
                Discoveries remain opportunities until a real purchase and out-the-door cost are
                confirmed.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              {displayRows.map((row) => (
                <article
                  key={row.key}
                  className={`rounded-2xl border p-4 ${
                    row.kind === "purchase_inbox"
                      ? "border-amber-300/25 bg-amber-300/[.06]"
                      : "border-white/10 bg-black/30"
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                            row.kind === "purchase_inbox"
                              ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                              : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                          }`}
                        >
                          {row.badge}
                        </span>
                        <span className="text-xs font-bold text-neutral-500">
                          {mountainDate(row.purchasedAt)}
                        </span>
                      </div>
                      <h3 className="mt-3 truncate text-xl font-black">{row.title}</h3>
                      <p className="mt-1 text-sm font-semibold text-neutral-400">
                        Cost {money(row.cost)} · Qty {row.quantity} · Unit {money(row.unitCost)} ·
                        Signal {row.signal}
                      </p>
                    </div>
                    <Link
                      href={row.href}
                      className="shrink-0 rounded-full border border-white/15 bg-white/[.06] px-4 py-2.5 text-sm font-black hover:bg-white/10"
                    >
                      {row.actionLabel}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/35 px-5 py-4">
      <p className="text-[10px] font-black uppercase tracking-[.18em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function DeskCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-[1.4rem] border border-white/10 bg-white/[.035] p-5">
      <p className="text-3xl font-black text-amber-300">{value}</p>
      <h2 className="mt-2 text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-neutral-500">{detail}</p>
    </article>
  );
}
