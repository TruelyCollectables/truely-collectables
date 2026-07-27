from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def main() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function imageUrls(item: EbayItemSummary) {
  return Array.from(
    new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((image) => image?.imageUrl)]
        .map(clean)
        .filter((url) => /^https?:\/\//i.test(url)),
    ),
  );
}
''',
        '''function fullResolutionEbayImageUrl(value: unknown) {
  const url = clean(value);
  if (!/^https?:\/\//i.test(url)) return "";
  return url.replace(/\/s-l\d+(?=\.(?:jpe?g|png|webp)(?:\?|$))/i, "/s-l1600");
}

function imageUrls(item: EbayItemSummary) {
  return Array.from(
    new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((image) => image?.imageUrl)]
        .map(fullResolutionEbayImageUrl)
        .filter(Boolean),
    ),
  );
}
''',
        "full-resolution eBay images",
    )

    text = replace_once(
        text,
        '''function titleScore(title: string, expected: InstaCompEbayBenchmarkExpectedIdentity) {
''',
        '''function titleConflictsWithExpectedParallel(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const expectedParallel = normalized(testCase.expected.parallel);
  if (expectedParallel && expectedParallel !== "base") return false;

  const titleText = normalized(title);
  const conflictingParallels = new Set<string>();
  for (const candidate of INSTACOMP_EBAY_BENCHMARK_CASES) {
    if (normalized(candidate.expected.setName) !== normalized(testCase.expected.setName)) continue;
    const names = [candidate.expected.parallel, ...(candidate.expected.parallelAliases || [])]
      .map(normalized)
      .filter((value) => value && value !== "base");
    for (const name of names) conflictingParallels.add(name);
  }
  return Array.from(conflictingParallels).some((parallel) =>
    parallel.split(" ").every((token) => titleText.includes(token)),
  );
}

function titleScore(title: string, expected: InstaCompEbayBenchmarkExpectedIdentity) {
''',
        "parallel-conflict helper",
    )

    text = replace_once(
        text,
        '''    .filter(({ item, title, score }) => item.itemId && title && !rejectedTitle(title) && score >= 65)
''',
        '''    .filter(
      ({ item, title, score }) =>
        item.itemId &&
        title &&
        !rejectedTitle(title) &&
        !titleConflictsWithExpectedParallel(title, testCase) &&
        score >= 65,
    )
''',
        "parallel-conflict source filter",
    )

    path.write_text(text)


if __name__ == "__main__":
    main()
