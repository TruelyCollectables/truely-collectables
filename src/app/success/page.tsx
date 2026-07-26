import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import { STORE_SUPPORT_EMAIL } from "../../lib/legal";
import {
  resolvePostPurchaseStatus,
  type PostPurchaseState,
} from "../../lib/post-purchase-status";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import { getStoreSettings } from "../../lib/store-settings";
import { getActiveStoreId } from "../../lib/stores";
import SuccessCelebration from "./SuccessCelebration";
import { inferSuccessTheme, rgba } from "./theme";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Order Status",
  robots: {
    index: false,
    follow: false,
  },
};

type PurchasedProduct = {
  id: number;
  title: string;
  player: string | null;
  sport: string | null;
  image_url: string | null;
  price: number | null;
};

function confirmedMessageForType(type: string) {
  if (["offer", "accepted_offer"].includes(type)) {
    return {
      title: "Offer Purchase Confirmed",
      body: "Your accepted-offer payment and order record are verified. We will get the card ready for fulfillment.",
    };
  }

  if (type === "counter") {
    return {
      title: "Counter Offer Purchase Confirmed",
      body: "Your counter-offer payment and order record are verified. That card is now moving into fulfillment.",
    };
  }

  return {
    title: "Purchase Confirmed",
    body: "Your payment and order record are verified. We will get your sports cards ready for their trip home.",
  };
}

function messageForState(state: PostPurchaseState, purchaseType: string) {
  if (state === "confirmed") return confirmedMessageForType(purchaseType);

  if (state === "processing") {
    return {
      title: "Payment Received",
      body: "Stripe confirms the payment. The signed webhook is finishing the order record and inventory update now.",
    };
  }

  if (state === "incomplete") {
    return {
      title: "Checkout Not Completed",
      body: "This checkout is not recorded as a completed paid purchase. Your cart has not been cleared.",
    };
  }

  return {
    title: "Checkout Could Not Be Verified",
    body: "We could not verify a completed paid Stripe checkout for this return link. Your cart has not been cleared.",
  };
}

function statusLabel(state: PostPurchaseState) {
  if (state === "confirmed") return "Order Confirmed";
  if (state === "processing") return "Payment Verified / Finalizing";
  if (state === "incomplete") return "Payment Incomplete";
  return "Verification Failed";
}

