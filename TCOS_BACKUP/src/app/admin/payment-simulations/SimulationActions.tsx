"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SimulationActions({
  stripeTestEnabled,
}: {
  stripeTestEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"deterministic" | "stripe_test" | null>(null);
  const [message, setMessage] = useState("");

  async function run(mode: "deterministic" | "stripe_test") {
    if (mode === "stripe_test") {
      const confirmation = window.prompt(
        "This creates tagged Stripe TEST objects only. Type RUN STRIPE TEST to continue.",
      );
      if (confirmation !== "RUN STRIPE TEST") return;
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
      router.refresh();
    } catch (error: any) {
      setMessage(error.message || "Simulation failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
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
        onClick={() => run("stripe_test")}
        disabled={busy !== null || !stripeTestEnabled}
        className="rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-black text-violet-950 disabled:opacity-50"
      >
        {busy === "stripe_test" ? "Running Stripe Test..." : "Run Stripe Sandbox Suite"}
      </button>
      {message ? <p className="text-sm font-bold text-neutral-700">{message}</p> : null}
    </div>
  );
}
