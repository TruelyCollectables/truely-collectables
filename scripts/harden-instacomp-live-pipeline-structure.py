from pathlib import Path


def main() -> None:
    path = Path("src/lib/instacomp-live-pipeline.ts")
    text = path.read_text()
    start_marker = "export function dedupeExactMarketEvidence"
    end_marker = "export function missingExactIdentityFields"
    start = text.find(start_marker)
    end = text.find(end_marker)
    if start < 0 or end < 0 or end <= start:
        raise SystemExit("Could not locate generated exact-market dedupe section")

    valid = '''export function dedupeExactMarketEvidence(values: InstaCompComp[], limit = 50) {
  const seen = new Set<string>();
  return values
    .filter((comp) => {
      if (!Number.isFinite(Number(comp.price)) || Number(comp.price) <= 0) return false;
      const key = compKey(comp);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }
      return left.price - right.price;
    })
    .slice(0, limit);
}

export function dedupeExactMarketComps(values: InstaCompComp[], limit = 50) {
  return dedupeExactMarketEvidence(values, limit).filter(hasTrustedDeliveredPrice);
}

'''
    path.write_text(text[:start] + valid + text[end:])


if __name__ == "__main__":
    main()
