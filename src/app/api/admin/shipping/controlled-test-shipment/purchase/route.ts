import {
  controlledTestStatus,
  purchaseControlledOneOunceLetter,
  type ControlledTestAddress,
} from "@/src/lib/shipstation-controlled-test";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirmPurchase !== true) {
      return Response.json(
        {
          success: false,
          postagePurchased: false,
          error: "Explicit confirmation is required before the controlled test can purchase real postage.",
        },
        { status: 400 },
      );
    }
    if (body?.machinableAttested !== true) {
      return Response.json(
        {
          success: false,
          postagePurchased: false,
          error: "Confirm the finished 1 oz letter is flexible, uniformly thick, and machinable before purchasing postage.",
        },
        { status: 400 },
      );
    }

    const status = controlledTestStatus();
    if (!status.purchaseEnabled) {
      return Response.json(
        {
          success: false,
          postagePurchased: false,
          error: "Controlled real-postage test lane is still locked.",
          requiredFlag: "TCOS_SHIPSTATION_TEST_SHIPMENT_ENABLED=true",
          maxPostage: status.maxPostage,
        },
        { status: 409 },
      );
    }

    const destination: ControlledTestAddress = {
      name: body?.name,
      company: body?.company,
      addressLine1: body?.addressLine1,
      addressLine2: body?.addressLine2,
      city: body?.city,
      state: body?.state,
      postalCode: body?.postalCode,
      countryCode: body?.countryCode || "US",
    };

    const purchase = await purchaseControlledOneOunceLetter(destination);
    return Response.json(
      {
        success: true,
        postagePurchased: true,
        ...purchase,
        labelPdfUrl: `/api/admin/shipping/controlled-test-shipment/pdf?externalShipmentId=${encodeURIComponent(purchase.externalShipmentId)}`,
        letterTrackUrl: "https://www.lettertrackpro.com/Login.asp",
        letterTrackFinalizeRequired: true,
        message: purchase.reused
          ? "Existing controlled test postage was reused. No second ShipStation charge was submitted. Print the PDF and finalize it in LetterTrack before mailing."
          : "Controlled 1 oz USPS First-Class Mail test postage was purchased. Print the PDF and finalize it in LetterTrack before mailing.",
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        postagePurchased: false,
        error: error?.message || "Could not purchase the controlled test postage.",
      },
      { status: 502, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
}
