"use client";

import { useEffect, useState } from "react";

type Origin = {
  name: string;
  company?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
};

type ConnectionResult = {
  ok?: boolean;
  apiKeyConfigured?: boolean;
  apiProduct?: string;
  configuredCarrierId?: string | null;
  configuredCarrierFound?: boolean;
  recommendedCarrierId?: string | null;
  carriers?: Array<{
    carrierId: string;
    carrierCode: string;
    friendlyName: string;
    nickname: string | null;
  }>;
  services?: Array<{
    serviceCode: string;
    name: string;
    domestic: boolean | null;
    international: boolean | null;
  }>;
  packages?: Array<{
    packageCode: string;
    name: string;
  }>;
  requiredServices?: {
    letter: { code: string; available: boolean | null };
    groundAdvantage: { code: string; available: boolean | null };
    priorityMail: { code: string; available: boolean | null };
  };
  requiredPackages?: {
    letter: { code: string; available: boolean | null };
    parcel: { code: string; available: boolean | null };
  };
  postagePurchaseAttempted?: boolean;
  message?: string;
  error?: string;
};

const EMPTY_ORIGIN: Origin = {
  name: "",
  company: "Truely Collectables",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  countryCode: "US",
};

export default function ShipStationConnectionTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [origin, setOrigin] = useState<Origin>(EMPTY_ORIGIN);
  const [originConfigured, setOriginConfigured] = useState(false);
  const [originSaving, setOriginSaving] = useState(false);
  const [originMessage, setOriginMessage] = useState<string | null>(null);

  async function loadOrigin() {
    try {
      const response = await fetch(`/api/admin/shipping/shipstation-origin?load=${Date.now()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (data?.origin) {
        setOrigin({ ...EMPTY_ORIGIN, ...data.origin });
        setOriginConfigured(true);
      } else {
        setOriginConfigured(false);
      }
    } catch {
      setOriginConfigured(false);
    }
  }

  async function saveOrigin() {
    if (originSaving) return;
    setOriginSaving(true);
    setOriginMessage(null);
    try {
      const response = await fetch("/api/admin/shipping/shipstation-origin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(origin),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not save ship-from address.");
      setOrigin({ ...EMPTY_ORIGIN, ...data.origin });
      setOriginConfigured(true);
      setOriginMessage("Ship-from address saved. Live labels will use this address directly; no ShipStation warehouse is required.");
    } catch (error: any) {
      setOriginMessage(error?.message || "Could not save ship-from address.");
    } finally {
      setOriginSaving(false);
    }
  }

  async function runTest() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch(
        `/api/admin/shipping/shipstation-connection-test?test=${Date.now()}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as ConnectionResult;
      setResult(data);
    } catch (error: any) {
      setResult({
        ok: false,
        postagePurchaseAttempted: false,
        error: error?.message || "Could not run ShipStation API connection test.",
      });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadOrigin();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const serviceRows = result?.requiredServices
    ? [
        ["First-Class Letter", result.requiredServices.letter],
        ["Ground Advantage", result.requiredServices.groundAdvantage],
        ["Priority Mail", result.requiredServices.priorityMail],
      ] as const
    : [];
  const packageRows = result?.requiredPackages
    ? [
        ["Letter package", result.requiredPackages.letter],
        ["Parcel package", result.requiredPackages.parcel],
      ] as const
    : [];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-sky-800">Ship-from setup</p>
            <h2 className="mt-1 text-xl font-black">TruelyCollectables return / ship-from address</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              The standalone ShipStation API accepts a direct ship-from address on every label. Save it here once; TCOS stores it in store settings and does not require a separate ShipStation app account or warehouse.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${originConfigured ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
            {originConfigured ? "Saved" : "Required"}
          </span>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Name" value={origin.name} onChange={(value) => setOrigin((old) => ({ ...old, name: value }))} />
          <Field label="Company" value={origin.company || ""} onChange={(value) => setOrigin((old) => ({ ...old, company: value }))} />
          <Field label="Address line 1" value={origin.addressLine1} onChange={(value) => setOrigin((old) => ({ ...old, addressLine1: value }))} />
          <Field label="Address line 2" value={origin.addressLine2 || ""} onChange={(value) => setOrigin((old) => ({ ...old, addressLine2: value }))} />
          <Field label="City" value={origin.city} onChange={(value) => setOrigin((old) => ({ ...old, city: value }))} />
          <Field label="State" value={origin.state} onChange={(value) => setOrigin((old) => ({ ...old, state: value.toUpperCase() }))} />
          <Field label="ZIP" value={origin.postalCode} onChange={(value) => setOrigin((old) => ({ ...old, postalCode: value }))} />
          <Field label="Country" value={origin.countryCode} onChange={(value) => setOrigin((old) => ({ ...old, countryCode: value.toUpperCase() }))} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveOrigin}
            disabled={originSaving}
            className={`rounded-2xl bg-neutral-950 px-5 py-3 text-sm font-black text-white ${originSaving ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {originSaving ? "Saving..." : "Save Ship-From Address"}
          </button>
          {originMessage ? <p className="text-sm font-semibold text-neutral-700">{originMessage}</p> : null}
        </div>
      </section>

      <button
        type="button"
        onClick={runTest}
        disabled={running}
        className={`rounded-2xl bg-sky-900 px-5 py-3 text-sm font-black text-white shadow-sm ${running ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {running ? "Testing ShipStation API..." : "Test Standalone ShipStation API — No Purchase"}
      </button>

      {result ? (
        <div
          className={`rounded-3xl border p-5 ${
            result.ok && originConfigured
              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest">ShipStation API diagnostic</p>
              <h2 className="mt-1 text-xl font-black">
                {result.ok && originConfigured ? "Ready for controlled label test" : "Connection needs setup"}
              </h2>
            </div>
            <span className="rounded-full border border-current px-3 py-1 text-xs font-black uppercase">No postage purchased</span>
          </div>

          <p className="mt-3 text-sm font-semibold leading-6">
            {result.error || result.message || "Connection test finished."}
          </p>

          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
            <Status label="API product" value={result.apiProduct || "ShipStation API"} />
            <Status label="API key" value={result.apiKeyConfigured ? "Authenticated/configured" : "Missing"} />
            <Status
              label="Configured carrier"
              value={
                result.configuredCarrierId
                  ? `${result.configuredCarrierId}${result.configuredCarrierFound ? " (found)" : " (not found)"}`
                  : "Not configured"
              }
            />
            <Status label="Recommended carrier" value={result.recommendedCarrierId || "None yet"} />
            <Status label="Ship-from" value={originConfigured ? "Saved in TCOS" : "Not saved"} />
            <Status label="Money moved" value={result.postagePurchaseAttempted === false ? "No" : "Unexpected"} />
          </dl>

          {serviceRows.length ? (
            <div className="mt-5 overflow-hidden rounded-2xl border border-current/20 bg-white/70">
              {serviceRows.map(([label, service]) => (
                <CheckRow key={label} label={label} code={service.code} available={service.available} />
              ))}
            </div>
          ) : null}

          {packageRows.length ? (
            <div className="mt-5 overflow-hidden rounded-2xl border border-current/20 bg-white/70">
              {packageRows.map(([label, pkg]) => (
                <CheckRow key={label} label={label} code={pkg.code} available={pkg.available} />
              ))}
            </div>
          ) : null}

          {result.carriers?.length ? (
            <details className="mt-5 rounded-2xl border border-current/20 bg-white/70 p-4">
              <summary className="cursor-pointer text-sm font-black">Connected carriers ({result.carriers.length})</summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {result.carriers.map((carrier) => (
                  <div key={carrier.carrierId} className="rounded-xl bg-white p-3 text-xs">
                    <p className="font-black">{carrier.friendlyName}</p>
                    <p className="mt-1 font-mono font-semibold">{carrier.carrierCode} · {carrier.carrierId}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {result.packages?.length ? (
            <details className="mt-3 rounded-2xl border border-current/20 bg-white/70 p-4">
              <summary className="cursor-pointer text-sm font-black">Show carrier package codes ({result.packages.length})</summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {result.packages.map((pkg) => (
                  <div key={pkg.packageCode} className="rounded-xl bg-white p-3 text-xs">
                    <p className="font-black">{pkg.name}</p>
                    <p className="mt-1 font-mono font-semibold">{pkg.packageCode}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-black text-neutral-800">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 font-semibold outline-none focus:border-sky-700"
      />
    </label>
  );
}

function CheckRow({ label, code, available }: { label: string; code: string; available: boolean | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 px-4 py-3 last:border-b-0">
      <div>
        <p className="font-black">{label}</p>
        <p className="text-xs font-semibold opacity-70">{code}</p>
      </div>
      <span className="rounded-full border border-current px-3 py-1 text-xs font-black uppercase">
        {available === true ? "Available" : available === false ? "Missing" : "Not tested"}
      </span>
    </div>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-current/20 bg-white/70 p-3">
      <dt className="text-xs font-black uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}
