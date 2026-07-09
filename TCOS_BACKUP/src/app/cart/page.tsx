import CartClient from "./CartClient";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getStoreSettings } from "../../lib/store-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CartPage() {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);

  return <CartClient storeDisplayName={storeSettings.displayName} />;
}
