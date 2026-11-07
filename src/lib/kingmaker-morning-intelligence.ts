import { createHash } from "node:crypto";

export type KingmakerIntelSeverity = "info" | "watch" | "action" | "warning";

export type KingmakerIntelItem = {
  key: string;
  title: string;
  detail: string;
  href?: string | null;
  severity: KingmakerIntelSeverity;
  expectedProfit?: number | null;
  roiPercent?: number | null;
  confidence?: number | null;
  observedAt?: string | null;
};

export type KingmakerPortfolioMovement = {
  key: string;
  title: string;
  detail: string;
  href?: string | null;
  movementType:
    | "purchase"
    | "sale"
    | "price_change"
    | "sell_signal"
    | "cooling_signal"
    | "research_debt";
  amount?: number | null;
  observedAt?: string | null;
};

export type KingmakerMorningIntelligenceInput = {
  generatedAt: string;
  truthReady: boolean;
  truthWarnings: string[];
  actionableDeals: KingmakerIntelItem[];
  meaningfulChanges: KingmakerIntelItem[];
  portfolioMovements: KingmakerPortfolioMovement[];
  systemWarnings: string[];
  previousFingerprint?: string | null;
  forceFull?: boolean;
};

export type KingmakerMorningIntelligencePayload = {
  generatedAt: string;
  mode: "full" | "compact" | "withheld";
  shouldDeliver: boolean;
  fingerprint: string;
  subject: string;
  headline: string;
  actionableDeals: KingmakerIntelItem[];
  meaningfulChanges: KingmakerIntelItem[];
  portfolioMovements: KingmakerPortfolioMovement[];
  warnings: string[];
  reason: string;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function finiteOrNull(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(2));
}

function stableIntelItem(item: KingmakerIntelItem) {
  return {
    key: normalizeText(item.key),
    title: normalizeText(item.title),
    detail: normalizeText(item.detail),
    href: item.href || null,
    severity: item.severity,
    expectedProfit: finiteOrNull(item.expectedProfit),
    roiPercent: finiteOrNull(item.roiPercent),
    confidence: finiteOrNull(item.confidence),
  };
}

function stablePortfolioMovement(item: KingmakerPortfolioMovement) {
  return {
    key: normalizeText(item.key),
    title: normalizeText(item.title),
    detail: normalizeText(item.detail),
    href: item.href || null,
    movementType: item.movementType,
    amount: finiteOrNull(item.amount),
  };
}

function stableSort<T extends { key: string }>(items: T[]) {
  return [...items].sort((a, b) => a.key.localeCompare(b.key));
}

export function fingerprintKingmakerMorningIntelligence(
  input: Pick<
    KingmakerMorningIntelligenceInput,
    | "truthReady"
    | "truthWarnings"
    | "actionableDeals"
    | "meaningfulChanges"
    | "portfolioMovements"
    | "systemWarnings"
  >,
) {
  const canonical = {
    truthReady: input.truthReady,
    truthWarnings: [...input.truthWarnings].map(normalizeText).sort(),
    actionableDeals: stableSort(input.actionableDeals.map(stableIntelItem)),
    meaningfulChanges: stableSort(input.meaningfulChanges.map(stableIntelItem)),
    portfolioMovements: stableSort(
      input.portfolioMovements.map(stablePortfolioMovement),
    ),
    systemWarnings: [...input.systemWarnings].map(normalizeText).sort(),
  };

  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export function buildKingmakerMorningIntelligence(
  input: KingmakerMorningIntelligenceInput,
): KingmakerMorningIntelligencePayload {
  const fingerprint = fingerprintKingmakerMorningIntelligence(input);
  const warnings = [...input.truthWarnings, ...input.systemWarnings]
    .map(normalizeText)
    .filter(Boolean);

  if (!input.truthReady) {
    return {
      generatedAt: input.generatedAt,
      mode: "withheld",
      shouldDeliver: true,
      fingerprint,
      subject: "KINGMAKER WARNING — decision-grade intelligence withheld",
      headline: "Truth gates are not healthy enough to issue buying guidance.",
      actionableDeals: [],
      meaningfulChanges: [],
      portfolioMovements: [],
      warnings,
      reason: "truth_not_ready",
    };
  }

  const materialCount =
    input.actionableDeals.length +
    input.meaningfulChanges.length +
    input.portfolioMovements.length +
    warnings.length;
  const unchanged = Boolean(
    input.previousFingerprint && input.previousFingerprint === fingerprint,
  );

  if (!input.forceFull && unchanged) {
    return {
      generatedAt: input.generatedAt,
      mode: "compact",
      shouldDeliver: false,
      fingerprint,
      subject: "KINGMAKER — no material change",
      headline: "No new decision-grade intelligence since the last delivery.",
      actionableDeals: [],
      meaningfulChanges: [],
      portfolioMovements: [],
      warnings: [],
      reason: "duplicate_suppressed",
    };
  }

  if (!input.forceFull && materialCount === 0) {
    return {
      generatedAt: input.generatedAt,
      mode: "compact",
      shouldDeliver: false,
      fingerprint,
      subject: "KINGMAKER — no action required",
      headline: "No verified opportunities or portfolio events require action.",
      actionableDeals: [],
      meaningfulChanges: [],
      portfolioMovements: [],
      warnings: [],
      reason: "no_material_change",
    };
  }

  const actionCount = input.actionableDeals.length;
  const warningSuffix = warnings.length > 0 ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";

  return {
    generatedAt: input.generatedAt,
    mode: "full",
    shouldDeliver: true,
    fingerprint,
    subject: `KINGMAKER Morning Intelligence — ${actionCount} action${actionCount === 1 ? "" : "s"}${warningSuffix}`,
    headline:
      actionCount > 0
        ? `${actionCount} verified opportunity${actionCount === 1 ? " requires" : " require"} owner review.`
        : "Portfolio or system intelligence requires owner review.",
    actionableDeals: input.actionableDeals,
    meaningfulChanges: input.meaningfulChanges,
    portfolioMovements: input.portfolioMovements,
    warnings,
    reason: input.forceFull ? "forced_full" : "material_change",
  };
}
