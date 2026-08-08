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
    .replace(/\bFx\b/g, "FX")
    .replace(/\bSp\b/g, "SP")
    .replace(/\bNhl\b/g, "NHL")
    .replace(/\bNba\b/g, "NBA")
    .replace(/\bWnba\b/g, "WNBA");
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

function normalizeSeasonToken(value: string) {
  return value.replace(/[–—/]/g, "-").replace(/\s+/g, "").trim();
}

function detectPrintedSeason(text: string) {
  const productSeason = firstMatch(text, [
    /\b((?:19|20)\d{2}(?:[-/]\d{2})?)\s+PANINI\s*-\s*/i,
    /\b((?:19|20)\d{2}(?:[-/]\d{2})?)\s+(?:THE\s+CUP|STATURE|PREMIER|ULTIMATE\s+COLLECTION|SP\s+GAME\s+USED|ARTIFACTS|EXQUISITE(?:\s+COLLECTION)?)\s+HOCKEY\b/i,
    /\b((?:19|20)\d{2})\s+TOPPS\s+(?:DEFINITIVE|CHROME|BOWMAN|ROOKIE|ON\s+DEMAND)/i,
    /[©®&]\s*((?:19|20)\d{2})\s+(?:THE\s+)?TOPPS\s+COMPANY\b/i,
    /\b((?:19|20)\d{2})\s+THE\s+TOPPS\s+COMPANY\b/i,
  ]);
  if (productSeason?.[1]) return normalizeSeasonToken(productSeason[1]);

  const seasonMatches = Array.from(
    text.matchAll(/\b((?:19|20)\d{2}[-/]\d{2})\b/g),
  );
  if (!seasonMatches.length) return null;

  const productTerms = /\b(?:panini|topps|upper\s+deck|udc|bowman|mosaic|noir|obsidian|immaculate|limited|one\s+football|black\s+football|encore|stature|the\s+cup|premier|ultimate|sp\s+game\s+used|artifacts|exquisite|hockey|basketball|football|baseball)\b/i;
  const ranked = seasonMatches
    .map((match) => {
      const index = match.index || 0;
      const context = text.slice(Math.max(0, index - 40), index + match[0].length + 90);
      return {
        value: normalizeSeasonToken(match[1]),
        score: productTerms.test(context) ? 2 : 0,
        index,
      };
    })
    .sort((a, b) => b.score - a.score || b.index - a.index);
  return ranked[0]?.value || null;
}

function normalizeSetProduct(value: string) {
  return collectorInsertLabel(
    value
      .replace(/\s+/g, " ")
      .replace(/\s*[./]+\s*$/g, "")
      .trim(),
  );
}

