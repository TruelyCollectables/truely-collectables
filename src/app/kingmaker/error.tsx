"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

function recoveryUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("km_recover", String(Date.now()));
  return url.toString();
}

function errorFingerprint(error: Error & { digest?: string }) {
  return [
    window.location.pathname,
    error.digest || "",
    error.name || "",
    error.message || "",
  ].join("|");
}

export default function KingmakerError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const detail = useMemo(
    () => error.message || "Unknown KINGMAKER route error.",
    [error.message],
  );
  const route = usePathname();

  useEffect(() => {
    console.error("KINGMAKER route error", error);

    try {
      const key = `kingmaker-recovery:${errorFingerprint(error)}`;
      if (window.sessionStorage.getItem(key) !== "attempted") {
        window.sessionStorage.setItem(key, "attempted");
        window.location.replace(recoveryUrl());
      }
    } catch {
      // Keep the visible controls if storage is unavailable.
    }
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-3xl rounded-2xl border-2 border-red-800 bg-white p-6 text-neutral-950 shadow-[6px_6px_0_#111]">
        <p className="text-xs font-black uppercase tracking-widest text-red-700">
          KINGMAKER recovered safely
        </p>
        <h1 className="mt-2 text-2xl font-black text-neutral-950">
          This page hit an error.
        </h1>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          A clean reload was attempted automatically. If this panel remains,
          the diagnostic below identifies the exact failing route.
        </p>

        <div className="mt-4 rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-sm">
          <p>
            <strong>Route:</strong> {route}
          </p>
          <p className="mt-2 break-words">
            <strong>Error:</strong> {detail}
          </p>
          {error.digest ? (
            <p className="mt-2 break-all">
              <strong>Digest:</strong> {error.digest}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.replace(recoveryUrl())}
            className="rounded-xl bg-neutral-950 px-5 py-3 font-black text-white"
          >
            Reload cleanly
          </button>
          <a
            href="/kingmaker"
            className="rounded-xl border-2 border-neutral-900 bg-white px-5 py-3 font-black text-neutral-950"
          >
            Back to KINGMAKER
          </a>
        </div>
      </section>
    </main>
  );
}
