"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildInstaCompV2Decision,
  type InstaCompV2Comp,
  type InstaCompV2Provider,
  type InstaCompV2ScanInput,
  type InstaCompV2Stats,
} from "@/src/lib/instacomp-v2";

type ScanAi = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  serialNumber?: string | null;
  team?: string | null;
  sport?: string | null;
  conditionGuess?: string | null;
  confidence?: number | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  certificationNumber?: string | null;
  isRookie?: boolean | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
};

type ScanResult = Omit<InstaCompV2ScanInput, "ai" | "sourceCoverage"> & {
  ok?: boolean;
  error?: string;
  ai?: ScanAi;
  searchQuery?: string;
  stats?: InstaCompV2Stats;
  soldStats?: InstaCompV2Stats;
  soldComps?: InstaCompV2Comp[];
  activeComps?: InstaCompV2Comp[];
  marketValueComps?: InstaCompV2Comp[];
  remainingCards?: InstaCompV2Comp[];
  providers?: InstaCompV2Provider[];
  links?: Record<string, string>;
  note?: string;
  sourceCoverage?: Array<{
    label?: string | null;
    status?: string | null;
    includedInMarketValue?: boolean | null;
    resultCount?: number | null;
    message?: string | null;
  }>;
};

type DealInputs = {
  purchasePrice: string;
  purchaseShipping: string;
  salesTax: string;
  sellingFeePercent: string;
  outboundShipping: string;
  supplies: string;
  gradingCost: string;
};

