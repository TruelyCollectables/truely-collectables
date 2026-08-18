from pathlib import Path

path = Path('src/lib/checklist-registry/upper-deck-html.ts')
text = path.read_text()

def replace_once(old: str, new: str, label: str):
    global text
    if old not in text:
        raise SystemExit(f'Upper Deck recovery patch missed {label}')
    text = text.replace(old, new, 1)

replace_once(
    'export const UPPER_DECK_HTML_ADAPTER_VERSION = "1.0.1" as const;',
    'export const UPPER_DECK_HTML_ADAPTER_VERSION = "1.0.2-recovery" as const;',
    'adapter version',
)

replace_once(
'''function releasePeriod(title: string) {
  const match = title.match(/\\b(20\\d{2})\\s*-\\s*(\\d{2,4})\\b/);
  if (!match) return { releaseYear: null, season: null, matched: "" };
  const ending = match[2].length === 4 ? match[2].slice(-2) : match[2];
  return {
    releaseYear: null,
    season: `${match[1]}-${ending}`,
    matched: match[0],
  };
}''',
'''function releasePeriod(title: string) {
  const seasonMatch = title.match(/\\b(20\\d{2})\\s*-\\s*(\\d{2,4})\\b/);
  if (seasonMatch) {
    const ending = seasonMatch[2].length === 4 ? seasonMatch[2].slice(-2) : seasonMatch[2];
    return {
      releaseYear: null,
      season: `${seasonMatch[1]}-${ending}`,
      matched: seasonMatch[0],
    };
  }
  const yearMatch = title.match(/\\b(20\\d{2})\\b/);
  if (yearMatch) {
    return { releaseYear: yearMatch[1], season: null, matched: yearMatch[0] };
  }
  return { releaseYear: null, season: null, matched: "" };
}''',
    'year-only release period',
)

replace_once(
'''function parseSerialRun(value: string) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (/\\b1\\s*(?:of|-|\\/)\\s*1\\b/i.test(normalized)) return 1;
  if (/^\\/?\\d{1,7}$/.test(normalized)) {
    const result = Number.parseInt(normalized.replace("/", ""), 10);
    return result > 0 ? result : null;
  }
  return null;
}''',
'''function parseSerialRun(value: string) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (/\\b1\\s*(?:of|-|\\/)\\s*1\\b/i.test(normalized)) return 1;
  const compact = normalized.replace(/,/g, "").replace(/^ann\\.?\\s*/i, "").trim();
  const match = compact.match(/^(?:#?\\s*)?(?:\\d+\\s*(?:of|\\/)\\s*)?(\\d{1,7})$/i);
  if (match) {
    const result = Number.parseInt(match[1], 10);
    return result > 0 ? result : null;
  }
  return null;
}''',
    'serial parser',
)

replace_once(
'''function splitSubjects(value: string) {
  return clean(value)
    .replace(/\\s+CL$/i, "")
    .split(/\\s*\\/\\s*|\\s*;\\s*|\\s+&\\s+/)
    .map((entry) => clean(entry).replace(/\\s+CL$/i, ""))
    .filter(Boolean);
}''',
'''function splitSubjects(value: string) {
  return clean(value)
    .replace(/\\s+CL$/i, "")
    .split(/\\s*\\/\\s*|\\s*;\\s*|\\s+&\\s+/)
    .map((entry) => clean(entry).replace(/\\s+CL$/i, "").replace(/\\s+["“][^"”]+["”]$/u, ""))
    .filter(Boolean);
}''',
    'subject annotation normalization',
)

replace_once(
'''    description: findHeaderIndex(table.headers, ["Description", "Player Name"]),
    teamCity: findHeaderIndex(table.headers, ["Team City"]),''',
'''    description: findHeaderIndex(table.headers, ["Description", "Player Name", "Player", "Name"]),
    firstName: findHeaderIndex(table.headers, ["First Name", "FirstName"]),
    lastName: findHeaderIndex(table.headers, ["Last Name", "LastName"]),
    teamCity: findHeaderIndex(table.headers, ["Team City", "TeamCity"]),''',
    'alternate player headers',
)

