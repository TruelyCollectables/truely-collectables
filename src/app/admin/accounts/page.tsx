import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AccountProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  account_status: string | null;
  default_account_type: string | null;
  tos_accepted: boolean | null;
  tos_version: string | null;
  tos_accepted_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type AccountOrder = {
  account_id: string | null;
  total: number | null;
  status: string | null;
};

type AccountOffer = {
  account_id: string | null;
  status: string | null;
};

type AccountStats = {
  orders: number;
  paidOrders: number;
  revenue: number;
  offers: number;
  openOffers: number;
};

function isMissingAccountDataError(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_profiles") ||
    message.includes("account_id")
  );
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function emptyStats(): AccountStats {
  return {
    orders: 0,
    paidOrders: 0,
    revenue: 0,
    offers: 0,
    openOffers: 0,
  };
}

function buildStats(
  profiles: AccountProfile[],
  orders: AccountOrder[],
  offers: AccountOffer[],
) {
  const statsByAccount = new Map<string, AccountStats>();

  for (const profile of profiles) {
    statsByAccount.set(profile.id, emptyStats());
  }

  for (const order of orders) {
    if (!order.account_id) continue;
    const stats = statsByAccount.get(order.account_id);
    if (!stats) continue;

    stats.orders += 1;
    if (order.status === "paid") {
      stats.paidOrders += 1;
      stats.revenue += Number(order.total || 0);
    }
  }

  for (const offer of offers) {
    if (!offer.account_id) continue;
    const stats = statsByAccount.get(offer.account_id);
    if (!stats) continue;

    stats.offers += 1;
    if (offer.status === "pending" || offer.status === "countered") {
      stats.openOffers += 1;
    }
  }

  return statsByAccount;
}

export default async function AdminAccountsPage() {
  const storeId = getActiveStoreId();
  const { data: profiles, error: profilesError } = await supabase
    .from("account_profiles")
    .select(
      "id,email,display_name,account_status,default_account_type,tos_accepted,tos_version,tos_accepted_at,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (profilesError) {
    const isMigrationMissing = isMissingAccountDataError(profilesError);

    return (
      <main className="min-h-screen bg-[#f4f1ea] p-8 text-neutral-950">
        <div className="mx-auto max-w-5xl rounded-md border border-neutral-200 bg-white p-6">
          <Link href="/admin" className="text-sm font-bold underline">
            Back to Command Center
          </Link>
          <h1 className="mt-4 text-3xl font-black">Customer Accounts</h1>
          <p className="mt-3 text-sm text-neutral-600">
            {isMigrationMissing
              ? "Account tables are not available yet. Apply the TCOS account migrations before using this page."
              : `Could not load account profiles: ${profilesError.message}`}
          </p>
        </div>
      </main>
    );
  }

  const typedProfiles = (profiles || []) as AccountProfile[];
  const [ordersResult, offersResult] = await Promise.all([
    supabase
      .from("orders")
      .select("account_id,total,status")
      .eq("store_id", storeId)
      .not("account_id", "is", null),
    supabase
      .from("offers")
      .select("account_id,status")
      .eq("store_id", storeId)
      .not("account_id", "is", null),
  ]);

  const ordersUnavailable =
    ordersResult.error && isMissingAccountDataError(ordersResult.error);
  const offersUnavailable =
    offersResult.error && isMissingAccountDataError(offersResult.error);

  if (ordersResult.error && !ordersUnavailable) {
    throw ordersResult.error;
  }

  if (offersResult.error && !offersUnavailable) {
    throw offersResult.error;
  }

  const statsByAccount = buildStats(
    typedProfiles,
    ordersUnavailable ? [] : ((ordersResult.data || []) as AccountOrder[]),
    offersUnavailable ? [] : ((offersResult.data || []) as AccountOffer[]),
  );

  const activeAccounts = typedProfiles.filter(
    (profile) => profile.account_status === "active",
  );
  const tosAccepted = typedProfiles.filter((profile) => profile.tos_accepted);
  const linkedRevenue = Array.from(statsByAccount.values()).reduce(
    (sum, stats) => sum + stats.revenue,
    0,
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Accounts
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Customer Account Lookup
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Review buyer accounts, linked orders, offer activity, TOS status,
              and account separation from platform admin access.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin" label="Command Center" />
            <CommandLink href="/admin/orders" label="Orders" />
            <CommandLink href="/admin/offers" label="Offers" />
            <CommandLink href="/admin/security" label="Security" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {ordersUnavailable || offersUnavailable ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            Account profiles are available, but order/offer account links need
            the account-link migration before counts can be shown.
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total Accounts" value={String(typedProfiles.length)} />
          <Metric label="Active Accounts" value={String(activeAccounts.length)} />
          <Metric label="TOS Accepted" value={String(tosAccepted.length)} />
          <Metric label="Linked Revenue" value={money(linkedRevenue)} />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Recent Accounts</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Limited to the latest 100 profiles while the account system is
              still in foundation mode.
            </p>
          </div>

          {typedProfiles.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No customer accounts have been created yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-200 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">TOS</th>
                    <th className="px-5 py-3">Orders</th>
                    <th className="px-5 py-3">Offers</th>
                    <th className="px-5 py-3">Revenue</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {typedProfiles.map((profile) => {
                    const stats = statsByAccount.get(profile.id) || emptyStats();

                    return (
                      <tr key={profile.id}>
                        <td className="px-5 py-4">
                          <p className="font-black">
                            {profile.email ||
                              profile.display_name ||
                              "No account email"}
                          </p>
                          <p className="mt-1 max-w-[320px] break-all text-xs text-neutral-500">
                            {profile.id}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-bold">{label(profile.account_status)}</p>
                          <p className="text-xs text-neutral-500">
                            {label(profile.default_account_type)}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-bold">
                            {profile.tos_accepted ? "Accepted" : "Missing"}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {profile.tos_version || "No version"}
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-black">{stats.orders}</p>
                          <p className="text-xs text-neutral-500">
                            {stats.paidOrders} paid
                          </p>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-black">{stats.offers}</p>
                          <p className="text-xs text-neutral-500">
                            {stats.openOffers} open
                          </p>
                        </td>
                        <td className="px-5 py-4 font-black">
                          {money(stats.revenue)}
                        </td>
                        <td className="px-5 py-4 text-neutral-600">
                          {shortDate(profile.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 break-words text-3xl font-black">{value}</p>
    </div>
  );
}

function CommandLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
    >
      {label}
    </Link>
  );
}
