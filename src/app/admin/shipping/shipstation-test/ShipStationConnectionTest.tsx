"use client";

import { useState } from "react";

type ConnectionResult = {
  ok?: boolean;
  apiKeyConfigured?: boolean;
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
  requiredServices?: {
    letter: { code: string; available: boolean | null };
    groundAdvantage: { code: string; available: boolean | null };
    priorityMail: { code: string; available: boolean | null };
  };
  postagePurchaseAttempted?: boolean;
  message?: string;
  error?: string;
};

export default function ShipStationConnectionTest() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);

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
        error: error?.message || "Could not run ShipStation connection test.",
      });
    } finally {
      setRunning(false);
    }
  }

  const serviceRows = result?.requiredServices
    ? [
        ["First-Class Letter", result.requiredServices.letter],
        ["Ground Advantage", result.requiredServices.groundAdvantage],
        ["Priority Mail", result.requiredServices.priorityMail],
      ] as const
    : [];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={runTest}
        disabled={running}
        className={`rounded-2xl bg-sky-900 px-5 py-3 text-sm font-black text-white shadow-sm ${running ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {running ? "Testing ShipStation..." : "Test ShipStation Connection — No Purchase"}
      </button>

      {result ? (
        <div
          className={`rounded-3xl border p-5 ${
            result.ok
              ? "border-emerald-300 bg-emerald-50 text-emerald-950"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-widest">
                ShipStation diagnostic
              </p>
              <h2 className="mt-1 text-xl font-black">
                {result.ok ? "Connection ready" : "Connection needs setup"}
              </h2>
            </div>
            <span className="rounded-full border border-current px-3 py-1 text-xs font-black uppercase">
              No postage purchased
            </span>
          </div>

          <p className="mt-3 text-sm font-semibold leading-6">
            {result.error || result.message || "Connection test finished."}
          </p>

          <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
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
            <Status
              label="Money moved"
              value={result.postagePurchaseAttempted === false ? "No" : "Unexpected"}
            />
          </dl>

          {serviceRows.length ? (
            <div className="mt-5 overflow-hidden rounded-2xl border border-current/20 bg-white/70">
              {serviceRows.map(([label, service]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-current/10 px-4 py-3 last:border-b-0"
                >
                  <div>
                    <p className="font-black">{label}</p>
                    <p className="text-xs font-semibold opacity-70">{service.code}</p>
                  </div>
                  <span className="rounded-full border border-current px-3 py-1 text-xs font-black uppercase">
                    {service.available === true
                      ? "Available"
                      : service.available === false
                        ? "Missing"
                        : "Not tested"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {result.carriers?.length ? (
            <div className="mt-5">
              <h3 className="text-sm font-black uppercase tracking-widest">
                Connected carriers
              </h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {result.carriers.map((carrier) => (
                  <div
                    key={carrier.carrierId}
                    className="rounded-2xl border border-current/20 bg-white/70 p-3"
                  >
                    <p className="font-black">{carrier.friendlyName}</p>
                    <p className="mt-1 text-xs font-semibold">
                      {carrier.carrierCode} · {carrier.carrierId}
                    </p>
                    {carrier.nickname ? (
                      <p className="mt-1 text-xs font-semibold opacity-70">
                        {carrier.nickname}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result.services?.length ? (
            <details className="mt-5 rounded-2xl border border-current/20 bg-white/70 p-4">
              <summary className="cursor-pointer text-sm font-black">
                Show all services on selected carrier ({result.services.length})
              </summary>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {result.services.map((service) => (
                  <div key={service.serviceCode} className="rounded-xl bg-white p-3 text-xs">
                    <p className="font-black">{service.name}</p>
                    <p className="mt-1 font-mono font-semibold">{service.serviceCode}</p>
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

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-current/20 bg-white/70 p-3">
      <dt className="text-xs font-black uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}
