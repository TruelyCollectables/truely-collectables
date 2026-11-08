export function normalizeInstaCompListingSerial(
  value: string | null | undefined,
): string | null {
  const text = String(value || "")
    .trim()
    .replace(/[|｜]/g, "/")
    .replace(/\s+/g, " ");

  if (!text) return null;

  const numbered = text.match(/(?:#\s*)?(\d+)\s*(?:\/|\bof\b)\s*(\d+)/i);

  if (numbered) {
    const printRun = Number.parseInt(numbered[2], 10);
    return Number.isFinite(printRun) && printRun > 0 ? `/${printRun}` : null;
  }

  const denominatorOnly = text.match(/^\/\s*(\d+)$/);

  if (denominatorOnly) {
    const printRun = Number.parseInt(denominatorOnly[1], 10);
    return Number.isFinite(printRun) && printRun > 0 ? `/${printRun}` : null;
  }

  return null;
}

export function instaCompListingSerialSuffix(
  value: string | null | undefined,
): string {
  return normalizeInstaCompListingSerial(value) || "";
}
