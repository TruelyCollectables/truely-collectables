import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingReviews, saveKingmakerMacPricingReview } from "./kingmaker-mac-server";
export const REVIEW_STATES = ["overdue","due_soon","scheduled","unscheduled"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
function admin(actor: InstaCompJobActor) { if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required.",403,"KINGMAKER_REVIEW_ADMIN_REQUIRED"); }
export async function getKingmakerWorkOrderReviews(actor: InstaCompJobActor, input: Record<string, unknown> = {}) { admin(actor); return (await getKingmakerMacPricingReviews(input)).reviews; }
export async function scheduleKingmakerWorkOrderReview(actor: InstaCompJobActor, input: Record<string, unknown>) { admin(actor); return (await saveKingmakerMacPricingReview(input)).review; }
