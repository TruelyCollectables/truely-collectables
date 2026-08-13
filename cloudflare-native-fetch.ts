declare global {
  // Captured by the Cloudflare custom Worker before OpenNext/Next can wrap fetch.
  // It is intentionally absent on Vercel and in browsers, where normal fetch remains the fallback.
  var __TRUELY_CLOUDFLARE_NATIVE_FETCH__: typeof fetch | undefined;
}

if (!globalThis.__TRUELY_CLOUDFLARE_NATIVE_FETCH__) {
  globalThis.__TRUELY_CLOUDFLARE_NATIVE_FETCH__ = globalThis.fetch.bind(globalThis);
}

export {};
