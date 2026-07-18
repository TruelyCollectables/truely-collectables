"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ConnectRefreshActions({
  disabled,
}: {
  disabled?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  async function refreshConnectStatuses() {
    setLoading(true);
    setMessage({ tone: "info", text: "Refreshing Stripe Connect statuses..." });

    try {
      const response = await fetch("/api/admin/seller-payouts/connect-refresh", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({
          tone: "error",
          text: data.error || "Could not refresh seller Connect statuses.",
        });
        return;
      }

      const failedCount = Number(data.failedCount || 0);
      setMessage({
        tone: failedCount > 0 ? "error" : "success",
        text:
          failedCount > 0
            ? `Refreshed ${data.updatedCount || 0} seller Connect account(s); ${failedCount} failed.`
            : `Refreshed ${data.updatedCount || 0} seller Connect account(s).`,
      });

      router.refresh();
    } catch (error) {
      console.error(error);
      setMessage({
        tone: "error",
        text: "Could not refresh seller Connect statuses.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        aria-busy={loading}
        disabled={disabled || loading}
        onClick={refreshConnectStatuses}
        className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-bold text-neutral-900 hover:bg-white disabled:bg-neutral-100 disabled:text-neutral-400"
      >
        {loading ? "Refreshing..." : "Refresh Stripe Status"}
      </button>
      {message ? <ActionNotice tone={message.tone}>{message.text}</ActionNotice> : null}
    </div>
  );
}

function ActionNotice({
  tone,
  children,
}: {
  tone: "success" | "error" | "info";
  children: React.ReactNode;
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded border px-2 py-1 text-xs font-bold ${className}`}
    >
      {children}
    </p>
  );
}
