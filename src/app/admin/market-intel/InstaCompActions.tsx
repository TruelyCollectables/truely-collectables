"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addAdminHandoff } from "../../../lib/admin-handoff";

export default function InstaCompActions({
  identityId,
  handoff,
  compact = false,
  dark = false,
}: {
  identityId: string;
  handoff?: string | null;
  compact?: boolean;
  dark?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const compUrl = addAdminHandoff(
    `/admin/market-intel/comps/${identityId}`,
    handoff,
  );
  const trackUrl = addAdminHandoff(
    `/api/admin/market-intel/identities/${identityId}/track-today`,
    handoff,
  );

  async function trackToday() {
    if (busy) return;
    setBusy(true);
    setMessage("Scanning this exact card and recording today’s market snapshot...");

    try {
      const response = await fetch(trackUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.success !== true) {
        throw new Error(payload?.error || `Tracking failed with HTTP ${response.status}.`);
      }
      setMessage(payload.message || "Today’s exact-card market observation was recorded.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to track this exact card today.",
      );
    } finally {
      setBusy(false);
    }
  }

  const base = compact
    ? "rounded-md px-3 py-2 text-xs font-black"
    : "rounded-md px-4 py-2.5 text-sm font-black";
  const compClass = dark
    ? `${base} border border-cyan-400 bg-cyan-950 text-cyan-100 hover:bg-cyan-900`
    : `${base} border border-cyan-400 bg-cyan-50 text-cyan-950 hover:bg-cyan-100`;
  const trackClass = dark
    ? `${base} bg-fuchsia-300 text-black hover:bg-fuchsia-200 disabled:cursor-wait disabled:opacity-50`
    : `${base} bg-fuchsia-800 text-white hover:bg-fuchsia-700 disabled:cursor-wait disabled:opacity-50`;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap gap-2">
        <a href={compUrl} className={compClass}>
          InstaComp™
        </a>
        <button
          type="button"
          onClick={() => void trackToday()}
          disabled={busy}
          aria-busy={busy}
          title="Run a focused eBay exact-card scan, rescore live matches, recalculate the verified-comp market, and record today’s observation without buying the card."
          className={trackClass}
        >
          {busy ? "Tracking Today..." : "Track Today"}
        </button>
      </div>
      {message ? (
        <p
          role={message.toLowerCase().includes("unable") || message.toLowerCase().includes("failed") ? "alert" : "status"}
          className={
            dark
              ? "max-w-2xl text-xs font-bold text-neutral-200"
              : "max-w-2xl text-xs font-bold text-neutral-600"
          }
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
