"use client";

import { useLayoutEffect } from "react";

type PricingRequestBody = {
  inventoryItemId?: unknown;
};

function isPricingRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  return method === "POST" && url.includes("/api/account/seller/inventory/instacomp");
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit) {
  if (typeof init?.body === "string") {
    return JSON.parse(init.body) as PricingRequestBody;
  }
  if (input instanceof Request) {
    return (await input.clone().json()) as PricingRequestBody;
  }
  return {} as PricingRequestBody;
}

function authorizationHeader(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers.get("authorization");
}

export default function ChecklistIdentityGuard({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const inFlight = new Map<string, Promise<void>>();

    async function assertRegistryIdentity(
      inventoryItemId: string,
      authorization: string | null,
    ) {
      const existing = inFlight.get(inventoryItemId);
      if (existing) return existing;

      const task = (async () => {
        const response = await originalFetch(
          "/api/account/seller/instacomp-pending-identity",
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json",
              ...(authorization ? { authorization } : {}),
            },
            body: JSON.stringify({ inventoryItemId }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success !== true) {
          throw new Error(
            payload?.error ||
              "Checklist Registry identity must be resolved before marketplace comps can run.",
          );
        }
      })();

      inFlight.set(inventoryItemId, task);
      try {
        await task;
      } finally {
        inFlight.delete(inventoryItemId);
      }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isPricingRequest(input, init)) return originalFetch(input, init);

      try {
        const body = await requestBody(input, init);
        const inventoryItemId = String(body.inventoryItemId || "").trim();
        if (!inventoryItemId) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "inventoryItemId is required before Registry identity verification.",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        await assertRegistryIdentity(
          inventoryItemId,
          authorizationHeader(input, init),
        );
        return originalFetch(input, init);
      } catch (error: unknown) {
        return new Response(
          JSON.stringify({
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Checklist Registry identity verification failed.",
            code: "CHECKLIST_IDENTITY_REQUIRED",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
    };

    return () => {
      window.fetch = originalFetch;
      inFlight.clear();
    };
  }, []);

  return children;
}
