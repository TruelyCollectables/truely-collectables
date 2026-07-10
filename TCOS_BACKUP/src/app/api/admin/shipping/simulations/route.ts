import { runShippingSimulationSuite } from "../../../../../lib/shipping-simulations";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runShippingSimulationSuite();
    return Response.json({ success: true, ...result });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Shipping simulation suite failed." },
      { status: 500 },
    );
  }
}
