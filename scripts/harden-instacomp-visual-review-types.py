from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def main() -> None:
    path = Path("src/app/api/instacomp/live-scan/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function providerAfterVisualReview(params: {
  provider: InstaCompProviderResult;
  accepted: InstaCompProviderResult["results"];
  rejectedCount: number;
}) {
  return {
    ...params.provider,
    status: params.accepted.length ? "live" : "no_matches",
    message: params.accepted.length
      ? `${params.accepted.length} candidate image${params.accepted.length === 1 ? "" : "s"} passed exact-card visual proof.`
      : `${params.rejectedCount} title candidate${params.rejectedCount === 1 ? " was" : "s were"} rejected or inconclusive after image proof.`,
    results: params.accepted,
  } satisfies InstaCompProviderResult;
}
''',
        '''function normalizedVisualSourceCategory(
  value: string,
): InstaCompProviderResult["results"][number]["sourceCategory"] {
  if (value === "sold") return "sold";
  if (value === "marketplace") return "marketplace";
  if (value === "auction") return "auction";
  if (value === "pricing") return "pricing";
  if (value === "broad") return "broad";
  return "reference";
}

function providerAfterVisualReview(params: {
  provider: InstaCompProviderResult;
  accepted: Awaited<ReturnType<typeof verifyInstaCompCompetitionImages>>["accepted"];
  rejectedCount: number;
}) {
  return {
    ...params.provider,
    status: params.accepted.length ? "live" : "no_matches",
    message: params.accepted.length
      ? `${params.accepted.length} candidate image${params.accepted.length === 1 ? "" : "s"} passed exact-card visual proof.`
      : `${params.rejectedCount} title candidate${params.rejectedCount === 1 ? " was" : "s were"} rejected or inconclusive after image proof.`,
    results: params.accepted.map((row) => ({
      ...row,
      sourceCategory: normalizedVisualSourceCategory(row.sourceCategory),
      matchScore: row.matchScore ?? 0,
    })),
  } satisfies InstaCompProviderResult;
}
''',
        "visual-review provider normalization",
    )

    path.write_text(text)


if __name__ == "__main__":
    main()
