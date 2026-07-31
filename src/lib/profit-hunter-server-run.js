import "server-only";

import { createHash } from "node:crypto";
import { Resend } from "resend";
import { EbayBrowseAdapter } from "../../connectors/tcos-market-intel-mcp/src/public-search.mjs";
import {
  buildDealHunterEbayQueryFamilies,
  DEFAULT_BASEBALL_PROSPECTS,
  screenDealHunterEbayTitle,
} from "./deal-hunter-ebay-query-families.js";
import { getMarketIntelDealWorkbench } from "./market-intel-deals";
import { getMarketIntelDeliveryConfig } from "./market-intel-delivery";
import { runMarketIntelHotWatch } from "./market-intel-hot-watch";
import { createSupabaseServerClient } from "./supabase-server";

const MOUNTAIN_TIME_ZONE = "America/Denver";
const PROFIT_HUNTER_HOURS = Object.freeze([7, 9, 11, 13, 15, 17, 19, 21]);
const EXPECTED_WNBA_FAMILIES = 15;
const EXPECTED_MICHKOV_YOUNG_GUNS_FAMILIES = 8;
const EXPECTED_MICHKOV_OPC_FAMILIES = 10;
const EXPECTED_IVAN_FAMILIES = 3;
const EXPECTED_PROSPECT_FAMILIES = DEFAULT_BASEBALL_PROSPECTS.length * 2;
const EXPECTED_SIGNED_BASEBALL_FAMILIES = DEFAULT_BASEBALL_PROSPECTS.length;
const EXPECTED_TOTAL_FAMILIES =
  EXPECTED_WNBA_FAMILIES +
  EXPECTED_MICHKOV_YOUNG_GUNS_FAMILIES +
  EXPECTED_MICHKOV_OPC_FAMILIES +
  EXPECTED_IVAN_FAMILIES +
  EXPECTED_PROSPECT_FAMILIES +
  EXPECTED_SIGNED_BASEBALL_FAMILIES;

const OPC_PLATINUM_FAMILIES = Object.freeze([
  {
    familyId: "matvei-michkov-opc-platinum.exact-o-pee-chee-rainbow",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Michkov 2024-25 O-Pee-Chee Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.opc-rainbow",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Michkov 2024-25 OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.o-pee-chee-no-punctuation",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Michkov 2024-25 O Pee Chee Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.color-numbered-parallels",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Michkov OPC Platinum rookie parallel color numbered",
  },
  {
    familyId: "matvei-michkov-opc-platinum.rookie-autographs",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Michkov O-Pee-Chee Platinum rookie autograph auto",
  },
  {
    familyId: "matvei-michkov-opc-platinum.matvey-first-name",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvey Michkov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.matei-first-name",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matei Michkov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.michov-surname",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Michov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.mikhkov-surname",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Matvei Mikhkov OPC Platinum Rainbow rookie",
  },
  {
    familyId: "matvei-michkov-opc-platinum.mitchkov-surname",
    scope: "matvei_michkov_opc_platinum",
    lane: "opc_platinum_rookie_rainbow_or_better",
    watchedPerson: "Matvei Michkov",
    itemType: "opc_platinum_rookie_parallel_or_autograph",
    query: "Mitchkov OPC Platinum rookie parallel Philadelphia Flyers",
  },
]);

const OPC_NAME_SIGNAL = /\b(michkov|michov|mikhkov|mitchkov)\b/i;
const OPC_CANONICAL_NAME = /\bmatvei\s+michkov\b/i;
const OPC_PRODUCT_SIGNAL = /\b(?:o[\s.-]?pee[\s.-]?chee|opc)\s+platinum\b/i;
const OPC_EXPLICIT_BASE = /\bbase(?:\s+card)?\b/i;
const OPC_PROHIBITED =
  /\b(custom|reprint|facsimile|digital card|nft|mystery|break spot|box break|case break|replica|checklist)\b/i;
