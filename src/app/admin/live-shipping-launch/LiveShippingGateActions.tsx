"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LiveShippingGateActions({
  approvalReady,
  approvalDatabaseReady,
}: {
  approvalReady: boolean;
  approvalDatabaseReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "revoke" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);

  async function submit(action: "approve" | "revoke") {
    const expected =
      action === "approve" ? "APPROVE LIVE SHIPPING" : "REVOKE LIVE SHIPPING";
    const confirmation = window.prompt(`Type ${expected} exactly.`);
    if (confirmation !== expected) return;
    const operator = window.prompt("Operator name for the immutable audit log:");
    if (!operator?.trim()) return;
    const note = window.prompt("Optional launch/revocation note:") || "";

    setBusy(action);
    setMessage({
      tone: "info",
      text:
        action === "approve"
          ? "Recording live shipping approval..."
          : "Recording emergency shipping revocation...",
    });
    try {
      const response = await fetch("/api/admin/live-shipping-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirmation, operator, note }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Gate update failed.");
      setMessage({
        tone: "success",
        text:
          action === "approve"
            ? "Database approval recorded. Live shipping still requires the environment kill switch and live purchase mode."
            : "Live shipping approval revoked.",
      });
      router.refresh();
    } catch (error: any) {
      setMessage({
        tone: "error",
        text: error.message || "Gate update failed.",
      });
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
        {busy === "approve" ? "Approving..." : "Approve Live Shipping"}
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
          Approval is disabled until the live-shipping launch gate migration is
          applied.
        </p>
      ) : null}
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
        ? "border-red-200 bg-red-50 text-red-950"
        : "border-blue-200 bg-blue-50 text-blue-950";

  return (
    <p className={`w-full rounded border px-3 py-2 text-sm font-bold ${className}`}>
      {children}
    </p>
  );
}
