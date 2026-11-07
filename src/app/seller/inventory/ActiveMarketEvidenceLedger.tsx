type EvidenceDisposition =
  | "verified_pricing"
  | "scouting"
  | "packaging_rejected"
  | "identity_rejected"
  | "auction_only"
  | "self_listing"
  | "unclassified";

type EvidenceEntry = {
  id?: string;
  title?: string;
  url?: string | null;
  price?: number | null;
  shippingCost?: number | null;
  landedPrice?: number | null;
  disposition?: EvidenceDisposition;
  reasons?: string[];
  packagingState?: "sealed" | "opened" | "unknown";
  fixedPrice?: boolean | null;
  seenInQueries?: string[];
  sourceLanes?: string[];
};

type EvidenceAccounting = {
  passed?: boolean;
  checkedAt?: string | null;
  summary?: string | null;
  externalCandidateCount?: number;
  accountedExternalCount?: number;
  queriesAttempted?: number;
  queriesSucceeded?: number;
  queriesFailed?: number;
  counts?: {
    verifiedPricing?: number;
    scouting?: number;
    packagingRejected?: number;
    identityRejected?: number;
    auctionOnly?: number;
    selfListing?: number;
    unclassified?: number;
  };
  failures?: string[];
  warnings?: string[];
  ledger?: EvidenceEntry[];
};

type SourceCoverage = {
  passed?: boolean;
  checkedAt?: string | null;
  summary?: string | null;
  failures?: string[];
  warnings?: string[];
  lanes?: Array<{
    key?: string;
    label?: string;
    attempted?: boolean;
    completed?: boolean;
    resultCount?: number | null;
    failureCount?: number | null;
  }>;
};

type ActiveMarketAttackEvidence = {
  [key: string]: unknown;
  evidenceAccounting?: EvidenceAccounting | null;
  evidenceAccountingReceipt?: string | null;
  sourceCoverage?: SourceCoverage | null;
};

const DISPOSITIONS: Array<{
  key: EvidenceDisposition;
  label: string;
  description: string;
  tone: string;
}> = [
  {
    key: "verified_pricing",
    label: "Verified pricing evidence",
    description: "These fixed-price listings passed the exact-card and product-state rules.",
    tone: "border-emerald-700 bg-emerald-50",
  },
  {
    key: "scouting",
    label: "Review-only scouting",
    description: "Potential matches that are visible for review but cannot affect pricing.",
    tone: "border-amber-700 bg-amber-50",
  },
  {
    key: "packaging_rejected",
    label: "Packaging rejected",
    description: "Listings with a product state that conflicts with the target card.",
    tone: "border-rose-700 bg-rose-50",
  },
  {
    key: "identity_rejected",
    label: "Identity rejected",
    description: "Listings rejected for the wrong player, year, card number, print run, grading, set, parallel, autograph or relic state.",
    tone: "border-rose-700 bg-rose-50",
  },
  {
    key: "auction_only",
    label: "Auction-only",
    description: "Auction listings are documented but never used for fixed-price undercut math.",
    tone: "border-sky-700 bg-sky-50",
  },
  {
    key: "self_listing",
    label: "Your eBay listing",
    description: "Your listing is proved separately and excluded from competitor counts and pricing.",
    tone: "border-violet-700 bg-violet-50",
  },
  {
    key: "unclassified",
    label: "Unclassified — pricing blocked",
    description: "No external listing is allowed to remain here.",
    tone: "border-rose-900 bg-rose-100",
  },
];

const REASON_LABELS: Record<string, string> = {
  seller_listing_excluded_from_competitor_pricing:
    "Seller listing separated from competitor pricing",
  passed_exact_market_rules: "Passed exact-card market rules",
  review_only_not_used_for_pricing: "Review only — not used for pricing",
  packaging_state_conflict: "Packaging or product state conflicts with the target",
  opened_listing_conflicts_with_sealed_target:
    "Opened or ripped listing conflicts with the sealed target",
  sealed_listing_conflicts_with_opened_target:
    "Sealed or unripped listing conflicts with the opened target",
  excluded_listing_format: "Excluded lot, break, reprint, replica or other unsafe format",
  player_mismatch: "Wrong player",
  year_mismatch: "Wrong year",
  missing_year_evidence: "Year is not stated clearly enough",
  card_number_mismatch: "Wrong card number",
  missing_card_number_evidence: "Card number is not stated clearly enough",
  numbered_variant_conflicts_with_unnumbered_target:
    "Numbered variant conflicts with the unnumbered target",
  missing_print_run_evidence: "Serial-number print run is not stated",
  print_run_mismatch: "Wrong serial-number print run",
  autograph_state_mismatch: "Autograph state does not match",
  relic_state_mismatch: "Relic or memorabilia state does not match",
  graded_raw_state_mismatch: "Graded versus raw state does not match",
  set_mismatch: "Set or product line does not match",
  parallel_mismatch: "Parallel or insert does not match",
  auction_not_used_for_pricing: "Auction — not used for fixed-price pricing",
  insufficient_exact_identity_evidence: "Not enough exact-card identity evidence",
  missing_listing_title: "Listing title was unavailable",
};