const OPC_RAINBOW_OR_BETTER =
  /\b(rainbow|retro rainbow|sunset|yellow traxx|red prism|violet pixels|arctic freeze|emerald surge|orange checkers|seismic gold|golden treasures|neon yellow|aqua marine|blue rainbow|pink matte|color wheel|parallel|numbered|serial numbered|auto|autograph|signature)\b|\/\d{1,4}\b/i;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeText(value) {
  return String(value ?? "").trim();
}

function money(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "Unknown";
}

function denverParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MOUNTAIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
  };
}

export function getProfitHunterScheduleState(date = new Date()) {
  const mountain = denverParts(date);
  return {
    ...mountain,
    timeZone: MOUNTAIN_TIME_ZONE,
    allowed: PROFIT_HUNTER_HOURS.includes(mountain.hour),
    slot: `${String(mountain.hour).padStart(2, "0")}00`,
    scheduledHours: [...PROFIT_HUNTER_HOURS],
  };
}

function rawEbayItem(entry) {
  return (
    entry?.rawPayload?.raw_payload ||
    entry?.rawPayload?.rawPayload ||
    entry?.rawPayload ||
    {}
  );
}

function extractItemId(entry) {
  const raw = rawEbayItem(entry);
  const direct = safeText(raw.itemId || raw.legacyItemId);
  if (direct) return direct;
  return safeText(entry?.url).match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/i)?.[1] || null;
}

function screenOpcTitle(title) {
  const value = safeText(title);
  const rejectionReasons = [];
  const reviewReasons = [];
  if (!value) rejectionReasons.push("missing_title");
  if (OPC_PROHIBITED.test(value)) {
    rejectionReasons.push("custom_reprint_digital_break_mystery_or_checklist");
  }
  if (!OPC_NAME_SIGNAL.test(value)) {
    rejectionReasons.push("michkov_name_or_variant_not_claimed");
  }
  if (!OPC_PRODUCT_SIGNAL.test(value)) {
    rejectionReasons.push("opc_platinum_product_not_claimed");
  }
  if (OPC_EXPLICIT_BASE.test(value) && !OPC_RAINBOW_OR_BETTER.test(value)) {
    rejectionReasons.push("ordinary_base_excluded");
  } else if (!OPC_RAINBOW_OR_BETTER.test(value)) {
    reviewReasons.push("rainbow_or_better_not_proven_from_title_verify_images");
  }
  if (!/\b(rookie|rc)\b/i.test(value)) {
    reviewReasons.push("rookie_status_not_explicit_verify_exact_card");
  }
  if (!OPC_CANONICAL_NAME.test(value)) {
    reviewReasons.push("seller_name_variant_or_misspelling_detected_verify_images");
  }
  return {
    accepted: rejectionReasons.length === 0,
    manualReviewRequired: reviewReasons.length > 0,
    rejectionReasons,
    reviewReasons,
  };
}

function normalizeCandidate(entry, family, screening) {
  const raw = rawEbayItem(entry);
  const itemPrice = finiteNumber(entry.askingPrice);
  const shipping = finiteNumber(entry.shipping);
  const buyerFees = finiteNumber(entry.buyerFees);
  const tax = finiteNumber(entry.tax);
  const knownDeliveredCost =
    itemPrice === null
      ? null
      : itemPrice + (shipping || 0) + (buyerFees || 0) + (tax || 0);
  return {
    candidateId: extractItemId(entry)
      ? `ebay:${extractItemId(entry)}`
      : `ebay-url:${safeText(entry.url)}`,
    marketplace: "eBay",
    listingItemId: extractItemId(entry),
    listingUrl: safeText(entry.url),
    title: safeText(entry.title),
    watchedPerson: family.watchedPerson,
    scope: family.scope,
    lane: family.lane,
    itemType: family.itemType,
    queryFamilyIds: [family.familyId],
    itemPrice,
    inboundShipping: shipping,
    buyerFees,
    tax,
    knownDeliveredCost,
    sellerName: safeText(entry.sellerName) || safeText(raw.seller?.username) || null,
    condition: safeText(raw.condition || raw.conditionId) || null,
    buyingOptions: Array.isArray(raw.buyingOptions)
      ? raw.buyingOptions.map(String)
      : [],
    itemCreationDate: raw.itemCreationDate || null,
    itemEndDate: raw.itemEndDate || null,
    imageUrls: Array.from(
      new Set(
        [
          ...(entry.imageUrls || []),
          raw.image?.imageUrl,
          ...(raw.thumbnailImages || []).map((image) => image?.imageUrl),
        ].filter(Boolean),
      ),
    ).slice(0, 12),
    manualReviewRequired: Boolean(
      entry.manualReviewRequired || screening.manualReviewRequired,
    ),
    preliminaryRisks: [...(screening.reviewReasons || [])],
    exactCompStatus: "NOT_YET_VERIFIED",
    purchaseReady: false,
  };
}