replace_once(
'''    serial: findHeaderIndex(table.headers, ["Serial #'d", "#'d", "Serial #d"]),''',
'''    serial: findHeaderIndex(table.headers, ["Serial #'d", "#'d", "Serial #d", "#'d To", "Numbered To"]),''',
    'serial header aliases',
)

replace_once(
'''  if (indexes.setName < 0 || indexes.card < 0 || indexes.description < 0) {
    throw new Error(
      "Upper Deck checklist table requires Set Name, Card, and Description/Player Name columns",
    );
  }''',
'''  if (indexes.setName < 0 || indexes.card < 0 || (indexes.description < 0 && indexes.firstName < 0 && indexes.lastName < 0)) {
    throw new Error(
      "Upper Deck checklist table requires Set Name, Card, and a Description/Player or First/Last Name column",
    );
  }''',
    'alternate player header requirement',
)

replace_once(
'''      description: at(cells, indexes.description),''',
'''      description: at(cells, indexes.description) || clean(`${at(cells, indexes.firstName)} ${at(cells, indexes.lastName)}`),''',
    'synthesized player name',
)

replace_once(
'''  const rows = parseRows(html);
  const setMap = new Map<string, ChecklistImportSet>();
  const cardMap = new Map<string, CardAccumulator>();
  const cardNumberOwners = new Map<string, string>();''',
'''  const rows = parseRows(html);
  const subjectConflictKeys = new Set<string>();
  const firstSubjectByNumber = new Map<string, string>();
  for (const row of rows) {
    const descriptor = splitParallelDescriptor(row.rawSetName);
    const setSourceKey = comparable(clean(descriptor.setName));
    const players = splitSubjects(row.description);
    if (!setSourceKey || !row.cardNumber || !players.length) continue;
    const key = `${setSourceKey}:${comparable(row.cardNumber)}:${comparable(buildVariation(row))}`;
    const signature = players.map(comparable).sort().join("+");
    const prior = firstSubjectByNumber.get(key);
    if (prior && prior !== signature) subjectConflictKeys.add(key);
    else if (!prior) firstSubjectByNumber.set(key, signature);
  }
  const setMap = new Map<string, ChecklistImportSet>();
  const cardMap = new Map<string, CardAccumulator>();''',
    'subject conflict prepass',
)

replace_once(
'''    const variation = buildVariation(row);
    const autographStatus = hasPositiveMarker(row.auto) ? "autograph" : "non-auto";''',
'''    let variation = buildVariation(row);
    const subjectConflictKey = `${setSourceKey}:${comparable(row.cardNumber)}:${comparable(variation)}`;
    if (subjectConflictKeys.has(subjectConflictKey)) {
      variation = [variation, `Subject: ${players.join(" / ")}`].filter(Boolean).join("; ");
      issue(issues, "card_number_subject_variant", "warning", `${setName} #${row.cardNumber} is reused by Upper Deck for multiple subjects; preserved as an explicit subject variation`, rowReference);
    }
    const autographStatus = hasPositiveMarker(row.auto) ? "autograph" : "non-auto";''',
    'subject variation preservation',
)

replace_once(
'''    const numberOwnerKey = `${setSourceKey}:${comparable(row.cardNumber)}:${variationKey}`;
    const playerSignature = players.map(comparable).sort().join("+");
    const previousOwner = cardNumberOwners.get(numberOwnerKey);
    if (previousOwner && previousOwner !== playerSignature) {
      issue(issues, "card_number_subject_conflict", "error", `${setName} #${row.cardNumber} maps to conflicting subjects`, rowReference);
      continue;
    }
    cardNumberOwners.set(numberOwnerKey, playerSignature);

''',
'''    const playerSignature = players.map(comparable).sort().join("+");

''',
    'remove fatal subject conflict gate',
)

replace_once(
'''      issue(issues, "duplicate_identity", "error", `Duplicate Upper Deck identity for ${row.rawSetName} #${row.cardNumber}`, rowReference);''',
'''      issue(issues, "duplicate_identity", "warning", `Duplicate Upper Deck source row for ${row.rawSetName} #${row.cardNumber} was deduplicated`, rowReference);''',
    'duplicate identity severity',
)

path.write_text(text)
print('Patched Upper Deck recovery parser')
