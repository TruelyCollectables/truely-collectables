import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingTargetHistory } from "./kingmaker-mac-server";
export async function getKingmakerWorkOrderTargetHistory(actor: InstaCompJobActor, input: { attackKey?: unknown; limit?: unknown; offset?: unknown }) {
  if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required for KINGMAKER work-order history.",403,"KINGMAKER_TARGET_HISTORY_ADMIN_REQUIRED");
  const attackKey = String(input.attackKey || "").trim(); if (!attackKey) throw new InstaCompJobServerError("A work-order target is required.",400,"KINGMAKER_TARGET_HISTORY_TARGET_REQUIRED");
  const limit = Math.max(1,Math.min(Number(input.limit || 50),100)); const offset = Math.max(0,Number(input.offset || 0));
  return (await getKingmakerMacPricingTargetHistory(attackKey,limit,offset)).history;
}