function mergeCandidate(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    queryFamilyIds: Array.from(
      new Set([...existing.queryFamilyIds, ...incoming.queryFamilyIds]),
    ),
    scopes: Array.from(
      new Set([...(existing.scopes || [existing.scope]), incoming.scope]),
    ),
    lanes: Array.from(
      new Set([...(existing.lanes || [existing.lane]), incoming.lane]),
    ),
    preliminaryRisks: Array.from(
      new Set([
        ...(existing.preliminaryRisks || []),
        ...(incoming.preliminaryRisks || []),
      ]),
    ),
    imageUrls: Array.from(
      new Set([...(existing.imageUrls || []), ...(incoming.imageUrls || [])]),
    ).slice(0, 12),
    manualReviewRequired:
      existing.manualReviewRequired || incoming.manualReviewRequired,
  };
}

function allFamilies() {
  return [
    ...buildDealHunterEbayQueryFamilies({ scope: "wnba" }),
    ...buildDealHunterEbayQueryFamilies({ scope: "ivan_demidov" }),
    ...buildDealHunterEbayQueryFamilies({ scope: "matvei_michkov_young_guns" }),
    ...OPC_PLATINUM_FAMILIES,
    ...buildDealHunterEbayQueryFamilies({
      scope: "baseball_prospects",
      players: DEFAULT_BASEBALL_PROSPECTS,
    }),
    ...buildDealHunterEbayQueryFamilies({
      scope: "signed_baseballs",
      players: DEFAULT_BASEBALL_PROSPECTS,
    }),
  ];
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );
  return results;
}

