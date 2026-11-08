const INSTACOMP_BENCHMARK_LIVE_SCAN_PATH = "/api/instacomp/live-scan";

function validatedHttpUrl(value: string | URL) {
  const url = value instanceof URL ? new URL(value.href) : new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("InstaComp benchmark requests require an HTTP(S) URL.");
  }
  return url;
}

export function buildInstaCompBenchmarkLiveScanUrl(
  benchmarkRequestUrl: string | URL,
) {
  return new URL(
    INSTACOMP_BENCHMARK_LIVE_SCAN_PATH,
    validatedHttpUrl(benchmarkRequestUrl),
  );
}

export function buildInstaCompBenchmarkSameOriginHeaders(
  liveScanUrl: string | URL,
) {
  const target = validatedHttpUrl(liveScanUrl);
  const origin = target.origin;

  return {
    origin,
    referer: `${origin}/admin/instacomp`,
    "sec-fetch-site": "same-origin",
  } as const;
}
