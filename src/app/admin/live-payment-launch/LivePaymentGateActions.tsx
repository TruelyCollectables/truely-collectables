"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LivePaymentGateActions({
  approvalReady,
  approvalDatabaseReady,
}: {
  approvalReady: boolean;
  approvalDatabaseReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "revoke" | null>(null);

  async function submit(action: "approve" | "revoke") {
    const expected =
      action === "approve" ? "APPROVE LIVE PAYMENTS" : "REVOKE LIVE PAYMENTS";
    const confirmation = window.prompt(`Type ${expected} exactly.`);
    if (confirmation !== expected) return;
    const operator = window.prompt("Operator name for the immutable audit log:");
    if (!operator?.trim()) return;
    const note = window.prompt("Optional launch/revocation note:") || "";

    setBusy(action);
    try {
      const response = await fetch("/api/admin/live-payment-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation, operator, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Gate update failed.");
      window.alert(
        action === "approve"
          ? "Database approval recorded. Live Checkout still requires the environment kill switch."
          : "Live payment approval revoked.",
      );
      router.refresh();
    } catch (error: any) {
      window.alert(error.message || "Gate update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        disabled={!approvalReady || !approvalDatabaseReady || busy !== null}
        onClick={() => submit("approve")}
        className="rounded bg-green-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "approve" ? "Approving..." : "Approve Live Payments"}
      </button>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => submit("revoke")}
        className="rounded bg-red-700 px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "revoke" ? "Revoking..." : "Emergency Revoke"}
      </button>
      {!approvalDatabaseReady ? (
        <p className="w-full text-sm font-bold text-red-800">
          Approval is disabled until the live-payment launch gate migration is
          applied.
        </p>
      ) : null}
    </div>
  );
}
