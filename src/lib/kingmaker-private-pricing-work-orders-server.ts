import "server-only";
import { InstaCompJobServerError, type InstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingWorkOrders, saveKingmakerMacPricingWorkOrder } from "./kingmaker-mac-server";

export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES = ["queued","in_progress","blocked","completed","dismissed"] as const;
export const KINGMAKER_PRIVATE_PRICING_WORK_ORDER_FILTERS = ["untracked","queued","in_progress","blocked","resolved","completed","dismissed"] as const;
export type KingmakerPrivatePricingWorkOrderStatus = (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_STATUSES)[number];
export type KingmakerPrivatePricingWorkOrderFilter = (typeof KINGMAKER_PRIVATE_PRICING_WORK_ORDER_FILTERS)[number];
export type KingmakerPrivatePricingWorkOrderListInput = { limit?: unknown; offset?: unknown; status?: unknown; search?: unknown };
export type KingmakerPrivatePricingWorkOrderSaveInput = { attackKey?: unknown; status?: unknown; priority?: unknown; notes?: unknown; expectedVersion?: unknown };
export type KingmakerPrivatePricingWorkOrder = Record<string, any>;
export type KingmakerPrivatePricingWorkOrderRow = Record<string, any>;
export type KingmakerPrivatePricingWorkOrdersReport = Record<string, any> & { boundary: "private_coverage_work_orders_only"; rows: KingmakerPrivatePricingWorkOrderRow[] };
function admin(actor: InstaCompJobActor) { if (actor.type !== "admin") throw new InstaCompJobServerError("Administrative access is required for private pricing work orders.",403,"KINGMAKER_PRIVATE_PRICING_WORK_ORDERS_ADMIN_REQUIRED"); }
export async function getKingmakerPrivatePricingWorkOrders(actor: InstaCompJobActor, input: KingmakerPrivatePricingWorkOrderListInput = {}) {
  admin(actor); return (await getKingmakerMacPricingWorkOrders(input as Record<string, unknown>)).workOrders as KingmakerPrivatePricingWorkOrdersReport;
}
export async function saveKingmakerPrivatePricingWorkOrder(actor: InstaCompJobActor, input: KingmakerPrivatePricingWorkOrderSaveInput) {
  admin(actor); return (await saveKingmakerMacPricingWorkOrder(input as Record<string, unknown>)).workOrder as KingmakerPrivatePricingWorkOrder;
}
