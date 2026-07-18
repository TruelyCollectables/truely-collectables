"use client";

import Link from "next/link";
import { useEffect } from "react";

function adminErrorReference(error: Error & { digest?: string }) {
  const digest = String(error.digest || "").trim();

  if (digest) return `Server digest: ${digest}`;

  return "No server digest was returned. Retry once, then open Production Smoke and match the browser time with server logs.";
}

export default function AdminError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Admin route failed:", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-10 text-neutral-950">
      <section className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm">
        <div className="border-b border-rose-200 bg-rose-50 p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-700">
            Admin recovery
          </p>
          <h1 className="mt-2 text-3xl font-black md:text-4xl">
            This admin panel hit an error.
          </h1>
          <p className="mt-3 max-w-2xl font-semibold leading-7 text-rose-950">
            The rest of the site is still available. Retry this panel, go back to
            the command center, or use the safe reference below to match the
            server logs without exposing raw exception text in the operator UI.
          </p>
        </div>

        <div className="grid gap-5 p-6">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
              Safe recovery reference
            </p>
            <p className="mt-2 break-all font-mono text-sm font-bold text-neutral-800">
              {adminErrorReference(error)}
            </p>
            <p className="mt-2 text-xs font-bold leading-5 text-neutral-600">
              Raw exception details stay in the server/browser logs. The admin
              screen stays readable so a broken panel does not look like a
              broken dashboard.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Retry This Panel
            </button>
            <Link
              href="/admin"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Admin Command Center
            </Link>
            <Link
              href="/admin/production-smoke"
              className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-950 hover:bg-amber-100"
            >
              Production Smoke
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
