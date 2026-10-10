import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingCoverage } from "./kingmaker-mac-server";

export const KINGMAKER_PRIVATE_PRICING_GAP_TYPES = ["missing_release","checklist_pending","set_gap","identity_gap"] as const;
export const KINGMAKER_PRIVATE_PRICING_ACTIONABILITY = ["actionable","parser_review"] as const;
export type KingmakerPrivatePricingGapType = (typeof KINGMAKER_PRIVATE_PRICING_GAP_TYPES)[number];
export type KingmakerPrivatePricingActionability = (typeof KINGMAKER_PRIVATE_PRICING_ACTIONABILITY)[number];
export type KingmakerPrivatePricingCoverageInput = { limit?: unknown; offset?: unknown; gapType?: unknown; sport?: unknown; search?: unknown };
export type KingmakerPrivatePricingCoverageRow = Record<string, any> & { gapType: KingmakerPrivatePricingGapType; actionabilityStatus: KingmakerPrivatePricingActionability };
export type KingmakerPrivatePricingCoverage = Record<string, any> & { boundary: "aggregate_private_reference_only"; rows: KingmakerPrivatePricingCoverageRow[] };
function admin(actor: InstaCompJobActor) { if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required for private pricing coverage.",403,"KINGMAKER_PRIVATE_PRICING_COVERAGE_ADMIN_REQUIRED"); }
export async function getKingmakerPrivatePricingCoverage(actor: InstaCompJobActor, input: KingmakerPrivatePricingCoverageInput = {}) {
  admin(actor);
  const result = await getKingmakerMacPricingCoverage(input as Record<string, unknown>);
  return result.coverage as KingmakerPrivatePricingCoverage;
}
