"use client";

import { useLayoutEffect } from "react";

function isPricingRequest(input: RequestInfo | URL, init?: RequestInit) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method = String(
    init?.method || (input instanceof Request ? input.method : "GET"),
  ).toUpperCase();
  return (
    method === "POST" &&
    url.includes("/api/account/seller/inventory/instacomp") &&
    !url.includes("/api/account/seller/inventory/instacomp-verified")
  );
}

function verifiedUrl(input: RequestInfo | URL) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return url.replace(
    "/api/account/seller/inventory/instacomp",
    "/api/account/seller/inventory/instacomp-verified",
  );
}

export default function ChecklistIdentityGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  useLayoutEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isPricingRequest(input, init)) return originalFetch(input, init);

      if (input instanceof Request) {
        const request = input.clone();
        return originalFetch(
          new Request(verifiedUrl(request), {
            method: init?.method || request.method,
            headers: init?.headers || request.headers,
            body: init?.body || (request.method === "GET" || request.method === "HEAD"
              ? undefined
              : await request.text()),
            credentials: init?.credentials || request.credentials,
            cache: init?.cache || request.cache,
            redirect: init?.redirect || request.redirect,
            referrer: init?.referrer || request.referrer,
            referrerPolicy: init?.referrerPolicy || request.referrerPolicy,
            integrity: init?.integrity || request.integrity,
            keepalive: init?.keepalive || request.keepalive,
            mode: init?.mode || request.mode,
            signal: init?.signal || request.signal,
          }),
        );
      }

      return originalFetch(verifiedUrl(input), init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return children;
}
