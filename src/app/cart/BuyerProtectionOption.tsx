"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_PATH,
  BUYER_PROTECTION_POLICY_VERSION,
  BUYER_PROTECTION_TERMS_SUMMARY,
  type BuyerProtectionPreferenceMode,
} from "../../lib/buyer-protection";
import { getAccountSession } from "../account/account-session";

export type BuyerProtectionCheckoutChoice = {
  selected: boolean;
  preferenceMode: BuyerProtectionPreferenceMode;
  termsAccepted: boolean;
  policyVersion: string;
  storedConsentCurrent: boolean;
};

const EMPTY_CHOICE: BuyerProtectionCheckoutChoice = {
  selected: false,
  preferenceMode: "one_time",
  termsAccepted: false,
  policyVersion: BUYER_PROTECTION_POLICY_VERSION,
  storedConsentCurrent: false,
};

export default function BuyerProtectionOption({
  available,
  onChange,
}: {
  available: boolean;
  onChange: (choice: BuyerProtectionCheckoutChoice) => void;
}) {
  const [session] = useState(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const signedIn = Boolean(session?.access_token);
  const [choice, setChoice] = useState<BuyerProtectionCheckoutChoice>(EMPTY_CHOICE);
  const [loading, setLoading] = useState(signedIn);
  const [requiresReacceptance, setRequiresReacceptance] = useState(false);

  function update(next: BuyerProtectionCheckoutChoice) {
    setChoice(next);
    onChange({
      ...next,
      selected: available && next.selected,
    });
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;
    fetch("/api/account/buyer-protection/preference", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Preference unavailable");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        const currentAlwaysOn = payload.currentAlwaysOn === true;
        const alwaysOff = payload.preference?.mode === "always_off";
        const next: BuyerProtectionCheckoutChoice = currentAlwaysOn
          ? {
              selected: true,
              preferenceMode: "always_on",
              termsAccepted: true,
              policyVersion: BUYER_PROTECTION_POLICY_VERSION,
              storedConsentCurrent: true,
            }
          : alwaysOff
            ? {
                ...EMPTY_CHOICE,
                preferenceMode: "always_off",
              }
            : EMPTY_CHOICE;
        setRequiresReacceptance(payload.requiresReacceptance === true);
        setChoice(next);
        onChange(next);
      })
      .catch(() => {
        if (!cancelled) {
          setChoice(EMPTY_CHOICE);
          onChange(EMPTY_CHOICE);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.access_token, onChange]);

  const needsAcceptance =
    choice.selected && !choice.storedConsentCurrent;

  function selectMode(mode: BuyerProtectionPreferenceMode) {
    if (mode === "always_off") {
      update({
        ...EMPTY_CHOICE,
        preferenceMode: "always_off",
      });
      return;
    }

    update({
      selected: true,
      preferenceMode: signedIn ? mode : "one_time",
      termsAccepted: choice.storedConsentCurrent,
      policyVersion: BUYER_PROTECTION_POLICY_VERSION,
      storedConsentCurrent:
        mode === "always_on" && choice.storedConsentCurrent,
    });
  }

  return (
    <section className="mt-4 rounded border border-violet-200 bg-violet-50 p-4 text-violet-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-violet-700">
            Optional reimbursement program
          </p>
          <h3 className="mt-1 text-lg font-black">
            Truely Collectables Buyer Protection — ${BUYER_PROTECTION_FEE.toFixed(2)}
          </h3>
        </div>
        <Link
          href={BUYER_PROTECTION_PATH}
          target="_blank"
          className="font-black underline"
        >
          Read terms
        </Link>
      </div>

      {!available ? (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">
          Available only when Tracked Card Letter is the selected shipping method.
        </p>
      ) : loading ? (
        <p className="mt-3 text-sm font-bold">Loading your protection preference…</p>
      ) : (
        <>
          {signedIn ? (
            <fieldset className="mt-4 space-y-2">
              <legend className="font-black">Protection choice</legend>
              {[
                ["always_on", "Always add to qualifying orders"],
                ["one_time", "Add to this order only"],
                ["always_off", "Do not add protection"],
              ].map(([mode, label]) => (
                <label
                  key={mode}
                  className="flex min-h-11 items-center gap-3 rounded border border-violet-200 bg-white px-3 py-2 text-sm font-bold"
                >
                  <input
                    type="radio"
                    name="buyer-protection-mode"
                    checked={choice.preferenceMode === mode}
                    onChange={() =>
                      selectMode(mode as BuyerProtectionPreferenceMode)
                    }
                    className="h-5 w-5"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : (
            <label className="mt-4 flex min-h-12 items-start gap-3 rounded border border-violet-200 bg-white p-3 text-sm font-bold">
              <input
                type="checkbox"
                checked={choice.selected}
                onChange={(event) =>
                  update({
                    ...EMPTY_CHOICE,
                    selected: event.target.checked,
                  })
                }
                className="mt-1 h-5 w-5"
              />
              Add Buyer Protection to this order for ${BUYER_PROTECTION_FEE.toFixed(2)}.
            </label>
          )}

          {requiresReacceptance ? (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">
              The protection terms changed. Your old Always On consent is inactive until you accept the current version.
            </p>
          ) : null}

          {needsAcceptance ? (
            <label className="mt-3 flex items-start gap-3 rounded border border-violet-300 bg-white p-3 text-sm leading-6">
              <input
                type="checkbox"
                checked={choice.termsAccepted}
                onChange={(event) =>
                  update({
                    ...choice,
                    termsAccepted: event.target.checked,
                    policyVersion: BUYER_PROTECTION_POLICY_VERSION,
                  })
                }
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                I accept Buyer Protection version {BUYER_PROTECTION_POLICY_VERSION}. I understand the shipment must remain undelivered for at least 7 full days, and my claim must be submitted within 21 calendar days after shipment. Reimbursement covers only the protected item subtotal up to $20, not shipping or the protection fee.
              </span>
            </label>
          ) : choice.selected && choice.storedConsentCurrent ? (
            <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-950">
              Always On is active under the current policy version. You will not be asked again unless the terms change or you opt out.
            </p>
          ) : null}

          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs font-semibold">
            {BUYER_PROTECTION_TERMS_SUMMARY.slice(1, 6).map((term) => (
              <li key={term}>{term}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
