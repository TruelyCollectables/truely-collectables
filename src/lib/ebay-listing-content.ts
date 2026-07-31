const ACTIVE_CONTENT_PATTERNS: Array<[RegExp, string]> = [
  [/<\s*script\b/i, "script tags"],
  [/<\s*(?:iframe|object|embed|form|input|button|meta|link|base)\b/i, "active HTML elements"],
  [/\bon[a-z]+\s*=/i, "inline event handlers"],
  [/javascript\s*:/i, "javascript URLs"],
  [/data\s*:\s*text\/html/i, "HTML data URLs"],
];

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
}

export function ebayListingContentProblems(value: string) {
  const problems: string[] = [];

  for (const [pattern, label] of ACTIVE_CONTENT_PATTERNS) {
    if (pattern.test(value)) problems.push(`eBay description contains prohibited ${label}`);
  }

  return problems;
}

export function assertSafeEbayListingContent(value: string) {
  const problems = ebayListingContentProblems(value);
  if (problems.length) throw new Error(problems.join("; "));
}

export function plainTextFromEbayHtml(value: string, maximum = 4_000) {
  const withoutHiddenContent = value
    .replace(/<\s*(?:script|style)[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeBasicEntities(withoutHiddenContent)
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
}

export function normalizeEbayAspects(value: Record<string, string[]>) {
  const output: Record<string, string[]> = {};

  for (const [rawName, rawValues] of Object.entries(value || {})) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    if (name.length > 40) {
      throw new Error(`eBay item-specific name is over 40 characters: ${name}`);
    }

    const values = Array.from(
      new Set(
        (Array.isArray(rawValues) ? rawValues : [])
          .map((entry) => String(entry || "").trim())
          .filter(Boolean),
      ),
    );

    for (const entry of values) {
      if (entry.length > 50) {
        throw new Error(`eBay item-specific value is over 50 characters: ${name}`);
      }
    }

    if (values.length) output[name] = values;
  }

  return output;
}

export function validatedHttpsImageUrls(values: string[], maximum = 24) {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of values || []) {
    const value = String(rawValue || "").trim();
    if (!value || seen.has(value)) continue;

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("eBay images must use valid public HTTPS URLs.");
    }

    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error("eBay images must use valid public HTTPS URLs.");
    }

    seen.add(value);
    output.push(value);
    if (output.length >= maximum) break;
  }

  return output;
}
