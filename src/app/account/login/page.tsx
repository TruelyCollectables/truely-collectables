"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAccountSession } from "../account-session";

export default function AccountLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/account/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.session) {
        setError(data.error || "Account login failed");
        return;
      }

      saveAccountSession(data.session);
      router.push("/account");
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
        <h1 className="mt-2 text-3xl font-black">Account Login</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Customer account login is separate from TCOS admin access.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
          >
            {isSubmitting ? "Checking..." : "Log In"}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        ) : null}

        <p className="mt-5 text-sm text-neutral-600">
          Need an account?{" "}
          <Link href="/account/signup" className="font-bold underline">
            Create one
          </Link>
        </p>
      </section>
    </main>
  );
}
