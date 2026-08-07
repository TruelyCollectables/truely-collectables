function normalized(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}

const SPORT_RULES = [
  ["soccer", /\b(?:soccer|uefa|bundesliga|epl)\b|premier[- ]league/],
  ["wrestling", /\b(?:wwe|aew|wrestling|wcw)\b/],
  ["mma", /\b(?:ufc|mma)\b/],
  ["racing", /\b(?:nascar|racing)\b/],
  ["basketball", /\b(?:basketball|nba|wnba)\b/],
  ["baseball", /\b(?:baseball|mlb)\b/],
  ["football", /\b(?:football|nfl|aaf)\b/],
  ["hockey", /\b(?:hockey|nhl|ahl)\b/],
  ["golf", /\b(?:golf|pga)\b/],
  ["tennis", /\b(?:tennis|atp|wta)\b/],
  ["boxing", /\bboxing\b/],
];

function sportHits(value) {
  const text = normalized(value);
  const hits = SPORT_RULES.filter(([, pattern]) => pattern.test(text)).map(([sport]) => sport);
  // In soccer source text, "football" can be a synonym rather than a separate
  // American-football product. Prefer explicit soccer evidence in that pair.
  if (hits.includes("soccer") && hits.includes("football")) {
    hits.splice(hits.indexOf("football"), 1);
  }
  return [...new Set(hits)];
}

export function classifyMasterSportCandidate(candidate, set, checklistText = "") {
  const rawTitle = normalized(candidate?.title);
  const title = normalized(`${candidate?.title || ""} ${set?.product || ""}`);
  const url = normalized(candidate?.sourceUrl);
  const directFiles = normalized(
    (candidate?.files || [])
      .filter((file) => !file?.duplicateOf)
      .map((file) => file?.name || "")
      .join(" "),
  );
  const archivedText = normalized(checklistText);

  // A source title explicitly naming multiple distinct sports is an article or
  // index spanning multiple releases unless it explicitly calls itself a
  // multisport product. Do not force it into the first sport token found.
  const explicitTitleSports = sportHits(rawTitle);
  const explicitMultisport = /\b(?:multi[- ]?sport|multiple[- ]sport)\b/.test(`${title} ${url}`);
  if (explicitTitleSports.length > 1 && !explicitMultisport) {
    return {
      sport: "aggregate_multi_release",
      reason: "multiple_explicit_sports_in_source_title",
      evidence: explicitTitleSports,
    };
  }

  // BigApple's top-level sport paths are stronger than its occasionally stale
  // slugs/titles. This deliberately resolves cases such as a WWE-looking slug
  // under /nba/ whose checklist body is actually Bowman Basketball.
  for (const [path, sport] of [
    ["/nfl/", "football"],
    ["/nba/", "basketball"],
    ["/mlb/", "baseball"],
    ["/nhl/", "hockey"],
    ["/soccer/", "soccer"],
  ]) {
    if (url.includes(path)) {
      return { sport, reason: "source_url_path", evidence: [path] };
    }
  }

  if (url.includes("/multisport/") || explicitMultisport) {
    return { sport: "multi-sport", reason: "explicit_multisport_source", evidence: [] };
  }

  const titleSports = sportHits(title);
  if (titleSports.length === 1) {
    return { sport: titleSports[0], reason: "source_title", evidence: titleSports };
  }

  const fileSports = sportHits(directFiles);
  if (fileSports.length === 1) {
    return { sport: fileSports[0], reason: "direct_file_name", evidence: fileSports };
  }

  if (/\bmulti-sport checklist\b|\bmulti\/other sport checklists\b/.test(archivedText)) {
    return { sport: "multi-sport", reason: "archived_checklist_category", evidence: [] };
  }

  const archivedSports = sportHits(archivedText);
  if (archivedSports.length === 1) {
    return { sport: archivedSports[0], reason: "archived_checklist_text", evidence: archivedSports };
  }

  // BigApple uses /non-sports/ as a catch-all for entertainment plus several
  // legitimate sports such as wrestling, racing, golf, UFC, tennis and boxing.
  // It is only a non-sport exclusion after every stronger evidence surface above
  // fails to identify a sport.
  if (url.includes("/non-sports/")) {
    return { sport: "excluded_non_sport", reason: "non_sports_source_path", evidence: [] };
  }

  return { sport: "needs_sport_review", reason: "insufficient_sport_evidence", evidence: [] };
}

export { sportHits };
