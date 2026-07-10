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

  async function refreshConnectStatuses() {
    setLoading(true);

    try {
      const response = await fetch("/api/admin/seller-payouts/connect-refresh", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        alert(data.error || "Could not refresh seller Connect statuses.");
        return;
      }

      const failedCount = Number(data.failedCount || 0);
      if (failedCount > 0) {
        alert(
          `Refreshed ${data.updatedCount || 0} seller Connect account(s); ${failedCount} failed.`,
        );
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      alert("Could not refresh seller Connect statuses.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={refreshConnectStatuses}
      className="rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-bold text-neutral-900 hover:bg-white disabled:bg-neutral-100 disabled:text-neutral-400"
    >
      {loading ? "Refreshing..." : "Refresh Stripe Status"}
    </button>
  );
}
