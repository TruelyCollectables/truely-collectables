import {
  getShipStationOrigin,
  saveShipStationOrigin,
  shipStationOriginMissing,
} from "@/src/lib/shipstation-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const origin = await getShipStationOrigin();
    return Response.json(
      {
        configured: Boolean(origin),
        origin,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error: any) {
    return Response.json(
      { configured: false, origin: null, error: error?.message || "Could not load ship-from settings." },
      { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const missing = shipStationOriginMissing(body);
    if (missing.length) {
      return Response.json(
        { error: `Ship-from address is incomplete: ${missing.join(", ")}.`, missing },
        { status: 422 },
      );
    }
    const origin = await saveShipStationOrigin(body);
    return Response.json(
      {
        success: true,
        configured: true,
        origin,
        message: "ShipStation ship-from address saved for TruelyCollectables shipping.",
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not save ship-from settings." },
      { status: 500 },
    );
  }
}
