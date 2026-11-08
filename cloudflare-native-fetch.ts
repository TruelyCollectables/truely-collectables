declare global {
  // Captured by the Cloudflare custom Worker before OpenNext/Next can wrap fetch.
  // It is intentionally absent in browsers, where normal fetch remains the fallback.
  var __TRUELY_CLOUDFLARE_NATIVE_FETCH__: typeof fetch | undefined;
}

// The IP-intelligence integration is observational/fail-open in request-gate
// and can add a long external network wait to every request on Cloudflare.
// Disable it in the Cloudflare runtime so storefront and API traffic are never
// held up by the external provider.
if (typeof process !== "undefined" && process.env) {
  try {
    delete process.env.IP_INTELLIGENCE_API_URL;
  } catch {
    process.env.IP_INTELLIGENCE_API_URL = "";
  }
}

if (!globalThis.__TRUELY_CLOUDFLARE_NATIVE_FETCH__) {
  globalThis.__TRUELY_CLOUDFLARE_NATIVE_FETCH__ = globalThis.fetch.bind(globalThis);
}

export {};
