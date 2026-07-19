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
    <main className="min-h-screen bg-[#f4f1e8] px-4 py-10 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <section className="border-4 border-neutral-950 bg-yellow-300 p-6 shadow-[8px_8px_0_#111318]">
          <p className="text-xs font-black uppercase tracking-[0.2em]">
            Truely Collectables owner access
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">
            Activate the owner seller account
          </h1>
          <p className="mt-3 font-bold leading-7">
            This repairs or creates the confirmed seller login for the store owner.
            It does not use the public buyer signup or card-verification flow.
          </p>
        </section>

        <section className="mt-8 border-2 border-neutral-950 bg-white p-6 shadow-[5px_5px_0_#111318]">
          <div className="rounded border-2 border-neutral-950 bg-neutral-100 px-4 py-3">
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
                className="mt-1 w-full border-2 border-neutral-950 px-3 py-3 font-bold"
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
                className="mt-1 w-full border-2 border-neutral-950 px-3 py-3 font-bold"
                placeholder="Enter the same password again"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full border-2 border-neutral-950 bg-neutral-950 px-5 py-3 text-lg font-black text-white disabled:opacity-50"
            >
              {submitting ? "Activating..." : "Activate Owner Seller Login"}
            </button>
          </form>

          {error ? (
            <p className="mt-5 border-2 border-rose-700 bg-rose-100 px-4 py-3 font-bold text-rose-900">
              {error}
            </p>
          ) : null}

          {success ? (
            <div className="mt-5 border-2 border-emerald-700 bg-emerald-100 p-4 text-emerald-950">
              <p className="text-xl font-black">Owner seller login is active.</p>
              <p className="mt-2 font-semibold">
                Log in with {OWNER_EMAIL} and the password you just set.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/account/login"
                  className="border-2 border-neutral-950 bg-neutral-950 px-4 py-3 font-black text-white"
                >
                  Open Login
                </Link>
                <Link
                  href="/seller"
                  className="border-2 border-neutral-950 bg-white px-4 py-3 font-black"
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
