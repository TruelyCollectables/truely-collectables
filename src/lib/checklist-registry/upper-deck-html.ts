import {
  buildChecklistIdentityFingerprint,
  type ChecklistIdentityInput,
} from "./identity";
import {
  type ChecklistImportCard,
  type ChecklistImportParallel,
  type ChecklistImportPlan,
  type ChecklistImportSet,
  type ChecklistImportValidationIssue,
  type ChecklistSourceAdapter,
  type ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";

export const UPPER_DECK_HTML_ADAPTER_ID = "upper-deck-html-checklist" as const;
export const UPPER_DECK_HTML_ADAPTER_VERSION = "1.0.1" as const;

const TEST_BATCH_MARKER = "tcos-checklist-scope";
const KNOWN_PARALLEL_SUFFIXES = [
  "Printing Plates",
  "Black and White",
  "Golden Treasures",
  "Gold Glitter Bomb",
  "Outburst Silver",
  "Outburst Red",
  "Outburst Gold",
  "Speckled Rainbow",
  "Black Rainbow",
  "Orange Slice",
  "Blue Spectrum",
  "Purple Diamond",
  "Pink Lemonade",
  "Silver Foil",
  "High Gloss",
  "Exclusives",
  "Clear Cut",
  "Deluxe",
  "Doubloons",
  "Auto",
].sort((left, right) => right.length - left.length);

type ParsedRow = {
  rowNumber: number;
  rawSetName: string;
  cardNumber: string;
  description: string;
  teamCity: string;
  teamName: string;
  rookie: string;
  auto: string;
  memTech: string;
  serial: string;
  shortPrint: string;
  odds: string;
  point: string;
  subjects: string;
};

type RowEvidence = {
  officialSetName: string;
  parallel: string | null;
  serialRun: number | null;
  rookie: string | null;
  autograph: string | null;
  memorabiliaOrTechnology: string | null;
  shortPrint: string | null;
  statedOdds: string | null;
  configurations: string[];
  point: string | null;
  subjects: string | null;
};

type CardAccumulator = {
  card: Omit<ChecklistImportCard, "sourceNotes">;
  evidence: RowEvidence[];
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "...",
    ldquo: '"',
    lsquo: "'",
    lt: "<",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    quot: '"',
    rdquo: '"',
    rsquo: "'",
  };

  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, token: string) => {
      if (/^#x/i.test(token)) {
        const codePoint = Number.parseInt(token.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      if (token.startsWith("#")) {
        const codePoint = Number.parseInt(token.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
      }
      return named[token.toLowerCase()] ?? entity;
    },
  );
}

function htmlText(value: string) {
  return clean(
    decodeHtmlEntities(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<\/p\s*>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function normalizeHeader(value: string) {
  return comparable(value).replace(/-/g, "");
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.findIndex((header) => normalizedAliases.has(normalizeHeader(header)));
}

function extractOfficialTable(html: string) {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(
    (match) => match[0],
  );

  for (const table of tables) {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
      (match) => match[1],
    );
    const parsedRows = rows.map((row) =>
      [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
        (cell) => htmlText(cell[1]),
      ),
    );
    const headerIndex = parsedRows.findIndex((cells) => {
      const normalized = cells.map(normalizeHeader);
      return normalized.includes("setname") && normalized.includes("card");
    });
    if (headerIndex >= 0) {
      return {
        headers: parsedRows[headerIndex],
        rows: parsedRows.slice(headerIndex + 1).filter((cells) => cells.some(Boolean)),
      };
    }
  }

  throw new Error("Upper Deck checklist HTML does not contain a Set Name/Card table");
}

function extractTitle(html: string) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) throw new Error("Upper Deck checklist HTML is missing its H1 title");
  return htmlText(match[1]);
}

function releasePeriod(title: string) {
  const match = title.match(/\b(20\d{2})\s*-\s*(\d{2,4})\b/);
  if (!match) return { releaseYear: null, season: null, matched: "" };
  const ending = match[2].length === 4 ? match[2].slice(-2) : match[2];
  return {
    releaseYear: null,
    season: `${match[1]}-${ending}`,
    matched: match[0],
  };
}

function releaseSlug(sourceUrl: string) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const last = pathname.split("/").filter(Boolean).at(-1);
    return comparable(last || "upper-deck-checklist");
  } catch {
    return "upper-deck-checklist";
  }
}

