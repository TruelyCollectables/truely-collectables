from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def main() -> None:
    path = Path("src/lib/instacomp.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function stripSeasonRanges(value: string) {
  return String(value || "").replace(
    /\\b(?:19|20)\\d{2}\\s*[-/]\\s*\\d{2,4}\\b/g,
    " ",
  );
}
''',
        '''function stripSeasonRanges(value: string) {
  return String(value || "").replace(
    /\\b(?:19|20)\\d{2}\\s*[-/]\\s*\\d{2,4}\\b/g,
    " ",
  );
}

function canonicalSeason(value: string | null | undefined) {
  const normalized = normalizeText(value);
  const match = normalized.match(
    /\\b((?:19|20)\\d{2})\\s*[-/]\\s*(\\d{2,4})\\b/,
  );
  if (!match) return normalized;
  const start = match[1];
  const rawEnd = match[2];
  const end = rawEnd.length === 2 ? `${start.slice(0, 2)}${rawEnd}` : rawEnd;
  return `${start}-${end}`;
}

function titleHasYear(title: string, value: string | null | undefined) {
  const target = canonicalSeason(value);
  if (!target) return false;
  if (/^(?:19|20)\\d{2}$/.test(target)) {
    return new RegExp(`(?:^|[^0-9])${target}(?:$|[^0-9])`).test(
      normalizeText(title),
    );
  }
  return canonicalSeason(title) === target;
}
''',
        "canonical season helpers",
    )

    text = replace_once(
        text,
        '''  const year = normalizeText(ai.year);
''',
        '''  const year = canonicalSeason(ai.year);
''',
        "canonical target year",
    )

    text = replace_once(
        text,
        '''  if (year && t.includes(year)) {
''',
        '''  if (year && titleHasYear(title, ai.year)) {
''',
        "canonical title year match",
    )

    path.write_text(text)


if __name__ == "__main__":
    main()
