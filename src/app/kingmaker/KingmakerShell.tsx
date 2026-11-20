"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  ACCOUNT_SESSION_CHANGE_EVENT,
  clearAccountSession,
  getAccountSession,
} from "../account/account-session";

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
};

type NavGroup = {
  id: string;
  title: string;
  items: readonly NavItem[];
};

const navigationGroups: readonly NavGroup[] = [
  {
    id: "overview",
    title: "Overview",
    items: [{ href: "/kingmaker", label: "Command Center", exact: true }],
  },
  {
    id: "intake",
    title: "Scan & Intake",
    items: [
      { href: "/kingmaker/scan", label: "Scan Cards" },
      { href: "/kingmaker/verified-csv", label: "Verified CSV Intake" },
      { href: "/kingmaker/missing-picture", label: "Missing Picture" },
      { href: "/kingmaker/pending-receipts", label: "Pending Receipts" },
    ],
  },
  {
    id: "inventory",
    title: "Pricing & Inventory",
    items: [
      { href: "/kingmaker/resale-ready", label: "Resale Ready" },
      { href: "/kingmaker/inventory", label: "Inventory" },
      { href: "/kingmaker/memorabilia-autographs", label: "Memorabilia & Autos" },
      { href: "/kingmaker/intelligence", label: "Intelligence" },
    ],
  },
  {
    id: "listings",
    title: "Master Listings",
    items: [
      { href: "/kingmaker/listings", label: "Master Listings" },
      { href: "/kingmaker/pending", label: "Pending Review" },
      { href: "/kingmaker/pending-repair", label: "Pending Repair" },
    ],
  },
  {
    id: "channels",
    title: "Channels & Orders",
    items: [
      { href: "/kingmaker/marketplaces", label: "Marketplaces" },
      { href: "/kingmaker/offers", label: "Offers" },
      { href: "/kingmaker/orders", label: "Orders" },
      { href: "/kingmaker/payouts", label: "Payouts" },
      { href: "/kingmaker/sourcing", label: "Sourcing" },
    ],
  },
  {
    id: "settings",
    title: "Settings & Logins",
    items: [
      { href: "/kingmaker/settings", label: "Settings & Logins" },
      { href: "/kingmaker/instacomp-audit", label: "InstaComp Audit" },
    ],
  },
];

function isItemActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export default function KingmakerShell({
  children,
  adminAuthenticated = false,
}: {
  children: ReactNode;
  adminAuthenticated?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sellerEmail, setSellerEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const session = getAccountSession();
      const valid = Boolean(
        session?.access_token &&
          Number(session.expires_at || 0) * 1000 > Date.now(),
      );
      setSellerEmail(valid ? session?.user?.email || "Seller session" : null);
    };
    refresh();
    window.addEventListener(ACCOUNT_SESSION_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ACCOUNT_SESSION_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // Ignore network errors and proceed with local cleanup + redirect
    }
    clearAccountSession();
    router.push("/admin/login?next=%2Fkingmaker");
    router.refresh();
  }

  const operatorLabel = sellerEmail || (adminAuthenticated ? "Operator: Admin" : "Signed out");
  const isAuthenticated = adminAuthenticated || Boolean(sellerEmail);

  return (
    <div
      data-kingmaker-shell="v2"
      className="min-h-screen bg-[#0b1120] text-slate-100"
    >
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-[#0f172a]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-expanded={mobileNavOpen}
              aria-label="Toggle Kingmaker navigation"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-yellow-400 hover:text-yellow-300 lg:hidden"
            >
              <span className="text-sm font-bold">{mobileNavOpen ? "✕" : "☰"}</span>
            </button>
            <Link href="/kingmaker" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#facc15] font-display text-base font-extrabold tracking-tight text-[#0f172a]">
                KM
              </span>
              <div>
                <span className="font-display block text-xl font-extrabold uppercase leading-none tracking-wide text-white">
                  KINGMAKER
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  by Truely Collectables
                </span>
              </div>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              href="/kingmaker/inventory"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-300 hover:border-emerald-400"
            >
              <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
              TCOS: Connected
            </Link>
            <Link
              href="/kingmaker/marketplaces"
              className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 font-semibold text-blue-300 hover:border-blue-400"
            >
              <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
              eBay &amp; Mercari
            </Link>
            <Link
              href="/kingmaker/settings"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 font-semibold text-slate-200 hover:border-yellow-400 hover:text-yellow-300"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isAuthenticated ? "bg-[#22c55e]" : "bg-[#dc2626]"
                }`}
              />
              {operatorLabel}
            </Link>

            {isAuthenticated ? (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-bold text-slate-100 hover:border-red-500/60 hover:bg-red-950/50 hover:text-red-200 disabled:opacity-60"
              >
                {signingOut ? "Signing out..." : "Sign Out"}
              </button>
            ) : (
              <Link
                href="/admin/login?next=%2Fkingmaker"
                prefetch={false}
                className="rounded-lg bg-[#facc15] px-3.5 py-1.5 font-bold text-[#0f172a] hover:bg-[#eab308]"
              >
                Operator Login
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1560px] gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside
          className={`${
            mobileNavOpen ? "block" : "hidden"
          } border-b border-slate-800 bg-[#0f172a] px-3.5 py-5 lg:block lg:min-h-[calc(100vh-65px)] lg:border-b-0 lg:border-r`}
        >
          <nav aria-label="KINGMAKER navigation" className="space-y-5">
            {navigationGroups.map((group) => (
              <div key={group.id}>
                <p className="px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {group.title}
                </p>
                <div className="mt-1.5 space-y-1">
                  {group.items.map((item) => {
                    const active = isItemActive(pathname, item);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileNavOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition ${
                          active
                            ? "bg-[#facc15] font-bold text-[#0f172a]"
                            : "text-slate-300 hover:bg-slate-800/80 hover:text-white"
                        }`}
                      >
                        <span>{item.label}</span>
                        {active && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[#0f172a]" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 p-3.5 text-xs leading-5 text-slate-400">
            <p className="font-bold uppercase tracking-wider text-[#facc15]">
              Engine Guardrails
            </p>
            <ul className="mt-2 space-y-1">
              <li>• Operator Price Lock enforced</li>
              <li>• eBay $2.00 listing floor</li>
              <li>• Seller approval gates publish</li>
            </ul>
          </div>
        </aside>

        <div className="min-w-0 bg-[#0b1120]">{children}</div>
      </div>
    </div>
  );
}