function inferProduct(title: string, matchedPeriod: string) {
  return clean(title.replace(matchedPeriod, "").replace(/\bchecklist\b/gi, ""));
}

function inferBrand(product: string) {
  const withoutSport = product.replace(/\s+(hockey|golf|aew|pwhl|ahl)$/i, "").trim();
  if (/^upper deck\b/i.test(withoutSport)) return "Upper Deck";
  const first = withoutSport.split(/\s+/)[0];
  return first || "Upper Deck";
}

function inferSport(title: string) {
  if (/\bhockey\b/i.test(title)) return "Hockey";
  if (/\bgolf\b/i.test(title)) return "Golf";
  if (/\baew\b/i.test(title)) return "Wrestling";
  return "Other";
}

function inferLeague(title: string, sport: string) {
  if (/\bpwhl\b/i.test(title)) return "PWHL";
  if (/\bahl\b/i.test(title)) return "AHL";
  if (/\baew\b/i.test(title)) return "AEW";
  if (sport === "Hockey") return "NHL";
  return null;
}

function canonicalSetName(value: string) {
  const normalized = clean(value).replace(/^Base Set\s*-\s*/i, "");
  return normalized || "Base Set";
}

function splitParallelDescriptor(rawSetName: string) {
  const value = clean(rawSetName);
  const match = value.match(/^(.*?)\s+Parallel(?:\s*-\s*(.+))?$/i);
  if (!match) {
    return {
      setName: canonicalSetName(value),
      parallelName: null as string | null,
    };
  }

  const beforeParallel = clean(match[1]);
  const explicitSetSuffix = clean(match[2]);
  let basePrefix = "";
  let parallelName = beforeParallel;

  for (const suffix of KNOWN_PARALLEL_SUFFIXES) {
    if (beforeParallel.toLowerCase().endsWith(suffix.toLowerCase())) {
      basePrefix = clean(beforeParallel.slice(0, -suffix.length));
      parallelName = suffix;
      break;
    }
  }

  const setPieces = [basePrefix, explicitSetSuffix].filter(Boolean);
  const setName = setPieces.length
    ? canonicalSetName(setPieces.join(" - "))
    : "Base Set";
  return { setName, parallelName };
}

function parseSerialRun(value: string) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (/\b1\s*(?:of|-|\/)\s*1\b/i.test(normalized)) return 1;
  if (/^\/?\d{1,7}$/.test(normalized)) {
    const result = Number.parseInt(normalized.replace("/", ""), 10);
    return result > 0 ? result : null;
  }
  return null;
}

function splitSubjects(value: string) {
  return clean(value)
    .replace(/\s+CL$/i, "")
    .split(/\s*\/\s*|\s*;\s*|\s+&\s+/)
    .map((entry) => clean(entry).replace(/\s+CL$/i, ""))
    .filter(Boolean);
}

function splitTeam(value: string) {
  return clean(value)
    .split(/\s*\/\s*|\s*;\s*/)
    .map(clean)
    .filter(Boolean);
}

function teamsFrom(city: string, name: string) {
  const cities = splitTeam(city);
  const names = splitTeam(name);
  if (cities.length && cities.length === names.length) {
    return cities.map((entry, index) => clean(`${entry} ${names[index]}`));
  }
  const combined = clean(`${city} ${name}`);
  return combined ? [combined] : [];
}

function hasPositiveMarker(value: string) {
  const normalized = clean(value);
  return Boolean(normalized && !/^(no|none|false|n\/a|-)$/.test(normalized.toLowerCase()));
}

function memorabiliaStatus(memTech: string) {
  return /\b(memorabilia|relic|patch|jersey|swatch|puck|stick|glove|helmet)\b/i.test(
    memTech,
  )
    ? "memorabilia"
    : "non-memorabilia";
}

