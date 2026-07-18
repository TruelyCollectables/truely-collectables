"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type SimulationMode = "deterministic" | "stripe_test";
type PendingMode = "stripe_test" | "checkout_e2e";
type BusyMode = SimulationMode | "checkout_e2e";
type FeedbackTone = "info" | "success" | "error";

type FeedbackMessage = {
  text: string;
  tone: FeedbackTone;
};

export default function SimulationActions({
  stripeTestEnabled,
}: {
  stripeTestEnabled: boolean;
}) {
  const router = useRouter();
  const simulationActionRunningRef = useRef(false);
  const [busy, setBusy] = useState<BusyMode | null>(null);
  const [pendingMode, setPendingMode] = useState<PendingMode | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<FeedbackMessage | null>(null);

  function beginConfirmedRun(mode: PendingMode) {
    if (simulationActionRunningRef.current || busy !== null) {
      setMessage({
        text: "Finish the current payment simulation before starting another.",
        tone: "info",
      });
      return;
    }

    if (!stripeTestEnabled) {
      setMessage({
        text: "Enable Stripe test simulation before running Stripe-touching payment tests.",
        tone: "error",
      });
      return;
    }

    setPendingMode(mode);
    setConfirmation("");
    setMessage(null);
  }

  function cancelConfirmedRun() {
    if (simulationActionRunningRef.current || busy !== null) {
      setMessage({
        text: "Wait for the payment simulation to finish before cancelling.",
        tone: "info",
      });
      return;
    }

    setPendingMode(null);
    setConfirmation("");
  }

  async function run(mode: SimulationMode) {
    if (simulationActionRunningRef.current || busy !== null) {
      setMessage({
        text: "Finish the current payment simulation before starting another.",
        tone: "info",
      });
      return;
    }

    if (mode === "stripe_test" && !stripeTestEnabled) {
      setMessage({
        text: "Enable Stripe test simulation before running the Stripe sandbox suite.",
        tone: "error",
      });
      return;
    }

    if (mode === "stripe_test" && confirmation !== "RUN STRIPE TEST") {
      setMessage({
        text: "Type RUN STRIPE TEST exactly before running the Stripe sandbox suite.",
        tone: "error",
      });
      return;
    }

    simulationActionRunningRef.current = true;
    setBusy(mode);
    setMessage({
      text:
        mode === "stripe_test"
          ? "Running Stripe sandbox payment suite..."
          : "Running no-money payment suite...",
      tone: "info",
    });
    try {
      const response = await fetch("/api/admin/payment-simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, confirmation }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Simulation failed.");
      setMessage({
        text: `${data.status}: ${data.passed} passed, ${data.failed} failed, ${data.skipped} skipped.`,
        tone: data.failed > 0 ? "error" : "success",
      });
      setPendingMode(null);
      setConfirmation("");
      router.refresh();
    } catch (error: any) {
      setMessage({ text: error.message || "Simulation failed.", tone: "error" });
    } finally {
      simulationActionRunningRef.current = false;
      setBusy(null);
    }
  }

  async function runCheckoutE2E() {
    if (simulationActionRunningRef.current || busy !== null) {
      setMessage({
        text: "Finish the current payment simulation before starting another.",
        tone: "info",
      });
      return;
    }

    if (!stripeTestEnabled) {
      setMessage({
        text: "Enable Stripe test simulation before running the full checkout E2E test.",
        tone: "error",
      });
      return;
    }

    if (confirmation !== "RUN CHECKOUT E2E") {
      setMessage({
        text: "Type RUN CHECKOUT E2E exactly before running the full checkout test.",
        tone: "error",
      });
      return;
    }

    simulationActionRunningRef.current = true;
    setBusy("checkout_e2e");
    setMessage({ text: "Running full checkout E2E simulation...", tone: "info" });
    try {
      const response = await fetch(
        "/api/admin/payment-simulations/checkout-e2e",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Checkout E2E failed.");
      setMessage({
        text: `${data.status}: ${data.passed} passed, ${data.failed} failed, ${data.skipped} skipped.`,
        tone: data.failed > 0 ? "error" : "success",
      });
      setPendingMode(null);
      setConfirmation("");
      router.refresh();
    } catch (error: any) {
      setMessage({
        text: error.message || "Checkout E2E failed.",
        tone: "error",
      });
    } finally {
      simulationActionRunningRef.current = false;
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run("deterministic")}
          aria-disabled={busy !== null}
          aria-busy={busy === "deterministic"}
          className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white aria-disabled:cursor-wait aria-disabled:opacity-50"
        >
          {busy === "deterministic" ? "Running..." : "Run No-Money Suite"}
        </button>
        <button
          type="button"
          onClick={() => beginConfirmedRun("checkout_e2e")}
          aria-disabled={busy !== null || !stripeTestEnabled}
          aria-busy={busy === "checkout_e2e"}
          className="rounded-md border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-950 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {busy === "checkout_e2e" ? "Running Checkout E2E..." : "Run Full Checkout E2E"}
        </button>
        <button
          type="button"
          onClick={() => beginConfirmedRun("stripe_test")}
          aria-disabled={busy !== null || !stripeTestEnabled}
          aria-busy={busy === "stripe_test"}
          className="rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-black text-violet-950 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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
              aria-disabled={busy !== null}
              aria-busy={busy !== null}
              className="rounded bg-neutral-950 px-4 py-2 text-sm font-black text-white aria-disabled:cursor-wait aria-disabled:opacity-50"
            >
              {busy ? "Running..." : "Run confirmed test"}
            </button>
            <button
              type="button"
              onClick={cancelConfirmedRun}
              aria-disabled={busy !== null}
              className="rounded border border-neutral-300 bg-white px-4 py-2 text-sm font-black aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <ActionNotice message={message} />
    </div>
  );
}

function ActionNotice({ message }: { message: FeedbackMessage | null }) {
  if (!message) return null;

  const className =
    message.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : message.tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-900"
        : "border-sky-200 bg-sky-50 text-sky-900";

  return (
    <p
      aria-live={message.tone === "info" ? "polite" : "assertive"}
      className={`rounded-md border px-3 py-2 text-sm font-bold ${className}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}
