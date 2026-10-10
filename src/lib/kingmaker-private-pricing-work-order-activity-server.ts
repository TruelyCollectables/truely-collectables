import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingActivity } from "./kingmaker-mac-server";
export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTIONS = ["created","updated","auto_resolved","auto_reopened","review_scheduled","review_cleared","claimed","released","execution_updated","resolution_recorded"] as const;
export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ACTORS = ["admin","system"] as const;
function admin(actor: InstaCompJobActor) { if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required for private pricing work-order activity.",403,"KINGMAKER_PRIVATE_PRICING_WORK_ORDER_ACTIVITY_ADMIN_REQUIRED"); }
export async function getKingmakerPrivatePricingWorkOrderActivity(actor: InstaCompJobActor, input: Record<string, unknown> = {}) { admin(actor); return (await getKingmakerMacPricingActivity(input)).activity; }
