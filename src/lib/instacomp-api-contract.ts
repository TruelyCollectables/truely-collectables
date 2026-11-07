import { randomUUID } from "node:crypto";

export const INSTACOMP_API_VERSION = "2026-08-04" as const;
export const INSTACOMP_CONTRACT = "tcos.instacomp.verified-pricing.v1" as const;

export type InstaCompVerifiedRequest = {
  inventoryItemId: string;
  aiCouncilTier: string;
  forceIdentityRescan: boolean;
  requestId: string;
};

export type InstaCompBatchRequest = {
  inventoryItemIds: string[];
  aiCouncilTier: string;
  forceIdentityRescan: boolean;
  requestId: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function safeRequestId(value: unknown) {
  const candidate = clean(value);
  if (/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(candidate)) return candidate;
  return randomUUID();
}

export function parseVerifiedPricingRequest(
  body: Record<string, unknown>,
  headerRequestId?: string | null,
): InstaCompVerifiedRequest {
  return {
    inventoryItemId: clean(body.inventoryItemId),
    aiCouncilTier: clean(body.aiCouncilTier) || "adaptive",
    forceIdentityRescan: body.forceIdentityRescan === true,
    requestId: safeRequestId(headerRequestId || body.requestId),
  };
}

export function parseVerifiedBatchRequest(
  body: Record<string, unknown>,
  headerRequestId?: string | null,
  maxBatchSize = 50,
): InstaCompBatchRequest {
  const inventoryItemIds = Array.from(
    new Set(
      (Array.isArray(body.inventoryItemIds) ? body.inventoryItemIds : [])
        .map(clean)
        .filter(Boolean),
    ),
  ).slice(0, maxBatchSize);
  return {
    inventoryItemIds,
    aiCouncilTier: clean(body.aiCouncilTier) || "adaptive",
    forceIdentityRescan: body.forceIdentityRescan === true,
    requestId: safeRequestId(headerRequestId || body.requestId),
  };
}

export function instaCompResponseHeaders(params: {
  requestId: string;
  checklistVerified?: boolean;
  registryIdentityId?: string | null;
  mobileSurface?: boolean;
}) {
  const headers = new Headers({
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-instacomp-api-version": INSTACOMP_API_VERSION,
    "x-instacomp-contract": INSTACOMP_CONTRACT,
    "x-instacomp-request-id": params.requestId,
  });
  if (params.checklistVerified !== undefined) {
    headers.set(
      "x-instacomp-checklist-verified",
      params.checklistVerified ? "true" : "false",
    );
  }
  if (params.registryIdentityId) {
    headers.set("x-instacomp-registry-identity-id", params.registryIdentityId);
  }
  if (params.mobileSurface) headers.set("x-instacomp-mobile-api", "v1");
  return headers;
}

export function instaCompEnvelope<T extends Record<string, unknown>>(params: {
  requestId: string;
  payload: T;
  durationMs: number;
}) {
  return {
    contract: INSTACOMP_CONTRACT,
    apiVersion: INSTACOMP_API_VERSION,
    requestId: params.requestId,
    durationMs: Math.max(0, Math.round(params.durationMs)),
    ...params.payload,
  };
}
