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
  card_verified: boolean | null;
  card_verified_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  billing_country: string | null;
  billing_postal_code: string | null;
  card_verification_failure_reason: string | null;
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

type AccountDataIssue = {
  label: string;
  detail: string;
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

function safeErrorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message || "Unknown database error.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
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
      "id,email,display_name,account_status,default_account_type,tos_accepted,tos_version,tos_accepted_at,card_verified,card_verified_at,card_brand,card_last4,billing_country,billing_postal_code,card_verification_failure_reason,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (profilesError) {
    const isMigrationMissing = isMissingAccountDataError(profilesError);

    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.15),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
          <Link href="/admin" className="text-sm font-bold underline">
            Back to Command Center
          </Link>
          <h1 className="mt-4 text-3xl font-black">Customer Accounts</h1>
          <p className="mt-3 text-sm text-neutral-600">
            {isMigrationMissing
              ? "Account tables are not available yet. Apply the TCOS account migrations before using this page."
              : `Could not load account profiles: ${safeErrorMessage(profilesError)}`}
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
  const orderStatsUnavailable = Boolean(ordersResult.error);
  const offerStatsUnavailable = Boolean(offersResult.error);

  const accountDataIssues: AccountDataIssue[] = [];

  if (ordersResult.error) {
    accountDataIssues.push({
      label: "Order links unavailable",
      detail: ordersUnavailable
        ? "Order/account link columns are not available yet. Apply the account-link migration before trusting order counts or linked revenue."
        : `Could not load linked order counts: ${safeErrorMessage(ordersResult.error)}`,
    });
  }

  if (offersResult.error) {
    accountDataIssues.push({
      label: "Offer links unavailable",
      detail: offersUnavailable
        ? "Offer/account link columns are not available yet. Apply the account-link migration before trusting offer counts."
        : `Could not load linked offer counts: ${safeErrorMessage(offersResult.error)}`,
    });
  }

  const statsByAccount = buildStats(
    typedProfiles,
    orderStatsUnavailable ? [] : ((ordersResult.data || []) as AccountOrder[]),
    offerStatsUnavailable ? [] : ((offersResult.data || []) as AccountOffer[]),
  );

  const activeAccounts = typedProfiles.filter(
    (profile) => profile.account_status === "active",
  );
  const tosAccepted = typedProfiles.filter((profile) => profile.tos_accepted);
  const cardVerified = typedProfiles.filter((profile) => profile.card_verified);
  const linkedRevenue = Array.from(statsByAccount.values()).reduce(
    (sum, stats) => sum + stats.revenue,
    0,
  );
  const verificationPending = Math.max(
    0,
    typedProfiles.length - cardVerified.length,
  );
  const tosMissing = Math.max(0, typedProfiles.length - tosAccepted.length);
  const accountDataPosture =
    accountDataIssues.length > 0 ? "PARTIAL DATA" : "LINKED DATA LIVE";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.15),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Accounts
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Customer Account Lookup
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-300">
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

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {accountDataIssues.length > 0 ? (
          <section
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 shadow-sm ring-1 ring-amber-900/5"
          >
            <p className="font-black">
              Account profiles loaded, but linked activity is partially unavailable.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold">
              {accountDataIssues.map((issue) => (
                <li key={issue.label}>
                  <span className="font-black">{issue.label}:</span>{" "}
                  {issue.detail}
                </li>
              ))}
            </ul>
            <p className="mt-2 font-bold">
              Unavailable linked counts are labeled below instead of shown as a
              false zero.
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total Accounts" value={String(typedProfiles.length)} />
          <Metric label="Active Accounts" value={String(activeAccounts.length)} />
          <Metric label="TOS Accepted" value={String(tosAccepted.length)} />
          <Metric label="Card Verified" value={String(cardVerified.length)} />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Metric
            label="Linked Revenue"
            value={orderStatsUnavailable ? "Unavailable" : money(linkedRevenue)}
          />
          <Metric
            label="Verification Pending"
            value={String(typedProfiles.length - cardVerified.length)}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <AccountPostureCard
            eyebrow="Data posture"
            title={accountDataPosture}
            detail={
              accountDataIssues.length > 0
                ? "Linked order/offer counts are labeled unavailable instead of shown as false zeroes."
                : "Account profiles, order links, and offer links loaded cleanly for this view."
            }
            tone={accountDataIssues.length > 0 ? "amber" : "emerald"}
          />
          <AccountPostureCard
            eyebrow="Trust gates"
            title={`${verificationPending} card review${verificationPending === 1 ? "" : "s"}`}
            detail={`${tosMissing} account${tosMissing === 1 ? "" : "s"} still missing TOS acceptance; use this page to separate buyer readiness from admin access.`}
            tone={verificationPending > 0 || tosMissing > 0 ? "amber" : "emerald"}
          />
          <AccountPostureCard
            eyebrow="Linked activity"
            title={orderStatsUnavailable ? "Orders unavailable" : money(linkedRevenue)}
            detail={
              orderStatsUnavailable || offerStatsUnavailable
                ? "Apply account-link migrations before trusting activity totals."
                : "Linked revenue and offer activity are safe to review from the account table below."
            }
            tone={orderStatsUnavailable || offerStatsUnavailable ? "amber" : "sky"}
          />
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
          <div className="border-b border-neutral-200 bg-white/70 p-5">
            <h2 className="text-2xl font-black">Recent Accounts</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Limited to the latest 100 profiles while the account system is
              still in foundation mode.
            </p>
          </div>

          {typedProfiles.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 m-5 text-center text-sm font-semibold text-neutral-600">
              No customer accounts have been created yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Account</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">TOS</th>
                    <th className="px-5 py-3">Card/Billing</th>
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
                      <tr key={profile.id} className="transition hover:bg-neutral-50">
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
                          <p className="font-bold">
                            {profile.card_verified ? "Verified" : "Pending"}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {profile.card_brand && profile.card_last4
                              ? `${profile.card_brand.toUpperCase()} ${profile.card_last4}`
                              : "No card proof"}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {[profile.billing_country, profile.billing_postal_code]
                              .filter(Boolean)
                              .join(" ") || "No billing proof"}
                          </p>
                          {profile.card_verification_failure_reason ? (
                            <p className="mt-1 text-xs font-bold text-rose-700">
                              {label(profile.card_verification_failure_reason)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          {orderStatsUnavailable ? (
                            <>
                              <p className="font-black text-amber-800">
                                Unavailable
                              </p>
                              <p className="text-xs text-neutral-500">
                                Order links not loaded
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-black">{stats.orders}</p>
                              <p className="text-xs text-neutral-500">
                                {stats.paidOrders} paid
                              </p>
                            </>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {offerStatsUnavailable ? (
                            <>
                              <p className="font-black text-amber-800">
                                Unavailable
                              </p>
                              <p className="text-xs text-neutral-500">
                                Offer links not loaded
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="font-black">{stats.offers}</p>
                              <p className="text-xs text-neutral-500">
                                {stats.openOffers} open
                              </p>
                            </>
                          )}
                        </td>
                        <td className="px-5 py-4 font-black">
                          {orderStatsUnavailable
                            ? "Unavailable"
                            : money(stats.revenue)}
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
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 break-words text-3xl font-black">{value}</p>
    </div>
  );
}

function AccountPostureCard({
  eyebrow,
  title,
  detail,
  tone,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  tone: "amber" | "emerald" | "sky";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-950"
        : "border-amber-200 bg-amber-50 text-amber-950";

  return (
    <section className={`rounded-3xl border p-5 shadow-sm ring-1 ring-black/[0.02] ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-75">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-black tracking-tight">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 opacity-85">
        {detail}
      </p>
    </section>
  );
}

function CommandLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
    >
      {label}
    </Link>
  );
}
