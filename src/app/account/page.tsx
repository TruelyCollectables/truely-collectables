"use client";

import Link from "next/link";
import { useState } from "react";
import {
  clearAccountSession,
  getAccountSession,
  type StoredAccountSession,
} from "./account-session";

export default function AccountPage() {
  const [session, setSession] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );

  function logout() {
    clearAccountSession();
    setSession(null);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <section className="border-b border-neutral-200 pb-6">
        <p className="text-sm font-bold uppercase text-neutral-500">
          TCOS Account
        </p>
        <h1 className="mt-2 text-4xl font-black">Collector Account</h1>
        <p className="mt-3 max-w-3xl text-neutral-600">
          Customer accounts are the foundation for future collections,
          wishlists, want ads, trades, brag sessions, and order history.
        </p>
      </section>

      {!session ? (
        <section className="mt-8 rounded-md border border-neutral-200 bg-white p-6">
          <h2 className="text-2xl font-black">Not Logged In</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            Create or log into a buyer account. Seller and platform admin
            accounts stay separate.
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/account/login"
              className="rounded bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800"
            >
              Log In
            </Link>
            <Link
              href="/account/signup"
              className="rounded border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
            >
              Create Account
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.65fr_0.35fr]">
          <div className="rounded-md border border-neutral-200 bg-white p-6">
            <h2 className="text-2xl font-black">Account Ready</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <Info label="Email" value={session.user?.email || "Signed in"} />
              <Info label="User ID" value={session.user?.id || "Not shown"} />
              <Info
                label="Session"
                value={session.expires_at ? "Active with expiration" : "Active"}
              />
            </dl>

            <button
              type="button"
              onClick={logout}
              className="mt-6 rounded border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
            >
              Log Out
            </button>
          </div>

          <aside className="rounded-md border border-neutral-200 bg-white p-6">
            <h2 className="text-xl font-black">Coming Next</h2>
            <ul className="mt-4 space-y-2 text-sm text-neutral-600">
              <li>Order history</li>
              <li>Saved collection items</li>
              <li>Wishlists and want ads</li>
              <li>Seller account separation</li>
              <li>Optional MFA path</li>
            </ul>
          </aside>
        </section>
      )}
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-3">
      <dt className="font-bold text-neutral-500">{label}</dt>
      <dd className="break-words font-semibold text-neutral-950">{value}</dd>
    </div>
  );
}
