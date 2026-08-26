"use client";

import { useCallback, useEffect, useState } from "react";

type QueueStatus = "pending" | "completed" | "not_needed" | "error";
type AcceptedSale = {
  title: string;
  price: number;
  soldAt?: string | null;
  sourceLabel?: string;
};

type QueueRow = {
  id: string;
  status: QueueStatus;
  registryIdentityId: string;
  query: string;
  searchUrl: string;
  reasons: string[];
  pricingEligibleSoldCount: number;
  newestSoldAt: string | null;
  updatedAt: string;
  completedAt?: string | null;
  evidence?: {
    screenshotDataUrl?: string;
    screenshotSha256?: string;
    acceptedExactSales?: AcceptedSale[];
    rejectedSales?: Array<{ title?: string; price?: number; soldAt?: string | null; notes?: string | null }>;
  } | null;
};
type QueueResponse = {
  ok: boolean;
  count?: number;
  queue?: QueueRow[];
  error?: string;
};

type UploadResponse = {
  ok: boolean;
  extractedCount?: number;
  acceptedCount?: number;
  error?: string;
};

const STATUS_OPTIONS: Array<{ value: QueueStatus | "all"; label: string }> = [
  { value: "pending", label: "Needs verification" },
  { value: "error", label: "Needs retry" },
  { value: "completed", label: "Completed" },
  { value: "not_needed", label: "Not needed" },
  { value: "all", label: "All" },
];

function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

export default function Point130VerificationPage() {
  const [status, setStatus] = useState<QueueStatus | "all">("pending");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: QueueStatus | "all") => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/instacomp/130point-verification?status=${encodeURIComponent(nextStatus)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as QueueResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load queue.");
      setRows(payload.queue || []);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/admin/instacomp/130point-verification?status=${encodeURIComponent(status)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as QueueResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "Could not load queue.");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setRows(payload.queue || []);
        setMessage(null);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [status]);
  async function upload(row: QueueRow, file: File) {
    setBusyId(row.registryIdentityId);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("registryIdentityId", row.registryIdentityId);
      form.set("screenshot", file);
      const response = await fetch("/api/admin/instacomp/130point-verification", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as UploadResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Screenshot verification failed.");
      setMessage(
        `130point screenshot processed: ${payload.acceptedCount || 0} exact sale(s) accepted from ${payload.extractedCount || 0} visible sale(s).`,
      );
      await load(status);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">InstaComp Evidence Desk</p>
        <h1 className="mt-2 text-3xl font-black text-neutral-950">130point Verification Queue</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
          InstaComp creates these exceptions automatically. Open the exact search, capture the visible sales results, then upload the screenshot. Only strict exact-card sales are retained.
        </p>
      </section>
      <section className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => { setLoading(true); setStatus(option.value); }}
            className={`rounded-xl px-4 py-2 text-sm font-black ${status === option.value ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-700"}`}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(status)}
          className="rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white"
        >
          Refresh
        </button>
      </section>

      {message ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-bold text-sky-950">{message}</div> : null}
      {loading ? <div className="rounded-xl bg-neutral-100 p-5 font-bold text-neutral-600">Loading queue…</div> : null}
      {!loading && rows.length === 0 ? <div className="rounded-xl bg-neutral-100 p-5 font-bold text-neutral-600">No 130point items in this view.</div> : null}

      <section className="space-y-4">
        {rows.map((row) => {
          const accepted = row.evidence?.acceptedExactSales || [];
          const rejected = row.evidence?.rejectedSales || [];
          const busy = busyId === row.registryIdentityId;
          return (
            <article key={row.id} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-neutral-950 px-3 py-1 text-xs font-black uppercase text-white">{row.status.replace("_", " ")}</span>
                    <span className="text-xs font-bold text-neutral-500">Updated {dateLabel(row.updatedAt)}</span>
                  </div>
                  <h2 className="mt-3 break-words text-lg font-black text-neutral-950">{row.query}</h2>
                  <p className="mt-1 text-sm font-semibold text-neutral-600">
                    Trusted sold before verification: {row.pricingEligibleSoldCount} · newest {dateLabel(row.newestSoldAt)}
                  </p>
                </div>
                <a
                  href={row.searchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white"
                >
                  Open exact 130point search
                </a>
              </div>

              {row.reasons?.length ? (
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm font-semibold text-amber-900">
                  {row.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <label className={`cursor-pointer rounded-xl px-4 py-3 text-sm font-black text-white ${busy ? "bg-neutral-400" : "bg-sky-700"}`}>
                  {busy ? "Reading screenshot…" : "Upload 130point screenshot"}
                  <input
                    className="hidden"
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(row, file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <span className="text-xs font-semibold text-neutral-500">Registry {row.registryIdentityId}</span>
              </div>
              {accepted.length ? (
                <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-black text-emerald-950">Accepted exact sales ({accepted.length})</p>
                  <div className="mt-2 space-y-2">
                    {accepted.map((sale, index) => (
                      <div key={`${sale.title}-${sale.soldAt || index}`} className="flex flex-wrap justify-between gap-2 text-sm font-semibold text-emerald-950">
                        <span>{sale.title}</span>
                        <span>{money(sale.price)} · {dateLabel(sale.soldAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {rejected.length ? (
                <details className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <summary className="cursor-pointer text-sm font-black text-rose-950">Rejected / non-exact visible sales ({rejected.length})</summary>
                  <div className="mt-2 space-y-2 text-sm font-semibold text-rose-950">
                    {rejected.map((sale, index) => (
                      <p key={`${sale.title || "rejected"}-${index}`}>
                        {sale.title || "Unidentified row"}
                        {sale.price ? ` · ${money(sale.price)}` : ""}
                        {sale.notes ? ` · ${sale.notes}` : ""}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}
