import "server-only";

import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { createKingmakerMacPricingReceipt } from "./kingmaker-mac-server";
import type { KingmakerPricingDecision } from "./kingmaker-pricing-decision";
import {
  buildKingmakerPricingDecisionReceiptRow,
} from "./kingmaker-pricing-decision-receipt";
import type { KingmakerPricingProfileResolution } from "./kingmaker-pricing-profile-server";

type InstaCompActor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

export { buildKingmakerPricingDecisionReceiptRow };

export async function writeKingmakerPricingDecisionReceipt(params: { actor: InstaCompActor; identityId: string; profileResolution: KingmakerPricingProfileResolution; decision: KingmakerPricingDecision }) {
  const result = await createKingmakerMacPricingReceipt(buildKingmakerPricingDecisionReceiptRow(params));
  return String(result.id);
}