function statusClasses(state: PostPurchaseState) {
  if (state === "confirmed") {
    return "border-emerald-300 bg-emerald-950/70 text-emerald-100";
  }
  if (state === "processing") {
    return "border-sky-300 bg-sky-950/70 text-sky-100";
  }
  if (state === "incomplete") {
    return "border-amber-300 bg-amber-950/70 text-amber-100";
  }
  return "border-red-300 bg-red-950/70 text-red-100";
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

async function getPurchasedProducts(
  metadata: Record<string, string>,
  supabase: ReturnType<typeof createSupabaseServerClient>,
): Promise<PurchasedProduct[]> {
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

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function readableStatus(value: string | null | undefined) {
  return String(value || "processing").replaceAll("_", " ");
}

export default async function SuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; session_id?: string }>;
}) {
  const params = await searchParams;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);
  const postPurchase = await resolvePostPurchaseStatus({
    sessionId: params?.session_id,
    requestedType: params?.type,
    storeId,
    supabase,
  });
  const message = messageForState(postPurchase.state, postPurchase.purchaseType);
  const paymentVerified = ["confirmed", "processing"].includes(
    postPurchase.state,
  );
  const shouldClearCart =
    paymentVerified && postPurchase.purchaseType === "cart";
  const purchasedProducts = paymentVerified
    ? await getPurchasedProducts(postPurchase.metadata, supabase)
    : [];
  const featuredProduct = purchasedProducts[0] || null;
  const extraProductCount = Math.max(purchasedProducts.length - 1, 0);
  const theme = inferSuccessTheme(
    [featuredProduct?.title, featuredProduct?.player, featuredProduct?.sport],
    { defaultName: storeSettings.displayName },
  );
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
  const refreshHref = `/success?type=${encodeURIComponent(
    postPurchase.purchaseType,
  )}&session_id=${encodeURIComponent(postPurchase.sessionId || "")}`;

  return (
    <main
      className="min-h-screen px-4 py-10 text-white sm:px-6 sm:py-12"
      style={backgroundStyle}
    >
      <ClearCartOnSuccess clearOnLoad={shouldClearCart} />

      <section className="mx-auto flex max-w-4xl flex-col gap-8 text-center">
        <div>
          <p
            className="text-sm font-bold uppercase"
            style={{ color: theme.accent }}
          >
            {storeSettings.displayName}
          </p>
          <h1 className="mt-3 text-4xl font-black sm:text-5xl md:text-7xl">
            {message.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-neutral-300 sm:text-lg sm:leading-8">
            {message.body}
          </p>
        </div>

        <section
          className={`rounded border p-5 text-left ${statusClasses(
            postPurchase.state,
          )}`}
          aria-live="polite"
        >
          <p className="text-xs font-black uppercase tracking-wide">
            {statusLabel(postPurchase.state)}
          </p>
          <p className="mt-2 text-sm leading-6">{postPurchase.detail}</p>

          {postPurchase.order ? (
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div className="rounded bg-black/20 p-3">
                <dt className="font-bold opacity-75">Order</dt>
                <dd className="mt-1 text-lg font-black">
                  #{postPurchase.order.id}
                </dd>
              </div>
              <div className="rounded bg-black/20 p-3">
                <dt className="font-bold opacity-75">Total</dt>
                <dd className="mt-1 text-lg font-black">
                  {formatMoney(postPurchase.order.total)}
                </dd>
              </div>
              <div className="rounded bg-black/20 p-3">
                <dt className="font-bold opacity-75">Items</dt>
                <dd className="mt-1 text-lg font-black">
                  {postPurchase.order.itemCount}
                </dd>
              </div>
              <div className="rounded bg-black/20 p-3">
                <dt className="font-bold opacity-75">Status</dt>
                <dd className="mt-1 break-words font-black uppercase">
                  {readableStatus(
                    postPurchase.order.fulfillmentStatus ||
                      postPurchase.order.status,
                  )}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>

        {featuredProduct ? (
          <div
            className="grid grid-cols-1 gap-5 rounded border p-5 text-left md:grid-cols-[220px_1fr]"
            style={panelStyle}
          >
            <div className="relative min-h-72 overflow-hidden rounded border border-white/15 bg-black/30">
              <Image
                src={featuredProduct.image_url || "/placeholder.png"}
                alt={featuredProduct.title}
                fill
                sizes="(min-width: 768px) 220px, 100vw"
                unoptimized
                className="object-contain p-2"
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
                  .join(" - ") || "Sports card"}
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

        {postPurchase.state === "confirmed" ? (
          <SuccessCelebration
            productTitle={featuredProduct?.title}
            theme={theme}
          />
        ) : null}

        {paymentVerified ? (
          <div className="grid grid-cols-1 gap-4 text-left md:grid-cols-3">
            <div className="rounded border p-5" style={panelStyle}>
              <p className="font-bold" style={{ color: theme.accent }}>
                Inventory
              </p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">
                The signed webhook records the sale and updates available quantity.
              </p>
            </div>

            <div className="rounded border p-5" style={panelStyle}>
              <p className="font-bold" style={{ color: theme.accent }}>
                Protection
              </p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">
                Your order keeps payment, terms, and fulfillment evidence.
              </p>
            </div>

            <div className="rounded border p-5" style={panelStyle}>
              <p className="font-bold" style={{ color: theme.accent }}>
                Fulfillment
              </p>
              <p className="mt-2 text-sm leading-6 text-neutral-300">
                Tracking appears after the order is packed and a real label is recorded.
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
          {postPurchase.state === "processing" ? (
            <Link
              href={refreshHref}
              className="inline-flex min-h-12 items-center justify-center rounded border border-sky-300 px-6 font-black text-sky-100"
            >
              Refresh Order Status
            </Link>
          ) : null}

          {postPurchase.accountLinked && paymentVerified ? (
            <Link
              href="/account/orders"
              className="inline-flex min-h-12 items-center justify-center rounded px-6 font-black"
              style={{
                backgroundColor: theme.accent,
                color: theme.textOnAccent,
              }}
            >
              View Your Orders
            </Link>
          ) : null}

          {postPurchase.state === "incomplete" ? (
            <Link
              href="/cart"
              className="inline-flex min-h-12 items-center justify-center rounded bg-amber-300 px-6 font-black text-neutral-950"
            >
              Return to Cart
            </Link>
          ) : null}

          {paymentVerified ? (
            <Link
              href="/shop"
              className="inline-flex min-h-12 items-center justify-center rounded border border-neutral-600 px-6 font-black text-white"
            >
              Keep Collecting
            </Link>
          ) : null}

          <a
            href={`mailto:${STORE_SUPPORT_EMAIL}`}
            className="inline-flex min-h-12 items-center justify-center rounded border border-neutral-600 px-6 font-black text-white"
          >
            Order Support
          </a>
        </div>
      </section>
    </main>
  );
}
