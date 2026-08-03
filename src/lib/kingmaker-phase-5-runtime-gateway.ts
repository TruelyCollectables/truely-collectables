import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { KingmakerPersistenceOperation, KingmakerPersistencePlan } from "./kingmaker-phase-5-persistence-bridge";

export type KingmakerPersistenceReceipt = {
  operationFingerprint: string;
  table: KingmakerPersistenceOperation["table"];
  mode: KingmakerPersistenceOperation["mode"];
  status: "applied" | "duplicate";
};

export type KingmakerPersistenceClient = {
  insertIgnore: (operation: KingmakerPersistenceOperation) => Promise<"applied" | "duplicate">;
  upsert: (operation: KingmakerPersistenceOperation) => Promise<"applied">;
};

export async function executeKingmakerPersistencePlan(input: {
  plan: KingmakerPersistencePlan;
  client: KingmakerPersistenceClient;
}) {
  const fingerprints = input.plan.operations.map((operation) => operation.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length) throw new Error("duplicate_operation_fingerprint");

  const receipts: KingmakerPersistenceReceipt[] = [];
  for (const operation of input.plan.operations) {
    const status = operation.mode === "upsert"
      ? await input.client.upsert(operation)
      : await input.client.insertIgnore(operation);
    receipts.push({
      operationFingerprint: operation.fingerprint,
      table: operation.table,
      mode: operation.mode,
      status,
    });
  }

  const fingerprint = createHash("sha256").update(JSON.stringify({
    planFingerprint: input.plan.fingerprint,
    receipts,
  })).digest("hex");

  return {
    cycleFingerprint: input.plan.cycleFingerprint,
    applied: receipts.filter((receipt) => receipt.status === "applied").length,
    duplicates: receipts.filter((receipt) => receipt.status === "duplicate").length,
    receipts,
    fingerprint,
  };
}

export type KingmakerSignedRequest = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
};

function canonicalRequest(input: Omit<KingmakerSignedRequest, "signature">) {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, bodyHash].join("\n");
}

export function signKingmakerServiceRequest(input: Omit<KingmakerSignedRequest, "signature"> & { secret: string }) {
  if (input.secret.length < 32) throw new Error("service_secret_too_short");
  return createHmac("sha256", input.secret).update(canonicalRequest(input)).digest("hex");
}

export function verifyKingmakerServiceRequest(input: {
  request: KingmakerSignedRequest;
  secret: string;
  now: string;
  usedNonces: Set<string>;
  maximumSkewSeconds?: number;
}) {
  const errors: string[] = [];
  const nowMs = Date.parse(input.now);
  const requestedMs = Date.parse(input.request.timestamp);
  if (!Number.isFinite(nowMs) || !Number.isFinite(requestedMs)) errors.push("invalid_request_timestamp");
  const maximumSkewMs = (input.maximumSkewSeconds ?? 300) * 1000;
  if (Number.isFinite(nowMs) && Number.isFinite(requestedMs) && Math.abs(nowMs - requestedMs) > maximumSkewMs) errors.push("request_timestamp_outside_window");
  if (!input.request.nonce.trim()) errors.push("missing_request_nonce");
  if (input.usedNonces.has(input.request.nonce)) errors.push("request_nonce_replayed");
  if (!input.request.path.startsWith("/api/kingmaker/")) errors.push("invalid_kingmaker_path");
  if (!(["GET", "POST", "PATCH"] as string[]).includes(input.request.method.toUpperCase())) errors.push("unsupported_request_method");
  if (input.secret.length < 32) errors.push("service_secret_too_short");

  if (!errors.length) {
    const expected = signKingmakerServiceRequest({ ...input.request, secret: input.secret });
    const suppliedBuffer = Buffer.from(input.request.signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) errors.push("invalid_request_signature");
  }

  if (!errors.length) input.usedNonces.add(input.request.nonce);
  return { accepted: errors.length === 0, errors };
}

export function buildKingmakerApiResponse(input: {
  payload: unknown;
  etag: string;
  ifNoneMatch?: string | null;
}) {
  if (!input.etag.trim()) throw new Error("missing_etag");
  if (input.ifNoneMatch === input.etag) {
    return {
      status: 304 as const,
      headers: { etag: input.etag, "cache-control": "private, no-cache" },
      body: null,
    };
  }
  return {
    status: 200 as const,
    headers: { etag: input.etag, "cache-control": "private, no-cache", "content-type": "application/json" },
    body: input.payload,
  };
}
