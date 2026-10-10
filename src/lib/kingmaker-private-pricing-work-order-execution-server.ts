import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingExecution, saveKingmakerMacPricingExecution } from "./kingmaker-mac-server";
export const KINGMAKER_EXECUTION_LANES = ["unassigned","assigned","overdue","blocked","due_for_review","recently_resolved"] as const;
export const KINGMAKER_EXECUTION_SORTS = ["unlock_desc","priority_asc","due_asc","target_asc"] as const;
export const KINGMAKER_BLOCKED_REASONS = ["missing_checklist","missing_pricing_source","identity_conflict","insufficient_evidence","source_access_problem","other"] as const;
export const KINGMAKER_RESOLUTION_CODES = ["coverage_fixed","no_action_needed","invalid_target","more_evidence_required","dismissed_duplicate"] as const;
function admin(actor: InstaCompJobActor) { if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required.",403,"KINGMAKER_EXECUTION_ADMIN_REQUIRED"); }
export async function getKingmakerWorkOrderExecution(actor: InstaCompJobActor, input: Record<string, unknown> = {}) { admin(actor); return (await getKingmakerMacPricingExecution(input)).execution; }
export async function updateKingmakerWorkOrderExecution(actor: InstaCompJobActor, input: Record<string, unknown>) { admin(actor); return (await saveKingmakerMacPricingExecution(input)).workOrder; }
