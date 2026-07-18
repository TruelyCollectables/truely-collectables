import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../lib/admin-session";
import { getMarketIntelWatchCenter } from "../../../../lib/market-intel-watch-center";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

type CenterData = Awaited<ReturnType<typeof getMarketIntelWatchCenter>>;
type WatchTarget = CenterData["watchlist"][number];
type WatchIdentity = CenterData["identities"][number];
type WatchListing = CenterData["listings"][number];
type WatchPosition = CenterData["positions"][number];
type WatchAlert = CenterData["alerts"][number];
type WatchObservation = CenterData["observations"][number];

type PlayerSummary = {
  target: WatchTarget;
  identities: WatchIdentity[];
  listings: WatchListing[];
  positions: WatchPosition[];
  alerts: WatchAlert[];
  observations: WatchObservation[];
};

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function percentage(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

function time(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function movementTone(value: number | null | undefined) {
  if (value === null || value === undefined) return "text-neutral-500";
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-neutral-700";
}

function dealLabel(value: string | null | undefined) {
  return String(value || "watch").replaceAll("_", " ").toUpperCase();
}

function dealTone(value: string | null | undefined) {
  if (value === "too_good_to_be_true") {
    return "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950";
  }
  if (value === "steal") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (value === "great_buy") {
    return "border-lime-300 bg-lime-100 text-lime-950";
  }
  if (value === "good_buy") {
    return "border-cyan-300 bg-cyan-100 text-cyan-950";
  }
  if (value === "wholesale_opportunity") {
    return "border-amber-300 bg-amber-100 text-amber-950";
  }
  if (value === "mislisted") {
    return "border-violet-300 bg-violet-100 text-violet-950";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-800";
}

function noteValue(notes: string | null | undefined, key: string) {
  const prefix = `${key}: `;
  return (
    String(notes || "")
      .split("\n")
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length) || null
  );
}

function remainingUnits(position: WatchPosition) {
  return Number(
    position.performance?.quantity_remaining ?? position.lot.quantity_purchased,
  );
}

function compareIdentityHeat(left: WatchIdentity, right: WatchIdentity) {
  const seven =
    Number(right.latestValue?.seven_day_change_pct ?? -999) -
    Number(left.latestValue?.seven_day_change_pct ?? -999);
  if (seven !== 0) return seven;
  const thirty =
    Number(right.latestValue?.thirty_day_change_pct ?? -999) -
    Number(left.latestValue?.thirty_day_change_pct ?? -999);
  if (thirty !== 0) return thirty;
  return (
    Number(right.latestValue?.sample_size || 0) -
    Number(left.latestValue?.sample_size || 0)
  );
}

function compareDeals(left: WatchListing, right: WatchListing) {
  const actionable =
    Number(Boolean(right.score?.actionable)) -
    Number(Boolean(left.score?.actionable));
  if (actionable !== 0) return actionable;
  const score =
    Number(right.score?.buy_score || 0) - Number(left.score?.buy_score || 0);
  if (score !== 0) return score;
  const discount =
    Number(right.score?.discount_pct ?? -999) -
    Number(left.score?.discount_pct ?? -999);
  if (discount !== 0) return discount;
  return Number(left.delivered_price || 0) - Number(right.delivered_price || 0);
}

function observationStats(rows: WatchObservation[]) {
  const ordered = [...rows].sort(
    (left, right) =>
      new Date(left.observed_at).getTime() - new Date(right.observed_at).getTime(),
  );
  const priceRows = ordered.filter((row) => row.unit_delivered_price > 0);
  const firstPrice = priceRows[0] || null;
  const latestPrice = priceRows[priceRows.length - 1] || null;
  const priceChangePct =
    firstPrice && latestPrice && firstPrice.unit_delivered_price > 0
      ? ((latestPrice.unit_delivered_price - firstPrice.unit_delivered_price) /
          firstPrice.unit_delivered_price) *
        100
      : null;
  const verifiedSnapshots = ordered.filter(
    (row) => row.source_type === "market_snapshot",
  );
  return {
    first: ordered[0] || null,
    latest: ordered[ordered.length - 1] || null,
    firstPrice,
    latestPrice,
    priceChangePct,
    verifiedSnapshots,
  };
}

export default async function MarketIntelWatchCenterPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff =
    query?.[ADMIN_HANDOFF_PARAM] || (await createAdminSessionValue());
  const adminHref = (href: string) => addAdminHandoff(href, handoff);
  const data = await getMarketIntelWatchCenter();
  const activeTargetBySubject = new Map<string, WatchTarget>();

  for (const target of data.watchlist) {
    if (!target.active || !target.subject_id || !target.subject?.active) continue;
    const current = activeTargetBySubject.get(target.subject_id);
    if (!current || target.priority > current.priority) {
      activeTargetBySubject.set(target.subject_id, target);
    }
  }

  const identityById = new Map(
    data.identities.map((identity) => [identity.id, identity]),
  );
  const pendingAlerts = data.alerts.filter((alert) => alert.status === "pending");
  const summaries: PlayerSummary[] = Array.from(activeTargetBySubject.values())
    .map((target) => {
      const subjectId = String(target.subject_id);
      const identities = data.identities
        .filter((identity) => identity.active && identity.subject_id === subjectId)
        .sort(compareIdentityHeat);
      const listings = data.listings
        .filter((listing) => listing.identity?.subject_id === subjectId)
        .sort(compareDeals);
      const listingIds = new Set(listings.map((listing) => listing.id));
      const alerts = pendingAlerts.filter((alert) =>
        listingIds.has(alert.listing_id),
      );
      const positions = data.positions.filter((position) => {
        const identityId = position.lot.collectible_identity_id;
        return identityId
          ? identityById.get(identityId)?.subject_id === subjectId
          : false;
      });
      const observations = data.observations.filter(
        (observation) => observation.subject_id === subjectId,
      );
      return { target, identities, listings, alerts, positions, observations };
    })
    .sort(
      (left, right) =>
        right.target.priority - left.target.priority ||
        String(left.target.subject?.name || "").localeCompare(
          String(right.target.subject?.name || ""),
        ),
    );

  const topMovers = data.identities
    .filter(
      (identity) =>
        identity.active &&
        identity.subject_id &&
        activeTargetBySubject.has(identity.subject_id) &&
        identity.latestValue &&
        (identity.latestValue.seven_day_change_pct !== null ||
          identity.latestValue.thirty_day_change_pct !== null),
    )
    .sort(compareIdentityHeat)
    .slice(0, 10);
  const bestPrices = data.listings
    .filter(
      (listing) =>
        listing.identity?.subject_id &&
        activeTargetBySubject.has(listing.identity.subject_id),
    )
    .sort(compareDeals)
    .slice(0, 10);
  const ownedUnits = data.positions.reduce(
    (sum, position) => sum + remainingUnits(position),
    0,
  );
  const actionable = data.listings.filter((listing) => listing.score?.actionable);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-[1500px] px-6 py-8">
          <Link
            href={adminHref("/admin/market-intel")}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-lime-300">
            TCOS Watch Center™
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Who, What, and When to Investigate
          </h1>
          <p className="mt-3 max-w-5xl font-semibold text-neutral-300">
            Every tracked player, hottest exact cards, strongest live prices, pending
            alerts, owned positions, and dated market observations in one drill-down desk.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6 px-6 py-6">
        {data.errors.length > 0 ? (
          <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">Some intelligence is unavailable</h2>
            <div className="mt-2 space-y-1 text-sm font-semibold">
              {data.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          </section>
        ) : null}

        {data.observationMigrationRequired ? (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
            <h2 className="text-2xl font-black">Market observation migration required</h2>
            <p className="mt-2 font-semibold leading-6">
              Apply <code>supabase/migrations/20260718_tcos_market_intel_market_observations.sql</code>
              in Supabase SQL Editor. The rest of the Watch Center works now, but dated
              miner history begins after this migration is installed.
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <LinkMetric
            label="Tracked Players"
            value={String(summaries.length)}
            href="#tracked-players"
          />
          <LinkMetric
            label="Hot Exact Cards"
            value={String(topMovers.length)}
            href="#hot-cards"
          />
          <LinkMetric
            label="Active Prices"
            value={String(data.listings.length)}
            href="#best-prices"
          />
          <LinkMetric
            label="Actionable Buys"
            value={String(actionable.length)}
            href={adminHref("/admin/market-intel/deals#shark-list")}
          />
          <LinkMetric
            label="Pending Alerts"
            value={data.alertsAvailable ? String(pendingAlerts.length) : "—"}
            href={adminHref("/admin/market-intel/reports#pending-alerts")}
          />
          <LinkMetric
            label="Owned Units"
            value={String(ownedUnits)}
            href={adminHref("/admin/market-intel/purchases")}
          />
        </section>

        <section className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <Link
            href={adminHref("/admin/market-intel/watchlist")}
            className="rounded-md bg-cyan-900 px-4 py-2.5 text-sm font-black text-white"
          >
            Manage Tracked Players
          </Link>
          <Link
            href={adminHref("/admin/market-intel/ebay")}
            className="rounded-md bg-lime-700 px-4 py-2.5 text-sm font-black text-white"
          >
            Scan Exact Cards on eBay
          </Link>
          <Link
            href={adminHref("/admin/market-intel/discovery")}
            className="rounded-md bg-fuchsia-800 px-4 py-2.5 text-sm font-black text-white"
          >
            Discover New Exact Cards
          </Link>
          <Link
            href={adminHref("/admin/market-intel/reports")}
            className="rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
          >
            Alerts + Daily Intelligence
          </Link>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section
            id="hot-cards"
            className="scroll-mt-6 overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm"
          >
            <div className="border-b border-emerald-200 bg-emerald-50 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
                Momentum Board
              </p>
              <h2 className="mt-1 text-3xl font-black">Hot Exact Cards</h2>
              <p className="mt-1 text-sm font-semibold text-emerald-950">
                Ranked by seven-day movement, thirty-day movement, then comp depth.
              </p>
            </div>
            {topMovers.length === 0 ? (
              <EmptyState
                title="No calculated movers yet."
                detail="Add or ingest verified sold comps and recalculate the exact market to establish movement."
              />
            ) : (
              <div className="divide-y divide-neutral-200">
                {topMovers.map((identity, index) => (
                  <HotCardRow
                    key={identity.id}
                    identity={identity}
                    rank={index + 1}
                    href={adminHref(`/admin/market-intel/comps/${identity.id}`)}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            id="best-prices"
            className="scroll-mt-6 overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm"
          >
            <div className="border-b border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
                Price Board
              </p>
              <h2 className="mt-1 text-3xl font-black">Best Live Prices</h2>
              <p className="mt-1 text-sm font-semibold text-amber-950">
                Actionable deals first, followed by buy score, discount, and delivered cost.
              </p>
            </div>
            {bestPrices.length === 0 ? (
              <EmptyState
                title="No tracked live prices."
                detail="Run an eBay scan after exact-card identities exist."
              />
            ) : (
              <div className="divide-y divide-neutral-200">
                {bestPrices.map((listing, index) => (
                  <BestPriceRow key={listing.id} listing={listing} rank={index + 1} />
                ))}
              </div>
            )}
          </section>
        </section>

        <section id="tracked-players" className="scroll-mt-6 space-y-4">
          <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-6 text-cyan-950">
            <p className="text-xs font-black uppercase tracking-[0.18em]">
              Master Tracking Page
            </p>
            <h2 className="mt-1 text-4xl font-black">Every Player Being Tracked</h2>
            <p className="mt-2 max-w-5xl font-semibold leading-6">
              Click any player to investigate exact-card movement, live prices, alerts,
              owned cards, and everything the miner has observed since the first day.
            </p>
          </section>

          {summaries.length === 0 ? (
            <EmptyState
              title="No active tracked players."
              detail="Add or reactivate a player in the Market Intel watchlist."
            />
          ) : (
            summaries.map((summary) => (
              <PlayerCard
                key={summary.target.subject_id}
                summary={summary}
                adminHref={adminHref}
                observationsAvailable={data.observationsAvailable}
              />
            ))
          )}
        </section>
      </div>
    </main>
  );
}

function PlayerCard({
  summary,
  adminHref,
  observationsAvailable,
}: {
  summary: PlayerSummary;
  adminHref: (href: string) => string;
  observationsAvailable: boolean;
}) {
  const subject = summary.target.subject!;
  const bestListing = summary.listings[0] || null;
  const hotCards = summary.identities.filter(
    (identity) =>
      Number(identity.latestValue?.seven_day_change_pct || 0) > 0 ||
      Number(identity.latestValue?.thirty_day_change_pct || 0) > 0,
  );
  const ownedUnits = summary.positions.reduce(
    (sum, position) => sum + remainingUnits(position),
    0,
  );
  const ownedCost = summary.positions.reduce(
    (sum, position) => sum + Number(position.remaining_cost_basis || 0),
    0,
  );
  const ownedMarket = summary.positions.reduce(
    (sum, position) =>
      sum + Number(position.estimated_remaining_market_value || 0),
    0,
  );
  const mined = observationStats(summary.observations);
  const cardScope =
    noteValue(summary.target.notes, "Card scope") ||
    noteValue(subject.notes, "Card scope") ||
    "Tracked card scope is not documented yet.";

  return (
    <details className="group overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <summary className="cursor-pointer list-none p-5 hover:bg-neutral-50">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-black px-3 py-1 text-xs font-black text-white">
                PRIORITY {summary.target.priority}
              </span>
              <span className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1 text-xs font-black">
                {subject.sport_or_category || "Category pending"}
              </span>
              {summary.alerts.length > 0 ? (
                <span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-black text-rose-900">
                  {summary.alerts.length} PENDING ALERT
                  {summary.alerts.length === 1 ? "" : "S"}
                </span>
              ) : null}
            </div>
            <h3 className="mt-2 text-3xl font-black">{subject.name}</h3>
            <p className="mt-1 font-semibold text-neutral-600">
              {subject.team_or_affiliation ||
                subject.league_or_brand ||
                "Affiliation pending"}
            </p>
            <p className="mt-2 max-w-4xl text-sm font-bold text-emerald-800">
              {cardScope}
            </p>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6 xl:min-w-[720px]">
            <SmallMetric label="Exact Cards" value={String(summary.identities.length)} />
            <SmallMetric label="Hot Cards" value={String(hotCards.length)} />
            <SmallMetric label="Live Prices" value={String(summary.listings.length)} />
            <SmallMetric
              label="Best Discount"
              value={percentage(bestListing?.score?.discount_pct)}
              valueClassName={movementTone(bestListing?.score?.discount_pct)}
            />
            <SmallMetric label="Owned" value={String(ownedUnits)} />
            <SmallMetric label="Data Points" value={String(summary.observations.length)} />
          </div>
        </div>
        <p className="mt-4 text-xs font-black uppercase tracking-wide text-cyan-800 group-open:hidden">
          Click to investigate this player ↓
        </p>
      </summary>

      <div className="space-y-6 border-t border-neutral-200 bg-[#f8f6f1] p-5">
        <div className="flex flex-wrap gap-2">
          <Link
            href={adminHref("/admin/market-intel/comps")}
            className="rounded-md bg-cyan-900 px-4 py-2 text-sm font-black text-white"
          >
            Exact Markets
          </Link>
          <Link
            href={adminHref("/admin/market-intel/ebay")}
            className="rounded-md bg-lime-700 px-4 py-2 text-sm font-black text-white"
          >
            Scan eBay
          </Link>
          <Link
            href={adminHref("/admin/market-intel/deals#active-listings")}
            className="rounded-md bg-black px-4 py-2 text-sm font-black text-white"
          >
            All Live Prices
          </Link>
          <Link
            href={adminHref("/admin/market-intel/purchases")}
            className="rounded-md border border-neutral-400 bg-white px-4 py-2 text-sm font-black"
          >
            Purchase Ledger
          </Link>
        </div>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white">
            <div className="border-b border-emerald-200 bg-emerald-50 p-4">
              <h4 className="text-2xl font-black">Hottest Exact Cards</h4>
            </div>
            {summary.identities.length === 0 ? (
              <EmptyState
                title="No exact-card markets."
                detail="Approve exact identities and add verified sold comps."
              />
            ) : (
              <div className="divide-y divide-neutral-200">
                {summary.identities.slice(0, 5).map((identity, index) => (
                  <HotCardRow
                    key={identity.id}
                    identity={identity}
                    rank={index + 1}
                    href={adminHref(`/admin/market-intel/comps/${identity.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
            <div className="border-b border-amber-200 bg-amber-50 p-4">
              <h4 className="text-2xl font-black">Best Live Prices</h4>
            </div>
            {summary.listings.length === 0 ? (
              <EmptyState
                title="No live prices saved."
                detail="Run the exact-card eBay scanner."
              />
            ) : (
              <div className="divide-y divide-neutral-200">
                {summary.listings.slice(0, 5).map((listing, index) => (
                  <BestPriceRow key={listing.id} listing={listing} rank={index + 1} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="rounded-xl border border-fuchsia-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-700">
              Data Miner History
            </p>
            <h4 className="mt-1 text-2xl font-black">Market Since TCOS First Saw It</h4>
            {observationsAvailable && mined.first ? (
              <dl className="mt-4 space-y-3 text-sm">
                <Row label="First observed" value={time(mined.first.observed_at)} />
                <Row label="Latest observed" value={time(mined.latest?.observed_at)} />
                <Row
                  label="First observed unit price"
                  value={money(mined.firstPrice?.unit_delivered_price)}
                />
                <Row
                  label="Latest observed unit price"
                  value={money(mined.latestPrice?.unit_delivered_price)}
                />
                <Row
                  label="Observed price move"
                  value={percentage(mined.priceChangePct)}
                  valueClassName={movementTone(mined.priceChangePct)}
                />
                <Row label="All data points" value={String(summary.observations.length)} />
                <Row
                  label="Verified-comp snapshots"
                  value={String(mined.verifiedSnapshots.length)}
                />
              </dl>
            ) : (
              <p className="mt-4 text-sm font-semibold text-neutral-600">
                {observationsAvailable
                  ? "History begins automatically on the next discovery scan, deal score, or market recalculation."
                  : "Install the market-observation migration to begin dated history."}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              Your Position
            </p>
            <h4 className="mt-1 text-2xl font-black">Cards Already Owned</h4>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Purchase positions" value={String(summary.positions.length)} />
              <Row label="Units remaining" value={String(ownedUnits)} />
              <Row label="Remaining cost basis" value={money(ownedCost)} />
              <Row label="Estimated market value" value={money(ownedMarket)} />
            </dl>
            {summary.positions.slice(0, 3).map((position) => (
              <Link
                key={position.lot.id}
                href={adminHref(`/admin/market-intel/purchases/${position.lot.id}`)}
                className="mt-3 block rounded-md border border-neutral-200 p-3 text-sm font-black hover:bg-neutral-50"
              >
                #{position.lot.purchase_number} · {position.lot.collectible?.display_name || "Purchase"}
              </Link>
            ))}
          </div>

          <div className="rounded-xl border border-rose-200 bg-white p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">
              Alert Queue
            </p>
            <h4 className="mt-1 text-2xl font-black">Prices Requiring Attention</h4>
            {summary.alerts.length === 0 ? (
              <p className="mt-4 text-sm font-semibold text-neutral-600">
                No pending alerts for this player.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {summary.alerts.slice(0, 4).map((alert) => (
                  <a
                    key={alert.id}
                    href={alert.direct_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-rose-200 bg-rose-50 p-3 hover:bg-rose-100"
                  >
                    <p className="text-xs font-black uppercase text-rose-800">
                      {dealLabel(alert.deal_label)}
                    </p>
                    <p className="mt-1 text-sm font-black">{alert.title}</p>
                    <p className="mt-1 text-xs font-bold text-rose-900">
                      {money(alert.delivered_cost)} delivered · {money(alert.market_value)} market
                    </p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </details>
  );
}

function HotCardRow({
  identity,
  rank,
  href,
}: {
  identity: WatchIdentity;
  rank: number;
  href: string;
}) {
  const value = identity.latestValue;
  return (
    <Link href={href} className="block p-4 hover:bg-emerald-50/50">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-black text-emerald-900">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-black">{identity.display_name}</p>
          <p className="mt-1 text-xs font-semibold text-neutral-500">
            {identity.verifiedCompCount} verified comps · {value?.confidence_score.toFixed(0) || 0}% confidence
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-black">{money(value?.conservative_value)}</p>
          <p className={`text-xs font-black ${movementTone(value?.seven_day_change_pct)}`}>
            7D {percentage(value?.seven_day_change_pct)}
          </p>
          <p className={`text-xs font-black ${movementTone(value?.thirty_day_change_pct)}`}>
            30D {percentage(value?.thirty_day_change_pct)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function BestPriceRow({
  listing,
  rank,
}: {
  listing: WatchListing;
  rank: number;
}) {
  const quantity = Math.max(1, Number(listing.quantity || 1));
  const unitPrice = Number(listing.delivered_price || 0) / quantity;
  return (
    <a
      href={listing.direct_url}
      target="_blank"
      rel="noreferrer"
      className="block p-4 hover:bg-amber-50/60"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 font-black text-amber-900">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black ${dealTone(listing.score?.deal_label)}`}>
              {dealLabel(listing.score?.deal_label)}
            </span>
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[10px] font-black">
              {listing.marketplace?.name || "Marketplace"}
            </span>
          </div>
          <p className="mt-2 font-black">{listing.original_title}</p>
          <p className="mt-1 text-xs font-semibold text-neutral-500">
            {listing.identity?.display_name || "Exact identity pending"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-black">{money(listing.delivered_price)}</p>
          <p className="text-xs font-bold text-neutral-500">{money(unitPrice)} / item</p>
          <p className={`text-xs font-black ${movementTone(listing.score?.discount_pct)}`}>
            {percentage(listing.score?.discount_pct)} vs market
          </p>
        </div>
      </div>
    </a>
  );
}

function LinkMetric({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-md"
    >
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500 group-hover:text-cyan-800">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-2 text-xs font-black text-cyan-700">DRILL IN →</p>
    </Link>
  );
}

function SmallMetric({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className={`mt-1 font-black ${valueClassName}`}>{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-2 last:border-b-0">
      <dt className="font-semibold text-neutral-600">{label}</dt>
      <dd className={`text-right font-black ${valueClassName}`}>{value}</dd>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="p-6">
      <h3 className="text-xl font-black">{title}</h3>
      <p className="mt-2 font-semibold text-neutral-600">{detail}</p>
    </div>
  );
}
