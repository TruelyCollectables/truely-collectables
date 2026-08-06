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
  "Upper Deck clear-stock back-logo cue",
  "Outliers",
  "Future Watch",
  "Spectrum FX",
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

function collectorInsertLabel(value: string) {
  return titleCaseWords(value)
    .replace(/\bUd\b/g, "UD")
    .replace(/\bOpc\b/g, "OPC")
    .replace(/\bFx\b/g, "FX");
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

  if (
    /\bupper\s+deck\b/i.test(text) &&
    /\b(?:transparent|translucent|acetate|clear[-\s]*stock|clear\s*\/\s*ghosted)\b/i.test(text) &&
    /\b(?:centered\s+(?:team\s+)?logo|ghosted\s+back\s+logo|back\s+logo|team\s+logo|player[-\s]*name\s+treatment|clear\s+back)\b/i.test(text)
  ) {
    return {
      label: "Clear Cut",
      setName: "Clear Cut",
      reason: "Upper Deck clear-stock back-logo cue indicates Clear Cut",
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

  const priorityNamedInsert = firstMatch(text, [
    /\b(spectrum\s+fx|outliers)\b/i,
  ]);

  if (priorityNamedInsert?.[1]) {
    const label = collectorInsertLabel(priorityNamedInsert[1]);

    return {
      label,
      setName: label,
      reason: `printed text indicates insert/subset ${label}`,
      confidence: "exact",
    };
  }

  const namedInsert = firstMatch(text, [
    /\b(ud\s+canvas|canvas|dazzlers|young\s+guns|rookie\s+materials|honor\s+roll|rookie\s+class|star\s+rookies|portraits|debut\s+dates|opc\s+glossy|clear\s+cut|marquee\s+rookies|spectrum\s+fx|outliers|future\s+watch)\b/i,
  ]);

  if (namedInsert?.[1]) {
    const label = collectorInsertLabel(namedInsert[1]);

    return {
      label,
      setName: label,
      reason: `printed text indicates insert/subset ${label}`,
      confidence: "exact",
    };
  }

  if (
    /\binsert\s+(?:card|cards|set|subset)\b/i.test(text) ||
    /\bspecial\s+insert\b/i.test(text) ||
    /\bfrom\s+this\s+subset\b/i.test(text) ||
    /\bsubset\s+(?:card|cards|set)\b/i.test(text)
  ) {
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

function normalizePrizmSurfaceParallel(
  ai: InstaCompAiResult,
  evidenceText: string,
): InstaCompAiResult {
  const parallel = cleanSignalText(ai.parallel);
  if (!parallel) return ai;

  const context = cleanSignalText(
    [parallel, ai.setName, ai.brand, ai.notes, evidenceText]
      .filter(Boolean)
      .join(" "),
  );
  if (!/\bprizm\b/i.test(context)) return ai;

  const explicitVelocity = /\bvelocity\b/i.test(context);
  const directionalVelocity = /\b(?:dense|repeating|directional|angled)?\s*(?:diagonal|chevron|speed[- ]?line|criss[- ]?cross|cross[- ]?hatch)(?:\s+(?:line|lines|slash|slashes|streak|streaks|pattern))?\b/i.test(
    context,
  );
  const strongCrackedIce = /\b(?:irregular\s+polygon|polygonal|shattered[- ]?(?:ice|glass)|broken[- ]?glass|ice[- ]?shard|faceted[- ]?(?:ice|crystal))\b/i.test(
    context,
  );
  const weakCrackedIce = /\bcracked[- ]?ice\b/i.test(context);
  const color = /\bblue\b/i.test(context) ? "Blue " : "";

  if (
    (explicitVelocity || directionalVelocity) &&
    !strongCrackedIce &&
    /cracked[- ]?ice|\bblue\s+prizm\b|\bvelocity\b/i.test(parallel)
  ) {
    const corrected = `${color}Velocity Prizm`;
    if (parallel.toLowerCase() === corrected.toLowerCase()) return ai;
    return {
      ...ai,
      parallel: corrected,
      notes: appendNote(
        ai.notes,
        `Prizm surface firewall corrected "${parallel}" to "${corrected}" because the evidence shows directional velocity lines rather than irregular shattered-ice facets.`,
      ),
    };
  }

  if (
    (strongCrackedIce || (weakCrackedIce && !directionalVelocity)) &&
    !explicitVelocity &&
    /velocity|\bblue\s+prizm\b/i.test(parallel)
  ) {
    const corrected = `${color}Cracked Ice Prizm`;
    if (parallel.toLowerCase() === corrected.toLowerCase()) return ai;
    return {
      ...ai,
      parallel: corrected,
      notes: appendNote(
        ai.notes,
        `Prizm surface firewall corrected "${parallel}" to "${corrected}" because the evidence shows irregular shattered-ice facets.`,
      ),
    };
  }

  return ai;
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
      ai.setName,
      ai.brand,
      ai.notes,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const surfaceGuardedAi = normalizePrizmSurfaceParallel(ai, combinedEvidence);
  const signal = detectPrintedVariantSignal(combinedEvidence);
  const currentParallel = surfaceGuardedAi.parallel || null;

  if (!signal && currentParallel && /uncertain|unknown|unsure|ambiguous|exact type uncertain/i.test(currentParallel)) {
    return {
      ...surfaceGuardedAi,
      parallel: null,
      notes: appendNote(
        surfaceGuardedAi.notes,
        `Identity guardrail suppressed uncertain parallel label "${currentParallel}" because OCR/printed evidence did not confirm it.`,
      ),
    };
  }

  if (!signal && currentParallel && isBaseParallel(currentParallel)) {
    return {
      ...surfaceGuardedAi,
      parallel: null,
      notes: appendNote(
        surfaceGuardedAi.notes,
        "Identity guardrail suppressed generic Base parallel label; base cards stay unlabelled unless the printed card name requires it.",
      ),
    };
  }

  if (!signal) return surfaceGuardedAi;

  const shouldOverrideBase = isBaseParallel(currentParallel);
  const shouldPreserveSpecificParallel =
    currentParallel &&
    !isBaseParallel(currentParallel) &&
    !/uncertain|unknown|insert/i.test(currentParallel);

  if (shouldPreserveSpecificParallel) {
    return {
      ...surfaceGuardedAi,
      notes: appendNote(
        surfaceGuardedAi.notes,
        `Identity guardrail checked printed variant signal (${signal.reason}) and preserved AI parallel "${currentParallel}".`,
      ),
    };
  }

  const guardedParallel = signal.label;
  const guardedSetName =
    signal.setName && (!surfaceGuardedAi.setName || isBaseParallel(surfaceGuardedAi.setName))
      ? signal.setName
      : surfaceGuardedAi.setName;
  const loweredConfidence =
    signal.confidence === "review"
      ? Math.min(surfaceGuardedAi.confidence || 0, 0.84)
      : surfaceGuardedAi.confidence;

  return {
    ...surfaceGuardedAi,
    setName: guardedSetName,
    parallel: guardedParallel,
    confidence: loweredConfidence,
    notes: appendNote(
      surfaceGuardedAi.notes,
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
