from pathlib import Path


PROVIDER = Path("src/lib/instacomp-exact-market-provider.ts")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label}")
    return text.replace(old, new, 1)


def main() -> None:
    text = PROVIDER.read_text()

    text = replace_once(
        text,
        '''function cleanSpaces(value: string | null | undefined) {
  return String(value || "").replace(/\\s+/g, " ").trim();
}
''',
        '''function cleanSpaces(value: string | null | undefined) {
  return String(value || "").replace(/\\s+/g, " ").trim();
}

export function isSerpApiNoResultsMessage(value: unknown) {
  const message = cleanSpaces(typeof value === "string" ? value : "");
  return /(?:hasn['’]?t returned any results|no results(?: were)? found|no matching results)/i.test(
    message,
  );
}

export function classifyExactEbayProviderStatus(params: {
  configured: boolean;
  resultCount: number;
  successfulAttemptCount: number;
  firstError: string | null;
}): InstaCompProviderResult["status"] {
  if (!params.configured) return "not_configured";
  if (params.resultCount > 0) return "live";
  if (params.successfulAttemptCount > 0) return "no_matches";
  return params.firstError ? "error" : "no_matches";
}
''',
        "SerpApi no-results and status helpers",
    )

    text = replace_once(
        text,
        '''    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      return {
        ok: false as const,
        items: [] as EbaySerpItem[],
        cached: false,
        message: sanitizeInstaCompProviderError(`SerpApi eBay ${lane} search failed: ${String(payload?.error || response.statusText)}`),
      };
    }
    const items = normalizeEbaySerpItems(payload);
''',
        '''    const payload = await response.json().catch(() => ({}));
    const payloadError = payload?.error;
    if (!response.ok || (payloadError && !isSerpApiNoResultsMessage(payloadError))) {
      return {
        ok: false as const,
        items: [] as EbaySerpItem[],
        cached: false,
        message: sanitizeInstaCompProviderError(`SerpApi eBay ${lane} search failed: ${String(payloadError || response.statusText)}`),
      };
    }
    if (isSerpApiNoResultsMessage(payloadError)) {
      return {
        ok: true as const,
        items: [] as EbaySerpItem[],
        cached: false,
        message: cleanSpaces(String(payloadError)),
      };
    }
    const items = normalizeEbaySerpItems(payload);
''',
        "SerpApi normal no-results response handling",
    )

    text = replace_once(
        text,
        '''  let results: InstaCompComp[] = [];
  let firstError: string | null = null;

  for (const query of params.queries) {
''',
        '''  let results: InstaCompComp[] = [];
  let firstError: string | null = null;
  let successfulAttemptCount = 0;

  for (const query of params.queries) {
''',
        "successful exact-provider attempt counter",
    )

    text = replace_once(
        text,
        '''    const exact = filterStrictExactMarketMatches(rawComps(fetched.items, params.lane), params.ai, 50).map(
''',
        '''    successfulAttemptCount += 1;
    const exact = filterStrictExactMarketMatches(rawComps(fetched.items, params.lane), params.ai, 50).map(
''',
        "successful exact-provider attempt increment",
    )

    text = replace_once(
        text,
        '''  const primaryQuery = params.queries[0] || "sports card";
  const status = !SERPAPI_API_KEY
    ? "not_configured"
    : results.length
      ? "live"
      : firstError
        ? "error"
        : "no_matches";
''',
        '''  const primaryQuery = params.queries[0] || "sports card";
  const status = classifyExactEbayProviderStatus({
    configured: Boolean(SERPAPI_API_KEY),
    resultCount: results.length,
    successfulAttemptCount,
    firstError,
  });
''',
        "exact-provider status classification",
    )

    text = replace_once(
        text,
        '''    message: results.length
      ? `${results.length} strict exact ${params.lane} result${results.length === 1 ? "" : "s"} passed after ${attempts.length} query attempt${attempts.length === 1 ? "" : "s"}.`
      : firstError || `No strict exact ${params.lane} results passed after ${attempts.length} query attempt${attempts.length === 1 ? "" : "s"}.`,
''',
        '''    message: results.length
      ? `${results.length} strict exact ${params.lane} result${results.length === 1 ? "" : "s"} passed after ${attempts.length} query attempt${attempts.length === 1 ? "" : "s"}.`
      : successfulAttemptCount > 0
        ? `No strict exact ${params.lane} results passed after ${successfulAttemptCount} successful query attempt${successfulAttemptCount === 1 ? "" : "s"}${firstError ? `; an additional attempt reported: ${firstError}` : "."}`
        : firstError || `No strict exact ${params.lane} results passed after ${attempts.length} query attempt${attempts.length === 1 ? "" : "s"}.`,
''',
        "exact-provider no-match message",
    )

    PROVIDER.write_text(text)
    print("Applied deterministic SerpApi no-results and provider-status handling.")


if __name__ == "__main__":
    main()
