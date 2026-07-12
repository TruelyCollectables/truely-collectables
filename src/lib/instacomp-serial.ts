export function serialRunDisplayLabel(value: string | null | undefined) {
  const match = String(value || "").match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);

  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }

  if (numerator === 1 && denominator === 1) return "1/1";

  return `/${denominator}`;
}
