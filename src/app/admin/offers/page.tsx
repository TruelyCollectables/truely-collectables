import Link from "next/link";
import Image from "next/image";
import {
  getAccountProfilesByIds,
  type AccountProfileSummary,
} from "../../../lib/account-profiles";
import { supabase } from "../../../lib/supabase";
import { getActiveStoreId } from "../../../lib/stores";
import OfferActions from "./OfferActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OfferProduct = {
  title: string | null;
  image_url: string | null;
  price: number | null;
};

type Offer = {
  id: number;
  account_id?: string | null;
  customer_name: string | null;
  customer_email: string | null;
  offer_amount: number;
  status: string;
  stripe_checkout_url: string | null;
  products?: OfferProduct | null;
};

export default async function AdminOffersPage() {
  const storeId = getActiveStoreId();
  const { data: offers, error } = await supabase
    .from("offers")
   .select(`
  *,
  stripe_checkout_url,
  products(title, image_url, price)
`)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-3xl font-bold mb-4">Offers</h1>
        <p>Error loading offers: {error.message}</p>
      </main>
    );
  }

  const typedOffers = (offers || []) as Offer[];
  const accountProfiles = await getAccountProfilesByIds(
    typedOffers.map((offer) => offer.account_id),
  );

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Best Offers</h1>

      <Link href="/admin/products" className="underline block mb-6">
        ← Back to Admin Products
      </Link>

      <div className="space-y-4">
        {typedOffers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            accountProfile={
              offer.account_id
                ? accountProfiles.get(offer.account_id)
                : undefined
            }
          />
        ))}

        {typedOffers.length === 0 && <p>No offers yet.</p>}
      </div>
    </main>
  );
}

function accountLabel(
  accountId: string | null | undefined,
  accountProfile: AccountProfileSummary | undefined,
  guestLabel: string,
) {
  if (accountProfile) {
    return (
      accountProfile.email || accountProfile.display_name || accountProfile.id
    );
  }

  return accountId ? "Linked account profile unavailable" : guestLabel;
}

function OfferCard({
  offer,
  accountProfile,
}: {
  offer: Offer;
  accountProfile?: AccountProfileSummary;
}) {
  return (
    <div className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-4">
      <Image
        src={offer.products?.image_url || "/placeholder.png"}
        alt={offer.products?.title || "Product"}
        width={128}
        height={128}
        unoptimized
        className="h-32 w-32 rounded border object-cover"
      />

      <div className="md:col-span-2">
        <h2 className="font-bold">{offer.products?.title}</h2>
        <p>Asking: ${Number(offer.products?.price || 0).toFixed(2)}</p>
        <p>Offer: ${Number(offer.offer_amount).toFixed(2)}</p>
      </div>

      <div>
        <p>{offer.customer_name}</p>
        <p>{offer.customer_email}</p>
        <p className="mt-1 text-sm font-semibold text-gray-700">
          Account: {accountLabel(offer.account_id, accountProfile, "Guest offer")}
        </p>
        <p className="font-bold">Status: {offer.status}</p>
      </div>

      <OfferActions
        offerId={String(offer.id)}
        status={offer.status}
        checkoutUrl={offer.stripe_checkout_url}
      />
    </div>
  );
}
