"use client";

import Link from "next/link";
import { useState } from "react";

const OWNER_EMAIL = "sales@truelycollectables.com";

export default function OwnerSellerAccountPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const response = await fetch("/api/admin/owner-seller-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Owner seller account setup failed.");
      }

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (nextError: any) {
      setError(nextError?.message || "Owner seller account setup failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fef3c7_0,#f8fafc_42%,#eef2ff_100%)] px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
          <div className="bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.24),transparent_34%),linear-gradient(135deg,#0f172a,#111827_55%,#1f2937)] p-6 sm:p-8">
            <Link
              href="/admin"
              className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
            >
              Command Center
            </Link>
            <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-amber-200">
              Truely Collectables owner access
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
              Activate the owner seller account
            </h1>
            <p className="mt-3 max-w-2xl font-bold leading-7 text-neutral-300">
              This repairs or creates the confirmed seller login for the store owner.
              It does not use the public buyer signup or card-verification flow.
            </p>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-100 px-4 py-3 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              Locked owner email
            </p>
            <p className="mt-1 text-xl font-black">{OWNER_EMAIL}</p>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-black">Set owner password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
                className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 font-bold shadow-sm outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                placeholder="At least 12 characters"
              />
            </label>

            <label className="block">
              <span className="text-sm font-black">Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
                className="mt-1 w-full rounded-2xl border border-neutral-300 bg-white px-4 py-3 font-bold shadow-sm outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-100"
                placeholder="Enter the same password again"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-neutral-950 px-5 py-3 text-lg font-black text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Activating..." : "Activate Owner Seller Login"}
            </button>
          </form>

          {error ? (
            <p className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 font-bold text-rose-900">
              {error}
            </p>
          ) : null}

          {success ? (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
              <p className="text-xl font-black">Owner seller login is active.</p>
              <p className="mt-2 font-semibold">
                Log in with {OWNER_EMAIL} and the password you just set.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/account/login"
                  className="rounded-full bg-neutral-950 px-4 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800"
                >
                  Open Login
                </Link>
                <Link
                  href="/seller"
                  className="rounded-full border border-neutral-200 bg-white px-4 py-3 font-black shadow-sm transition hover:bg-neutral-50"
                >
                  Open Seller Command Center
                </Link>
              </div>
            </div>
          ) : null}

          <p className="mt-5 text-xs font-semibold leading-5 text-neutral-500">
            The password is sent directly to the private server endpoint and is not
            displayed or stored in this page after activation.
          </p>
        </section>
      </div>
    </main>
  );
}
