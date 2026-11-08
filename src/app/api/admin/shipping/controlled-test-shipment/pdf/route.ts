import { getControlledTestLabel } from "@/src/lib/shipstation-controlled-test";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const externalShipmentId = String(url.searchParams.get("externalShipmentId") || "").trim();
    const label = await getControlledTestLabel(externalShipmentId);
    const apiKey = String(process.env.SHIPSTATION_API_KEY || "").trim();
    if (!apiKey) {
      return Response.json(
        { error: "ShipStation API credentials are unavailable." },
        { status: 503 },
      );
    }

    const response = await fetch(label.labelPdfUrl, {
      headers: {
        "API-Key": apiKey,
        Accept: "application/pdf",
      },
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

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/pdf")) {
      return Response.json(
        { error: "ShipStation did not return a PDF test label." },
        { status: 502 },
      );
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="tcos-controlled-1oz-test-${label.labelId}.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load the controlled test label PDF." },
      { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
