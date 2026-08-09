import Link from "next/link";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mx-auto w-full max-w-[1500px] px-4 pt-5 sm:px-6 lg:px-8">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/kingmaker"
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-amber-300 bg-neutral-950 px-6 py-4 text-center text-lg font-black tracking-wide text-white shadow-xl transition hover:-translate-y-0.5 hover:border-amber-200 hover:bg-neutral-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-500"
          >
            <span className="text-2xl" aria-hidden="true">
              👑
            </span>
            OPEN KINGMAKER
          </Link>
          <Link
            href="/admin/instacomp/fast"
            className="flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl border-2 border-cyan-300 bg-cyan-950 px-6 py-4 text-center text-lg font-black tracking-wide text-white shadow-xl transition hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
          >
            <span className="text-2xl" aria-hidden="true">
              📷
            </span>
            INSTACOMP
          </Link>
        </div>
      </div>
      {children}
    </>
  );
}
