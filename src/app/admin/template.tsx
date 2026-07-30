"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const PUBLIC_ADMIN_PATHS = new Set([
  "/admin/login",
  "/admin/reset-password",
]);

function orderIdFromPath(pathname: string) {
  const match = /^\/admin\/orders\/(\d+)$/.exec(pathname);
  return match ? match[1] : "";
}

export default function AdminTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const feeReconciliationStarted = useRef(false);
  const isProtectedAdminPage =
    pathname.startsWith("/admin") && !PUBLIC_ADMIN_PATHS.has(pathname);
  const refundPanelAvailable =
    pathname === "/admin/orders" || /^\/admin\/orders\/\d+$/.test(pathname);

  useEffect(() => {
    if (!isProtectedAdminPage) return;

    void fetch("/api/admin/session/refresh", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!feeReconciliationStarted.current) {
      feeReconciliationStarted.current = true;
      void fetch("/api/admin/reconcile-platform-fees", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
    }
  }, [isProtectedAdminPage, pathname]);

  return (
    <>
      {children}
      {refundPanelAvailable ? <RefundOrderPanel pathname={pathname} /> : null}
    </>
  );
}

function RefundOrderPanel({ pathname }: { pathname: string }) {
  const pathOrderId = orderIdFromPath(pathname);
  const [manualOrderId, setManualOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const orderId = pathOrderId || manualOrderId;
  const cleanOrderId = Number(orderId);
  const cleanReason = reason.replace(/\s+/g, " ").trim();
  const canSubmit =
    Number.isInteger(cleanOrderId) &&
    cleanOrderId > 0 &&
    cleanReason.length >= 10 &&
    confirmed &&
    !submitting;

  async function submitRefund() {
    if (!canSubmit) {
      setMessage({
        tone: "error",
        text: "Enter an order ID, a reason of at least 10 characters, and confirm the full refund.",
      });
      return;
    }

    setSubmitting(true);
    setMessage({
      tone: "info",
      text: "Submitting the full Stripe refund and cancelling fulfillment...",
    });

    try {
      const response = await fetch("/api/orders/refund", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: cleanOrderId,
          reason: cleanReason,
          confirmed: true,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage({
          tone: "error",
          text: data.error || "The order could not be refunded.",
        });
        return;
      }

      setMessage({
        tone: "success",
        text: `Refund ${data.refundStatus || "submitted"}. Fulfillment is cancelled. Inventory was not automatically relisted.`,
      });

      window.setTimeout(() => {
        window.location.assign(`/admin/orders/${cleanOrderId}`);
      }, 1200);
    } catch (error: any) {
      setMessage({
        tone: "error",
        text: error?.message || "The order could not be refunded.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const messageClasses =
    message?.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : message?.tone === "error"
        ? "border-red-200 bg-red-50 text-red-950"
        : "border-sky-200 bg-sky-50 text-sky-950";

  return (
    <details className="fixed bottom-4 right-4 z-[80] w-[min(92vw,420px)] rounded-3xl border border-red-300 bg-white shadow-2xl">
      <summary className="cursor-pointer list-none rounded-3xl bg-red-700 px-5 py-4 text-sm font-black text-white shadow-sm">
        Refund / cancel order
      </summary>

      <div id="refund-order" className="space-y-4 p-5">
        <div>
          <h2 className="text-xl font-black text-neutral-950">
            Full order refund
          </h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
            This sends the full payment back through Stripe to the original payment
            method and cancels fulfillment. Inventory is not automatically relisted.
          </p>
        </div>

        <label className="block text-sm font-black text-neutral-900">
          Order ID
          <input
            inputMode="numeric"
            value={orderId}
            readOnly={Boolean(pathOrderId)}
            onChange={(event) =>
              setManualOrderId(event.target.value.replace(/\D/g, ""))
            }
            className="mt-2 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-red-700 read-only:bg-neutral-100"
            placeholder="Order number"
          />
        </label>

        <label className="block text-sm font-black text-neutral-900">
          Why is this order being cancelled?
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 500))}
            className="mt-2 min-h-28 w-full rounded-2xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold outline-none focus:border-red-700"
            placeholder="Example: The item was damaged before shipment and cannot be fulfilled."
          />
          <span className="mt-1 block text-xs font-semibold text-neutral-500">
            {cleanReason.length}/500 characters; minimum 10.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-950">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            I understand this issues a full refund and cancels the fulfillment queue
            for this order.
          </span>
        </label>

        <button
          type="button"
          onClick={submitRefund}
          disabled={!canSubmit}
          aria-busy={submitting}
          className="w-full rounded-2xl bg-red-700 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Refunding..." : "Issue full refund and cancel order"}
        </button>

        {message ? (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={`rounded-2xl border p-3 text-sm font-bold ${messageClasses}`}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </details>
  );
}
