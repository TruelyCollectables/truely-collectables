import Stripe from "stripe";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import { supabase } from "../../lib/supabase";
import { getActiveStoreId } from "../../lib/stores";
import SuccessCelebration from "./SuccessCelebration";
import { inferSuccessTheme, rgba } from "./theme";

export const dynamic = "force-dynamic";

type PurchasedProduct = {
  id: number;
  title: string;
  player: string | null;
  sport: string | null;
  image_url: string | null;
  price: number | null;
};

function messageForType(type: string) {
  if (type === "offer") {
    return {
      title: "Offer Purchase Confirmed",
      body: "Your accepted-offer checkout went through. We will verify the order, protect the details, and get it ready for fulfillment.",
    };
  }

  if (type === "counter") {
    return {
      title: "Counter Offer Purchase Confirmed",
      body: "Your counter-offer checkout went through. That collectable is now moving into the fulfillment flow.",
    };
  }

  return {
    title: "Purchase Confirmed",
    body: "Thank you for your order. We will verify the payment, update inventory, and get your collectable ready for its trip home.",
  };
}

function parseCartProductIds(value: string | null | undefined): number[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    const items = Array.isArray(parsed) ? parsed : parsed.items || [];

    if (!Array.isArray(items)) return [];

    return items
      .map((item) => Number(item.id || item.product_id || item.productId))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
}

async function getCheckoutMetadata(sessionId: string | null | undefined) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeKey || !sessionId) return null;

  try {
    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    return session.metadata || null;
  } catch (error) {
    console.error("Success page could not load Stripe session metadata", error);
    return null;
  }
}

async function getPurchasedProducts(
  sessionId: string | null | undefined,
): Promise<PurchasedProduct[]> {
  const metadata = await getCheckoutMetadata(sessionId);

  if (!metadata) return [];

  const productIds = [
    Number(metadata.product_id),
    ...parseCartProductIds(metadata.cart),
  ]
    .filter((id) => Number.isFinite(id) && id > 0)
    .filter((id, index, allIds) => allIds.indexOf(id) === index);

  if (productIds.length === 0) return [];

  const storeId = getActiveStoreId();

  const { data, error } = await supabase
    .from("products")
    .select("id,title,player,sport,image_url,price")
    .eq("store_id", storeId)
    .in("id", productIds);

  if (error) {
    console.error("Success page could not load purchased products", error);
    return [];
  }

  const products = (data || []) as PurchasedProduct[];

  return productIds
    .map((id) => products.find((product) => product.id === id))
    .filter(Boolean) as PurchasedProduct[];
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; session_id?: string }>;
}) {
  const params = await searchParams;
  const purchaseType = params?.type || "cart";
  const message = messageForType(purchaseType);
  const purchasedProducts = await getPurchasedProducts(params?.session_id);
  const featuredProduct = purchasedProducts[0] || null;
  const extraProductCount = Math.max(purchasedProducts.length - 1, 0);
  const theme = inferSuccessTheme([
    featuredProduct?.title,
    featuredProduct?.player,
    featuredProduct?.sport,
  ]);
  const backgroundStyle = {
    background: [
      `radial-gradient(circle at 15% 12%, ${rgba(theme.secondary, 0.42)}, transparent 28%)`,
      `radial-gradient(circle at 82% 18%, ${rgba(theme.accent, 0.32)}, transparent 30%)`,
      `linear-gradient(135deg, ${theme.primary} 0%, #111111 54%, ${theme.secondary} 140%)`,
    ].join(", "),
  };
  const panelStyle = {
    backgroundColor: rgba("#111111", 0.7),
    borderColor: rgba(theme.accent, 0.45),
  };

  return (
    <main className="min-h-screen px-6 py-12 text-white" style={backgroundStyle}>
      <ClearCartOnSuccess clearOnLoad={purchaseType === "cart"} />

      <section className="mx-auto flex max-w-4xl flex-col gap-8 text-center">
        <div>
          <p
            className="text-sm font-bold uppercase"
            style={{ color: theme.accent }}
          >
            Truely Collectables
          </p>
          <h1 className="mt-3 text-5xl font-black md:text-7xl">
            {message.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-neutral-300">
            {message.body}
          </p>
        </div>

        {featuredProduct ? (
          <div
            className="grid grid-cols-1 gap-5 rounded border p-5 text-left md:grid-cols-[220px_1fr]"
            style={panelStyle}
          >
            <div className="overflow-hidden rounded border border-white/15 bg-black/30">
              <img
                src={featuredProduct.image_url || "/placeholder.png"}
                alt={featuredProduct.title}
                className="h-72 w-full object-cover md:h-full"
              />
            </div>

            <div className="flex flex-col justify-center">
              <p
                className="text-sm font-bold uppercase"
                style={{ color: theme.accent }}
              >
                Built around this pickup
              </p>
              <h2 className="mt-2 text-3xl font-black leading-tight md:text-5xl">
                {featuredProduct.title}
              </h2>
              <p className="mt-3 text-neutral-300">
                {[featuredProduct.sport, featuredProduct.player]
                  .filter(Boolean)
                  .join(" - ") || "Collectable"}
              </p>
              <p className="mt-4 text-sm text-neutral-300">
                Page theme: <strong>{theme.name}</strong>
                {extraProductCount > 0
                  ? `, plus ${extraProductCount} more item${
                      extraProductCount === 1 ? "" : "s"
                    } in this order.`
                  : "."}
              </p>
            </div>
          </div>
        ) : null}

        <SuccessCelebration productTitle={featuredProduct?.title} theme={theme} />

        <div className="grid grid-cols-1 gap-4 text-left md:grid-cols-3">
          <div className="rounded border p-5" style={panelStyle}>
            <p className="font-bold" style={{ color: theme.accent }}>
              Inventory
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-300">
              TCOS records the sale and updates available quantity.
            </p>
          </div>

          <div className="rounded border p-5" style={panelStyle}>
            <p className="font-bold" style={{ color: theme.accent }}>
              Protection
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-300">
              Your order keeps its payment, TOS, and fulfillment evidence.
            </p>
          </div>

          <div className="rounded border p-5" style={panelStyle}>
            <p className="font-bold" style={{ color: theme.accent }}>
              Fulfillment
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-300">
              Once packed, tracking gets added from the admin order flow.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="/shop"
            className="rounded px-6 py-3 font-bold"
            style={{ backgroundColor: theme.accent, color: theme.textOnAccent }}
          >
            Keep Collecting
          </a>
          <a
            href="/"
            className="rounded border border-neutral-700 px-6 py-3 font-bold text-white"
          >
            Back Home
          </a>
        </div>
      </section>
    </main>
  );
}
