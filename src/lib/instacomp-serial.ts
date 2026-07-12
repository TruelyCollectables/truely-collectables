export type InstaCompSerialNumber = {
  exact: string;
  numerator: number;
  denominator: number;
};

export function extractInstaCompSerialNumber(
  value: string | null | undefined
): InstaCompSerialNumber | null {
  const normalized = String(value || "")
    .replace(/[|｜]/g, "/")
    .replace(/\bone\s+of\s+one\b/gi, "1/1")
    .replace(/\b1\s+of\s+1\b/gi, "1/1");
  const candidates = normalized.matchAll(
    /\b([0-9O]{1,6})\s*(?:\/|of)\s*([0-9O]{1,6})\b/gi
  );

  for (const candidate of candidates) {
    const numeratorText = candidate[1].replace(/O/gi, "0");
    const denominatorText = candidate[2].replace(/O/gi, "0");
    const numerator = Number(numeratorText);
    const denominator = Number(denominatorText);

    if (
      !Number.isSafeInteger(numerator) ||
      !Number.isSafeInteger(denominator) ||
      numerator < 1 ||
      denominator < 1 ||
      numerator > denominator
    ) {
      continue;
    }

    return {
      exact: `${numeratorText}/${denominatorText}`,
      numerator,
      denominator,
    };
  }

  return null;
}

export function serialRunDisplayLabel(value: string | null | undefined) {
  const serial = extractInstaCompSerialNumber(value);
  if (!serial) return null;

  if (serial.numerator === 1 && serial.denominator === 1) return "1/1";

  return `/${serial.denominator}`;
}
