"use client";

import { useCallback, useEffect, useState } from "react";

type StatusState = "checking" | "ok" | "problem";

type StatusItem = {
  label: string;
  detail: string;
  state: StatusState;
};

const checks = [
  { key: "edge", label: "Cloudflare edge", path: "/__edge-health" },
  { key: "storefront", label: "Storefront", path: "/shop?status_probe=kingmaker" },
  { key: "merchant", label: "Merchant feed", path: "/google-merchant-feed.xml?status_probe=kingmaker" },
  { key: "sitemap", label: "Sitemap", path: "/sitemap.xml?status_probe=kingmaker" },
] as const;

function stateText(state: StatusState) {
  if (state === "checking") return "CHECKING";
  if (state === "ok") return "OK";
  return "PROBLEM";
}

function stateClass(state: StatusState) {
  if (state === "checking") {
    return "border-slate-700 bg-slate-900 text-slate-300";
  }
  if (state === "ok") {
    return "border-emerald-800/80 bg-emerald-950/50 text-emerald-200";
  }
  return "border-rose-800/80 bg-rose-950/50 text-rose-200";
}

export default function KingmakerStatusStrip() {
  const [items, setItems] = useState<StatusItem[]>(
    checks.map((check) => ({
      label: check.label,
      detail: "Waiting for first check",
      state: "checking",
    })),
  );
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const runChecks = useCallback(async () => {
    const results = await Promise.all(
      checks.map(async (check) => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 8_000);
        try {
          const separator = check.path.includes("?") ? "&" : "?";
          const response = await fetch(`${check.path}${separator}t=${Date.now()}`, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          return {
            label: check.label,
            detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
            state: response.ok ? ("ok" as const) : ("problem" as const),
          };
        } catch {
          return {
            label: check.label,
            detail: "No response",
            state: "problem" as const,
          };
        } finally {
          window.clearTimeout(timeout);
        }
      }),
    );

    setItems(results);
    setLastChecked(new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }));
  }, []);

  useEffect(() => {
    void runChecks();
    const interval = window.setInterval(() => void runChecks(), 60_000);
    return () => window.clearInterval(interval);
  }, [runChecks]);

  const problemCount = items.filter((item) => item.state === "problem").length;
  const checking = items.some((item) => item.state === "checking");

  return (
    <section
      aria-label="KINGMAKER live status"
      className="border-t border-slate-800 bg-slate-950/80 px-4 py-3"
      data-kingmaker-status="v1"
    >
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${checking ? "bg-amber-300" : problemCount ? "bg-rose-400" : "bg-emerald-400"}`}
              aria-hidden="true"
            />
            <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-200">
              Live system status
            </p>
            {checking ? (
              <span className="text-xs text-slate-500">Checking...</span>
            ) : problemCount ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="rounded-full border border-rose-700/70 bg-rose-950/60 px-2.5 py-1 text-xs font-black text-rose-200 underline decoration-rose-400/60 underline-offset-2 hover:bg-rose-900/70"
                aria-label={`Show details for ${problemCount} system problem${problemCount === 1 ? "" : "s"}`}
              >
                {problemCount} problem{problemCount === 1 ? "" : "s"} — click for details
              </button>
            ) : (
              <span className="text-xs text-emerald-300">All clear</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:border-emerald-500 hover:text-white"
            aria-expanded={expanded}
          >
            {expanded ? "Hide check details" : "Show check details"}
          </button>
        </div>

        {expanded ? (
          <div className="mt-3">
            {problemCount ? (
              <div className="mb-3 rounded-xl border border-rose-800/70 bg-rose-950/40 px-3 py-3 text-xs text-rose-100">
                <p className="font-black uppercase tracking-wider">What needs attention</p>
                <p className="mt-1 text-rose-200/80">
                  A problem means that check returned a non-2xx response or did not answer before the timeout. It does not automatically mean orders or inventory are broken; review the affected check below and retry after correcting the underlying issue.
                </p>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((item) => (
                <div
                  key={item.label}
                  className={`rounded-xl border px-3 py-2 ${item.state === "checking" ? "border-slate-700 bg-slate-900 text-slate-300" : item.state === "ok" ? "border-emerald-800/80 bg-emerald-950/50 text-emerald-200" : "border-rose-800/80 bg-rose-950/50 text-rose-200"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold">{item.label}</span>
                    <span className="text-[10px] font-black tracking-wider">{stateText(item.state)}</span>
                  </div>
                  <p className="mt-1 text-[11px] opacity-80">{item.detail}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void runChecks()}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:border-emerald-500 hover:text-white"
              >
                Run checks again
              </button>
              {problemCount ? (
                <span className="text-[11px] text-slate-500">
                  Problem checks: {items.filter((item) => item.state === "problem").map((item) => item.label).join(", ")}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="mt-2 text-[10px] text-slate-600">
          {lastChecked ? `Last checked ${lastChecked}; checks repeat every minute.` : "Live checks run automatically."}
        </p>
      </div>
    </section>
  );
}
