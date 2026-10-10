import "server-only";

import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingProfiles } from "./kingmaker-mac-server";
import {
  DEFAULT_KINGMAKER_PRICING_PROFILE,
  type KingmakerPricingProfile,
} from "./kingmaker-pricing-profile";

type InstaCompActor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

export function kingmakerPricingProfileOwner(actor: InstaCompActor) {
  return {
    storeId: actor.storeId,
    sellerAccountId: actor.type === "seller" ? actor.sellerAccountId || null : null,
  };
}

export async function resolveKingmakerPricingProfile(params: { actor: InstaCompActor; profileId?: string | null }) {
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const payload = await getKingmakerMacPricingProfiles(storeId, sellerAccountId);
  const profileId = String(params.profileId || "").trim();
  const selected = profileId
    ? payload.profiles.find((row) => String(row.id) === profileId)
    : payload.profiles.find((row) => row.isDefault === true);
  if (selected) {
    return {
      profile: selected as KingmakerPricingProfile,
      selection: profileId ? "requested" as const : "default" as const,
    };
  }
  return {
    profile: { id: "tcos-standard", ...DEFAULT_KINGMAKER_PRICING_PROFILE },
    selection: "fallback" as const,
  };
}

export type KingmakerPricingProfileResolution = Awaited<ReturnType<typeof resolveKingmakerPricingProfile>>;
