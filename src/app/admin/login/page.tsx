"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));

        if (res.status === 429) {
          const retryMinutes = data.retryAfterSeconds
            ? Math.ceil(Number(data.retryAfterSeconds) / 60)
            : null;

          setError(
            retryMinutes
              ? `Too many failed attempts. Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`
              : "Too many failed attempts. Try again later.",
          );
        } else {
          const attempts =
            typeof data.attemptsRemaining === "number"
              ? ` ${data.attemptsRemaining} attempt${data.attemptsRemaining === 1 ? "" : "s"} left before lockout.`
              : "";
          setError(`${data.error || "Wrong password"}${attempts}`);
        }

        return;
      }

      const nextPath = new URLSearchParams(window.location.search).get("next");
      const destination =
        nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
          ? nextPath
          : "/admin/products";

      window.location.assign(destination);
    } catch (err: any) {
      setError(
        err?.name === "AbortError"
          ? "Admin login timed out. Refresh and try again."
          : err?.message || "Admin login failed before the server responded.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-md border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase text-neutral-500">
          TCOS Admin
        </p>
        <h1 className="mt-2 text-3xl font-black">Admin Login</h1>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
          >
            {isSubmitting ? "Checking..." : "Login"}
          </button>
        </form>

        {error && (
          <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
