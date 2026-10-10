"use client";

import { useEffect } from "react";

export default function KingmakerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("KINGMAKER route error", error);
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-3xl rounded-2xl border-2 border-red-800 bg-white p-6 shadow-[6px_6px_0_#111]">
        <p className="text-xs font-black uppercase tracking-widest text-red-700">
          KINGMAKER recovered safely
        </p>
        <h1 className="mt-2 text-2xl font-black">This page hit an error.</h1>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          The rest of KINGMAKER remains intact. Retry this route or return to the
          main workspace.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-neutral-950 px-5 py-3 font-black text-white"
          >
            Retry page
          </button>
          <a
            href="/kingmaker"
            className="rounded-xl border-2 border-neutral-900 bg-white px-5 py-3 font-black"
          >
            Back to KINGMAKER
          </a>
        </div>
      </section>
    </main>
  );
}
