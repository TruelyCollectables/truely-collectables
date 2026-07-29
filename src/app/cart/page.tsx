import type { Metadata } from "next";
import CartClient from "./CartClient";
import CheckoutPolicyNotice from "./CheckoutPolicyNotice";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getStoreSettings } from "../../lib/store-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shopping Cart",
  description:
    "Review the items in your Truely Collectables cart before secure checkout.",
  alternates: {
    canonical: "/cart",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function CartPage() {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return (
    <>
      <CartClient storeDisplayName={storeSettings.displayName} />
      <CheckoutPolicyNotice />
    </>
  );
}
