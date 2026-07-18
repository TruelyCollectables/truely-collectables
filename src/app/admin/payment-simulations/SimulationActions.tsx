"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SimulationActions({
  stripeTestEnabled,
}: {
  stripeTestEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "deterministic" | "stripe_test" | "checkout_e2e" | null
  >(null);
  const [pendingMode, setPendingMode] = useState<"stripe_test" | "checkout_e2e" | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");

  async function run(mode: "deterministic" | "stripe_test") {
    if (mode === "stripe_test" && confirmation !== "RUN STRIPE TEST") {
      setMessage("Type RUN STRIPE TEST exactly before running the Stripe sandbox suite.");
      return;
    }

    setBusy(mode);
    setMessage("");
    try {
      const response = await fetch("/api/admin/payment-simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Simulation failed.");
      setMessage(
        `${data.status}: ${data.passed} passed, ${data.failed} failed, ${data.skipped} skipped.`,
      );
      setPendingMode(null);
      setConfirmation("");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Simulation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runCheckoutE2E() {
    if (confirmation !== "RUN CHECKOUT E2E") {
      setMessage("Type RUN CHECKOUT E2E exactly before running the full checkout test.");
      return;
    }

    setBusy("checkout_e2e");
    setMessage("");
    try {
      const response = await fetch(
        "/api/admin/payment-simulations/checkout-e2e",
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Checkout E2E failed.");
      setMessage(
        `${data.status}: ${data.passed} passed, ${data.failed} failed, ${data.skipped} skipped.`,
      );
      setPendingMode(null);
      setConfirmation("");
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Checkout E2E failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => run("deterministic")}
        disabled={busy !== null}
        className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
      >
        {busy === "deterministic" ? "Running..." : "Run No-Money Suite"}
      </button>
      <button
        type="button"
        onClick={() => {
          setPendingMode("checkout_e2e");
          setConfirmation("");
          setMessage("");
        }}
        disabled={busy !== null || !stripeTestEnabled}
        className="rounded-md border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-950 disabled:opacity-50"
      >
        {busy === "checkout_e2e" ? "Running Checkout E2E..." : "Run Full Checkout E2E"}
      </button>
      <button
        type="button"
        onClick={() => {
          setPendingMode("stripe_test");
          setConfirmation("");
          setMessage("");
        }}
        disabled={busy !== null || !stripeTestEnabled}
        className="rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-black text-violet-950 disabled:opacity-50"
      >
        {busy === "stripe_test" ? "Running Stripe Test..." : "Run Stripe Sandbox Suite"}
      </button>
      </div>
      {pendingMode ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-4 text-sky-950">
          <p className="text-sm font-black">
            {pendingMode === "checkout_e2e"
              ? "Confirm full checkout E2E"
              : "Confirm Stripe sandbox suite"}
          </p>
          <p className="mt-1 text-xs font-bold">
            {pendingMode === "checkout_e2e"
              ? "This runs a disposable Stripe TEST storefront order and removes its TCOS fixture afterward."
              : "This creates tagged Stripe TEST objects only."}
          </p>
          <label className="mt-3 block text-xs font-black">
            Type{" "}
            <code>
              {pendingMode === "checkout_e2e"
                ? "RUN CHECKOUT E2E"
                : "RUN STRIPE TEST"}
            </code>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-950"
              placeholder={
                pendingMode === "checkout_e2e"
                  ? "RUN CHECKOUT E2E"
                  : "RUN STRIPE TEST"
              }
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                pendingMode === "checkout_e2e"
                  ? runCheckoutE2E()
                  : run("stripe_test")
              }
              disabled={busy !== null}
              className="rounded bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              {busy ? "Running..." : "Run confirmed test"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingMode(null);
                setConfirmation("");
              }}
              disabled={busy !== null}
              className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-black disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-sm font-bold text-neutral-700">{message}</p> : null}
    </div>
  );
}
