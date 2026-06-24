import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import OfferActions from "./OfferActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminOffersPage() {
  const { data: offers, error } = await supabase
    .from("offers")
   .select(`
  *,
  stripe_checkout_url,
  products(title, image_url, price)
`)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-3xl font-bold mb-4">Offers</h1>
        <p>Error loading offers: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Best Offers</h1>

      <Link href="/admin/products" className="underline block mb-6">
        ← Back to Admin Products
      </Link>

      <div className="space-y-4">
        {offers?.map((offer) => (
          <div
            key={offer.id}
            className="border rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-4"
          >
            <img
              src={offer.products?.image_url || "/placeholder.png"}
              alt={offer.products?.title || "Product"}
              className="w-32 rounded border"
            />

            <div className="md:col-span-2">
              <h2 className="font-bold">{offer.products?.title}</h2>
              <p>Asking: ${Number(offer.products?.price || 0).toFixed(2)}</p>
              <p>Offer: ${Number(offer.offer_amount).toFixed(2)}</p>
            </div>

            <div>
              <p>{offer.customer_name}</p>
              <p>{offer.customer_email}</p>
              <p className="font-bold">Status: {offer.status}</p>
            </div>

            <OfferActions
  offerId={offer.id}
  status={offer.status}
  checkoutUrl={offer.stripe_checkout_url}
/>
          </div>
        ))}

        {offers?.length === 0 && <p>No offers yet.</p>}
      </div>
    </main>
  );
}