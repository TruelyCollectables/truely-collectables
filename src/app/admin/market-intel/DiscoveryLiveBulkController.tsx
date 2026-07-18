"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type ReviewRow = {
  id: string;
  player: string;
  selected: boolean;
  ready: boolean;
  missing: string[];
  form: HTMLFormElement;
  checkbox: HTMLInputElement | null;
};

type ApprovalPayload =
  | { success: true; identityId: string; listingId: string | null }
  | { success: false; error: string };

type BulkPayload =
  | {
      success: true;
      result: {
        requested: number;
        approved: number;
        rejected: number;
        skipped: number;
        errors: Array<{ candidateId: string; message: string }>;
      };
    }
  | { success: false; error: string };

type EnrichmentPayload =
  | {
      success: true;
      result: {
        requested: number;
        recovered: number;
        unresolved: number;
        errors: Array<{ candidateId: string; message: string }>;
      };
    }
  | { success: false; error: string };

const APPROVAL_CHUNK_SIZE = 3;
const REJECT_CHUNK_SIZE = 3;
const ENRICHMENT_CHUNK_SIZE = 5;

function normalize(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function candidateId(form: HTMLFormElement) {
  return form.action.match(/\/discovery\/([^/]+)\/approve/i)?.[1] || "";
}

function field(
  form: HTMLFormElement,
  name: string,
): HTMLInputElement | HTMLSelectElement | null {
  const value = form.elements.namedItem(name);
  return value instanceof HTMLInputElement || value instanceof HTMLSelectElement
    ? value
    : null;
}

function value(form: HTMLFormElement, name: string) {
  return field(form, name)?.value.trim() || "";
}

function checked(form: HTMLFormElement, name: string) {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement && input.type === "checkbox" && input.checked;
}

function missingFields(form: HTMLFormElement) {
  const missing: Array<{
    label: string;
    element: HTMLInputElement | HTMLSelectElement | null;
  }> = [];

  for (const [name, label] of [
    ["seasonYear", "Year"],
    ["manufacturer", "Manufacturer"],
    ["productLine", "Product line"],
    ["cardNumber", "Exact card number"],
  ] as const) {
    if (!value(form, name)) missing.push({ label, element: field(form, name) });
  }

  const quantity = Number(value(form, "quantity"));
  if (!Number.isInteger(quantity) || quantity <= 0) {
    missing.push({
      label: "Positive whole-number quantity",
      element: field(form, "quantity"),
    });
  }

  if (value(form, "conditionType") === "graded") {
    if (!value(form, "gradingCompany")) {
      missing.push({ label: "Grading company", element: field(form, "gradingCompany") });
    }
    if (!value(form, "grade")) {
      missing.push({ label: "Grade", element: field(form, "grade") });
    }
  }

  const parallel = normalize(value(form, "parallelName"));
  const serial = Number(value(form, "serialNumberedTo"));
  const nonBase = Boolean(
    (parallel && !["base", "base card", "regular", "standard"].includes(parallel)) ||
      value(form, "insertName") ||
      value(form, "variationName") ||
      (Number.isInteger(serial) && serial > 0) ||
      checked(form, "autograph") ||
      checked(form, "memorabilia"),
  );
  if (!nonBase) {
    missing.push({
      label: "Non-base signal",
      element:
        field(form, "parallelName") ||
        field(form, "insertName") ||
        field(form, "variationName"),
    });
  }

  return missing;
}

function oldBulkBar() {
  const heading = Array.from(document.querySelectorAll<HTMLElement>("p")).find(
    (node) => normalize(node.textContent) === "bulk discovery review",
  );
  return heading?.closest<HTMLElement>("div.fixed") || null;
}

export default function DiscoveryLiveBulkController() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState<"approve" | "reject" | "recover" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const hiddenBar = useRef<HTMLElement | null>(null);

  const scan = useCallback(() => {
    if (pathname !== "/admin/market-intel/discovery") return;

    const old = oldBulkBar();
    if (old) {
      old.style.display = "none";
      hiddenBar.current = old;
    }

    const nextRows: ReviewRow[] = [];
    for (const form of Array.from(
      document.querySelectorAll<HTMLFormElement>(
        'form[action*="/api/admin/market-intel/discovery/"][action*="/approve"]',
      ),
    )) {
      const id = candidateId(form);
      if (!id) continue;
      form.noValidate = true;
      const parallel = field(form, "parallelName");
      if (parallel instanceof HTMLInputElement) parallel.required = false;

      const article = document.getElementById(`candidate-${id}`);
      const checkbox =
        article?.querySelector<HTMLInputElement>(
          'input[type="checkbox"][aria-label^="Select "]',
        ) || null;
      const missing = missingFields(form).map((item) => item.label);
      nextRows.push({
        id,
        player: article?.querySelector("h3")?.textContent?.trim() || "Candidate",
        selected: Boolean(checkbox?.checked),
        ready: missing.length === 0,
        missing,
        form,
        checkbox,
      });
    }
    setRows(nextRows);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/admin/market-intel/discovery") return;
    let queued = false;
    const queueScan = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        scan();
      });
    };
    const observer = new MutationObserver(queueScan);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", queueScan, true);
    document.addEventListener("change", queueScan, true);
    queueScan();

    return () => {
      observer.disconnect();
      document.removeEventListener("input", queueScan, true);
      document.removeEventListener("change", queueScan, true);
      if (hiddenBar.current) hiddenBar.current.style.display = "";
    };
  }, [pathname, scan]);

  const selected = useMemo(() => rows.filter((row) => row.selected), [rows]);
  const readySelected = useMemo(
    () => selected.filter((row) => row.ready),
    [selected],
  );
  const readyRows = useMemo(() => rows.filter((row) => row.ready), [rows]);
  const missingCardNumberRows = useMemo(
    () => rows.filter((row) => row.missing.includes("Exact card number")),
    [rows],
  );
  const incomplete = selected.length - readySelected.length;
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const handoff = searchParams.get("admin_handoff");

  function setSelection(test: (row: ReviewRow) => boolean) {
    if (busy) return;
    for (const row of rows) {
      const desired = test(row);
      if (row.checkbox && row.checkbox.checked !== desired) row.checkbox.click();
    }
    setConfirmReject(false);
    setError(null);
    window.setTimeout(scan, 0);
  }

  function reviewFirstIncomplete() {
    const row = selected.find((item) => !item.ready) || rows.find((item) => !item.ready);
    if (!row) {
      setError("Every visible candidate is approval-ready.");
      return;
    }
    row.form.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => missingFields(row.form)[0]?.element?.focus(), 350);
  }

  async function approveRow(row: ReviewRow) {
    const missing = missingFields(row.form);
    if (missing.length) {
      throw new Error(`${row.player}: ${missing.map((item) => item.label).join(", ")}.`);
    }
    const response = await fetch(row.form.action, {
      method: "POST",
      body: new FormData(row.form),
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json().catch(() => null)) as ApprovalPayload | null;
    if (!response.ok || !payload || payload.success !== true) {
      throw new Error(
        payload && "error" in payload
          ? payload.error
          : `${row.player}: approval failed with HTTP ${response.status}.`,
      );
    }
  }

  async function approveSelected() {
    if (busy) return;
    if (!selected.length) {
      setError("Select at least one candidate first.");
      return;
    }
    if (!readySelected.length) {
      setError("None of the selected cards are ready. TCOS moved to the first missing field.");
      reviewFirstIncomplete();
      return;
    }

    setBusy("approve");
    setConfirmReject(false);
    setError(null);
    let approved = 0;
    let failed = 0;
    let firstError = "";

    for (let index = 0; index < readySelected.length; index += APPROVAL_CHUNK_SIZE) {
      const outcomes = await Promise.allSettled(
        readySelected.slice(index, index + APPROVAL_CHUNK_SIZE).map(approveRow),
      );
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") approved += 1;
        else {
          failed += 1;
          firstError ||= outcome.reason instanceof Error
            ? outcome.reason.message
            : "Approval failed.";
        }
      }
      setProgress(`Approved ${approved}/${readySelected.length} ready cards · Failed ${failed}`);
    }

    const params = new URLSearchParams({
      bulk: "1",
      requested: String(selected.length),
      processed: String(selected.length),
      approved: String(approved),
      rejected: "0",
      skipped: String(incomplete + failed),
      t: String(Date.now()),
    });
    if (firstError) params.set("firstError", firstError.slice(0, 220));
    if (handoff) params.set("admin_handoff", handoff);
    window.location.assign(`/admin/market-intel/discovery?${params.toString()}`);
  }

  async function rejectSelected() {
    if (busy) return;
    if (!selected.length) {
      setError("Select at least one candidate before rejecting.");
      return;
    }
    if (!confirmReject) {
      setConfirmReject(true);
      setError(null);
      return;
    }

    setBusy("reject");
    setError(null);
    let rejected = 0;
    let skipped = 0;
    let firstError = "";
    const endpoint = handoff
      ? `/api/admin/market-intel/discovery/bulk?admin_handoff=${encodeURIComponent(handoff)}`
      : "/api/admin/market-intel/discovery/bulk";

    for (let index = 0; index < selected.length; index += REJECT_CHUNK_SIZE) {
      const chunk = selected.slice(index, index + REJECT_CHUNK_SIZE);
      const formData = new FormData();
      formData.set("action", "reject");
      formData.set("reason", "Bulk rejected during Discovery Desk review.");
      chunk.forEach((row) => formData.append("candidateIds", row.id));
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as BulkPayload | null;
      if (!response.ok || !payload || payload.success !== true) {
        skipped += chunk.length;
        firstError ||= payload && "error" in payload
          ? payload.error
          : `Reject failed with HTTP ${response.status}.`;
      } else {
        rejected += payload.result.rejected;
        skipped += payload.result.skipped;
        firstError ||= payload.result.errors[0]?.message || "";
      }
      setProgress(`Rejected ${rejected}/${selected.length} selected cards · Skipped ${skipped}`);
    }

    const params = new URLSearchParams({
      bulk: "1",
      requested: String(selected.length),
      processed: String(selected.length),
      approved: "0",
      rejected: String(rejected),
      skipped: String(skipped),
      t: String(Date.now()),
    });
    if (firstError) params.set("firstError", firstError.slice(0, 220));
    if (handoff) params.set("admin_handoff", handoff);
    window.location.assign(`/admin/market-intel/discovery?${params.toString()}`);
  }

  async function recoverCardNumbers() {
    if (busy) return;
    const source = selected.filter((row) => row.missing.includes("Exact card number"));
    const rowsToRecover = source.length ? source : missingCardNumberRows;
    if (!rowsToRecover.length) {
      setError("No visible candidates are missing an exact card number.");
      return;
    }

    setBusy("recover");
    setError(null);
    let recovered = 0;
    let unresolved = 0;
    let failures = 0;
    let firstError = "";
    const endpoint = handoff
      ? `/api/admin/market-intel/discovery/enrich-card-numbers?admin_handoff=${encodeURIComponent(handoff)}`
      : "/api/admin/market-intel/discovery/enrich-card-numbers";

    for (let index = 0; index < rowsToRecover.length; index += ENRICHMENT_CHUNK_SIZE) {
      const chunk = rowsToRecover.slice(index, index + ENRICHMENT_CHUNK_SIZE);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: chunk.map((row) => row.id) }),
      });
      const payload = (await response.json().catch(() => null)) as EnrichmentPayload | null;
      if (!response.ok || !payload || payload.success !== true) {
        failures += chunk.length;
        firstError ||= payload && "error" in payload
          ? payload.error
          : `Recovery failed with HTTP ${response.status}.`;
      } else {
        recovered += payload.result.recovered;
        unresolved += payload.result.unresolved;
        failures += payload.result.errors.length;
        firstError ||= payload.result.errors[0]?.message || "";
      }
      setProgress(
        `Recovered ${recovered} card numbers · Unresolved ${unresolved} · Errors ${failures}`,
      );
    }

    const params = new URLSearchParams({
      enriched: "1",
      requested: String(rowsToRecover.length),
      processed: String(rowsToRecover.length),
      recovered: String(recovered),
      unresolved: String(unresolved),
      enrichmentErrors: String(failures),
    });
    if (firstError) params.set("enrichmentError", firstError.slice(0, 220));
    if (handoff) params.set("admin_handoff", handoff);
    window.location.assign(`/admin/market-intel/discovery?${params.toString()}`);
  }

  if (pathname !== "/admin/market-intel/discovery" || rows.length === 0) return null;

  return (
    <section className="fixed inset-x-4 bottom-4 z-[80] mx-auto max-w-6xl rounded-xl border border-cyan-600 bg-[#101418] p-4 text-white shadow-2xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">
            Live Bulk Discovery Review
          </p>
          <p className="mt-1 font-black">
            {selected.length} selected · {readySelected.length} ready now · {incomplete} incomplete
          </p>
          <p className="mt-1 text-xs font-bold text-neutral-300">
            Ready status updates from the fields currently visible on each card—not stale scanner data.
          </p>
          {progress ? <p className="mt-2 text-sm font-black text-lime-300">{progress}</p> : null}
          {error ? (
            <p role="alert" className="mt-2 rounded-md border border-rose-400 bg-rose-950 px-3 py-2 text-sm font-bold text-rose-100">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={Boolean(busy)} onClick={() => setSelection(() => !allSelected)} className="rounded-md border border-neutral-500 bg-white/10 px-3 py-2 text-sm font-black disabled:opacity-40">
            {allSelected ? "Clear All" : "Select All"}
          </button>
          <button type="button" disabled={Boolean(busy) || readyRows.length === 0} onClick={() => setSelection((row) => row.ready)} className="rounded-md border border-cyan-500 bg-cyan-950 px-3 py-2 text-sm font-black text-cyan-100 disabled:opacity-40">
            Select Ready Now ({readyRows.length})
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={reviewFirstIncomplete} className="rounded-md border border-amber-400 bg-amber-950 px-3 py-2 text-sm font-black text-amber-100 disabled:opacity-40">
            Review First Incomplete
          </button>
          <button type="button" disabled={Boolean(busy) || missingCardNumberRows.length === 0} onClick={() => void recoverCardNumbers()} className="rounded-md bg-amber-500 px-4 py-2 text-sm font-black text-black disabled:opacity-40">
            {busy === "recover" ? "Recovering..." : `Recover Card Numbers (${missingCardNumberRows.length})`}
          </button>
          <button type="button" disabled={Boolean(busy) || readySelected.length === 0} onClick={() => void approveSelected()} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
            {busy === "approve" ? "Approving..." : `Approve Ready Selected (${readySelected.length})`}
          </button>
          <button type="button" disabled={Boolean(busy) || selected.length === 0} onClick={() => void rejectSelected()} className="rounded-md bg-rose-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
            {confirmReject ? "Confirm Reject Selected" : "Reject Selected"}
          </button>
          {confirmReject ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmReject(false)} className="rounded-md border border-neutral-500 bg-white/10 px-3 py-2 text-sm font-black disabled:opacity-40">
              Cancel Reject
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
