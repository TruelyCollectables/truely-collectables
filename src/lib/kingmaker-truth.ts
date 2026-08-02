export const KINGMAKER_SOURCE_TYPES = [
  "ebay",
  "mercari",
  "poshmark",
  "comc",
  "whatnot",
  "fanatics_collect",
  "collx",
  "facebook",
  "card_show",
  "dealer",
  "private_seller",
  "seller_sweep",
  "manual",
  "other",
] as const;

export const KINGMAKER_LIFECYCLE_STATUSES = [
  "new",
  "reviewing",
  "watching",
  "offer_planned",
  "offer_sent",
  "bought",
  "passed",
  "expired",
  "lost",
  "cancelled",
  "archived",
] as const;

export const KINGMAKER_OWNER_DECISIONS = [
  "buy",
  "make_offer",
  "watch",
  "pass",
  "research",
  "ignore",
] as const;

export type KingmakerSourceType = (typeof KINGMAKER_SOURCE_TYPES)[number];
export type KingmakerLifecycleStatus =
  (typeof KINGMAKER_LIFECYCLE_STATUSES)[number];
export type KingmakerOwnerDecision =
  (typeof KINGMAKER_OWNER_DECISIONS)[number];

export type KingmakerOpportunityTruth = {
  lifecycleStatus: KingmakerLifecycleStatus;
  ownerDecision: KingmakerOwnerDecision | null;
  identityStatus:
    | "review_required"
    | "verified_exact"
    | "rejected_conflict"
    | "unavailable";
  marketStatus:
    | "unverified"
    | "verified_completed_sales"
    | "insufficient_sales"
    | "stale"
    | "unavailable";
  purchaseLotId: string | null;
};

const TERMINAL_STATUSES = new Set<KingmakerLifecycleStatus>([
  "bought",
  "passed",
  "expired",
  "lost",
  "cancelled",
  "archived",
]);

const ALLOWED_TRANSITIONS: Record<
  KingmakerLifecycleStatus,
  ReadonlySet<KingmakerLifecycleStatus>
> = {
  new: new Set(["reviewing", "watching", "offer_planned", "passed", "expired", "archived"]),
  reviewing: new Set(["watching", "offer_planned", "offer_sent", "bought", "passed", "expired", "lost", "archived"]),
  watching: new Set(["reviewing", "offer_planned", "offer_sent", "bought", "passed", "expired", "lost", "archived"]),
  offer_planned: new Set(["reviewing", "offer_sent", "bought", "passed", "expired", "lost"]),
  offer_sent: new Set(["reviewing", "bought", "passed", "expired", "lost"]),
  bought: new Set(["cancelled", "archived"]),
  passed: new Set(["reviewing", "watching", "archived"]),
  expired: new Set(["reviewing", "watching", "archived"]),
  lost: new Set(["reviewing", "watching", "archived"]),
  cancelled: new Set(["reviewing", "archived"]),
  archived: new Set(),
};

export function canTransitionKingmakerOpportunity(
  from: KingmakerLifecycleStatus,
  to: KingmakerLifecycleStatus,
) {
  return from === to || ALLOWED_TRANSITIONS[from].has(to);
}

export function assertKingmakerTransition(
  from: KingmakerLifecycleStatus,
  to: KingmakerLifecycleStatus,
) {
  if (!canTransitionKingmakerOpportunity(from, to)) {
    throw new Error(`KINGMAKER lifecycle transition ${from} -> ${to} is not allowed.`);
  }
}

export function kingmakerDecisionToStatus(
  decision: KingmakerOwnerDecision,
): KingmakerLifecycleStatus {
  if (decision === "buy") return "reviewing";
  if (decision === "make_offer") return "offer_planned";
  if (decision === "watch") return "watching";
  if (decision === "pass" || decision === "ignore") return "passed";
  return "reviewing";
}

export function validateKingmakerTruth(input: KingmakerOpportunityTruth) {
  const warnings: string[] = [];

  if (input.lifecycleStatus === "bought" && !input.purchaseLotId) {
    warnings.push("bought_without_purchase_lot");
  }
  if (input.purchaseLotId && input.lifecycleStatus !== "bought") {
    warnings.push("purchase_lot_linked_before_bought_status");
  }
  if (
    input.identityStatus === "verified_exact" &&
    input.marketStatus !== "verified_completed_sales"
  ) {
    warnings.push("verified_identity_without_verified_completed_sales");
  }
  if (
    input.ownerDecision === "buy" &&
    (input.identityStatus !== "verified_exact" ||
      input.marketStatus !== "verified_completed_sales")
  ) {
    warnings.push("buy_decision_without_truth_gates");
  }
  if (
    TERMINAL_STATUSES.has(input.lifecycleStatus) &&
    input.lifecycleStatus !== "bought" &&
    input.purchaseLotId
  ) {
    warnings.push("terminal_nonpurchase_status_has_purchase_lot");
  }

  return {
    consistent: warnings.length === 0,
    warnings,
  };
}

export function requireKingmakerBuyTruth(input: KingmakerOpportunityTruth) {
  const result = validateKingmakerTruth(input);
  const blocking = result.warnings.filter((warning) =>
    [
      "bought_without_purchase_lot",
      "verified_identity_without_verified_completed_sales",
      "buy_decision_without_truth_gates",
    ].includes(warning),
  );
  if (blocking.length > 0) {
    throw new Error(`KINGMAKER buy truth gate failed: ${blocking.join(", ")}.`);
  }
  return result;
}
