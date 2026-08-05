"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  ACCOUNT_SESSION_CHANGE_EVENT,
  getAccountSession,
} from "../account/account-session";

const navigation = [
  { href: "/kingmaker", label: "Command Center", exact: true },
  { href: "/kingmaker/scan", label: "Scan Cards", exact: false },
  { href: "/kingmaker/pending", label: "Pending Listings", exact: false },
  { href: "/kingmaker/inventory", label: "Inventory", exact: false },
  { href: "/kingmaker/intelligence", label: "Intelligence", exact: false },
  { href: "/kingmaker/sourcing", label: "Sourcing", exact: false },
  { href: "/kingmaker/offers", label: "Offers", exact: false },
  { href: "/kingmaker/orders", label: "Orders", exact: false },
  { href: "/kingmaker/marketplaces", label: "Marketplaces", exact: false },
  { href: "/kingmaker/payouts", label: "Payouts", exact: false },
  { href: "/kingmaker/settings", label: "Settings", exact: false },
] as const;

function activeRoute(
  pathname: string,
  item: (typeof navigation)[number],
) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export default function KingmakerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [accountLabel, setAccountLabel] = useState("Seller account");

  useEffect(() => {
    const refresh = () => {
      const session = getAccountSession();
      setAccountLabel(session?.user?.email || "Seller account");
    };
    refresh();
    window.addEventListener(ACCOUNT_SESSION_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(ACCOUNT_SESSION_CHANGE_EVENT, refresh);
  }, []);

  return (
    <div
      data-kingmaker-shell="v1"
      className="min-h-screen bg-slate-950 text-white"
    >
      <header className="border-b border-slate-800 bg-slate-950/95 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/kingmaker"
              className="text-xs font-black uppercase tracking-[0.28em] text-emerald-300"
            >
              KINGMAKER
            </Link>
            <p className="mt-1 text-sm text-slate-300">
              Seller operations powered by InstaComp AI intelligence
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300">
              {accountLabel}
            </span>
            <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-3 py-2 font-bold text-emerald-200">
              Registry controls identity
            </span>
            <span className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-2 font-bold text-blue-200">
              Seller approval controls execution
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-0 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-slate-800 bg-slate-950 px-4 py-5 lg:min-h-[calc(100vh-89px)] lg:border-b-0 lg:border-r">
          <nav aria-label="KINGMAKER navigation" className="grid gap-1 sm:grid-cols-3 lg:grid-cols-1">
            {navigation.map((item) => {
              const active = activeRoute(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                    active
                      ? "bg-emerald-400 text-slate-950"
                      : "text-slate-300 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-xs leading-5 text-slate-400">
            <p className="font-black text-slate-200">Authority chain</p>
            <p className="mt-2">
              InstaComp analyzes and recommends. The Checklist Registry locks exact identity. KINGMAKER manages review and authorized seller actions.
            </p>
          </div>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
