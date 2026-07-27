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
        '''import type { InstaCompAiResult } from "./instacomp";
''',
        '''import type { InstaCompAiResult } from "./instacomp";
import { INSTACOMP_EBAY_BENCHMARK_CASES } from "./instacomp-ebay-benchmark-cases";
''',
        "official checklist seed import",
    )

    text = replace_once(
        text,
        '''];

function cleanText(value: string | null | undefined) {
''',
        '''  ...INSTACOMP_EBAY_BENCHMARK_CASES.map((testCase) => ({
    catalogId: `tcos-official-${testCase.id}`,
    sourceUrl: testCase.catalogSourceUrl,
    player: testCase.expected.player,
    year: testCase.expected.year,
    brand: testCase.expected.brand,
    setName: testCase.expected.setName,
    cardNumber: testCase.expected.cardNumber,
    parallel: testCase.expected.parallel || "Base",
    variation: testCase.expected.parallel || "Base",
    serialRun: testCase.expected.serialDenominator
      ? `/${testCase.expected.serialDenominator}`
      : null,
    team: testCase.expected.team,
    sport: testCase.expected.sport,
    isAuto: testCase.expected.isAuto,
    isRelic: testCase.expected.isRelic,
  })),
];

function cleanText(value: string | null | undefined) {
''',
        "official checklist seed rows",
    )

    old = '''  const cardNumber = comparableCardNumber(input.cardNumber);
  const candidateCardNumber = comparableCardNumber(candidate.cardNumber);
  const year = comparableText(input.year);
  const candidateYear = comparableText(candidate.year);
  const player = comparableText(input.player);
  const candidatePlayer = comparableText(candidate.player);
  const parallel = comparableText(input.parallel || input.variation);
  const candidateParallel = comparableText(candidate.parallel || candidate.variation);
  const evidence = comparableText(evidenceText);

  const cardNumberMatches =
    cardNumber &&
    candidateCardNumber &&
    (cardNumber === candidateCardNumber ||
      evidence.includes(candidateCardNumber) ||
      evidence.includes(candidate.cardNumber?.toLowerCase() || ""));
  const yearMatches = !year || !candidateYear || year === candidateYear;
  const playerMatches = !player || !candidatePlayer || player === candidatePlayer;
  const printedCueMatches =
    parallel &&
    candidateParallel &&
    (parallel === candidateParallel ||
      candidateParallel.includes(parallel) ||
      parallel.includes(candidateParallel));

  return Boolean(cardNumberMatches && yearMatches && (playerMatches || printedCueMatches));
'''
    new = '''  const cardNumber = comparableCardNumber(input.cardNumber);
  const candidateCardNumber = comparableCardNumber(candidate.cardNumber);
  const year = comparableText(input.year);
  const candidateYear = comparableText(candidate.year);
  const brand = comparableText(input.brand);
  const candidateBrand = comparableText(candidate.brand);
  const setName = comparableText(input.setName);
  const candidateSetName = comparableText(candidate.setName);
  const player = comparableText(input.player);
  const candidatePlayer = comparableText(candidate.player);
  const parallel = comparableText(input.parallel || input.variation);
  const candidateParallel = comparableText(candidate.parallel || candidate.variation);
  const serialRun = comparableText(input.serialRun);
  const candidateSerialRun = comparableText(candidate.serialRun);

  const cardNumberMatches =
    Boolean(cardNumber) &&
    Boolean(candidateCardNumber) &&
    cardNumber === candidateCardNumber;
  const yearMatches = Boolean(year) && Boolean(candidateYear) && year === candidateYear;
  const brandMatches = Boolean(brand) && Boolean(candidateBrand) && brand === candidateBrand;
  const setMatches =
    Boolean(setName) &&
    Boolean(candidateSetName) &&
    (setName === candidateSetName ||
      setName.includes(candidateSetName) ||
      candidateSetName.includes(setName));
  const playerMatches =
    Boolean(player) &&
    Boolean(candidatePlayer) &&
    (player === candidatePlayer ||
      player.replace(/\\band\\b/g, " ") === candidatePlayer.replace(/\\band\\b/g, " "));
  const parallelMatches =
    !parallel ||
    !candidateParallel ||
    isGenericBase(parallel) ||
    isGenericBase(candidateParallel) ||
    parallel === candidateParallel ||
    candidateParallel.includes(parallel) ||
    parallel.includes(candidateParallel);
  const serialMatches =
    !candidateSerialRun || Boolean(serialRun && serialRun === candidateSerialRun);

  return Boolean(
    cardNumberMatches &&
      yearMatches &&
      brandMatches &&
      setMatches &&
      playerMatches &&
      parallelMatches &&
      serialMatches,
  );
'''
    text = replace_once(text, old, new, "strict catalog identity gate")
    path.write_text(text)


if __name__ == "__main__":
    main()
