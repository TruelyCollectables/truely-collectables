import {
  controlledTestStatus,
  quoteControlledOneOunceLetter,
  type ControlledTestAddress,
} from "@/src/lib/shipstation-controlled-test";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ...controlledTestStatus(),
      postagePurchased: false,
      message: "Controlled 1 oz test shipment is fixed to USPS First-Class Mail letter postage.",
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ControlledTestAddress;
    const quote = await quoteControlledOneOunceLetter(body);
    return Response.json(
      {
        success: true,
        postagePurchased: false,
        ...quote,
        destination: {
          city: String(body.city || "").trim(),
          state: String(body.state || "").trim().toUpperCase(),
          postalCode: String(body.postalCode || "").trim(),
        },
        message: `ShipStation quoted $${quote.postageAmount.toFixed(2)} for the controlled 1.00 oz USPS First-Class Mail letter. No postage was purchased.`,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-TCOS-Controlled-Test": "quote-no-purchase",
        },
      },
    );
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        postagePurchased: false,
        error: error?.message || "Could not quote the controlled 1 oz test shipment.",
      },
      { status: 422, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
