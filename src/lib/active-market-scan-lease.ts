export type ActiveMarketScanLeaseStatus =
  | "running"
  | "completed"
  | "failed"
  | "superseded";

export type ActiveMarketScanLease = {
  schema: "truely.activeMarketScanLease.v1";
  runId: string;
  status: ActiveMarketScanLeaseStatus;
  ownerAccountId: string;
  startedAt: string;
  expiresAt: string;
  completedAt?: string | null;
  responseStatus?: number | null;
  resultMode?: string | null;
  evidenceReceipt?: string | null;
  error?: string | null;
};

export type ActiveMarketScanHistoryEntry = {
  runId: string;
  status: ActiveMarketScanLeaseStatus;
  ownerAccountId: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  responseStatus: number | null;
  resultMode: string | null;
  evidenceReceipt: string | null;
  error: string | null;
};

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function dateMs(value: unknown): number | null {
  const parsed = new Date(text(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function readActiveMarketScanLease(
  metadata: unknown,
): ActiveMarketScanLease | null {
  const raw = record(record(metadata).active_market_scan_lease);
  const runId = text(raw.runId);
  const ownerAccountId = text(raw.ownerAccountId);
  const startedAt = text(raw.startedAt);
  const expiresAt = text(raw.expiresAt);
  const status = text(raw.status) as ActiveMarketScanLeaseStatus;
  if (
    !runId ||
    !ownerAccountId ||
    !startedAt ||
    !expiresAt ||
    !["running", "completed", "failed", "superseded"].includes(status)
  ) {
    return null;
  }

  return {
    schema: "truely.activeMarketScanLease.v1",
    runId,
    status,
    ownerAccountId,
    startedAt,
    expiresAt,
    completedAt: text(raw.completedAt) || null,
    responseStatus: number(raw.responseStatus),
    resultMode: text(raw.resultMode) || null,
    evidenceReceipt: text(raw.evidenceReceipt) || null,
    error: text(raw.error) || null,
  };
}

export function inspectActiveMarketScanLease(input: {
  metadata: unknown;
  now?: Date;
}) {
  const now = input.now || new Date();
  const lease = readActiveMarketScanLease(input.metadata);
  if (!lease) {
    return {
      canAcquire: true,
      reason: "no_valid_lease" as const,
      lease: null,
      remainingMs: 0,
    };
  }

  const expiry = dateMs(lease.expiresAt);
  const remainingMs = expiry === null ? 0 : Math.max(0, expiry - now.getTime());
  if (lease.status !== "running") {
    return {
      canAcquire: true,
      reason: "previous_scan_finished" as const,
      lease,
      remainingMs: 0,
    };
  }
  if (expiry === null || expiry <= now.getTime()) {
    return {
      canAcquire: true,
      reason: "running_lease_expired" as const,
      lease,
      remainingMs: 0,
    };
  }

  return {
    canAcquire: false,
    reason: "scan_already_running" as const,
    lease,
    remainingMs,
  };
}

export function buildRunningActiveMarketScanLease(input: {
  runId: string;
  ownerAccountId: string;
  now?: Date;
  ttlMs?: number;
}): ActiveMarketScanLease {
  const now = input.now || new Date();
  const ttlMs = Math.min(
    10 * 60_000,
    Math.max(60_000, input.ttlMs ?? 5 * 60_000),
  );
  return {
    schema: "truely.activeMarketScanLease.v1",
    runId: input.runId,
    status: "running",
    ownerAccountId: input.ownerAccountId,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    completedAt: null,
    responseStatus: null,
    resultMode: null,
    evidenceReceipt: null,
    error: null,
  };
}

export function isActiveMarketScanLeaseOwner(
  metadata: unknown,
  runId: string,
): boolean {
  const lease = readActiveMarketScanLease(metadata);
  return Boolean(lease && lease.runId === runId && lease.status === "running");
}

export function finishActiveMarketScanLease(input: {
  lease: ActiveMarketScanLease;
  status: Exclude<ActiveMarketScanLeaseStatus, "running">;
  now?: Date;
  responseStatus?: number | null;
  resultMode?: string | null;
  evidenceReceipt?: string | null;
  error?: string | null;
}): ActiveMarketScanLease {
  const now = input.now || new Date();
  return {
    ...input.lease,
    status: input.status,
    completedAt: now.toISOString(),
    responseStatus: input.responseStatus ?? null,
    resultMode: input.resultMode || null,
    evidenceReceipt: input.evidenceReceipt || null,
    error: input.error || null,
  };
}

export function toActiveMarketScanHistoryEntry(
  lease: ActiveMarketScanLease,
): ActiveMarketScanHistoryEntry {
  const started = dateMs(lease.startedAt);
  const completed = dateMs(lease.completedAt);
  return {
    runId: lease.runId,
    status: lease.status,
    ownerAccountId: lease.ownerAccountId,
    startedAt: lease.startedAt,
    completedAt: lease.completedAt || null,
    durationMs:
      started === null || completed === null
        ? null
        : Math.max(0, completed - started),
    responseStatus: lease.responseStatus ?? null,
    resultMode: lease.resultMode || null,
    evidenceReceipt: lease.evidenceReceipt || null,
    error: lease.error || null,
  };
}

export function appendActiveMarketScanHistory(input: {
  metadata: unknown;
  lease: ActiveMarketScanLease;
  limit?: number;
}): ActiveMarketScanHistoryEntry[] {
  const metadata = record(input.metadata);
  const existing = Array.isArray(metadata.active_market_scan_history)
    ? metadata.active_market_scan_history
        .map((entry) => record(entry))
        .map((entry) => ({
          runId: text(entry.runId),
          status: text(entry.status) as ActiveMarketScanLeaseStatus,
          ownerAccountId: text(entry.ownerAccountId),
          startedAt: text(entry.startedAt),
          completedAt: text(entry.completedAt) || null,
          durationMs: number(entry.durationMs),
          responseStatus: number(entry.responseStatus),
          resultMode: text(entry.resultMode) || null,
          evidenceReceipt: text(entry.evidenceReceipt) || null,
          error: text(entry.error) || null,
        }))
        .filter(
          (entry) =>
            entry.runId &&
            entry.ownerAccountId &&
            entry.startedAt &&
            ["running", "completed", "failed", "superseded"].includes(
              entry.status,
            ),
        )
    : [];
  const next = [
    toActiveMarketScanHistoryEntry(input.lease),
    ...existing.filter((entry) => entry.runId !== input.lease.runId),
  ];
  return next.slice(0, Math.max(1, Math.min(100, input.limit ?? 20)));
}
