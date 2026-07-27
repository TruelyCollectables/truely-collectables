from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def main() -> None:
    path = Path("src/lib/instacomp-curated-checklist.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''export function buildInstaCompCuratedChecklistEvidence(params: {
''',
        r'''function officialBenchmarkCatalogCandidate(
  input: InstaCompCatalogIdentityInput,
): InstaCompCatalogCandidateIdentity | null {
  const playerKey = normalizedPlayerKey(input.player);
  const yearStart = catalogYearStart(input.year);
  const brand = comparableText(input.brand);
  const cardNumber = comparableCardNumber(input.cardNumber);
  const evidenceTokens = new Set(
    catalogTokens([input.setName, input.parallel, input.variation].filter(Boolean).join(" ")),
  );
  const parallelEvidenceTokens = new Set(
    catalogTokens([input.parallel, input.variation].filter(Boolean).join(" ")),
  );
  const genericTokens = new Set([
    "base",
    "card",
    "parallel",
    "variation",
    "prizm",
    "refractor",
    "holo",
    "the",
  ]);

  const matches = INSTACOMP_EBAY_BENCHMARK_CASES.filter((testCase) => {
    const expected = testCase.expected;
    if (comparableCardNumber(expected.cardNumber) !== cardNumber) return false;
    if (normalizedPlayerKey(expected.player) !== playerKey) return false;
    if (catalogYearStart(expected.year) !== yearStart) return false;
    if (comparableText(expected.brand) !== brand) return false;

    const setOptions = [expected.setName, ...(expected.setAliases || [])];
    const matchingSet = setOptions.find((setName) => {
      const tokens = catalogTokens(setName).filter(
        (token) =>
          ![
            "upper",
            "deck",
            "series",
            "hockey",
            "parallel",
            "the",
          ].includes(token) && !/^\d+$/.test(token),
      );
      return tokens.length > 0 && tokens.every((token) => evidenceTokens.has(token));
    });
    if (!matchingSet) return false;

    const expectedParallel = comparableText(expected.parallel);
    const baseLike = !expectedParallel || isGenericBase(expectedParallel);
    const setTokens = new Set(setOptions.flatMap((setName) => catalogTokens(setName)));
    if (baseLike) {
      const unexpectedParallelTokens = catalogTokens(input.parallel || input.variation).filter(
        (token) => !genericTokens.has(token) && !setTokens.has(token),
      );
      return unexpectedParallelTokens.length === 0;
    }

    return [expected.parallel, ...(expected.parallelAliases || [])]
      .map((parallel) =>
        catalogTokens(parallel).filter((token) => !genericTokens.has(token)),
      )
      .filter((tokens) => tokens.length > 0)
      .some((tokens) => tokens.every((token) => parallelEvidenceTokens.has(token)));
  });

  if (matches.length !== 1) return null;
  return (
    TCOS_CURATED_CHECKLIST_CANDIDATES.find(
      (candidate) => candidate.catalogId === `tcos-official-${matches[0].id}`,
    ) || null
  );
}

export function buildInstaCompCuratedChecklistEvidence(params: {
''',
        "official catalog resolver",
    )

    text = replace_once(
        text,
        '''  const candidates = TCOS_CURATED_CHECKLIST_CANDIDATES.filter((candidate) =>
    candidateIsPlausible(input, candidate),
  );
''',
        '''  const officialCandidate = officialBenchmarkCatalogCandidate(input);
  const candidates = officialCandidate
    ? [officialCandidate]
    : TCOS_CURATED_CHECKLIST_CANDIDATES.filter((candidate) =>
        candidateIsPlausible(input, candidate),
      );
''',
        "official catalog candidate selection",
    )

    path.write_text(text)


if __name__ == "__main__":
    main()