const DEFAULT_DEAL_INPUTS: DealInputs = {
  purchasePrice: "",
  purchaseShipping: "0",
  salesTax: "0",
  sellingFeePercent: "13.25",
  outboundShipping: "5.99",
  supplies: "0.50",
  gradingCost: "24.99",
};

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toFixed(1)}%`;
}

function numericInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function uniqueComps(rows: InstaCompV2Comp[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.url || ""}|${row.title || ""}|${row.price || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function actionTone(action: string) {
  if (action === "BUY_NOW") return "border-emerald-300 bg-emerald-500 text-white";
  if (action === "BUY") return "border-emerald-200 bg-emerald-100 text-emerald-950";
  if (action === "MAKE_OFFER") return "border-amber-300 bg-amber-300 text-neutral-950";
  if (action === "PASS") return "border-rose-300 bg-rose-600 text-white";
  if (action === "REVIEW") return "border-orange-300 bg-orange-100 text-orange-950";
  return "border-blue-200 bg-blue-100 text-blue-950";
}

function trustTone(status: string) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "review") return "border-orange-200 bg-orange-50 text-orange-900";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

export default function MobileInstaCompScanner() {
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [backImage, setBackImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [shippingEstimate, setShippingEstimate] = useState("5.99");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dealInputs, setDealInputs] = useState<DealInputs>(DEFAULT_DEAL_INPUTS);

  const soldComps = useMemo(
    () => uniqueComps(result?.soldComps || []),
    [result],
  );
  const activeListings = useMemo(
    () =>
      uniqueComps([
        ...(result?.activeComps || []),
        ...(result?.remainingCards || []),
      ]).filter((comp) => comp.sourceCategory !== "sold"),
    [result],
  );
  const decision = useMemo(() => {
    if (!result) return null;

    return buildInstaCompV2Decision(result, {
      purchasePrice: numericInput(dealInputs.purchasePrice),
      purchaseShipping: numericInput(dealInputs.purchaseShipping),
      salesTax: numericInput(dealInputs.salesTax),
      sellingFeeRate:
        (numericInput(dealInputs.sellingFeePercent) ?? 13.25) / 100,
      outboundShipping: numericInput(dealInputs.outboundShipping),
      supplies: numericInput(dealInputs.supplies),
      gradingCost: numericInput(dealInputs.gradingCost),
    });
  }, [dealInputs, result]);

  function updateField(name: string, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  function updateDealInput(name: keyof DealInputs, value: string) {
    setDealInputs((current) => ({ ...current, [name]: value }));
  }

  async function runScan() {
    if (!frontImage) {
      setError("Take or choose a front photo first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("frontImage", frontImage);
      form.append("aiCouncilTier", "adaptive");
      if (backImage) form.append("backImage", backImage);

      const response = await fetch("/api/instacomp/scan", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ScanResult;

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "InstaComp could not finish this scan.");
      }

      const ai = data.ai || {};
      const initialDecision = buildInstaCompV2Decision(data);
      setFields({
        player: String(ai.player || ""),
        year: String(ai.year || ""),
        brand: String(ai.brand || ""),
        setName: String(ai.setName || ""),
        cardNumber: String(ai.cardNumber || ""),
        parallel: String(ai.parallel || ""),
        serialNumber: String(ai.serialNumber || ""),
        team: String(ai.team || ""),
        sport: String(ai.sport || ""),
        condition: String(ai.conditionGuess || ""),
        price: String(
          initialDecision.targets.listPrice ||
            data.soldStats?.suggestedPrice ||
            data.stats?.suggestedPrice ||
            "",
        ),
      });
      setDealInputs(DEFAULT_DEAL_INPUTS);
      setResult(data);
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : "The scan failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  const listParams = new URLSearchParams({
    source: "instacomp-mobile-v2",
    player: fields.player || "",
    year: fields.year || "",
    brand: fields.brand || "",
    setName: fields.setName || "",
    cardNumber: fields.cardNumber || "",
    parallel: fields.parallel || "",
    serialNumber: fields.serialNumber || "",
    team: fields.team || "",
    sport: fields.sport || "",
    condition: fields.condition || "",
    price: fields.price || "",
    q: result?.searchQuery || "",
  });
  const identityTitle = [
    fields.year,
    fields.brand,
    fields.setName,
    fields.player,
    fields.parallel,
    fields.cardNumber ? `#${fields.cardNumber}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-w-0 space-y-4" data-instacomp-version="2.0">
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-700">
              InstaComp 2.0
            </p>
            <h2 className="mt-1 text-xl font-black">Scan one card</h2>
          </div>
          <span className="rounded-full bg-neutral-950 px-3 py-1 text-xs font-black text-white">
            Decision Engine
          </span>
        </div>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          Take the front first. Add the back for card number, parallel, serial,
          autograph, relic, grading, and stronger exact-match confidence.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm font-black">
            Front photo
            <input
              className="mt-2 block w-full text-base"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) =>
                setFrontImage(event.target.files?.[0] || null)
              }
            />
            <span className="mt-2 block break-all text-xs font-semibold text-neutral-600">
              {frontImage?.name || "No front selected"}
            </span>
          </label>
          <label className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm font-black">
            Back photo
            <input
              className="mt-2 block w-full text-base"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) =>
                setBackImage(event.target.files?.[0] || null)
              }
            />
            <span className="mt-2 block break-all text-xs font-semibold text-neutral-600">
              {backImage?.name || "Optional, but strongly recommended"}
            </span>
          </label>
        </div>
        <button
          type="button"
          onClick={runScan}
          disabled={loading}
          className="mt-4 min-h-12 w-full rounded-xl bg-neutral-950 px-4 py-3 text-base font-black text-white disabled:opacity-60"
        >
          {loading ? "Running InstaComp 2.0…" : "Run InstaComp 2.0"}
        </button>
        {error ? (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-black text-rose-800">
            {error}
          </p>
        ) : null}
      </section>

      {result && decision ? (
        <>
          <section
            data-instacomp-v2-decision-engine="true"
            className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950 text-white shadow-lg"
          >
            <div className="border-b border-white/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
                    InstaComp decision
                  </p>
                  <h2 className="mt-1 break-words text-xl font-black">
                    {identityTitle || "Identified card"}
                  </h2>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-black ${trustTone(
                      decision.trust.status,
                    )}`}
                  >
                    {decision.trust.label} · {decision.trust.pricingConfidence}%
                  </span>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-1">
                  <div
                    className={`rounded-xl border px-4 py-3 text-center ${actionTone(
                      decision.recommendation.action,
                    )}`}
                  >
                    <p className="text-[10px] font-black uppercase tracking-widest opacity-75">
                      Call
                    </p>
                    <p className="text-lg font-black">
                      {decision.recommendation.label}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-neutral-300">
                      InstaComp score
                    </p>
                    <p className="text-2xl font-black">
                      {decision.scores.opportunity ?? decision.scores.instaComp}
                      <span className="text-sm text-neutral-400">/100</span>
                    </p>
                  </div>
                </div>
              </div>
              <h3 className="mt-4 text-lg font-black">
                {decision.recommendation.headline}
              </h3>
              <p className="mt-1 text-sm font-semibold leading-6 text-neutral-300">
                {decision.recommendation.summary}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
              <DarkMetric label="Expected sale" value={money(decision.targets.expectedSalePrice)} />
              <DarkMetric label="Projected profit" value={money(decision.economics.projectedProfit)} />
              <DarkMetric label="ROI" value={percent(decision.economics.roiPercent)} />
              <DarkMetric label="Market trend" value={decision.market.trend.label} />
            </div>

            <div className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-400">
                Buy targets after fees and shipping
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <TargetCard label="Instant buy" value={decision.targets.instantBuy} detail="50% target ROI" />
                <TargetCard label="Good buy" value={decision.targets.goodBuy} detail="30% target ROI" />
                <TargetCard label="Fair buy" value={decision.targets.fairBuy} detail="15% target ROI" />
                <TargetCard label="Pass above" value={decision.targets.passAbove} detail="Protect the margin" />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">
              What will this deal actually make?
            </p>
            <h2 className="mt-1 text-xl font-black">Enter the real buying costs</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MoneyInput label="Listing / offer price" value={dealInputs.purchasePrice} onChange={(value) => updateDealInput("purchasePrice", value)} />
              <MoneyInput label="Buyer shipping" value={dealInputs.purchaseShipping} onChange={(value) => updateDealInput("purchaseShipping", value)} />
              <MoneyInput label="Tax + buyer fees" value={dealInputs.salesTax} onChange={(value) => updateDealInput("salesTax", value)} />
              <MoneyInput label="Selling fee %" value={dealInputs.sellingFeePercent} onChange={(value) => updateDealInput("sellingFeePercent", value)} suffix="%" />
              <MoneyInput label="Outbound shipping" value={dealInputs.outboundShipping} onChange={(value) => updateDealInput("outboundShipping", value)} />
              <MoneyInput label="Supplies" value={dealInputs.supplies} onChange={(value) => updateDealInput("supplies", value)} />
              <MoneyInput label="Grading cost" value={dealInputs.gradingCost} onChange={(value) => updateDealInput("gradingCost", value)} />
              <div className="rounded-xl border border-amber-200 bg-white p-3">
                <p className="text-xs font-black uppercase text-neutral-500">All-in cost</p>
                <p className="mt-2 text-xl font-black">{money(decision.economics.allInCost)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard label="Selling fees" value={money(decision.economics.estimatedSellingFees)} />
              <MetricCard label="Net proceeds" value={money(decision.economics.netProceeds)} />
              <MetricCard label="Profit" value={money(decision.economics.projectedProfit)} />
              <MetricCard label="Margin" value={percent(decision.economics.marginPercent)} />
            </div>
          </section>

          <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-800">
              Market intelligence
            </p>
            <h2 className="mt-1 text-xl font-black">Evidence, demand, and risk</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ScoreCard label="Pricing" value={decision.trust.pricingConfidence} />
              <ScoreCard label="Heat" value={decision.scores.heat} />
              <ScoreCard label="Liquidity" value={decision.scores.liquidity} />
              <ScoreCard label="Risk" value={decision.scores.risk} inverse />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MetricCard label="Sold 30 days" value={String(decision.market.sold30Days)} />
              <MetricCard label="Sold 90 days" value={String(decision.market.sold90Days)} />
              <MetricCard label="Active supply" value={String(decision.market.activeSupply)} />
              <MetricCard label="Sell-through" value={percent(decision.market.sellThroughPercent)} />
            </div>
            <div className="mt-3 rounded-xl border border-cyan-200 bg-white p-3">
              <p className="text-xs font-black uppercase text-neutral-500">Why InstaComp made this call</p>
              <ul className="mt-2 space-y-1 text-sm font-semibold leading-5 text-neutral-700">
                {decision.recommendation.reasons.map((reason) => (
                  <li key={reason}>• {reason}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-800">
              Grade decision
            </p>
            <h2 className="mt-1 text-xl font-black">Raw vs. graded evidence</h2>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <MetricCard label="Raw" value={money(decision.grading.rawValue)} />
              <MetricCard label={`PSA 9 (${decision.market.graded.psa9SampleSize})`} value={money(decision.grading.psa9Value)} />
              <MetricCard label={`PSA 10 (${decision.market.graded.psa10SampleSize})`} value={money(decision.grading.psa10Value)} />
            </div>
            <p className="mt-3 rounded-xl border border-violet-200 bg-white p-3 text-sm font-semibold leading-6 text-violet-950">
              {decision.grading.recommendation}
            </p>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-xl font-black">Editable card and listing details</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ["player", "Player"],
                ["year", "Year"],
                ["brand", "Brand"],
                ["setName", "Set"],
                ["cardNumber", "Card number"],
                ["parallel", "Parallel / variation"],
                ["serialNumber", "Serial number"],
                ["team", "Team"],
                ["sport", "Sport / category"],
                ["condition", "Condition"],
                ["price", "Website price"],
              ].map(([name, label]) => (
                <label key={name} className="text-sm font-black">
                  {label}
                  <input
                    value={fields[name] || ""}
                    onChange={(event) => updateField(name, event.target.value)}
                    className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-neutral-300 px-3 text-base font-semibold"
                  />
                </label>
              ))}
            </div>
            <Link
              href={`/list?${listParams.toString()}`}
              className="mt-4 block min-h-12 rounded-xl bg-amber-300 px-4 py-3 text-center text-base font-black text-neutral-950"
            >
              Send to List Cards
            </Link>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-emerald-800">
              Sold market
            </p>
            <h2 className="mt-1 text-xl font-black">Sold comps ({soldComps.length})</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
              <MetricCard label="Low" value={money(decision.market.raw.low)} />
              <MetricCard label="Median" value={money(decision.market.raw.median)} />
              <MetricCard label="Average" value={money(decision.market.raw.average)} />
              <MetricCard label="High" value={money(decision.market.raw.high)} />
            </div>
            <div className="mt-3 space-y-3">
              {soldComps.length ? (
                soldComps.map((comp, index) => (
                  <CompCard key={`${comp.url}-${index}`} comp={comp} />
                ))
              ) : (
                <NoMatches label="No verified sold matches were returned. Use the sold-search button below to review broader results." />
              )}
            </div>
            {result.links?.ebaySoldUrl ? (
              <a
                href={result.links.ebaySoldUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-xl border border-emerald-300 bg-white px-4 py-3 text-center font-black text-emerald-900"
              >
                Open broader eBay sold search
              </a>
            ) : null}
          </section>

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-blue-800">
              For sale now
            </p>
            <h2 className="mt-1 text-xl font-black">
              Current listings ({activeListings.length})
            </h2>
            <label className="mt-3 block text-sm font-black">
              Estimated shipping when a source does not provide it
              <input
                inputMode="decimal"
                value={shippingEstimate}
                onChange={(event) => setShippingEstimate(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-blue-300 bg-white px-3 text-base"
              />
            </label>
            <div className="mt-3 space-y-3">
              {activeListings.length ? (
                activeListings.map((comp, index) => (
                  <CompCard
                    key={`${comp.url}-${index}`}
                    comp={comp}
                    shippingEstimate={Number(shippingEstimate) || 0}
                  />
                ))
              ) : (
                <NoMatches label="No exact active matches were returned. Open the broader active search below to see nearby listings." />
              )}
            </div>
            {result.links?.ebayActiveUrl ? (
              <a
                href={result.links.ebayActiveUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-xl border border-blue-300 bg-white px-4 py-3 text-center font-black text-blue-900"
              >
                Open broader eBay active search
              </a>
            ) : null}
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black">Source status</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Only included exact matches affect the market value. Registered or
              broader sources stay visible for manual verification.
            </p>
            <div className="mt-3 space-y-2">
              {(result.sourceCoverage || []).map((source, index) => (
                <div
                  key={`${source.label}-${index}`}
                  className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong>{source.label || "Source"}</strong>
                    <span className="font-black">{source.resultCount || 0}</span>
                  </div>
                  <p className="mt-1 font-semibold text-neutral-600">
                    {source.status || "unknown"}
                    {source.message ? ` — ${source.message}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function DarkMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">
        {label}
      </p>
      <p className="mt-1 break-words text-base font-black text-white">{value}</p>
    </div>
  );
}

function TargetCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-black text-neutral-300">{label}</p>
      <p className="mt-1 text-xl font-black">{money(value)}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
        {detail}
      </p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white p-3 text-center shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 break-words text-lg font-black text-neutral-950">{value}</p>
    </div>
  );
}

function ScoreCard({
  label,
  value,
  inverse = false,
}: {
  label: string;
  value: number;
  inverse?: boolean;
}) {
  const displayed = inverse ? 100 - value : value;
  return (
    <div className="rounded-xl border border-cyan-200 bg-white p-3 text-center shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200">
        <div
          className="h-full rounded-full bg-neutral-950"
          style={{ width: `${Math.max(2, Math.min(100, displayed))}%` }}
        />
      </div>
    </div>
  );
}

function MoneyInput({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
}) {
  return (
    <label className="text-xs font-black text-neutral-700">
      {label}
      <div className="mt-1 flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-3">
        {!suffix ? <span className="font-black text-neutral-500">$</span> : null}
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-1 text-base font-black outline-none"
        />
        {suffix ? <span className="font-black text-neutral-500">{suffix}</span> : null}
      </div>
    </label>
  );
}

function NoMatches({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-sm font-bold text-neutral-700">
      {label}
    </p>
  );
}

function CompCard({
  comp,
  shippingEstimate,
}: {
  comp: InstaCompV2Comp;
  shippingEstimate?: number;
}) {
  const price = Number(comp.price) || 0;
  const knownShipping =
    comp.shippingPrice === null || comp.shippingPrice === undefined
      ? Number.NaN
      : Number(comp.shippingPrice);
  const shipping = Number.isFinite(knownShipping)
    ? knownShipping
    : shippingEstimate;
  const total = shipping === undefined ? null : price + shipping;
  const content = (
    <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <p className="break-words text-sm font-black leading-5">
        {comp.title || "Untitled listing"}
      </p>
      <p className="mt-1 text-xs font-bold text-neutral-500">
        {comp.sourceLabel || "Marketplace"}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-neutral-100 p-2">
          <p className="text-[10px] font-black uppercase text-neutral-500">Item</p>
          <p className="font-black">{money(price)}</p>
        </div>
        <div className="rounded-lg bg-neutral-100 p-2">
          <p className="text-[10px] font-black uppercase text-neutral-500">Shipping</p>
          <p className="font-black">
            {shipping === undefined ? "See listing" : money(shipping)}
          </p>
        </div>
        <div className="rounded-lg bg-neutral-100 p-2">
          <p className="text-[10px] font-black uppercase text-neutral-500">Approx total</p>
          <p className="font-black">{total === null ? "See listing" : money(total)}</p>
        </div>
      </div>
    </div>
  );

  return comp.url ? (
    <a href={comp.url} target="_blank" rel="noreferrer" className="block">
      {content}
    </a>
  ) : (
    content
  );
}
