from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def main() -> None:
    path = Path("scripts/run-instacomp-ebay-25-benchmark.mjs")
    text = path.read_text()

    text = replace_once(
        text,
        '''  const exactSoldSupported = completed.filter(
    (result) => Number(result.scan?.exactMarket?.soldCount || 0) > 0,
  ).length;
  const trustedPrices = completed.filter((result) =>
    Number.isFinite(Number(result.scan?.exactMarket?.trustedSuggestedPrice)),
  ).length;
''',
        '''  const exactSoldSupported = completed.filter(
    (result) =>
      Number(
        result.scan?.exactMarket?.pricingEligibleSoldCount ??
          result.scan?.exactMarket?.soldCount ??
          0,
      ) > 0,
  ).length;
  const trustedPrices = completed.filter((result) => {
    const price = Number(result.scan?.exactMarket?.trustedSuggestedPrice);
    const soldCount = Number(
      result.scan?.exactMarket?.pricingEligibleSoldCount ??
        result.scan?.exactMarket?.soldCount ??
        0,
    );
    return Number.isFinite(price) && price > 0 && soldCount > 0;
  }).length;
  const cleanupFailures = completed.filter(
    (result) => result.cleanup?.status === "error",
  ).length;
''',
        "trusted-price summary",
    )

    text = replace_once(
        text,
        '''      providerErrorCards: providerErrors,
      weakOrMislabeledSellerTitles: sellerTitleWeak,
''',
        '''      providerErrorCards: providerErrors,
      cleanupFailures,
      weakOrMislabeledSellerTitles: sellerTitleWeak,
''',
        "cleanup summary field",
    )

    text = replace_once(
        text,
        '''    `- Exact-market provider errors: **${s.providerErrorCards}**`,
    `- Weak or mislabeled seller titles: **${s.weakOrMislabeledSellerTitles}**`,
''',
        '''    `- Exact-market provider errors: **${s.providerErrorCards}**`,
    `- Benchmark scan cleanup failures: **${s.cleanupFailures}**`,
    `- Weak or mislabeled seller titles: **${s.weakOrMislabeledSellerTitles}**`,
''',
        "cleanup markdown field",
    )

    text = text.replace(
        "verified front/back image pair.",
        "verified front/back image pair using the highest available eBay image resolution.",
    )

    path.write_text(text)


if __name__ == "__main__":
    main()
