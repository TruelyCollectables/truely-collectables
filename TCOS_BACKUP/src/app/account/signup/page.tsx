"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TERMS_OF_SERVICE_VERSION } from "../../../lib/legal";
import { saveAccountSession } from "../account-session";

export default function AccountSignupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";

    const params = new URLSearchParams(window.location.search);

    return params.get("card_verification") === "canceled"
      ? "Card and billing address verification was canceled. Account activation cannot finish until verification is completed."
      : "";
  });
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/account/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName,
          email,
          password,
          tosAccepted,
          tosVersion: TERMS_OF_SERVICE_VERSION,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Account signup failed");
        return;
      }

      if (data.cardVerificationUrl) {
        setMessage("Account started. Opening secure card verification...");
        window.location.href = data.cardVerificationUrl;
        return;
      }

      if (data.session) {
        saveAccountSession(data.session);
        router.push("/account");
        return;
      }

      setMessage(
        "Account created. Check your email to confirm the account before logging in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <section className="rounded-md border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase text-neutral-500">
          TCOS Account
        </p>
        <h1 className="mt-2 text-3xl font-black">Create Account</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Buyer accounts use email, password, Terms acceptance, and secure card
          verification. Seller and platform-admin access stay separate.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Display Name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="Collector name"
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
              placeholder="At least 10 characters"
              autoComplete="new-password"
              required
              minLength={10}
            />
          </label>

          <label className="flex items-start gap-3 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm leading-6">
            <input
              type="checkbox"
              checked={tosAccepted}
              onChange={(event) => setTosAccepted(event.target.checked)}
              className="mt-1 h-4 w-4"
              required
            />
            <span>
              I accept the{" "}
              <Link href="/terms" className="font-bold underline">
                Terms of Service
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
          >
            {isSubmitting ? "Creating..." : "Create Account And Verify Card"}
          </button>
        </form>

        <p className="mt-3 text-xs leading-5 text-neutral-500">
          Card verification is handled by Stripe. TCOS does not store raw card
          numbers or CVV.
        </p>

        {error ? (
          <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        ) : null}

        {message ? (
          <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
            {message}
          </p>
        ) : null}

        <p className="mt-5 text-sm text-neutral-600">
          Already have an account?{" "}
          <Link href="/account/login" className="font-bold underline">
            Log in
          </Link>
        </p>
      </section>
    </main>
  );
}
