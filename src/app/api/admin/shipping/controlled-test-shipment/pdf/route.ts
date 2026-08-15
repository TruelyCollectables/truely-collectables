import { getControlledTestLabel } from "@/src/lib/shipstation-controlled-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const externalShipmentId = String(url.searchParams.get("externalShipmentId") || "").trim();
    const label = await getControlledTestLabel(externalShipmentId);

    const response = await fetch(label.labelPdfUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return Response.json(
        { error: `ShipStation PDF download refused an unexpected redirect (HTTP ${response.status}).` },
        { status: 502 },
      );
    }
    if (!response.ok) {
      return Response.json(
        { error: `ShipStation PDF download failed with HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const bytes = await response.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/pdf",
        "Content-Disposition": `inline; filename="tcos-controlled-1oz-test-${label.labelId}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load the controlled test label PDF." },
      { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
