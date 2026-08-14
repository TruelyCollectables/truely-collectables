declare global {
  // Captured by the Cloudflare custom Worker before OpenNext/Next can wrap fetch.
  // It is intentionally absent on Vercel and in browsers, where normal fetch remains the fallback.
  var __TRUELY_CLOUDFLARE_NATIVE_FETCH__: typeof fetch | undefined;
}

// The one-time Vercel secret handoff copied Vercel's own platform marker as a
// runtime binding. This module is imported only by the Cloudflare Worker entry,
// so neutralize that marker before OpenNext evaluates. Application secrets are
// untouched; this prevents Cloudflare from being misdetected as Vercel.
//
// The IP-intelligence integration is observational/fail-open in request-gate
// and can add a long external network wait to every request on Cloudflare.
// Keep that optional lookup on Vercel, but disable it in the Cloudflare runtime
// so storefront and API traffic are never held up by the external provider.
if (typeof process !== "undefined" && process.env) {
  try {
    delete process.env.VERCEL;
  } catch {
    process.env.VERCEL = "";
  }

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
