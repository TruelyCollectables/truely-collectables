export function sanitizePublicListingTitle(value: unknown) {
  return String(value || "Untitled")
    .replace(/\bZduplicate\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

export function sanitizePublicListingDescription(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^Imported from CollX collection ID \d+\.\s*/i, "")
    .replace(
      /^Imported from active eBay listing snapshot\.\s*Full description\/images pending eBay API refresh\.\s*/i,
      "",
    )
    .replace(/^Imported from eBay listing \d+\.\s*/i, "")
    .replace(/\bZduplicate\b/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}