function extractConfigurations(odds: string) {
  const value = clean(odds).toLowerCase();
  const configs: string[] = [];
  const add = (label: string) => {
    if (!configs.includes(label)) configs.push(label);
  };
  if (/\bhobby\b|(?:^|[,\s])h(?:[,\s]|$)/i.test(value)) add("Hobby");
  if (/e-pack|(?:^|[,\s])e(?:[,\s]|$)/i.test(value)) add("e-Pack");
  if (/\bblaster\b|(?:^|[,\s])b(?:[,\s]|$)/i.test(value)) add("Blaster");
  if (/\bstarter\b/i.test(value)) add("Starter");
  if (/\btin\b/i.test(value)) add("Tin");
  if (/\bhanger\b/i.test(value)) add("Hanger");
  if (/\bdollar\b/i.test(value)) add("Dollar Store");
  if (/\bmega\b/i.test(value)) add("Mega");
  if (/\bretail\b/i.test(value)) add("Retail");
  return configs;
}

function inferSetType(params: {
  setName: string;
  autographStatus: string;
  memorabiliaStatus: string;
}): ChecklistImportSet["setType"] {
  if (params.autographStatus === "autograph") return "autograph";
  if (params.memorabiliaStatus === "memorabilia") return "memorabilia";
  if (/^base set$/i.test(params.setName)) return "base";
  if (/\b(young guns|rookies|subset)\b/i.test(params.setName)) return "subset";
  return "insert";
}

function buildVariation(row: ParsedRow) {
  const values: string[] = [];
  if (/\sCL$/i.test(row.description)) values.push("Checklist");
  if (clean(row.shortPrint)) values.push(clean(row.shortPrint));
  return values.length ? values.join("; ") : null;
}

function issue(
  issues: ChecklistImportValidationIssue[],
  code: string,
  severity: "warning" | "error",
  message: string,
  rowReference?: string,
) {
  issues.push({ code, severity, message, rowReference: rowReference || null });
}

