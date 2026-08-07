function normalized(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}

const SPORT_RULES = [
  ["soccer", /\b(?:soccer|uefa|bundesliga|epl)\b|premier[- ]league/],
  ["wrestling", /\b(?:wwe|aew|wrestling|wcw)\b/],
  ["mma", /\b(?:ufc|mma)\b/],
  ["racing", /\b(?:nascar|racing|formula\s*(?:1|one)|f1)\b/],
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

  const explicitTitleSports = sportHits(rawTitle);
  const explicitMultisport = /\b(?:multi[- ]?sport|multiple[- ]sport)\b/.test(`${title} ${url}`);
  const olympicMultisport = /\bolympic(?:s|ians?)?\b/.test(rawTitle);
  if (olympicMultisport) {
    return { sport: "multi-sport", reason: "olympic_multisport_title", evidence: ["olympic"] };
  }
  if (explicitTitleSports.length > 1 && !explicitMultisport) {
    return {
      sport: "aggregate_multi_release",
      reason: "multiple_explicit_sports_in_source_title",
      evidence: explicitTitleSports,
    };
  }

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
  if (/\bolympic(?:s|ians?)?\b/.test(archivedText)) {
    return { sport: "multi-sport", reason: "archived_olympic_multisport_text", evidence: ["olympic"] };
  }

  const archivedSports = sportHits(archivedText);
  if (archivedSports.length === 1) {
    return { sport: archivedSports[0], reason: "archived_checklist_text", evidence: archivedSports };
  }

  if (url.includes("/non-sports/")) {
    return { sport: "excluded_non_sport", reason: "non_sports_source_path", evidence: [] };
  }

  return { sport: "needs_sport_review", reason: "insufficient_sport_evidence", evidence: [] };
}

export { sportHits };
