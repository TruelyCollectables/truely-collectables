import { testShipStationConnection } from "@/src/lib/shipstation-connection";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await testShipStationConnection();
    return Response.json(result, {
      status: result.apiKeyConfigured ? 200 : 409,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-TCOS-ShipStation-Test": result.ok ? "ready" : "not-ready",
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        postagePurchaseAttempted: false,
        error: error?.message || "ShipStation connection test failed.",
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-TCOS-ShipStation-Test": "failed",
        },
      },
    );
  }
}
