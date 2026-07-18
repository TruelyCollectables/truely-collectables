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
  id: number;
  title: string | null;
  image_url: string | null;
  price: number | null;
  quantity: number | null;
};

type Offer = {
  id: number;
  account_id?: string | null;
  customer_name: string | null;
  customer_email: string | null;
  offer_amount: number;
  counter_amount?: number | null;
  status: string | null;
  stripe_checkout_url: string | null;
  created_at?: string | null;
  products?: OfferProduct | null;
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
}

function statusLabel(value: string | null | undefined) {
  if (!value) return "PENDING";
  return value.replaceAll("_", " ").toUpperCase();
}

function statusTone(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "accepted" || normalized === "paid") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (normalized === "countered" || normalized === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (normalized === "declined" || normalized === "expired") {
    return "border-red-200 bg-red-50 text-red-950";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function safeProductImage(value: string | null | undefined) {
  const src = String(value || "").trim();
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/")
    ? src
    : "/placeholder.png";
}

export default async function AdminOffersPage() {
  const storeId = getActiveStoreId();
  const { data: offers, error } = await supabase
    .from("offers")
    .select(
      `
      *,
      stripe_checkout_url,
      products(id, title, image_url, price, quantity)
    `,
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="bg-neutral-50 px-6 py-8 text-neutral-950">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Offers desk
          </p>
          <h1 className="mt-2 text-3xl font-black">Error loading offers</h1>
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
            {error.message}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/offers"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Retry
            </Link>
            <Link
              href="/admin"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const typedOffers = (offers || []) as Offer[];
  const accountProfiles = await getAccountProfilesByIds(
    typedOffers.map((offer) => offer.account_id),
  );
  const pendingOffers = typedOffers.filter(
    (offer) => offer.status === "pending",
  );
  const acceptedOffers = typedOffers.filter(
    (offer) => offer.status === "accepted",
  );
  const counteredOffers = typedOffers.filter(
    (offer) => offer.status === "countered",
  );
  const declinedOffers = typedOffers.filter(
    (offer) => offer.status === "declined",
  );
  const pendingValue = pendingOffers.reduce(
    (sum, offer) => sum + Number(offer.offer_amount || 0),
    0,
  );

  return (
    <main className="space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">
              Offers desk
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Best Offers
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              Review buyer offers, accept checkout-ready deals, decline poor
              offers, or send counter offers with clear Stripe payment links.
            </p>
            <p className="mt-2 text-xs font-bold text-neutral-400">
              Last refreshed: {new Date().toLocaleString()}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/products"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Products
            </Link>
            <Link
              href="/admin/orders"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Orders
            </Link>
            <Link
              href="/admin"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Pending"
          value={String(pendingOffers.length)}
          detail={`${money(pendingValue)} waiting on admin decision`}
        />
        <MetricCard
          label="Accepted"
          value={String(acceptedOffers.length)}
          detail="Checkout links created for buyers"
        />
        <MetricCard
          label="Countered"
          value={String(counteredOffers.length)}
          detail="Buyer counter-offer links sent"
        />
        <MetricCard
          label="Declined"
          value={String(declinedOffers.length)}
          detail="Offers closed without checkout"
        />
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
              Offer queue
            </p>
            <h2 className="mt-1 text-2xl font-black">Buyer offer decisions</h2>
          </div>
          <Link
            href="/shop"
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            View storefront
          </Link>
        </div>

        <div className="mt-5 space-y-4">
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

          {typedOffers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6">
              <h3 className="text-lg font-black">No buyer offers yet</h3>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-neutral-600">
                New product offers will appear here with buyer contact details,
                account links, asking price, offer amount, and decision actions.
              </p>
            </div>
          ) : null}
        </div>
      </section>
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

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </p>
      <p className="mt-3 text-3xl font-black">{value}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-500">{detail}</p>
    </div>
  );
}

function OfferCard({
  offer,
  accountProfile,
}: {
  offer: Offer;
  accountProfile?: AccountProfileSummary;
}) {
  const product = offer.products;
  const productTitle = product?.title || "Untitled product";
  const isPending = offer.status === "pending";

  return (
    <article className="grid gap-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 xl:grid-cols-[160px_1.4fr_1fr_240px]">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <Image
          src={safeProductImage(product?.image_url)}
          alt={productTitle}
          width={160}
          height={160}
          unoptimized
          className="h-40 w-full object-cover"
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-black">{productTitle}</h3>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(
              offer.status,
            )}`}
          >
            {statusLabel(offer.status)}
          </span>
        </div>
        <p className="mt-2 text-xs font-bold text-neutral-400">
          Offer #{offer.id} · Created {dateLabel(offer.created_at)}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
              Asking
            </p>
            <p className="mt-1 text-lg font-black">{money(product?.price)}</p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
              Offer
            </p>
            <p className="mt-1 text-lg font-black">
              {money(offer.offer_amount)}
            </p>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
              Qty left
            </p>
            <p className="mt-1 text-lg font-black">
              {Number(product?.quantity || 0)}
            </p>
          </div>
        </div>

        {offer.counter_amount ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
            Counter sent at {money(offer.counter_amount)}
          </p>
        ) : null}

        {product?.id ? (
          <Link
            href={`/admin/products/${product.id}`}
            className="mt-4 inline-flex rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Edit product
          </Link>
        ) : null}
      </div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
          Buyer
        </p>
        <p className="mt-2 font-black">
          {offer.customer_name || "Unnamed buyer"}
        </p>
        <p className="break-all text-sm font-semibold text-neutral-600">
          {offer.customer_email || "No buyer email"}
        </p>
        <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
          Account
        </p>
        <p className="mt-1 break-all text-sm font-semibold text-neutral-600">
          {accountLabel(offer.account_id, accountProfile, "Guest offer")}
        </p>
        {!isPending ? (
          <p className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-600">
            Decision actions lock after the offer leaves pending.
          </p>
        ) : null}
      </div>

      <OfferActions
        offerId={String(offer.id)}
        status={offer.status || "pending"}
        checkoutUrl={offer.stripe_checkout_url}
      />
    </article>
  );
}