function parseRows(html: string) {
  const table = extractOfficialTable(html);
  const indexes = {
    setName: findHeaderIndex(table.headers, ["Set Name"]),
    card: findHeaderIndex(table.headers, ["Card"]),
    description: findHeaderIndex(table.headers, ["Description", "Player Name"]),
    teamCity: findHeaderIndex(table.headers, ["Team City"]),
    teamName: findHeaderIndex(table.headers, ["Team Name"]),
    rookie: findHeaderIndex(table.headers, ["Rookie"]),
    auto: findHeaderIndex(table.headers, ["Auto"]),
    memTech: findHeaderIndex(table.headers, ["Mem/Tech", "Mem", "Technology"]),
    serial: findHeaderIndex(table.headers, ["Serial #'d", "#'d", "Serial #d"]),
    shortPrint: findHeaderIndex(table.headers, ["SPs", "SP", "SP's"]),
    odds: findHeaderIndex(table.headers, ["Stated Odds", "Odds"]),
    point: findHeaderIndex(table.headers, ["Point"]),
    subjects: findHeaderIndex(table.headers, ["Subjects"]),
  };
  if (indexes.setName < 0 || indexes.card < 0 || indexes.description < 0) {
    throw new Error(
      "Upper Deck checklist table requires Set Name, Card, and Description/Player Name columns",
    );
  }
  const at = (cells: string[], index: number) => (index >= 0 ? clean(cells[index]) : "");
  return table.rows.map(
    (cells, index): ParsedRow => ({
      rowNumber: index + 1,
      rawSetName: at(cells, indexes.setName),
      cardNumber: at(cells, indexes.card).replace(/^#\s*/, ""),
      description: at(cells, indexes.description),
      teamCity: at(cells, indexes.teamCity),
      teamName: at(cells, indexes.teamName),
      rookie: at(cells, indexes.rookie),
      auto: at(cells, indexes.auto),
      memTech: at(cells, indexes.memTech),
      serial: at(cells, indexes.serial),
      shortPrint: at(cells, indexes.shortPrint),
      odds: at(cells, indexes.odds),
      point: at(cells, indexes.point),
      subjects: at(cells, indexes.subjects),
    }),
  );
}

function testBatch(html: string) {
  return new RegExp(
    `<meta\\b[^>]*name=["']${TEST_BATCH_MARKER}["'][^>]*content=["']test_batch["'][^>]*>`,
    "i",
  ).test(html);
}

export function parseUpperDeckHtmlChecklist(
  artifact: ChecklistSourceArtifact,
): ChecklistImportPlan {
  const html =
    typeof artifact.content === "string"
      ? artifact.content
      : Buffer.from(artifact.content).toString("utf8");
  const title = extractTitle(html);
  const period = releasePeriod(title);
  const product = inferProduct(title, period.matched);
  const sport = inferSport(title);
  const league = inferLeague(title, sport);
  const issues: ChecklistImportValidationIssue[] = [];

  if (!period.season && !period.releaseYear) {
    issue(issues, "release_period_missing", "error", "Upper Deck checklist title must contain a release year or season");
  }
  if (
    artifact.authority === "official_manufacturer" &&
    !/^https:\/\/(?:www\.)?upperdeck\.com\/checklist\//i.test(artifact.sourceUrl)
  ) {
    issue(issues, "official_source_domain_mismatch", "error", "Official Upper Deck artifacts must originate from upperdeck.com/checklist/");
  }
  if (artifact.redistributionAllowed) {
    issue(issues, "unexpected_redistribution_permission", "warning", "Upper Deck source pages should remain privately archived unless redistribution permission is documented");
  }

  const release = {
    manufacturer: "Upper Deck",
    brand: inferBrand(product),
    product,
    releaseYear: period.releaseYear,
    season: period.season,
    sport,
    league,
    releaseSlug: releaseSlug(artifact.sourceUrl),
  };
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: release.manufacturer,
    releaseSlug: release.releaseSlug,
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });

  const rows = parseRows(html);
  const setMap = new Map<string, ChecklistImportSet>();
  const cardMap = new Map<string, CardAccumulator>();
  const cardNumberOwners = new Map<string, string>();
  const parallelMap = new Map<string, ChecklistImportParallel>();
  const identities: ChecklistImportPlan["identities"] = [];
  const fingerprints = new Set<string>();

  for (const row of rows) {
    const rowReference = `table.rows[${row.rowNumber}]`;
    const descriptor = splitParallelDescriptor(row.rawSetName);
    const setName = clean(descriptor.setName);
    const setSourceKey = comparable(setName);
    const players = splitSubjects(row.description);
    const teams = teamsFrom(row.teamCity, row.teamName);
    const variation = buildVariation(row);
    const autographStatus = hasPositiveMarker(row.auto) ? "autograph" : "non-auto";
    const memStatus = memorabiliaStatus(row.memTech);
    const configurations = extractConfigurations(row.odds);
    const serialRun = parseSerialRun(row.serial);

    if (!row.rawSetName || !setName || !setSourceKey) {
      issue(issues, "set_name_missing", "error", "Set Name is required", rowReference);
      continue;
    }
    if (!row.cardNumber || !players.length) {
      issue(issues, "card_identity_incomplete", "error", `${row.rawSetName} requires a card number and at least one player/subject`, rowReference);
      continue;
    }
    if (row.serial && serialRun == null) {
      issue(issues, "serial_run_unparsed", "error", `Could not parse Upper Deck serial run '${row.serial}'`, rowReference);
      continue;
    }

    const setType = inferSetType({ setName, autographStatus, memorabiliaStatus: memStatus });
    const existingSet = setMap.get(setSourceKey);
    if (!existingSet) {
      setMap.set(setSourceKey, {
        sourceKey: setSourceKey,
        name: setName,
        normalizedName: comparable(setName),
        setType,
      });
    } else if (existingSet.setType !== setType && setType !== "insert") {
      issue(issues, "set_type_conflict", "warning", `${setName} appears with both ${existingSet.setType} and ${setType} evidence`, rowReference);
    }

    const variationKey = comparable(variation);
    const cardSourceKey = `${setSourceKey}:${comparable(row.cardNumber)}:${variationKey}:${players
      .map(comparable)
      .sort()
      .join("+")}`;
    const numberOwnerKey = `${setSourceKey}:${comparable(row.cardNumber)}:${variationKey}`;
    const playerSignature = players.map(comparable).sort().join("+");
    const previousOwner = cardNumberOwners.get(numberOwnerKey);
    if (previousOwner && previousOwner !== playerSignature) {
      issue(issues, "card_number_subject_conflict", "error", `${setName} #${row.cardNumber} maps to conflicting subjects`, rowReference);
      continue;
    }
    cardNumberOwners.set(numberOwnerKey, playerSignature);

    const evidence: RowEvidence = {
      officialSetName: row.rawSetName,
      parallel: descriptor.parallelName,
      serialRun,
      rookie: clean(row.rookie) || null,
      autograph: clean(row.auto) || null,
      memorabiliaOrTechnology: clean(row.memTech) || null,
      shortPrint: clean(row.shortPrint) || null,
      statedOdds: clean(row.odds) || null,
      configurations,
      point: clean(row.point) || null,
      subjects: clean(row.subjects) || null,
    };

    const existingCard = cardMap.get(cardSourceKey);
    if (existingCard) {
      existingCard.evidence.push(evidence);
    } else {
      cardMap.set(cardSourceKey, {
        card: {
          sourceKey: cardSourceKey,
          setSourceKey,
          cardNumber: row.cardNumber,
          players,
          teams,
          rookieDesignation: hasPositiveMarker(row.rookie) ? true : null,
          firstBowmanDesignation: null,
          autographStatus,
          memorabiliaStatus: memStatus,
          variation,
        },
        evidence: [evidence],
      });
    }

    let parallelSourceKey: string | null = null;
    if (descriptor.parallelName) {
      const configurationExclusivity = configurations.length === 1 ? configurations[0] : null;
      parallelSourceKey = `${setSourceKey}:${comparable(descriptor.parallelName)}:${serialRun || 0}:${comparable(configurationExclusivity)}`;
      if (!parallelMap.has(parallelSourceKey)) {
        parallelMap.set(parallelSourceKey, {
          sourceKey: parallelSourceKey,
          setSourceKey,
          name: descriptor.parallelName,
          serialRun,
          configurationExclusivity,
        });
      }
    }

    const identityInput: ChecklistIdentityInput = {
      releaseYear: release.releaseYear,
      season: release.season,
      manufacturer: release.manufacturer,
      brand: release.brand,
      product: release.product,
      sport: release.sport,
      league: release.league,
      setName,
      cardNumber: row.cardNumber,
      players,
      teams,
      parallel: descriptor.parallelName,
      variation,
      serialRun,
      autographStatus,
      memorabiliaStatus: memStatus,
      configurationExclusivity: configurations.length === 1 ? configurations[0] : null,
    };
    const fingerprint = buildChecklistIdentityFingerprint(identityInput);
    if (fingerprints.has(fingerprint.fingerprintSha256)) {
      issue(issues, "duplicate_identity", "error", `Duplicate Upper Deck identity for ${row.rawSetName} #${row.cardNumber}`, rowReference);
      continue;
    }
    fingerprints.add(fingerprint.fingerprintSha256);
    identities.push({ cardSourceKey, parallelSourceKey, fingerprint });
  }

  const cards: ChecklistImportCard[] = [...cardMap.values()].map((entry) => ({
    ...entry.card,
    sourceNotes: JSON.stringify({
      schema: "tcos.upperDeck.rowEvidence.v1",
      rows: entry.evidence,
    }),
  }));
  const sets = [...setMap.values()];
  const parallels = [...parallelMap.values()];

  if (!sets.length) issue(issues, "no_sets", "error", "No Upper Deck sets were imported");
  if (!cards.length) issue(issues, "no_cards", "error", "No Upper Deck cards were imported");
  if (testBatch(html)) {
    issue(issues, "test_batch_only", "warning", "This HTML fixture proves the Upper Deck adapter but is not a complete checklist page");
  }

  const hasErrors = issues.some((entry) => entry.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: UPPER_DECK_HTML_ADAPTER_ID,
    adapterVersion: UPPER_DECK_HTML_ADAPTER_VERSION,
    source: {
      sourceUrl: artifact.sourceUrl,
      retrievedAt: artifact.retrievedAt,
      authority: artifact.authority,
      redistributionAllowed: artifact.redistributionAllowed,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
    },
    release,
    sets,
    cards,
    parallels,
    identities,
    validation: {
      status: hasErrors ? "validation_required" : "passed",
      issues,
      counts: {
        sets: sets.length,
        cards: cards.length,
        parallels: parallels.length,
        identities: identities.length,
      },
    },
  };
}

export const upperDeckHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: UPPER_DECK_HTML_ADAPTER_ID,
  version: UPPER_DECK_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?upperdeck\.com\/checklist\//i.test(artifact.sourceUrl)
    );
  },
  parse: parseUpperDeckHtmlChecklist,
};
