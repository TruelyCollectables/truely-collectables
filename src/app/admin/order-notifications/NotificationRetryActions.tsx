"use client";

import { useState } from "react";

export default function NotificationRetryActions({
  notificationId,
}: {
  notificationId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/order-notifications/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notificationId ? { notificationId } : { limit: 50 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || data?.result?.error || "Retry failed");
      }
      setMessage(notificationId ? "Delivery completed." : "Retry batch completed.");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error: any) {
      setMessage(error?.message || "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Retrying…" : notificationId ? "Retry" : "Retry Pending"}
      </button>
      {message ? <p className="max-w-xs text-xs text-neutral-600">{message}</p> : null}
    </div>
  );
}
