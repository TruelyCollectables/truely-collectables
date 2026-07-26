"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_PATH,
  BUYER_PROTECTION_POLICY_VERSION,
} from "../../../lib/buyer-protection";
import { getAccountSession } from "../account-session";

type ProtectionRecord = {
  id: string;
  order_id: number;
  status: string;
  fee_amount: number;
  covered_item_amount: number;
  policy_version: string;
  shipped_at: string | null;
  earliest_claim_at: string | null;
  claim_deadline_at: string | null;
  order?: {
    id: number;
    created_at: string;
    shipping_name: string | null;
    tracking_number: string | null;
    carrier: string | null;
    fulfillment_status: string | null;
  } | null;
  claim?: {
    id: string;
    status: string;
    submitted_at: string;
    decision_note: string | null;
    reimbursement_amount: number;
    reimbursed_at: string | null;
  } | null;
  claimWindow: {
    eligible: boolean;
    status: string;
    detail: string;
  };
};

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not started";
}

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function BuyerProtectionAccountPage() {
  const [accessToken, setAccessToken] = useState("");
  const [preference, setPreference] = useState<any>(null);
  const [currentAlwaysOn, setCurrentAlwaysOn] = useState(false);
  const [requiresReacceptance, setRequiresReacceptance] = useState(false);
  const [protections, setProtections] = useState<ProtectionRecord[]>([]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [statementByOrder, setStatementByOrder] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(token: string) {
    setLoading(true);
    setError("");

    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [preferenceResponse, claimsResponse] = await Promise.all([
        fetch("/api/account/buyer-protection/preference", {
          headers,
          cache: "no-store",
        }),
        fetch("/api/account/buyer-protection/claims", {
          headers,
          cache: "no-store",
        }),
      ]);
      const preferencePayload = await preferenceResponse.json();
      const claimsPayload = await claimsResponse.json();

      if (!preferenceResponse.ok) {
        throw new Error(
          preferencePayload.error || "Could not load protection preference",
        );
      }
      if (!claimsResponse.ok) {
        throw new Error(claimsPayload.error || "Could not load protected orders");
      }

      setPreference(preferencePayload.preference || null);
      setCurrentAlwaysOn(preferencePayload.currentAlwaysOn === true);
      setRequiresReacceptance(
        preferencePayload.requiresReacceptance === true,
      );
      setProtections(
        Array.isArray(claimsPayload.protections)
          ? claimsPayload.protections
          : [],
      );
    } catch (loadError: any) {
      setError(loadError.message || "Could not load Buyer Protection");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const session = getAccountSession();
    const token = session?.access_token || "";
    setAccessToken(token);
    if (token) load(token);
    else setLoading(false);
  }, []);

  async function savePreference(mode: "always_on" | "always_off") {
    if (!accessToken) return;
    if (mode === "always_on" && !termsAccepted) {
      setError("Accept the current Buyer Protection terms before enabling Always On.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/account/buyer-protection/preference",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            mode,
            termsAccepted: mode === "always_on" ? termsAccepted : false,
            policyVersion: BUYER_PROTECTION_POLICY_VERSION,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not save preference");
      }

      setMessage(
        mode === "always_on"
          ? "Always On is active for the current protection policy."
          : "Buyer Protection is off for future orders.",
      );
      setTermsAccepted(false);
      await load(accessToken);
    } catch (saveError: any) {
      setError(saveError.message || "Could not save preference");
    } finally {
      setSaving(false);
    }
  }

  async function submitClaim(orderId: number) {
    if (!accessToken) return;
    const statement = statementByOrder[orderId] || "";
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/account/buyer-protection/claims", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ orderId, statement }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not submit claim");
      }

      setMessage(`Claim submitted for order #${orderId}.`);
      setStatementByOrder((current) => ({ ...current, [orderId]: "" }));
      await load(accessToken);
    } catch (claimError: any) {
      setError(claimError.message || "Could not submit claim");
    } finally {
      setSaving(false);
    }
  }

  if (!accessToken && !loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-4xl font-black">Buyer Protection</h1>
        <p className="mt-3 text-neutral-600">
          Log in to manage Always On consent and submit protected-order claims.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/account/login"
            className="rounded bg-neutral-950 px-4 py-3 font-black text-white"
          >
            Log In
          </Link>
          <Link
            href={BUYER_PROTECTION_PATH}
            className="rounded border border-neutral-300 px-4 py-3 font-black"
          >
            Read Protection Terms
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-black uppercase tracking-wide text-violet-700">
            Optional reimbursement program
          </p>
          <h1 className="mt-2 text-4xl font-black">Buyer Protection</h1>
          <p className="mt-3 max-w-3xl text-neutral-600">
            ${BUYER_PROTECTION_FEE.toFixed(2)} per qualifying Tracked Card Letter order.
            Item subtotal only, up to $20. Shipping and the fee are excluded.
          </p>
        </div>
        <Link
          href={BUYER_PROTECTION_PATH}
          className="rounded border border-neutral-300 px-4 py-3 font-black"
        >
          Full Terms
        </Link>
      </div>

      {error ? (
        <p className="mt-5 rounded border border-red-200 bg-red-50 p-4 font-bold text-red-950">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-950">
          {message}
        </p>
      ) : null}

      <section className="mt-8 rounded border bg-white p-5">
        <h2 className="text-2xl font-black">Always On Preference</h2>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          Current status: {currentAlwaysOn ? "Always On" : "Off"}. Policy version:{" "}
          {preference?.policy_version || "No current consent"}.
        </p>
        {requiresReacceptance ? (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 font-bold text-amber-950">
            Your prior consent is stale because the terms changed. Accept the current
            version to turn Always On back on.
          </p>
        ) : null}

        {!currentAlwaysOn ? (
          <label className="mt-4 flex items-start gap-3 rounded border border-violet-200 bg-violet-50 p-4 text-sm leading-6">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              I accept Buyer Protection version {BUYER_PROTECTION_POLICY_VERSION}. I
              understand claims open after 7 full days and expire 21 calendar days after
              shipment. Reimbursement excludes shipping and the protection fee.
            </span>
          </label>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-3">
          {!currentAlwaysOn ? (
            <button
              type="button"
              disabled={saving || !termsAccepted}
              onClick={() => savePreference("always_on")}
              className="rounded bg-violet-900 px-4 py-3 font-black text-white disabled:opacity-50"
            >
              Turn Always On
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => savePreference("always_off")}
              className="rounded border border-red-300 px-4 py-3 font-black text-red-800 disabled:opacity-50"
            >
              Opt Out of Future Orders
            </button>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">Protected Orders and Claims</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Claims are accepted from day 7 through day 21 after shipment.
            </p>
          </div>
          <Link href="/account/orders" className="font-black underline">
            All Orders
          </Link>
        </div>

        {loading ? (
          <p className="mt-4 rounded border bg-white p-5 font-bold">Loading…</p>
        ) : protections.length === 0 ? (
          <p className="mt-4 rounded border bg-white p-5 text-neutral-600">
            No protected orders are attached to this account yet.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {protections.map((protection) => (
              <article key={protection.id} className="rounded border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-black">Order #{protection.order_id}</h3>
                    <p className="mt-1 text-sm font-semibold text-neutral-600">
                      Covered item amount: {money(protection.covered_item_amount)} ·
                      Status: {protection.status.replaceAll("_", " ")}
                    </p>
                  </div>
                  <span className="rounded border border-neutral-300 px-3 py-1 text-xs font-black uppercase">
                    {protection.claimWindow.status.replaceAll("_", " ")}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="font-black">Shipped</dt>
                    <dd>{dateLabel(protection.shipped_at)}</dd>
                  </div>
                  <div>
                    <dt className="font-black">Earliest Claim</dt>
                    <dd>{dateLabel(protection.earliest_claim_at)}</dd>
                  </div>
                  <div>
                    <dt className="font-black">Final Deadline</dt>
                    <dd>{dateLabel(protection.claim_deadline_at)}</dd>
                  </div>
                </dl>

                <p className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm font-semibold">
                  {protection.claimWindow.detail}
                </p>

                {protection.claim ? (
                  <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                    <p className="font-black">
                      Claim {protection.claim.status.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1">
                      Submitted {dateLabel(protection.claim.submitted_at)}.
                      {protection.claim.reimbursement_amount > 0
                        ? ` Reimbursement: ${money(protection.claim.reimbursement_amount)}.`
                        : ""}
                    </p>
                    {protection.claim.decision_note ? (
                      <p className="mt-1 font-semibold">{protection.claim.decision_note}</p>
                    ) : null}
                  </div>
                ) : protection.claimWindow.eligible ? (
                  <div className="mt-4">
                    <label className="block font-black" htmlFor={`claim-${protection.order_id}`}>
                      Describe the missing shipment
                    </label>
                    <textarea
                      id={`claim-${protection.order_id}`}
                      value={statementByOrder[protection.order_id] || ""}
                      onChange={(event) =>
                        setStatementByOrder((current) => ({
                          ...current,
                          [protection.order_id]: event.target.value,
                        }))
                      }
                      maxLength={1200}
                      className="mt-2 min-h-28 w-full rounded border p-3"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => submitClaim(protection.order_id)}
                      className="mt-3 rounded bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50"
                    >
                      Submit Missing-Mail Claim
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
