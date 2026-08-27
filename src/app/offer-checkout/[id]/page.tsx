import Link from "next/link";
import OfferCheckoutClient from "./OfferCheckoutClient";
import { BUYER_PROTECTION_POLICY_VERSION } from "../../../lib/buyer-protection";
import { parseOfferCheckoutToken } from "../../../lib/offer-checkout-token";
import { preferHighResolutionListingImage } from "../../../lib/listing-image-utils";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OfferProduct = {
  id: number | string;
  title: string;
  image_url: string | null;
  price: number | string;
  quantity: number | string;
};

function firstProduct(value: OfferProduct | OfferProduct[] | null | undefined) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

export default async function OfferCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token = "" } = await searchParams;
  const offerId = Number(id);
  const storeId = getActiveStoreId();

  try {
    if (!Number.isInteger(offerId) || offerId <= 0 || !token) {
      throw new Error("Offer checkout link is invalid.");
    }
    parseOfferCheckoutToken({ token, storeId, offerId });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "This offer checkout link is invalid or expired.";

    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h1 className="text-4xl font-black">Offer Checkout Unavailable</h1>
        <p className="mt-4 text-neutral-600">{detail}</p>
        <Link
          href="/shop"
          className="mt-6 inline-flex rounded bg-neutral-950 px-5 py-3 font-black text-white"
        >
          Return to Shop
        </Link>
      </main>
    );
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const { data: offer, error } = await supabase
    .from("offers")
    .select(
      "id,status,offer_amount,counter_amount,listing_price_at_offer,buyer_protection_selected,buyer_protection_policy_version,buyer_protection_terms_accepted_at,products(id,title,image_url,price,quantity)",
    )
    .eq("id", offerId)
    .eq("store_id", storeId)
    .single();
  const product = firstProduct(
    (offer?.products || null) as OfferProduct | OfferProduct[] | null,
  );

  if (error || !offer || !product) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h1 className="text-4xl font-black">Offer Not Found</h1>
        <p className="mt-4 text-neutral-600">
          This offer is no longer available for payment.
        </p>
        <Link href="/shop" className="mt-6 inline-flex font-black underline">
          Return to Shop
        </Link>
      </main>
    );
  }

  if (offer.status === "paid") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h1 className="text-4xl font-black">Offer Already Paid</h1>
        <p className="mt-4 text-neutral-600">
          This accepted offer has already completed payment.
        </p>
        <Link
          href="/account/orders"
          className="mt-6 inline-flex rounded bg-neutral-950 px-5 py-3 font-black text-white"
        >
          View Orders
        </Link>
      </main>
    );
  }

  if (!["accepted", "countered"].includes(offer.status)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6">
        <h1 className="text-4xl font-black">Offer Not Ready</h1>
        <p className="mt-4 text-neutral-600">
          This offer is not currently approved for payment.
        </p>
      </main>
    );
  }

  const saleSubtotal = Number(
    offer.status === "countered" ? offer.counter_amount : offer.offer_amount,
  );
  const listingPriceBasis = Number(
    offer.listing_price_at_offer ?? product.price,
  );

  return (
    <OfferCheckoutClient
      offerId={Number(offer.id)}
      token={token}
      productId={Number(product.id)}
      title={product.title}
      imageUrl={preferHighResolutionListingImage(product.image_url) || null}
      saleSubtotal={saleSubtotal}
      listingPriceBasis={listingPriceBasis}
      buyerProtectionSelected={offer.buyer_protection_selected === true}
      buyerProtectionPolicyCurrent={Boolean(
        offer.buyer_protection_policy_version ===
          BUYER_PROTECTION_POLICY_VERSION &&
          offer.buyer_protection_terms_accepted_at,
      )}
    />
  );
}
