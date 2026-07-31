"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { getAccountSession } from "../account/account-session";

export default function AccountCardIntakeShortcut() {
  const pathname = usePathname();
  const [signedIn] = useState(() =>
    typeof window === "undefined" ? false : Boolean(getAccountSession()),
  );

  if (pathname !== "/account" || !signedIn) return null;

  return (
    <aside
      aria-label="Card intake shortcut"
      className="border-b border-amber-300 bg-amber-50"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">
            Truely Collectables Owner Tool
          </p>
          <p className="mt-1 font-black text-neutral-950">
            Scan cards, run InstaComp™, edit listings, and publish to the website and eBay.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="shrink-0 rounded-xl bg-neutral-950 px-5 py-3 text-center text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
        >
          Open Card Intake Studio
        </Link>
      </div>
    </aside>
  );
}
