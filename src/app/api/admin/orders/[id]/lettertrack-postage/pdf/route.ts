import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

type ShippingLabelRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

function metadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeProviderPdfUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.hostname !== "api.shipstation.com"
    ) {
      return null;
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const orderId = Number(id);
    if (!orderId) {
      return Response.json({ error: "Missing order id." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("order_shipping_labels")
      .select("id,metadata")
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .not("label_status", "in", "(voided,failed)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return Response.json(
        { error: "No active shipping label was found." },
        { status: 404 },
      );
    }

    const label = data as ShippingLabelRow;
    const postage = metadataRecord(
      label.metadata,
      "lettertrack_shipstation_postage",
    );
    const providerPdfUrl = safeProviderPdfUrl(postage?.provider_pdf_url);

    if (postage?.status !== "purchased" || !providerPdfUrl) {
      return Response.json(
        { error: "No paid ShipStation letter-postage PDF is available." },
        { status: 404 },
      );
    }

    const apiKey = String(process.env.SHIPSTATION_API_KEY || "").trim();
    if (!apiKey) {
      return Response.json(
        { error: "ShipStation API credentials are unavailable." },
        { status: 503 },
      );
    }

    const response = await fetch(providerPdfUrl, {
      headers: {
        "API-Key": apiKey,
        Accept: "application/pdf",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status >= 300 && response.status < 400) {
      return Response.json(
        {
          error: `ShipStation label download refused an unexpected redirect (HTTP ${response.status}).`,
        },
        { status: 502 },
      );
    }

    if (!response.ok) {
      return Response.json(
        { error: `ShipStation label download failed with HTTP ${response.status}.` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/pdf")) {
      return Response.json(
        { error: "ShipStation did not return a PDF label." },
        { status: 502 },
      );
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="tcos-order-${orderId}-letter-postage.pdf"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Could not load paid postage PDF." },
      { status: 500 },
    );
  }
}
