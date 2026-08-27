import Link from "next/link";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-lg px-3 py-2 text-sm font-black text-neutral-950 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              Admin Home
            </Link>
            <Link
              href="/admin/advanced"
              className="rounded-lg px-3 py-2 text-sm font-bold text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
            >
              Advanced Admin
            </Link>
          </div>
          <Link
            href="/kingmaker"
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-black tracking-wide text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <span aria-hidden="true">👑</span>
            OPEN KINGMAKER
          </Link>
        </div>
      </header>
      {children}
    </>
  );
}