function detectPrintedSetName(text: string, season: string | null) {
  const paniniMatches = Array.from(
    text.matchAll(/\b((?:19|20)\d{2}(?:[-/]\d{2})?)\s+PANINI\s*-\s*([A-Z0-9][A-Z0-9 &'./-]{1,70}?(?:BASKETBALL|FOOTBALL|BASEBALL))\b/gi),
  )
    .map((match) => ({ season: match[1], product: match[2] }))
    .filter((match) => match.season && match.product)
    .sort((a, b) => a.product.length - b.product.length);
  const panini = paniniMatches[0];
  if (panini) {
    return `${normalizeSeasonToken(panini.season)} Panini ${normalizeSetProduct(panini.product)}`;
  }

  const upperDeck = text.match(
    /\b((?:19|20)\d{2}[-/]\d{2})\s+(THE\s+CUP|STATURE|PREMIER|ULTIMATE\s+COLLECTION|SP\s+GAME\s+USED|ARTIFACTS|EXQUISITE(?:\s+COLLECTION)?)\s+HOCKEY\b/i,
  );
  if (upperDeck?.[1] && upperDeck?.[2]) {
    return `${normalizeSeasonToken(upperDeck[1])} Upper Deck ${normalizeSetProduct(upperDeck[2])} Hockey`;
  }

  const definitive = text.match(
    /\b((?:19|20)\d{2})\s+TOPPS\s+(DEFINITIVE\s+COLLECTION)\s+BASEBALL\b/i,
  );
  if (definitive?.[1] && definitive?.[2]) {
    return `${definitive[1]} Topps ${normalizeSetProduct(definitive[2])} Baseball`;
  }

  if (/\bBOWMAN\s+CHROME\b/i.test(text) && season) {
    return `${season} Bowman Chrome`;
  }

  if (/\bROOKIE\s+PROGRESSION\b/i.test(text) && season) {
    return `${season} Topps Rookie Progression`;
  }

  return null;
}

function looksLikeCardCode(value: string) {
  if (!value || /^\d{4}[-/]\d{2,4}$/.test(value)) return false;
  if (/^\d{1,4}$/.test(value)) return true;
  const normalized = value.toLowerCase();
  if (
    new Set([
      "game-used",
      "player-worn",
      "player-used",
      "upper-deck",
      "all-rights",
      "rookie-auto",
      "auto-patch",
      "draft-day",
      "right-wing",
      "left-wing",
    ]).has(normalized)
  ) return false;
  return /[A-Za-z]/.test(value) && /^[A-Za-z0-9.-]{2,24}$/.test(value);
}

function detectPrintedCardNumber(text: string) {
  const explicitCode = text.match(/\bNO\.\s*([A-Z0-9]{1,6}-[A-Z0-9]{1,10})\b/i)?.[1];
  if (explicitCode && looksLikeCardCode(explicitCode)) return explicitCode;

  const codeMatches = Array.from(
    text.matchAll(/\b([A-Z0-9]{1,6}-[A-Z0-9]{1,10})\b/gi),
  );
  for (const match of codeMatches) {
    const candidate = String(match[1] || "").trim();
    if (looksLikeCardCode(candidate)) return candidate;
  }

  const explicitNumeric = firstMatch(text, [
    /\bNO\.\s*(\d{1,4})\b/i,
    /\bNO\s+(\d{1,4})\b/i,
    /\bCARD\s+(?:NO\.?|#)\s*(\d{1,4})\b/i,
  ])?.[1];
  if (explicitNumeric && looksLikeCardCode(explicitNumeric)) return explicitNumeric;

  const hashMatch = text.match(/(?:^|\s)#\s*(\d{1,4})\b/i)?.[1];
  if (hashMatch && looksLikeCardCode(hashMatch)) return hashMatch;
  return null;
}

function normalizeSportLabel(value: string | null | undefined) {
  const sport = cleanSignalText(value);
  if (/^(?:nfl|football)$/i.test(sport)) return "Football";
  if (/^(?:nhl|ice hockey|hockey)$/i.test(sport)) return "Hockey";
  if (/^(?:mlb|baseball)$/i.test(sport)) return "Baseball";
  if (/^(?:nba|wnba|basketball)$/i.test(sport)) return "Basketball";
  return value || null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}

function applyPrintedIdentityCorrections(
  ai: InstaCompAiResult,
  evidenceText: string,
  semanticEvidenceText = evidenceText,
) {
  const season = detectPrintedSeason(evidenceText);
  const setName = detectPrintedSetName(evidenceText, season);
  const detectedCardNumber = detectPrintedCardNumber(evidenceText);
  const currentCardNumber = cleanSignalText(ai.cardNumber);
  const currentCardVisible = Boolean(
    currentCardNumber &&
      !currentCardNumber.includes("/") &&
      new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(currentCardNumber)}(?:$|[^A-Za-z0-9])`, "i").test(evidenceText),
  );
  const cardNumber = currentCardVisible ? currentCardNumber : detectedCardNumber;
  const printedRookie = /\b(?:ROOKIE|RC)\b/i.test(semanticEvidenceText);
  const printedAuto = /\b(?:AUTOGRAPH(?:ED|S)?|AUTO\s+PATCH|AUTOGRAPH\s+ISSUE|AUTOGRAPH\s+IS\s+GUARANTEED|AUTOGRAPH\s+ARE\s+GUARANTEED|SIGNATURE)\b/i.test(semanticEvidenceText);
  const printedRelic = /\b(?:MEMORABILIA|PLAYER[- ](?:WORN|USED)\s+MATERIAL|AUTHENTIC\s+MEMORABILIA|ENCLOSED\s+OFFICIALLY\s+LICENSED\s+MATERIAL|JERSEY|PATCH|SWATCH)\b/i.test(semanticEvidenceText);

  const changes: string[] = [];
  const next: InstaCompAiResult = {
    ...ai,
    sport: normalizeSportLabel(ai.sport),
  };

  if (season && season !== cleanSignalText(ai.year)) {
    changes.push(`year ${ai.year || "null"} -> ${season}`);
    next.year = season;
  }
  if (setName && setName !== cleanSignalText(ai.setName)) {
    changes.push(`set ${ai.setName || "null"} -> ${setName}`);
    next.setName = setName;
  }
  if (cardNumber && cardNumber.toLowerCase() !== cleanSignalText(ai.cardNumber).toLowerCase()) {
    changes.push(`card number ${ai.cardNumber || "null"} -> ${cardNumber}`);
    next.cardNumber = cardNumber;
  }
  if (printedRookie && ai.isRookie !== true) {
    changes.push("rookie false -> true");
    next.isRookie = true;
  }
  if (printedAuto && ai.isAuto !== true) {
    changes.push("autograph false -> true");
    next.isAuto = true;
  }
  if (printedRelic && ai.isRelic !== true) {
    changes.push("relic false -> true");
    next.isRelic = true;
  }

  if (changes.length) {
    next.notes = appendNote(
      next.notes,
      `Printed identity normalization: ${changes.join("; ")}.`,
    );
  }
  return next;
}

function detectPrintedVariantSignal(text: string): VariantSignal | null {
  const premiumAutoBlue = text.match(/\bPREMIUM\s+AUTO\s+BLUE\b/i);
  if (premiumAutoBlue) {
    return {
      label: "Premium Auto Blue",
      reason: "printed text indicates Premium Auto Blue",
      confidence: "exact",
    };
  }

  const blueAutograph = text.match(/\bBLUE\s+AUTOGRAPHS?\b/i);
  if (blueAutograph) {
    return {
      label: "Blue Autographs",
      reason: "printed text indicates Blue Autographs",
      confidence: "exact",
    };
  }

  const hotSprings = text.match(/\bHOT\s+SPRINGS\b/i);
  if (hotSprings) {
    return {
      label: "Hot Springs",
      reason: "printed text indicates Hot Springs",
      confidence: "exact",
    };
  }

  const limitedColor = firstMatch(text, [
    /\b(?:limited\s+edition\s+)?(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\s+limited\b/i,
    /\blimited\s+(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\b/i,
  ]);
  if (limitedColor?.[1]) {
    const color = titleCaseWords(limitedColor[1]);
    return { label: `Limited ${color}`, reason: `printed text indicates Limited ${color}`, confidence: "exact" };
  }

  const colorParallel = firstMatch(text, [
    /\b(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\s+(parallel|foil|refractor|prizm|holo|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic)\b/i,
    /\b(parallel|foil|refractor|prizm|holo|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic)\s+(red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)\b/i,
  ]);
  if (colorParallel?.[1] && colorParallel?.[2]) {
    const first = titleCaseWords(colorParallel[1]);
    const second = titleCaseWords(colorParallel[2]);
    const label = /parallel|foil|refractor|prizm|holo|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic/i.test(colorParallel[1])
      ? `${second} ${first}`
      : `${first} ${second}`;
    return { label, reason: `printed text indicates ${label}`, confidence: "exact" };
  }

  if (/\bupper\s+deck\s+clear\s+cut\b/i.test(text) || /\bclear\s+cut\b/i.test(text)) {
    return { label: "Clear Cut", setName: "Clear Cut", reason: "printed text indicates Upper Deck Clear Cut / Clear Cut", confidence: "exact" };
  }

  if (/\bupper\s+deck\b/i.test(text) && /\b(?:transparent|translucent|acetate|clear[-\s]*stock|clear\s*\/\s*ghosted)\b/i.test(text) && /\b(?:centered\s+(?:team\s+)?logo|ghosted\s+back\s+logo|back\s+logo|team\s+logo|player[-\s]*name\s+treatment|clear\s+back)\b/i.test(text)) {
    return { label: "Clear Cut", setName: "Clear Cut", reason: "Upper Deck clear-stock back-logo cue indicates Clear Cut", confidence: "exact" };
  }

  if (/\bacetate\b/i.test(text)) {
    return { label: "Acetate / clear parallel - exact type uncertain", reason: "printed text or OCR indicates acetate/clear stock", confidence: "review" };
  }

  const priorityNamedInsert = firstMatch(text, [/\b(spectrum\s+fx|outliers)\b/i]);
  if (priorityNamedInsert?.[1]) {
    const label = collectorInsertLabel(priorityNamedInsert[1]);
    return { label, setName: label, reason: `printed text indicates insert/subset ${label}`, confidence: "exact" };
  }

  const namedInsert = firstMatch(text, [
    /\b(ud\s+canvas|canvas|dazzlers|young\s+guns|rookie\s+materials|honor\s+roll|rookie\s+class|star\s+rookies|portraits|debut\s+dates|opc\s+glossy|clear\s+cut|marquee\s+rookies|spectrum\s+fx|outliers|future\s+watch)\b/i,
  ]);
  if (namedInsert?.[1]) {
    const label = collectorInsertLabel(namedInsert[1]);
    return { label, setName: label, reason: `printed text indicates insert/subset ${label}`, confidence: "exact" };
  }

  if (/\bREFRACTOR\b/i.test(text)) {
    return { label: "Refractor", reason: "printed text indicates Refractor", confidence: "exact" };
  }

  if (/\bPRIZM\b/i.test(text)) {
    return { label: "Prizm", reason: "printed text indicates Prizm", confidence: "exact" };
  }

  if (/\binsert\s+(?:card|cards|set|subset)\b/i.test(text) || /\bspecial\s+insert\b/i.test(text) || /\bfrom\s+this\s+subset\b/i.test(text) || /\bsubset\s+(?:card|cards|set)\b/i.test(text)) {
    return { label: "Insert - exact type uncertain", reason: "printed text indicates an insert/subset but exact insert name needs review", confidence: "review" };
  }
  return null;
}

function comparableSerial(value: string | null | undefined) {
  return cleanSignalText(value).toLowerCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
}

export function applyInstaCompSerialEvidenceGuard(
  ai: InstaCompAiResult,
  confirmedSerialNumbers: Array<string | null | undefined>,
): InstaCompAiResult {
  const candidate = cleanSignalText(ai.serialNumber);
  if (!candidate) return ai;
  const candidateKey = comparableSerial(candidate);
  const corroborated = confirmedSerialNumbers
    .map((value) => cleanSignalText(value))
    .filter(Boolean)
    .some((value) => comparableSerial(value) === candidateKey);
  if (corroborated) return ai;
  return {
    ...ai,
    serialNumber: null,
    notes: appendNote(ai.notes, `Serial evidence guard suppressed uncorroborated serial "${candidate}"; fresh printed evidence did not confirm that exact stamp.`),
  };
}

function normalizePrizmSurfaceParallel(ai: InstaCompAiResult, evidenceText: string): InstaCompAiResult {
  const parallel = cleanSignalText(ai.parallel);
  if (!parallel) return ai;
  const context = cleanSignalText([parallel, ai.setName, ai.brand, ai.notes, evidenceText].filter(Boolean).join(" "));
  if (!/\bprizm\b/i.test(context)) return ai;
  const explicitVelocity = /\bvelocity\b/i.test(context);
  const directionalVelocity = /\b(?:dense|repeating|directional|angled)?\s*(?:diagonal|chevron|speed[- ]?line|criss[- ]?cross|cross[- ]?hatch)(?:\s+(?:line|lines|slash|slashes|streak|streaks|pattern))?\b/i.test(context);
  const strongCrackedIce = /\b(?:irregular\s+polygon|polygonal|shattered[- ]?(?:ice|glass)|broken[- ]?glass|ice[- ]?shard|faceted[- ]?(?:ice|crystal))\b/i.test(context);
  const weakCrackedIce = /\bcracked[- ]?ice\b/i.test(context);
  const color = /\bblue\b/i.test(context) ? "Blue " : "";
  if ((explicitVelocity || directionalVelocity) && !strongCrackedIce && /cracked[- ]?ice|\bblue\s+prizm\b|\bvelocity\b/i.test(parallel)) {
    const corrected = `${color}Velocity Prizm`;
    if (parallel.toLowerCase() === corrected.toLowerCase()) return ai;
    return { ...ai, parallel: corrected, notes: appendNote(ai.notes, `Prizm surface firewall corrected "${parallel}" to "${corrected}" because the evidence shows directional velocity lines rather than irregular shattered-ice facets.`) };
  }
  if ((strongCrackedIce || (weakCrackedIce && !directionalVelocity)) && !explicitVelocity && /velocity|\bblue\s+prizm\b/i.test(parallel)) {
    const corrected = `${color}Cracked Ice Prizm`;
    if (parallel.toLowerCase() === corrected.toLowerCase()) return ai;
    return { ...ai, parallel: corrected, notes: appendNote(ai.notes, `Prizm surface firewall corrected "${parallel}" to "${corrected}" because the evidence shows irregular shattered-ice facets.`) };
  }
  return ai;
}

export function applyInstaCompIdentityGuard(
  ai: InstaCompAiResult,
  context: { externalOcrText?: string | null } = {},
): InstaCompAiResult {
  const receipt = ai as InstaCompAiResult & {
    frontVisibleText?: unknown;
    backVisibleText?: unknown;
    backEvidence?: unknown;
  };
  const receiptText = [
    Array.isArray(receipt.frontVisibleText) ? receipt.frontVisibleText.join(" ") : null,
    Array.isArray(receipt.backVisibleText) ? receipt.backVisibleText.join(" ") : null,
    typeof receipt.backEvidence === "string" ? receipt.backEvidence : null,
  ].filter(Boolean).join(" ");
  const printedEvidence = cleanSignalText([
    context.externalOcrText,
    receiptText,
  ].filter(Boolean).join(" "));
  const combinedEvidence = cleanSignalText([
    printedEvidence,
    ai.setName,
    ai.brand,
    ai.notes,
  ].filter(Boolean).join(" "));
  const printedCorrectedAi = applyPrintedIdentityCorrections(
    ai,
    printedEvidence || combinedEvidence,
    combinedEvidence,
  );
  const surfaceGuardedAi = normalizePrizmSurfaceParallel(printedCorrectedAi, combinedEvidence);
  const signal = detectPrintedVariantSignal(combinedEvidence);
  const currentParallel = surfaceGuardedAi.parallel || null;

  if (!signal && currentParallel && /uncertain|unknown|unsure|ambiguous|exact type uncertain/i.test(currentParallel)) {
    return { ...surfaceGuardedAi, parallel: null, notes: appendNote(surfaceGuardedAi.notes, `Identity guardrail suppressed uncertain parallel label "${currentParallel}" because OCR/printed evidence did not confirm it.`) };
  }
  if (!signal && currentParallel && isBaseParallel(currentParallel)) {
    return { ...surfaceGuardedAi, parallel: null, notes: appendNote(surfaceGuardedAi.notes, "Identity guardrail suppressed generic Base parallel label; base cards stay unlabelled unless the printed card name requires it.") };
  }
  if (!signal) return surfaceGuardedAi;

  const shouldOverrideBase = isBaseParallel(currentParallel);
  const genericParallel = Boolean(currentParallel && /^(?:red|blue|green|gold|orange|purple|black|silver|pink|aqua|teal|bronze|copper|yellow|white)?\s*parallel$/i.test(currentParallel));
  const shouldPreserveSpecificParallel = currentParallel && !shouldOverrideBase && !genericParallel && !/uncertain|unknown|insert/i.test(currentParallel);

  if (shouldPreserveSpecificParallel) {
    return {
      ...surfaceGuardedAi,
      notes: appendNote(surfaceGuardedAi.notes, `Identity guardrail checked printed variant signal (${signal.reason}) and preserved AI parallel "${currentParallel}".`),
    };
  }

  const guardedParallel = signal.label;
  const guardedSetName = signal.setName && (!surfaceGuardedAi.setName || isBaseParallel(surfaceGuardedAi.setName))
    ? signal.setName
    : surfaceGuardedAi.setName;
  const loweredConfidence = signal.confidence === "review" ? Math.min(surfaceGuardedAi.confidence || 0, 0.84) : surfaceGuardedAi.confidence;
  return {
    ...surfaceGuardedAi,
    setName: guardedSetName,
    parallel: guardedParallel,
    confidence: loweredConfidence,
    notes: appendNote(surfaceGuardedAi.notes, `Identity guardrail: ${signal.reason}; replaced ${shouldOverrideBase ? "Base/null" : `uncertain value "${currentParallel}"`} with "${guardedParallel}".`),
  };
}

export const instaCompIdentityGuardFixtures = {
  baseParallelPattern,
  printedVariantGuardrailExamples,
};
