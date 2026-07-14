import { runShippingPurchaseAttemptAuditSimulationSuite } from "../../../../../lib/shipping-purchase-attempt-audit-simulations";
import { runShippingSimulationSuite } from "../../../../../lib/shipping-simulations";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runShippingSimulationSuite();
    const purchaseAudit = runShippingPurchaseAttemptAuditSimulationSuite();
    return Response.json({
      success: true,
      ...result,
      purchase_audit: purchaseAudit,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Shipping simulation suite failed." },
      { status: 500 },
    );
  }
}
