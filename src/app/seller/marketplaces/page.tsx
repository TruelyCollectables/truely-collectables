import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { getStoreSettings } from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Connector = {
  name: string;
  status: "active_foundation" | "next_to_connect" | "planned";
  description: string;
  href?: string;
  actionLabel: string;
};

type CountResult = {
  count: number | null;
  error?: { message?: string } | null;
};

const connectors: Connector[] = [
  {
    name: "eBay",
    status: "active_foundation",
    description:
      "Store #1 eBay import, reconciliation, post-sale quantity sync, and sync policy controls are already live for Truely Collectables.",
    href: "/admin/ebay",
    actionLabel: "Open eBay Health",
  },
  {
    name: "Seller eBay OAuth",
    status: "next_to_connect",
    description:
      "Next seller-safe layer: save each seller's eBay connection separately before importing third-party seller inventory.",
    actionLabel: "Seller OAuth Next",
  },
  {
    name: "Shopify",
    status: "planned",
    description:
      "Future connector for syncing TCOS master inventory into seller Shopify storefronts.",
    actionLabel: "Planned",
  },
  {
    name: "Whatnot",
    status: "planned",
    description:
      "Future connector for live selling, show inventory, and collectible marketplace imports.",
    actionLabel: "Planned",
  },
  {
    name: "Etsy",
    status: "planned",
    description:
      "Future connector for vintage, collectible, handmade, and specialty inventory.",
    actionLabel: "Planned",
  },
  {
    name: "Mercari",
    status: "planned",
    description:
      "Future connector for additional collectible marketplace reach.",
    actionLabel: "Planned",
  },
];

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function countLabel(value: number | null) {
  return value === null ? "Review" : value.toLocaleString();
}

function statusLabel(status: Connector["status"]) {
  if (status === "active_foundation") return "Active foundation";
  if (status === "next_to_connect") return "Next to connect";
  return "Planned";
}

function statusTone(status: Connector["status"]) {
  if (status === "active_foundation") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "next_to_connect") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

async function safeCount(query: PromiseLike<CountResult>) {
  const result = await query;
  return result.error ? null : result.count ?? 0;
}

export default async function SellerMarketplacesPage() {
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);

  const [productCount, ebayLinkedCount, activeProductCount, sellerPayoutCount] =
    await Promise.all([
      safeCount(
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId),
      ),
      safeCount(
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .not("ebay_item_id", "is", null),
      ),
      safeCount(
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId)
          .gt("quantity", 0),
      ),
      safeCount(
        supabase
          .from("seller_payout_accounts")
          .select("id", { count: "exact", head: true })
          .eq("store_id", storeId),
      ),
    ]);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Seller Sync
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Marketplace Connections
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Seller-facing control center for marketplace import and sync
              connections. The current live foundation is Store #1 scoped so
              Truely Collectables keeps working while seller-specific
              connectors are built around it.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/account" label="Account" />
            <CommandLink href="/seller-terms" label="Seller Terms" />
            <CommandLink href="/admin/ebay" label="eBay Health" primary />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Store Inventory" value={countLabel(productCount)} />
          <Metric label="Active Products" value={countLabel(activeProductCount)} />
          <Metric label="eBay Linked" value={countLabel(ebayLinkedCount)} />
          <Metric label="Seller Payout Profiles" value={countLabel(sellerPayoutCount)} />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Info label="Store" value={storeSettings.displayName} />
            <Info label="Store Status" value={label(storeSettings.status)} />
            <Info
              label="eBay Sync"
              value={storeSettings.ebaySyncEnabled ? "Enabled" : "Disabled"}
            />
            <Info
              label="Commission"
              value={`${(storeSettings.sellerCommissionRate * 100).toFixed(2)}%`}
            />
          </div>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Available Connectors</h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                eBay stays first because the active TCOS inventory engine,
                reconciliation board, and quantity-sync safety controls already
                run through the Store #1 marketplace foundation.
              </p>
            </div>
            <span className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
              Store {storeId.slice(-4)}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            {connectors.map((connector) => (
              <ConnectorCard key={connector.name} connector={connector} />
            ))}
          </div>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <h2 className="text-2xl font-black">Seller-Safe Build Queue</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              "Seller eBay auth route",
              "Seller token storage",
              "Seller-scoped importer",
              "First-sync wizard",
              "Conflict review dashboard",
            ].map((step, index) => (
              <div
                key={step}
                className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
              >
                <p className="text-xs font-black uppercase text-neutral-500">
                  Step {index + 1}
                </p>
                <p className="mt-2 font-bold">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function ConnectorCard({ connector }: { connector: Connector }) {
  const buttonClass = connector.href
    ? "bg-neutral-950 text-white hover:bg-neutral-800"
    : "cursor-not-allowed bg-neutral-200 text-neutral-500";

  return (
    <article className="flex min-h-[230px] flex-col rounded-md border border-neutral-200 bg-neutral-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-black">{connector.name}</h3>
        <span
          className={`shrink-0 rounded border px-2 py-1 text-[11px] font-black ${statusTone(
            connector.status,
          )}`}
        >
          {statusLabel(connector.status)}
        </span>
      </div>

      <p className="mt-3 flex-1 text-sm leading-6 text-neutral-600">
        {connector.description}
      </p>

      {connector.href ? (
        <Link
          href={connector.href}
          className={`mt-5 rounded-md px-4 py-2 text-center text-sm font-bold ${buttonClass}`}
        >
          {connector.actionLabel}
        </Link>
      ) : (
        <button
          className={`mt-5 rounded-md px-4 py-2 text-sm font-bold ${buttonClass}`}
          disabled
          type="button"
        >
          {connector.actionLabel}
        </button>
      )}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <dt className="text-xs font-bold uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

function CommandLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link
      href={href}
      className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}
    >
      {label}
    </Link>
  );
}
