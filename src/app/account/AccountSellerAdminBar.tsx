"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ACCOUNT_SESSION_CHANGE_EVENT,
  getFreshAccountSession,
  type StoredAccountSession,
} from "./account-session";

export default function AccountSellerAdminBar() {
  const [session, setSession] = useState<StoredAccountSession | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const freshSession = await getFreshAccountSession();
      if (!cancelled) setSession(freshSession);
    }

    void refresh();
    window.addEventListener(ACCOUNT_SESSION_CHANGE_EVENT, refresh);

    return () => {
      cancelled = true;
      window.removeEventListener(ACCOUNT_SESSION_CHANGE_EVENT, refresh);
    };
  }, []);

  if (!session) return null;

  return (
    <nav
      aria-label="Seller account administration"
      className="border-b border-neutral-900 bg-neutral-950 px-4 py-3 text-white sm:px-6"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-black uppercase tracking-[0.16em] text-yellow-300">
          Seller Admin
        </span>
        <Link
          href="/seller/admin/inventory"
          className="rounded-lg bg-yellow-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-yellow-200"
        >
          Inventory Admin
        </Link>
        <Link
          href="/seller/inventory"
          className="rounded-lg border border-white/20 px-3 py-2 text-sm font-black transition hover:bg-white/10"
        >
          Seller Workspace
        </Link>
        <Link
          href="/account/orders"
          className="rounded-lg border border-white/20 px-3 py-2 text-sm font-black transition hover:bg-white/10"
        >
          Orders
        </Link>
      </div>
    </nav>
  );
}