async function runNativeDiscovery({ perQuery = 20 } = {}) {
  const families = allFamilies();
  if (families.length !== EXPECTED_TOTAL_FAMILIES) {
    throw new Error(
      `Profit Hunter family contract mismatch: expected ${EXPECTED_TOTAL_FAMILIES}, received ${families.length}.`,
    );
  }
  const adapter = new EbayBrowseAdapter();
  if (!adapter.configured) {
    throw new Error("Production eBay Browse client is not configured.");
  }

  const outcomes = await mapWithConcurrency(families, 8, async (family) => {
    const startedAt = Date.now();
    const result = await adapter.search({
      query: family.query,
      sources: ["eBay"],
      filters: {},
      maxResults: Math.max(5, Math.min(20, Number(perQuery) || 20)),
    });
    const accepted = [];
    const rejectionCounts = {};
    for (const entry of result.results || []) {
      const screening =
        family.scope === "matvei_michkov_opc_platinum"
          ? screenOpcTitle(entry.title)
          : screenDealHunterEbayTitle({ title: entry.title, family });
      if (!screening.accepted) {
        for (const reason of screening.rejectionReasons || []) {
          rejectionCounts[reason] = Number(rejectionCounts[reason] || 0) + 1;
        }
        continue;
      }
      accepted.push(normalizeCandidate(entry, family, screening));
    }
    return {
      family,
      coverage: {
        familyId: family.familyId,
        scope: family.scope,
        lane: family.lane,
        watchedPerson: family.watchedPerson,
        query: family.query,
        status: "COMPLETE",
        rawResultCount: result.results?.length || 0,
        acceptedResultCount: accepted.length,
        rejectedResultCount: (result.results?.length || 0) - accepted.length,
        rejectionCounts,
        warnings: result.warnings || [],
        durationMs: Date.now() - startedAt,
      },
      accepted,
    };
  });

  const coverage = [];
  const errors = [];
  const deduplicated = new Map();
  outcomes.forEach((outcome, index) => {
    const family = families[index];
    if (outcome.status === "rejected") {
      const error =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      coverage.push({
        familyId: family.familyId,
        scope: family.scope,
        lane: family.lane,
        watchedPerson: family.watchedPerson,
        query: family.query,
        status: "FAILED",
        rawResultCount: 0,
        acceptedResultCount: 0,
        rejectedResultCount: 0,
        rejectionCounts: {},
        warnings: [],
        error,
      });
      errors.push({ familyId: family.familyId, error });
      return;
    }
    coverage.push(outcome.value.coverage);
    for (const candidate of outcome.value.accepted) {
      const key = candidate.listingItemId || candidate.listingUrl;
      if (!key) continue;
      deduplicated.set(key, mergeCandidate(deduplicated.get(key), candidate));
    }
  });

  const candidates = [...deduplicated.values()].sort((left, right) => {
    const leftCost = left.knownDeliveredCost ?? Number.POSITIVE_INFINITY;
    const rightCost = right.knownDeliveredCost ?? Number.POSITIVE_INFINITY;
    return leftCost - rightCost;
  });
  const successfulQueryCount = coverage.filter(
    (entry) => entry.status === "COMPLETE",
  ).length;
  return {
    schema: "TCOS_PROFIT_HUNTER_SERVER_V1",
    nativeEbayUsed: successfulQueryCount > 0,
    tokenMode: "client_credentials",
    queryFamilyCount: families.length,
    successfulQueryCount,
    failedQueryCount: errors.length,
    complete:
      errors.length === 0 &&
      successfulQueryCount === EXPECTED_TOTAL_FAMILIES,
    rawResultCount: coverage.reduce(
      (sum, entry) => sum + Number(entry.rawResultCount || 0),
      0,
    ),
    deduplicatedResultCount: candidates.length,
    candidates,
    coverage,
    errors,
  };
}

function compactActionableDeal(listing) {
  const score = listing.score || {};
  const market = listing.identity?.latest_value || {};
  const delivered = finiteNumber(score.delivered_cost);
  const netProfit = finiteNumber(score.expected_net_profit);
  const netRoi =
    delivered && delivered > 0 && netProfit !== null
      ? (netProfit / delivered) * 100
      : null;
  const netProceeds =
    finiteNumber(score.conservative_resale_value) === null
      ? null
      : Number(score.conservative_resale_value) -
        Number(score.expected_seller_fees || 0) -
        Number(score.expected_outbound_shipping || 0) -
        Number(score.expected_supplies || 0);
  return {
    listingId: listing.id,
    title: listing.original_title,
    exactIdentity: listing.identity?.display_name || null,
    marketplace: listing.marketplace?.name || null,
    sellerName: listing.seller_name || null,
    directUrl: listing.direct_url,
    itemPrice: finiteNumber(listing.asking_price),
    shipping: finiteNumber(listing.shipping_price),
    buyerFee: finiteNumber(listing.buyer_fee),
    deliveredCost: delivered,
    conservativeResale: finiteNumber(score.conservative_resale_value),
    medianMarketValue: finiteNumber(market.median_value),
    averageMarketValue: finiteNumber(market.average_value),
    lowMarketValue: finiteNumber(market.low_value),
    highMarketValue: finiteNumber(market.high_value),
    exactSoldCount: finiteNumber(market.sample_size),
    compConfidence: finiteNumber(market.confidence_score),
    liquidity: finiteNumber(market.liquidity_score),
    expectedSellerFees: finiteNumber(score.expected_seller_fees),
    expectedOutboundShipping: finiteNumber(score.expected_outbound_shipping),
    expectedSupplies: finiteNumber(score.expected_supplies),
    expectedNetSaleProceeds: netProceeds,
    expectedNetProfit: netProfit,
    expectedNetRoiPercent: netRoi,
    maximumDeliveredCostFor20PercentRoi:
      netProceeds === null ? null : netProceeds / 1.2,
    dealLabel: score.deal_label || null,
    buyScore: finiteNumber(score.buy_score),
    reason: score.reason || null,
    riskNotes: score.risk_notes || null,
  };
}

