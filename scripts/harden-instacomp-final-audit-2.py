from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def patch_benchmark() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()
    helper_marker = '''export function benchmarkTitleEligible(
'''
    helper = '''function benchmarkTitleHasExpectedPlayer(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const text = normalized(title);
  return [testCase.expected.player, ...(testCase.expected.playerAliases || [])]
    .map(normalized)
    .filter(Boolean)
    .some((player) => text.includes(player));
}

function benchmarkTitleHasExpectedBrand(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const brand = normalized(testCase.expected.brand);
  return Boolean(brand) && normalized(title).includes(brand);
}

function benchmarkTitleHasExpectedSet(
  title: string,
  testCase: InstaCompEbayBenchmarkCase,
) {
  const titleTokens = new Set(benchmarkTitleTokens(title));
  const ignored = new Set([
    "upper", "deck", "series", "hockey", "base", "card", "cards", "trading",
    "the", "set", "parallel", "2022", "2023", "2024", "2025", "2026",
  ]);
  return [testCase.expected.setName, ...(testCase.expected.setAliases || [])]
    .map((value) => benchmarkTitleTokens(value).filter((token) => !ignored.has(token)))
    .filter((tokens) => tokens.length > 0)
    .some((tokens) => tokens.every((token) => titleTokens.has(token)));
}

'''
    if helper not in text:
        if helper_marker not in text:
            raise SystemExit("Could not locate benchmark identity helper marker")
        text = text.replace(helper_marker, helper + helper_marker, 1)

    old = '''  return (
    !rejectedTitle(title) &&
    benchmarkTitleHasExpectedYear(title, testCase) &&
    titleHasExactCardNumber(title, testCase.expected.cardNumber) &&
    benchmarkTitleHasExpectedParallel(title, testCase) &&
    benchmarkTitleHasExpectedSerialRun(title, testCase)
  );
'''
    new = '''  return (
    !rejectedTitle(title) &&
    benchmarkTitleHasExpectedPlayer(title, testCase) &&
    benchmarkTitleHasExpectedYear(title, testCase) &&
    benchmarkTitleHasExpectedBrand(title, testCase) &&
    benchmarkTitleHasExpectedSet(title, testCase) &&
    titleHasExactCardNumber(title, testCase.expected.cardNumber) &&
    benchmarkTitleHasExpectedParallel(title, testCase) &&
    benchmarkTitleHasExpectedSerialRun(title, testCase)
  );
'''
    text = replace_once(text, old, new, "benchmark complete identity gate")
    path.write_text(text)


def patch_regressions() -> None:
    path = Path("scripts/run-instacomp-final-audit-regressions.ts")
    text = path.read_text()
    marker = '''assert.equal(benchmarkTitleEligible(`${exactBaseTitle} Outburst`, baseCase!), false);
'''
    additions = '''assert.equal(
  benchmarkTitleEligible(exactBaseTitle.replace("Lane Hutson", "Cole Caufield"), baseCase!),
  false,
  "benchmark source must reject the wrong player",
);
assert.equal(
  benchmarkTitleEligible(exactBaseTitle.replace("Upper Deck", "Topps"), baseCase!),
  false,
  "benchmark source must reject the wrong manufacturer",
);
assert.equal(
  benchmarkTitleEligible(exactBaseTitle.replace("Young Guns", "Dazzlers"), baseCase!),
  false,
  "benchmark source must reject the wrong insert or set",
);
'''
    if additions not in text:
        if marker not in text:
            raise SystemExit("Could not locate final benchmark regression marker")
        text = text.replace(marker, marker + additions, 1)
    path.write_text(text)


def main() -> None:
    patch_benchmark()
    patch_regressions()


if __name__ == "__main__":
    main()
