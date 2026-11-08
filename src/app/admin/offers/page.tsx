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

function safeErrorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message || "Unknown database error.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
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
    const offerLoadErrorMessage = safeErrorMessage(error);

    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(244,63,94,0.12),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-4xl rounded-3xl border border-red-200 bg-white/95 p-6 shadow-sm ring-1 ring-red-950/5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Offers desk
          </p>
          <h1 className="mt-2 text-3xl font-black">Error loading offers</h1>
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
            {offerLoadErrorMessage}
          </p>
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-950">
            <h2 className="text-lg font-black">Offer queue unavailable</h2>
            <p className="mt-2 text-sm font-semibold leading-6">
              Offer storage did not load, so this page cannot prove whether
              pending buyer decisions, accepted checkouts, counters, or declined
              offers exist. Retry after the database warning is cleared before
              treating the desk as empty.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-red-200 bg-white p-3">
                <dt className="font-black uppercase tracking-[0.12em] text-red-700">
                  Decision counts
                </dt>
                <dd className="mt-1 font-black">Unavailable</dd>
              </div>
              <div className="rounded-xl border border-red-200 bg-white p-3">
                <dt className="font-black uppercase tracking-[0.12em] text-red-700">
                  Operator action
                </dt>
                <dd className="mt-1 font-semibold">
                  Retry offers or open the dashboard; do not accept or decline
                  from stale memory.
                </dd>
              </div>
            </dl>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/offers"
              className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
            >
              Retry
            </Link>
            <Link
              href="/admin"
              className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black shadow-sm transition hover:bg-neutral-50"
            >
              Dashboard
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const typedOffers = (offers || []) as Offer[];
  let accountProfiles = new Map<string, AccountProfileSummary>();
  let accountProfilesError: { message?: string } | null = null;

  try {
    accountProfiles = await getAccountProfilesByIds(
      typedOffers.map((offer) => offer.account_id),
    );
  } catch (error) {
    accountProfilesError =
      error && typeof error === "object" && "message" in error
        ? { message: String(error.message || "Unknown account profile error.") }
        : { message: "Unknown account profile error." };
  }

  const accountProfilesUnavailable = Boolean(accountProfilesError);
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.2),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-300">
                Offers desk
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                Best Offers
              </h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-neutral-300">
                Review buyer offers, accept checkout-ready deals, decline poor
                offers, or send counter offers with clear Stripe payment links.
                Decision actions stay locked after pending status so stale
                money-path clicks do not create duplicate checkout work.
              </p>
              <p className="mt-2 text-xs font-bold text-neutral-500">
                Last refreshed: {new Date().toLocaleString()}
              </p>
            </div>

            <div className="grid min-w-[320px] grid-cols-3 gap-3 rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-xl shadow-neutral-950/20">
              <HeaderStat label="Pending" value={String(pendingOffers.length)} />
              <HeaderStat label="Open Value" value={money(pendingValue)} />
              <HeaderStat label="Accepted" value={String(acceptedOffers.length)} />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <CommandLink href="/admin/products" label="Products" />
            <CommandLink href="/admin/orders" label="Orders" />
            <CommandLink href="/admin" label="Dashboard" primary />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {accountProfilesUnavailable ? (
          <section
            aria-live="polite"
            role="status"
            className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-950/5"
          >
            <h2 className="text-xl font-black">
              Linked account profiles unavailable
            </h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6">
              Offers loaded, but buyer account enrichment did not. The offer desk
              remains usable; rows with linked buyers will show that profile
              details are unavailable instead of hiding the offer decision.
            </p>
            <p className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold">
              {safeErrorMessage(accountProfilesError)}
            </p>
          </section>
        ) : null}

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

        <section className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">
                Offer queue
              </p>
              <h2 className="mt-1 text-2xl font-black">Buyer offer decisions</h2>
            </div>
            <Link
              href="/shop"
              className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black shadow-sm transition hover:border-neutral-500"
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
                accountProfilesUnavailable={accountProfilesUnavailable}
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
      </div>
    </main>
  );
}

function accountLabel(
  accountId: string | null | undefined,
  accountProfile: AccountProfileSummary | undefined,
  guestLabel: string,
  accountProfilesUnavailable = false,
) {
  if (accountProfile) {
    return (
      accountProfile.email || accountProfile.display_name || accountProfile.id
    );
  }

  return accountId
    ? accountProfilesUnavailable
      ? "Linked account profile lookup unavailable"
      : "Linked account profile unavailable"
    : guestLabel;
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
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
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
  accountProfilesUnavailable,
}: {
  offer: Offer;
  accountProfile?: AccountProfileSummary;
  accountProfilesUnavailable?: boolean;
}) {
  const product = offer.products;
  const productTitle = product?.title || "Untitled product";
  const isPending = offer.status === "pending";

  return (
    <article className="grid gap-5 rounded-3xl border border-neutral-200 bg-neutral-50/90 p-5 shadow-sm ring-1 ring-black/[0.02] transition hover:bg-neutral-50 xl:grid-cols-[160px_1.4fr_1fr_240px]">
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
            className="mt-4 inline-flex rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black shadow-sm transition hover:border-neutral-500"
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
          {accountLabel(
            offer.account_id,
            accountProfile,
            "Guest offer",
            accountProfilesUnavailable,
          )}
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
        offerAmount={Number(offer.offer_amount || 0)}
        productPrice={product?.price ?? null}
        productQuantity={product?.quantity ?? null}
      />
    </article>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  );
}

function CommandLink({
  href,
  label,
  primary = false,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "rounded-full bg-white px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-neutral-200"
          : "rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
      }
    >
      {label}
    </Link>
  );
}