function currency(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Unknown";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function humanize(value: string | null | undefined) {
  const key = String(value || "").trim();
  if (!key) return "No reason recorded";
  if (REASON_LABELS[key]) return REASON_LABELS[key];
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusText(value: boolean | undefined) {
  return value === true ? "PASSED" : "BLOCKED";
}

export default function ActiveMarketEvidenceLedger({
  attack,
}: {
  attack: ActiveMarketAttackEvidence;
}) {
  const accounting = attack.evidenceAccounting;
  if (!accounting) return null;

  const ledger = Array.isArray(accounting.ledger) ? accounting.ledger : [];
  const counts = accounting.counts || {};
  const coverage = attack.sourceCoverage || null;
  const accountingPassed = accounting.passed === true;
  const coveragePassed = coverage?.passed === true;
  const fullyPassed = accountingPassed && (!coverage || coveragePassed);

  return (
    <section
      className={`mt-4 border-4 border-neutral-950 p-3 ${
        fullyPassed ? "bg-emerald-100" : "bg-rose-100"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em]">
            Active Market Evidence Ledger
          </p>
          <h4 className="mt-1 text-lg font-black">
            {fullyPassed ? "EVERY LISTING ACCOUNTED FOR" : "EVIDENCE REVIEW BLOCKED PRICING"}
          </h4>
        </div>
        <span className="border-2 border-neutral-950 bg-white px-3 py-1 text-xs font-black">
          Accounting {statusText(accounting.passed)}
          {coverage ? ` · Coverage ${statusText(coverage.passed)}` : ""}
        </span>
      </div>

      <p className="mt-2 text-xs font-semibold">
        {accounting.summary ||
          "Every external listing must be classified before active-market pricing can be trusted."}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <LedgerMetric label="External listings" value={accounting.externalCandidateCount} />
        <LedgerMetric label="Verified" value={counts.verifiedPricing} />
        <LedgerMetric label="Scouting" value={counts.scouting} />
        <LedgerMetric label="Packaging rejected" value={counts.packagingRejected} />
        <LedgerMetric label="Identity rejected" value={counts.identityRejected} />
        <LedgerMetric label="Auction-only" value={counts.auctionOnly} />
        <LedgerMetric label="Seller listing" value={counts.selfListing} />
        <LedgerMetric label="Unclassified" value={counts.unclassified} />
        <LedgerMetric
          label="Queries succeeded"
          value={`${Number(accounting.queriesSucceeded || 0)}/${Number(
            accounting.queriesAttempted || 0,
          )}`}
        />
      </div>

      {(accounting.failures || []).length || (coverage?.failures || []).length ? (
        <div className="mt-3 border-2 border-rose-800 bg-white p-3 text-xs">
          <p className="font-black uppercase text-rose-900">Pricing blockers</p>
          <ul className="mt-2 space-y-1 font-semibold text-rose-900">
            {[...(accounting.failures || []), ...(coverage?.failures || [])].map(
              (failure, index) => (
                <li key={`${failure}-${index}`}>• {humanize(failure)}</li>
              ),
            )}
          </ul>
        </div>
      ) : null}

      {coverage ? (
        <details className="mt-3 border-2 border-neutral-950 bg-white p-3 text-xs">
          <summary className="cursor-pointer font-black uppercase">
            Source coverage proof — {statusText(coverage.passed)}
          </summary>
          <p className="mt-2 font-semibold">
            {coverage.summary || "Source coverage details were saved with this scan."}
          </p>
          <div className="mt-3 space-y-2">
            {(coverage.lanes || []).map((lane, index) => (
              <div
                key={`${lane.key || lane.label}-${index}`}
                className="grid grid-cols-[1fr_auto] gap-3 border border-neutral-300 bg-neutral-50 px-3 py-2"
              >
                <div>
                  <p className="font-black">{lane.label || humanize(lane.key)}</p>
                  <p className="mt-1 text-[11px] font-semibold text-neutral-600">
                    {lane.attempted ? "Attempted" : "Not available"} · Results{" "}
                    {lane.resultCount === null || lane.resultCount === undefined
                      ? "unknown"
                      : lane.resultCount}
                    {lane.failureCount !== null && lane.failureCount !== undefined
                      ? ` · Failures ${lane.failureCount}`
                      : ""}
                  </p>
                </div>
                <span
                  className={`self-center border px-2 py-1 font-black ${
                    lane.completed
                      ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                      : "border-rose-500 bg-rose-100 text-rose-900"
                  }`}
                >
                  {lane.completed ? "COMPLETE" : "INCOMPLETE"}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <details className="mt-3 border-2 border-neutral-950 bg-white p-3 text-xs" open>
        <summary className="cursor-pointer font-black uppercase">
          Show every listing and decision ({ledger.length})
        </summary>
        <div className="mt-3 space-y-3">
          {DISPOSITIONS.map((group) => {
            const entries = ledger.filter(
              (entry) => entry.disposition === group.key,
            );
            if (!entries.length) return null;
            return (
              <details
                key={group.key}
                className={`border-2 p-3 ${group.tone}`}
                open={group.key === "verified_pricing" || group.key === "unclassified"}
              >
                <summary className="cursor-pointer font-black uppercase">
                  {group.label} ({entries.length})
                </summary>
                <p className="mt-2 font-semibold">{group.description}</p>
                <div className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                  {entries.map((entry, index) => (
                    <EvidenceRow
                      key={`${entry.id || entry.title || group.key}-${index}`}
                      entry={entry}
                    />
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </details>

      <div className="mt-3 border-2 border-neutral-950 bg-neutral-950 p-3 text-xs text-white">
        <p className="font-black uppercase">Evidence receipt</p>
        <p className="mt-1 break-all font-mono">
          {attack.evidenceAccountingReceipt || "Receipt unavailable — pricing must remain blocked"}
        </p>
      </div>
    </section>
  );
}

function LedgerMetric({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div className="border border-neutral-300 bg-white px-2 py-2">
      <p className="font-black text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-black text-neutral-950">
        {value === null || value === undefined ? "0" : value}
      </p>
    </div>
  );
}

function EvidenceRow({ entry }: { entry: EvidenceEntry }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="font-black">{entry.title || "Untitled eBay listing"}</p>
        <span className="whitespace-nowrap font-black">
          {entry.landedPrice !== null && entry.landedPrice !== undefined
            ? currency(entry.landedPrice)
            : currency(entry.price)}
        </span>
      </div>
      <p className="mt-1 font-semibold text-neutral-600">
        Item {currency(entry.price)} · Shipping {currency(entry.shippingCost)} · Product state{" "}
        {humanize(entry.packagingState)}
        {entry.fixedPrice === false ? " · Auction" : " · Fixed price"}
      </p>
      {(entry.reasons || []).length ? (
        <ul className="mt-2 space-y-1 font-semibold">
          {(entry.reasons || []).map((reason, index) => (
            <li key={`${reason}-${index}`}>• {humanize(reason)}</li>
          ))}
        </ul>
      ) : null}
      {(entry.sourceLanes || []).length || (entry.seenInQueries || []).length ? (
        <div className="mt-2 border-t border-neutral-200 pt-2 text-[11px] font-semibold text-neutral-500">
          {(entry.sourceLanes || []).length ? (
            <p>Sources: {(entry.sourceLanes || []).map(humanize).join(", ")}</p>
          ) : null}
          {(entry.seenInQueries || []).length ? (
            <p className="mt-1">Queries: {(entry.seenInQueries || []).join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  return entry.url ? (
    <a
      href={entry.url}
      target="_blank"
      rel="noreferrer"
      className="block border-2 border-neutral-950 bg-white p-3 hover:bg-neutral-50"
    >
      {content}
    </a>
  ) : (
    <div className="border-2 border-neutral-950 bg-white p-3">{content}</div>
  );
}
