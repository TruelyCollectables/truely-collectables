import type { KingmakerPricingDecision } from "./kingmaker-pricing-decision";
import type { KingmakerPricingProfile } from "./kingmaker-pricing-profile";

export type KingmakerPricingReceiptActor = {
  type: "seller" | "admin";
  storeId: string;
  sellerAccountId?: string | null;
};

export type KingmakerPricingReceiptProfileResolution = {
  selection: "requested" | "default" | "fallback";
  profile: KingmakerPricingProfile;
};

export function buildKingmakerPricingDecisionReceiptRow(params: {
  actor: KingmakerPricingReceiptActor;
  identityId: string;
  profileResolution: KingmakerPricingReceiptProfileResolution;
  decision: KingmakerPricingDecision;
}) {
  const profile = params.profileResolution.profile;
  return {
    storeId: params.actor.storeId,
    sellerAccountId:
      params.actor.type === "seller" ? params.actor.sellerAccountId || null : null,
    identityId: params.identityId,
    profileId: profile.id === "tcos-standard" ? null : profile.id,
    profileName: profile.name,
    profileSelection: params.profileResolution.selection,
    decision: params.decision,
    profile,
  };
}
