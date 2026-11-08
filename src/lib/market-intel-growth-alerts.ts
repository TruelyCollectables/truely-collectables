import "server-only";

import { createHash } from "node:crypto";
import { growthProfessionalCardEligibility } from "./market-intel-card-scope";
import {
  getMarketIntelGrowthWorkbench,
  type MarketIntelGrowthProjection,
} from "./market-intel-growth";
import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelGrowthAlertTier =
  | "must_buy"
  | "get_your_dick_hard_deal";

type GrowthAlertQualification = {
  tier: MarketIntelGrowthAlertTier;
  label: string;
  reason: string;
};

type ExistingAlert = {
  id: string;
  listing_id: string;
  alert_fingerprint: string;
  status: string;
  sent_at: string | null;
  metadata: Record<string, unknown>;
};

type IdentityEvidenceRow = {
  id: string;
  subject_id: string | null;
  sport_or_category: string | null;
  manufacturer: string | null;
  brand: string | null;
  product_line: string | null;
  set_name: string | null;
  display_name: string;
};

type SubjectEvidenceRow = {
  id: string;
  priority: number | null;
  notes: string | null;
  sport_or_category: string | null;
  league_or_brand: string | null;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function fingerprint(listingId: string, tier: MarketIntelGrowthAlertTier) {
  return createHash("sha256")
    .update(`growth-spec|${listingId}|${tier}`)
    .digest("hex");
}

function qualifyGrowthAlert(input: {
  projection: MarketIntelGrowthProjection;
  quantity: number;
  subjectPriority: number;
  marketSampleSize: number;
  marketConfidence: number;
}): GrowthAlertQualification | null {
  const projection = input.projection;
  const roi = numberValue(projection.projected_roi_pct);
  const upside = numberValue(projection.upside_multiple);
  const breakEven = projection.break_even_units;
  const expectedSold = projection.expected_units_sold;
  const safetyUnits = numberValue(projection.margin_of_safety_units);
  const strongMarketEvidence =
    input.marketSampleSize >= 2 && input.marketConfidence >= 35;
  const fastBreakEven =
    breakEven !== null &&
    breakEven <= Math.max(2, Math.floor(expectedSold * 0.3));

  if (
    input.quantity >= 5 &&
    projection.unit_delivered_cost <= 2.5 &&
    projection.projected_net_profit >= 100 &&
    roi >= 400 &&
    upside >= 5 &&
    projection.growth_score >= 75 &&
    projection.risk_score <= 45 &&
    input.subjectPriority >= 85 &&
    strongMarketEvidence &&
    fastBreakEven &&
    safetyUnits >= Math.ceil(expectedSold * 0.5)
  ) {
    return {
      tier: "get_your_dick_hard_deal",
      label: "GET YOUR DICK HARD DEAL",
      reason:
        "Extreme licensed-pro non-base lot: very low unit cost, 5×+ modeled upside, strong market evidence, low risk, and rapid break-even.",
    };
  }

  if (
    input.quantity >= 3 &&
    projection.unit_delivered_cost <= 5 &&
    projection.projected_net_profit >= 50 &&
    roi >= 250 &&
    upside >= 4 &&
    projection.growth_score >= 60 &&
    projection.risk_score <= 60 &&
    input.subjectPriority >= 75 &&
    (input.marketSampleSize >= 1 || input.subjectPriority >= 90) &&
    safetyUnits >= 1
  ) {
    return {
      tier: "must_buy",
      label: "MUST BUY",
      reason:
        "High-conviction licensed-pro non-base lot: at least 4× modeled upside, strong projected ROI, meaningful net-profit potential, and inventory remaining after break-even.",
    };
  }

  return null;
}

function normalizeExistingAlert(row: Record<string, unknown>): ExistingAlert {
  return {
    id: String(row.id),
    listing_id: String(row.listing_id),
    alert_fingerprint: String(row.alert_fingerprint),
    status: String(row.status),
    sent_at: row.sent_at ? String(row.sent_at) : null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
  };
}

export async function syncMarketIntelGrowthAlertOutbox() {
  const supabase = createSupabaseServerClient({ admin: true });
  const workbench = await getMarketIntelGrowthWorkbench();
  const candidates = workbench.autoCandidates;
  const identityIds = Array.from(
    new Set(candidates.map(({ listing }) => listing.collectible_identity_id).filter((value): value is string => Boolean(value))),
  );

  const { data: identityData, error: identityError } = identityIds.length
    ? await supabase
        .from("tcos_mi_collectible_identities")
        .select(
          "id,subject_id,sport_or_category,manufacturer,brand,product_line,set_name,display_name",
        )
        .in("id", identityIds)
    : { data: [], error: null };
  if (identityError) throw new Error(identityError.message);

  const identities = (identityData || []) as IdentityEvidenceRow[];
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  const subjectIds = Array.from(
    new Set(identities.map((identity) => identity.subject_id).filter((value): value is string => Boolean(value))),
  );

  const { data: subjectData, error: subjectError } = subjectIds.length
    ? await supabase
        .from("tcos_mi_subjects")
        .select("id,priority,notes,sport_or_category,league_or_brand")
        .in("id", subjectIds)
    : { data: [], error: null };
  if (subjectError) throw new Error(subjectError.message);

  const subjects = (subjectData || []) as SubjectEvidenceRow[];
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

  const { data: existingData, error: existingError } = await supabase
    .from("tcos_mi_alerts")
    .select("id,listing_id,alert_fingerprint,status,sent_at,metadata")
    .order("created_at", { ascending: false });
  if (existingError) throw new Error(existingError.message);

  const existing = (existingData || [])
    .map((row) => normalizeExistingAlert(row as Record<string, unknown>))
    .filter((alert) => alert.metadata.alert_engine === "growth_spec");
  const existingByFingerprint = new Map(
    existing.map((alert) => [alert.alert_fingerprint, alert]),
  );
  const currentFingerprints = new Set<string>();
  const now = new Date().toISOString();
  let qualified = 0;
  let created = 0;
  let refreshed = 0;
  let reopened = 0;

  for (const { listing, projection } of candidates) {
    if (!listing.collectible_identity_id || !listing.identity) continue;
    const identityEvidence = identityById.get(listing.collectible_identity_id);
    if (!identityEvidence) continue;
    const subject = identityEvidence.subject_id
      ? subjectById.get(identityEvidence.subject_id)
      : null;

    const professionalScope = growthProfessionalCardEligibility({
      sportOrCategory:
        subject?.sport_or_category || identityEvidence.sport_or_category,
      leagueOrBrand: subject?.league_or_brand,
      manufacturer: identityEvidence.manufacturer,
      brand: identityEvidence.brand,
      productLine: identityEvidence.product_line,
      setName: identityEvidence.set_name,
      displayName: identityEvidence.display_name,
      listingTitle: listing.original_title,
    });
    if (!professionalScope.eligible) continue;

    const marketSampleSize = numberValue(
      listing.identity.latest_value?.sample_size,
    );
    const marketConfidence = numberValue(
      listing.identity.latest_value?.confidence_score,
    );
    const subjectPriority = numberValue(subject?.priority, 0);
    const qualification = qualifyGrowthAlert({
      projection,
      quantity: listing.quantity,
      subjectPriority,
      marketSampleSize,
      marketConfidence,
    });
    if (!qualification) continue;

    qualified += 1;
    const alertFingerprint = fingerprint(listing.id, qualification.tier);
    currentFingerprints.add(alertFingerprint);
    const catalyst = noteValue(subject?.notes, "Catalyst");
    const roi = nullableNumber(projection.projected_roi_pct);
    const upside = nullableNumber(projection.upside_multiple);
    const prior = existingByFingerprint.get(alertFingerprint);
    const priorUnitCost = nullableNumber(prior?.metadata.unit_delivered_cost);
    const materiallyCheaper =
      prior?.status === "sent" &&
      priorUnitCost !== null &&
      projection.unit_delivered_cost <= priorUnitCost * 0.85;

    const payload = {
      listing_id: listing.id,
      deal_score_id: null,
      alert_fingerprint: alertFingerprint,
      alert_type: listing.quantity > 1 ? "wholesale" : "deal",
      deal_label: qualification.tier,
      title: `${qualification.label} — ${listing.original_title}`,
      summary: `${qualification.reason} Projection is a future-exit scenario, not a guaranteed return.`,
      direct_url: listing.direct_url,
      delivered_cost: listing.delivered_price,
      market_value:
        listing.identity.latest_value?.conservative_value || null,
      expected_net_profit: projection.projected_net_profit,
      buy_score: projection.growth_score,
      last_qualified_at: now,
      metadata: {
        alert_engine: "growth_spec",
        alert_tier: qualification.tier,
        marketplace: listing.marketplace_name,
        quantity: listing.quantity,
        unit_delivered_cost: projection.unit_delivered_cost,
        target_exit_price: 25,
        expected_units_sold: projection.expected_units_sold,
        projected_net_proceeds: projection.projected_net_proceeds,
        projected_net_profit: projection.projected_net_profit,
        projected_roi_pct: roi,
        upside_multiple: upside,
        break_even_units: projection.break_even_units,
        margin_of_safety_units: projection.margin_of_safety_units,
        growth_score: projection.growth_score,
        risk_score: projection.risk_score,
        confidence_score: marketConfidence,
        liquidity_score:
          listing.identity.latest_value?.liquidity_score || 0,
        market_sample_size: marketSampleSize,
        subject_priority: subjectPriority,
        catalyst,
        professional_scope: professionalScope.scope,
        professional_scope_reasons: professionalScope.reasons,
        disclaimer: "Future-exit scenario; not a guaranteed return.",
      },
    };

    if (prior) {
      const updatePayload: Record<string, unknown> = payload;
      if (prior.status === "expired" || materiallyCheaper) {
        updatePayload.status = "pending";
        updatePayload.first_qualified_at = now;
        updatePayload.sent_at = null;
        updatePayload.dismissed_at = null;
        reopened += 1;
      }
      const { error } = await supabase
        .from("tcos_mi_alerts")
        .update(updatePayload)
        .eq("id", prior.id);
      if (error) throw new Error(error.message);
      refreshed += 1;
    } else {
      const { error } = await supabase.from("tcos_mi_alerts").insert({
        ...payload,
        status: "pending",
        first_qualified_at: now,
      });
      if (error) throw new Error(error.message);
      created += 1;
    }
  }

  const pendingToExpire = existing.filter(
    (alert) =>
      alert.status === "pending" &&
      !currentFingerprints.has(alert.alert_fingerprint),
  );
  if (pendingToExpire.length > 0) {
    const { error } = await supabase
      .from("tcos_mi_alerts")
      .update({ status: "expired" })
      .in(
        "id",
        pendingToExpire.map((alert) => alert.id),
      );
    if (error) throw new Error(error.message);
  }

  const { data: pendingData, error: pendingError } = await supabase
    .from("tcos_mi_alerts")
    .select("id,deal_label,title,direct_url,buy_score,metadata,created_at")
    .eq("status", "pending")
    .order("buy_score", { ascending: false });
  if (pendingError) throw new Error(pendingError.message);

  const pending = (pendingData || []).filter(
    (row) =>
      (row.metadata as Record<string, unknown> | null)?.alert_engine ===
      "growth_spec",
  );

  return {
    qualified,
    created,
    refreshed,
    reopened,
    expired: pendingToExpire.length,
    pending,
  };
}
