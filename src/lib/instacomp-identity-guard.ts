import type { InstaCompAiResult } from "./instacomp";

type VariantSignal = {
  label: string;
  reason: string;
  confidence: "exact" | "review";
  setName?: string;
};

const baseParallelPattern = /^\s*(base|base card|standard|regular)\s*$/i;
const printedVariantGuardrailExamples = [
  "Limited Red",
  "Clear Cut",
  "Insert - exact type uncertain",
  "Acetate / clear parallel - exact type uncertain",
];

function cleanSignalText(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|｜]/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseWords(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isBaseParallel(value: string | null | undefined) {
  return !value || baseParallelPattern.test(value);
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }

  return null;
}

function detectPrintedVariantSignal(text: string): VariantSignal | null {
  const limitedColor = firstMatch(text, [
    /\b(?:limited\s+edition\s+)?(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\s+limited\b/i,
    /\blimited\s+(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\b/i,
  ]);

  if (limitedColor?.[1]) {
    const color = titleCaseWords(limitedColor[1]);

    return {
      label: `Limited ${color}`,
      reason: `printed text indicates Limited ${color}`,
      confidence: "exact",
    };
  }

  const colorParallel = firstMatch(text, [
    /\b(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\s+(parallel|foil|refractor|prizm|holo|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic)\b/i,
    /\b(parallel|foil|refractor|prizm|holo|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic)\s+(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\b/i,
  ]);

  if (colorParallel?.[1] && colorParallel?.[2]) {
    const first = titleCaseWords(colorParallel[1]);
    const second = titleCaseWords(colorParallel[2]);
    const label =
      /parallel|foil|refractor|prizm|holo|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic/i.test(
        colorParallel[1],
      )
        ? `${second} ${first}`
        : `${first} ${second}`;

    return {
      label,
      reason: `printed text indicates ${label}`,
      confidence: "exact",
    };
  }

  if (/\bupper\s+deck\s+clear\s+cut\b/i.test(text) || /\bclear\s+cut\b/i.test(text)) {
    return {
      label: "Clear Cut",
      setName: "Clear Cut",
      reason: "printed text indicates Upper Deck Clear Cut / Clear Cut",
      confidence: "exact",
    };
  }

  if (/\bacetate\b/i.test(text)) {
    return {
      label: "Acetate / clear parallel - exact type uncertain",
      reason: "printed text or OCR indicates acetate/clear stock",
      confidence: "review",
    };
  }

  const namedInsert = firstMatch(text, [
    /\b(ud\s+canvas|canvas|dazzlers|young\s+guns|rookie\s+materials|honor\s+roll|rookie\s+class|star\s+rookies|portraits|debut\s+dates|opc\s+glossy|clear\s+cut|marquee\s+rookies)\b/i,
  ]);

  if (namedInsert?.[1]) {
    const label = titleCaseWords(namedInsert[1].replace(/\bud\b/i, "UD"));

    return {
      label,
      setName: label,
      reason: `printed text indicates insert/subset ${label}`,
      confidence: "exact",
    };
  }

  if (/\binsert\b/i.test(text) || /\bsubset\b/i.test(text)) {
    return {
      label: "Insert - exact type uncertain",
      reason: "printed text indicates an insert/subset but exact insert name needs review",
      confidence: "review",
    };
  }

  return null;
}

function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}

export function applyInstaCompIdentityGuard(
  ai: InstaCompAiResult,
  context: {
    externalOcrText?: string | null;
  } = {},
): InstaCompAiResult {
  const combinedEvidence = cleanSignalText(
    [
      context.externalOcrText,
      ai.notes,
      ai.parallel,
      ai.setName,
      ai.brand,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const signal = detectPrintedVariantSignal(combinedEvidence);

  if (!signal) return ai;

  const currentParallel = ai.parallel || null;
  const shouldOverrideBase = isBaseParallel(currentParallel);
  const shouldPreserveSpecificParallel =
    currentParallel &&
    !isBaseParallel(currentParallel) &&
    !/uncertain|unknown|insert/i.test(currentParallel);

  if (shouldPreserveSpecificParallel) {
    return {
      ...ai,
      notes: appendNote(
        ai.notes,
        `Identity guardrail checked printed variant signal (${signal.reason}) and preserved AI parallel "${currentParallel}".`,
      ),
    };
  }

  const guardedParallel = signal.label;
  const guardedSetName =
    signal.setName && (!ai.setName || isBaseParallel(ai.setName))
      ? signal.setName
      : ai.setName;
  const loweredConfidence =
    signal.confidence === "review" ? Math.min(ai.confidence || 0, 0.84) : ai.confidence;

  return {
    ...ai,
    setName: guardedSetName,
    parallel: guardedParallel,
    confidence: loweredConfidence,
    notes: appendNote(
      ai.notes,
      `Identity guardrail: ${signal.reason}; replaced ${
        shouldOverrideBase ? "Base/null" : `uncertain value "${currentParallel}"`
      } with "${guardedParallel}".`,
    ),
  };
}

export const instaCompIdentityGuardFixtures = {
  baseParallelPattern,
  printedVariantGuardrailExamples,
};