function buildMarkdown({ schedule, discovery, hotWatch, actionableDeals }) {
  const lines = [
    "# TCOS Profit Hunter™ — Server Run",
    `**Mountain slot:** ${schedule.date} ${schedule.slot}`,
    `**Native eBay coverage:** ${discovery.successfulQueryCount}/${discovery.queryFamilyCount} families`,
    `**Raw observations:** ${discovery.rawResultCount}`,
    `**Deduplicated discovery candidates:** ${discovery.deduplicatedResultCount}`,
    `**Exact-comp actionable deals:** ${actionableDeals.length}`,
    "",
    "## Exact-Comp Deals",
  ];
  if (!actionableDeals.length) {
    lines.push(
      "No listing cleared the exact identity, verified sold-comp, delivered-cost, and net-profit gates in this cycle.",
    );
  } else {
    for (const deal of actionableDeals.slice(0, 20)) {
      lines.push(
        `- **${safeText(deal.dealLabel).replaceAll("_", " ").toUpperCase()} — ${deal.title}**`,
        `  - Delivered ${money(deal.deliveredCost)} | Normal market ${money(deal.conservativeResale)} | Net profit ${money(deal.expectedNetProfit)} | Net ROI ${deal.expectedNetRoiPercent === null ? "Unknown" : `${deal.expectedNetRoiPercent.toFixed(1)}%`}`,
        `  - Exact comp sample ${deal.exactSoldCount ?? 0} | Confidence ${deal.compConfidence ?? 0} | Max delivered for 20% ROI ${money(deal.maximumDeliveredCostFor20PercentRoi)}`,
        `  - ${deal.directUrl}`,
      );
    }
  }
  lines.push("", "## Discovery Coverage by Lane");
  const laneSummary = new Map();
  for (const row of discovery.coverage) {
    const key = `${row.scope}:${row.watchedPerson || row.lane}`;
    const current = laneSummary.get(key) || {
      scope: row.scope,
      watchedPerson: row.watchedPerson,
      queries: 0,
      raw: 0,
      accepted: 0,
      failed: 0,
    };
    current.queries += 1;
    current.raw += Number(row.rawResultCount || 0);
    current.accepted += Number(row.acceptedResultCount || 0);
    if (row.status !== "COMPLETE") current.failed += 1;
    laneSummary.set(key, current);
  }
  for (const summary of laneSummary.values()) {
    lines.push(
      `- ${summary.watchedPerson || summary.scope}: ${summary.queries} queries, ${summary.raw} raw, ${summary.accepted} accepted, ${summary.failed} failed`,
    );
  }
  lines.push(
    "",
    "## Market Watch Engine",
    `- Hot Watch searched ${hotWatch?.targetResults?.length || 0} exact identities.`,
    `- Qualified alerts: ${hotWatch?.alerts?.qualified || 0}; newly created: ${hotWatch?.alerts?.created || 0}; pending: ${hotWatch?.alerts?.pending || 0}.`,
    `- Email delivery attempted: ${Boolean(hotWatch?.delivery?.attempted)}; delivered: ${hotWatch?.delivery?.delivered || 0}.`,
    "",
    "Discovery-only candidates are never labeled as buys until InstaComp/exact identity and verified completed-sale evidence support the economics.",
  );
  if (discovery.errors.length) {
    lines.push("", "## Errors");
    for (const error of discovery.errors) {
      lines.push(`- ${error.familyId}: ${error.error}`);
    }
  }
  return lines.join("\n");
}

