import { NextResponse } from "next/server";
import {
  getEbayPublisherSetup,
  saveOrPublishEbayListing,
  type EbayPublisherAction,
  type EbayPublisherListing,
} from "../../../../lib/ebay-publisher";
import {
  createMissingEbayOffer,
  isMissingEbayOfferLookupError,
} from "../../../../lib/ebay-publisher-missing-offer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  try {
    const setup = await getEbayPublisherSetup();
    return NextResponse.json(setup, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load eBay publishing setup.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: EbayPublisherAction;
      listing?: EbayPublisherListing;
      confirmation?: string;
    };

    if (body.action !== "draft" && body.action !== "publish") {
      return NextResponse.json(
        { error: "Action must be draft or publish." },
        { status: 400 },
      );
    }

    if (!body.listing) {
      return NextResponse.json(
        { error: "Listing payload is required." },
        { status: 400 },
      );
    }

    const publishParams = {
      action: body.action,
      listing: body.listing,
      confirmation: body.confirmation,
    };

    let result;

    try {
      result = await saveOrPublishEbayListing(publishParams);
    } catch (error) {
      if (!isMissingEbayOfferLookupError(error)) throw error;

      result = await createMissingEbayOffer(publishParams);
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to publish eBay listing.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