async function saveReport({ schedule, discovery, hotWatch, actionableDeals, markdown }) {
  const supabase = createSupabaseServerClient({ admin: true });
  const generatedAt = new Date().toISOString();
  const reportType = "hourly_deals";
  const status = discovery.complete ? "generated" : "failed";
  const headline = discovery.complete
    ? `${discovery.successfulQueryCount}/${discovery.queryFamilyCount} native families; ${actionableDeals.length} exact-comp deal${actionableDeals.length === 1 ? "" : "s"}`
    : `${discovery.failedQueryCount} native family failure${discovery.failedQueryCount === 1 ? "" : "s"}`;
  const reportJson = {
    schema: "TCOS_PROFIT_HUNTER_SERVER_V1",
    schedule,
    summary: {
      nativeEbayUsed: discovery.nativeEbayUsed,
      queryFamilyCount: discovery.queryFamilyCount,
      successfulQueryCount: discovery.successfulQueryCount,
      failedQueryCount: discovery.failedQueryCount,
      rawResultCount: discovery.rawResultCount,
      deduplicatedResultCount: discovery.deduplicatedResultCount,
      exactCompActionableCount: actionableDeals.length,
    },
    actionableDeals,
    discoveryCandidates: discovery.candidates.slice(0, 250),
    sourceCoverage: discovery.coverage,
    errors: discovery.errors,
    hotWatch,
  };
  const checksum = createHash("sha256")
    .update(
      JSON.stringify({
        date: schedule.date,
        slot: schedule.slot,
        summary: reportJson.summary,
        candidateIds: reportJson.discoveryCandidates.map((row) => row.candidateId),
      }),
    )
    .digest("hex");
  const payload = {
    report_date: schedule.date,
    report_type: reportType,
    status,
    headline,
    report_markdown: markdown,
    report_json: reportJson,
    generated_at: generatedAt,
    delivered_at: null,
    error_message: discovery.complete
      ? null
      : discovery.errors.map((error) => `${error.familyId}: ${error.error}`).join(" | ").slice(0, 5000),
    metadata: {
      source: "vercel_server_cron",
      time_zone: MOUNTAIN_TIME_ZONE,
      slot: schedule.slot,
      checksum,
      deployment_sha:
        safeText(process.env.VERCEL_GIT_COMMIT_SHA).slice(0, 40) || null,
      deployment_region: process.env.VERCEL_REGION || null,
    },
  };
  const { data, error } = await supabase
    .from("tcos_mi_report_runs")
    .upsert(payload, { onConflict: "report_date,report_type" })
    .select("*")
    .single();
  if (error) throw new Error(`Unable to save Profit Hunter run: ${error.message}`);
  return data;
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendOperationalEmail({ report, discovery, actionableDeals, recovered }) {
  const config = getMarketIntelDeliveryConfig();
  if (!config.enabled || !config.configured || !config.apiKey || !config.from) {
    return { attempted: false, delivered: false, reason: "Market Intel email is not configured." };
  }
  const sendEveryRun =
    safeText(process.env.PROFIT_HUNTER_EMAIL_EVERY_RUN).toLowerCase() === "true";
  const shouldSend =
    sendEveryRun ||
    recovered ||
    !discovery.complete ||
    actionableDeals.length > 0;
  if (!shouldSend) {
    return { attempted: false, delivered: false, reason: "No new actionable or operational status change." };
  }
  const subject = !discovery.complete
    ? `TCOS Profit Hunter FAILED — ${discovery.failedQueryCount} native search families`
    : recovered
      ? `TCOS Profit Hunter RESTORED — ${discovery.successfulQueryCount}/${discovery.queryFamilyCount} native searches`
      : actionableDeals.length
        ? `TCOS Profit Hunter — ${actionableDeals.length} exact-comp deal${actionableDeals.length === 1 ? "" : "s"}`
        : `TCOS Profit Hunter completed — ${discovery.successfulQueryCount}/${discovery.queryFamilyCount}`;
  const resend = new Resend(config.apiKey);
  const { data, error } = await resend.emails.send({
    from: config.from,
    to: config.recipients,
    subject: subject.slice(0, 180),
    text: report.report_markdown,
    html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f1ea;color:#111;margin:0;padding:24px"><main style="max-width:820px;margin:auto;background:white;border:1px solid #ddd;border-radius:16px;padding:24px"><h1>${escapeHtml(subject)}</h1><pre style="white-space:pre-wrap;font:14px/1.55 Arial,Helvetica,sans-serif">${escapeHtml(report.report_markdown)}</pre></main></body></html>`,
  });
  if (error || !data?.id) {
    return {
      attempted: true,
      delivered: false,
      reason: error?.message || "Resend did not return an email ID.",
    };
  }
  const supabase = createSupabaseServerClient({ admin: true });
  await supabase
    .from("tcos_mi_report_runs")
    .update({
      delivered_at: new Date().toISOString(),
      metadata: {
        ...(report.metadata || {}),
        email_id: data.id,
        recipients: config.recipients,
      },
    })
    .eq("id", report.id);
  return { attempted: true, delivered: true, emailId: data.id };
}

async function previousProfitHunterRun() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_report_runs")
    .select("id,status,generated_at,report_type")
    .eq("report_type", "hourly_deals")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

export async function runProfitHunterServerCycle({ perQuery = 20 } = {}) {
  const startedAt = Date.now();
  const schedule = getProfitHunterScheduleState();
  const previous = await previousProfitHunterRun();
  const discovery = await runNativeDiscovery({ perQuery });
  let hotWatch = null;
  let hotWatchError = null;
  try {
    hotWatch = await runMarketIntelHotWatch({
      maxSubjects: 3,
      maxIdentities: 6,
      resultsPerQuery: 8,
      minimumConfidence: 55,
    });
  } catch (error) {
    hotWatchError = error instanceof Error ? error.message : String(error);
  }
  const workbench = await getMarketIntelDealWorkbench();
  const actionableDeals = (workbench.listings || [])
    .filter(
      (listing) =>
        listing.listing_status === "active" &&
        listing.score?.actionable === true,
    )
    .map(compactActionableDeal)
    .filter(
      (deal) =>
        deal.expectedNetRoiPercent !== null &&
        deal.expectedNetRoiPercent >= 20 &&
        Number(deal.exactSoldCount || 0) >= 2,
    )
    .sort(
      (left, right) =>
        Number(right.expectedNetRoiPercent || 0) -
        Number(left.expectedNetRoiPercent || 0),
    )
    .slice(0, 25);
  if (hotWatchError) {
    discovery.errors.push({ familyId: "market-intel-hot-watch", error: hotWatchError });
    discovery.failedQueryCount += 1;
    discovery.complete = false;
  }
  const markdown = buildMarkdown({
    schedule,
    discovery,
    hotWatch,
    actionableDeals,
  });
  const report = await saveReport({
    schedule,
    discovery,
    hotWatch,
    actionableDeals,
    markdown,
  });
  const recovered = Boolean(
    discovery.complete && previous && previous.status === "failed",
  );
  const email = await sendOperationalEmail({
    report,
    discovery,
    actionableDeals,
    recovered,
  });
  return {
    ok: discovery.complete,
    schema: "TCOS_PROFIT_HUNTER_SERVER_V1",
    schedule,
    reportId: report.id,
    reportType: report.report_type,
    nativeEbayUsed: discovery.nativeEbayUsed,
    queryFamilyCount: discovery.queryFamilyCount,
    successfulQueryCount: discovery.successfulQueryCount,
    failedQueryCount: discovery.failedQueryCount,
    rawResultCount: discovery.rawResultCount,
    deduplicatedResultCount: discovery.deduplicatedResultCount,
    exactCompActionableCount: actionableDeals.length,
    hotWatch: hotWatch
      ? {
          targetCount: hotWatch.targetResults?.length || 0,
          alerts: hotWatch.alerts || null,
          delivery: hotWatch.delivery || null,
        }
      : null,
    email,
    durationMs: Date.now() - startedAt,
    errors: discovery.errors,
  };
}

export const PROFIT_HUNTER_SERVER_CONTRACT = Object.freeze({
  timeZone: MOUNTAIN_TIME_ZONE,
  scheduledHours: [...PROFIT_HUNTER_HOURS],
  expectedTotalFamilies: EXPECTED_TOTAL_FAMILIES,
  expectedWnbaFamilies: EXPECTED_WNBA_FAMILIES,
  expectedMichkovYoungGunsFamilies: EXPECTED_MICHKOV_YOUNG_GUNS_FAMILIES,
  expectedMichkovOpcFamilies: EXPECTED_MICHKOV_OPC_FAMILIES,
});
