import { buildChecklistIdentityFingerprint } from "./identity";
import type {
  ChecklistImportCard,
  ChecklistImportParallel,
  ChecklistImportPlan,
  ChecklistImportValidationIssue,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { buildChecklistSourceStorageReceipt } from "./storage";

export const BECKETT_REFERENCE_HTML_ADAPTER_ID = "beckett-reference-html" as const;
export const BECKETT_REFERENCE_HTML_ADAPTER_VERSION = "1.0.0" as const;

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: unknown) {
  return clean(value).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (/^#x/i.test(token)) {
      const point = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    if (token.startsWith("#")) {
      const point = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }
    return named[token.toLowerCase()] ?? entity;
  });
}

function htmlText(value: string) {
  return clean(decodeHtml(value.replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]+>/g, " ")));
}

function contentText(artifact: ChecklistSourceArtifact) {
  return typeof artifact.content === "string" ? artifact.content : Buffer.from(artifact.content).toString("utf8");
}
function titleFrom(html: string) {
  return htmlText(
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      "",
  );
}

function splitBlockLines(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .split(/\r?\n/)
    .map((line) => htmlText(line))
    .filter(Boolean);
}

function normalizeSetName(value: string) {
  const name = clean(value)
    .replace(/^\d{4}(?:-\d{2})?\s+.*?\s+Checklist\s*[-:]?\s*/i, "")
    .replace(/\s+Checklist(?:\s+Top)?$/i, "")
    .replace(/^Checklist\s*[-:]?\s*/i, "")
    .trim();
  if (!name || /^base(?: set)?$/i.test(name) || /^(?:and details|team sets?(?: and details)?|team set lists?(?: and details)?)$/i.test(name)) return "Base Set";
  return name.slice(0, 160);
}

function inferSetType(name: string) {
  const value = comparable(name);
  if (!value || value === "base" || value === "base-set") return "base" as const;
  if (/autograph|signature|signed/.test(value)) return "autograph" as const;
  if (/relic|memorabilia|patch|swatch|jersey/.test(value)) return "memorabilia" as const;
  if (/insert|subset|rookie|prospect|variation|short-print|sp\b/.test(value)) return "insert" as const;
  return "other" as const;
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

function leagueForSport(value: string) {
  const sport = comparable(value);
  if (sport === "baseball") return "MLB";
  if (sport === "football") return "NFL";
  if (sport === "basketball") return "NBA";
  if (sport === "hockey") return "NHL";
  if (sport === "wrestling") return "WWE";
  return null;
}

function splitPlayers(value: string) {
  const cleaned = clean(value);
  return cleaned
    .split(/\s+(?:\/|&|and)\s+/i)
    .map((part) => clean(part))
    .filter(Boolean);
}

const CARD_NUMBER = /^(?:\d{1,4}[A-Za-z]?|[A-Z]{1,12}-[A-Z0-9]{1,24}|[A-Z]{1,6}\d[A-Z0-9]{0,12}|NNO|NO#)$/i;

function parseCardLine(line: string, setName: string): ChecklistImportCard | null {
  const match = clean(line).match(/^#?\s*(\S+)\s+(.+)$/);
  if (!match || !CARD_NUMBER.test(match[1])) return null;
  let subject = clean(match[2]);
  if (/^(?:cards?|packs?|boxes?)\b/i.test(subject)) return null;
  let team = "";
  const comma = subject.lastIndexOf(",");
  if (comma > 0 && comma < subject.length - 1) {
    team = clean(subject.slice(comma + 1));
    subject = clean(subject.slice(0, comma));
  }  const variationMatch = subject.match(/\((SP|SSP|variation|image variation|photo variation)[^)]*\)/i);
  const playerText = clean(
    subject.replace(/\((?:SP|SSP|variation|image variation|photo variation)[^)]*\)/gi, " "),
  );
  const players = splitPlayers(playerText);
  if (!players.length) return null;
  const setComparable = comparable(setName);
  return {
    sourceKey: "",
    setSourceKey: "",
    cardNumber: clean(match[1]).replace(/^#/, ""),
    players,
    teams: team ? [team] : [],
    rookieDesignation: /(?:\bRC\b|\brookie\b)/i.test(subject),
    firstBowmanDesignation: /first bowman/i.test(`${setName} ${subject}`),
    autographStatus: /autograph|signature|signed/.test(setComparable) ? "autograph" : "non-auto",
    memorabiliaStatus: /relic|memorabilia|patch|swatch|jersey/.test(setComparable)
      ? "memorabilia"
      : "non-memorabilia",
    variation: variationMatch ? clean(variationMatch[0].replace(/[()]/g, "")) : null,
    sourceNotes: null,
  };
}

function parseSerialRun(value: string) {
  const slash = clean(value).match(/\/\s*(\d{1,7})\b/);
  if (slash) return Number(slash[1]);
  const numbered = clean(value).match(/(?:numbered|limited)\s+(?:to|#?\s*)\s*(\d{1,7})\b/i);
  return numbered ? Number(numbered[1]) : null;
}
function parseParallelLine(line: string, setName: string): ChecklistImportParallel | null {
  const text = clean(line).replace(/^[-•*]+\s*/, "");
  if (!text || !/(?:parallel|refractor|prizm|foil|wave|velocity|ice|scope|disco|mosaic|shimmer|cracked|sapphire|gold|silver|bronze|red|blue|green|orange|purple|black|white|pink|aqua|superfractor|printing plate)/i.test(text)) {
    return null;
  }
  const serialRun = parseSerialRun(text);
  const name = clean(
    text
      .replace(/\s*\([^)]*(?:packs?|box|case)[^)]*\)\s*$/i, "")
      .replace(/\s*[-:(]*\s*\/?\s*\d{1,7}\)?\s*$/i, "")
      .replace(/\s*[-:(]*\s*(?:numbered|limited)\s+(?:to|#?\s*)\s*\d{1,7}\)?\s*$/i, ""),
  );
  if (!name || /^parallels?$/i.test(name)) return null;
  return {
    sourceKey: "",
    setSourceKey: "",
    name,
    serialRun,
    configurationExclusivity:
      text.match(/\b(hobby|retail|blaster|mega|hanger|fanatics|walmart|target|international|online exclusive)\b/i)?.[1] || null,
  };
}

function isChecklistStopHeading(value: string) {
  return /(?:team set lists?|team set checklists?|checklist by team|shop for|what to expect|product details|box breakdown|comments?)/i.test(value);
}
function extractRows(html: string) {
  const cards: Array<ChecklistImportCard & { setName: string }> = [];
  const parallels: Array<ChecklistImportParallel & { setName: string }> = [];
  let currentSet = "Base Set";
  let active = false;
  let parallelMode = false;
  let sawChecklistAnchor = false;
  const stopAtComments = html.search(/<div\b[^>]*(?:id=["']comments|class=["'][^"']*comments-area)/i);
  const source = stopAtComments > 0 ? html.slice(0, stopAtComments) : html;
  const blocks = source.matchAll(/<(h[1-6]|p|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi);

  for (const block of blocks) {
    const tag = block[1].toLowerCase();
    const body = block[2];
    if (tag.startsWith("h")) {
      const heading = htmlText(body);
      if (!heading) continue;
      if (isChecklistStopHeading(heading)) {
        active = false;
        parallelMode = false;
        continue;
      }
      if (/checklist\s+top$/i.test(heading) || /^jump to\b/i.test(heading)) continue;
      if (/\bchecklist\b/i.test(heading)) {
        sawChecklistAnchor = true;
        active = true;
        parallelMode = false;
        const nextSet = normalizeSetName(heading);
        if (nextSet && !/^\d{4}/.test(nextSet)) currentSet = nextSet;
        continue;
      }
      if (active && /\b(base set|autograph|signature|insert|relic|memorabilia|parallel|variation|rookie|prospect)\b/i.test(heading)) {
        currentSet = normalizeSetName(heading);
        parallelMode = false;
      }
      continue;
    }
    if (!active) continue;
    if (tag === "p") {
      const text = htmlText(body);
      if (/^parallels?\s*:??$/i.test(text)) {
        parallelMode = true;
        continue;
      }
      for (const line of splitBlockLines(body)) {
        const card = parseCardLine(line, currentSet);
        if (card) cards.push({ ...card, setName: currentSet });
      }
      continue;
    }

    if (tag === "ul") {
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => htmlText(match[1])).filter(Boolean);
      if (parallelMode || items.some((item) => Boolean(parseSerialRun(item)))) {
        for (const item of items) {
          const parallel = parseParallelLine(item, currentSet);
          if (parallel) parallels.push({ ...parallel, setName: currentSet });
        }
      }
      parallelMode = false;
    }
  }

  return { cards, parallels, sawChecklistAnchor };
}

function dedupeRows(rows: ReturnType<typeof extractRows>) {
  const cards: Array<ChecklistImportCard & { setName: string }> = [];
  const cardKeys = new Set<string>();
  for (const card of rows.cards) {
    const key = [comparable(card.setName), comparable(card.cardNumber), card.players.map(comparable).sort().join("+")].join("::");
    if (!cardKeys.has(key)) {
      cardKeys.add(key);
      cards.push(card);
    }
  }
  const parallels: Array<ChecklistImportParallel & { setName: string }> = [];
  const parallelKeys = new Set<string>();
  for (const parallel of rows.parallels) {
    const key = [comparable(parallel.setName), comparable(parallel.name), parallel.serialRun || ""].join("::");
    if (!parallelKeys.has(key)) {
      parallelKeys.add(key);
      parallels.push(parallel);
    }
  }
  return { cards, parallels, sawChecklistAnchor: rows.sawChecklistAnchor };
}

function targetMatchesPage(artifact: ChecklistSourceArtifact, title: string) {
  const target = artifact.targetContext || {};
  const haystack = comparable(`${title} ${artifact.sourceUrl}`);
  const required = [target.year || target.season, target.manufacturer, target.product]
    .flatMap((value) => comparable(value).split("-").filter(Boolean))
    .filter((token) => token.length >= 2 && !["cards", "card", "set"].includes(token));
  return required.every((token) => haystack.includes(token));
}

function releaseSlug(artifact: ChecklistSourceArtifact) {
  const targetKey = clean(artifact.targetContext?.targetKey);
  if (targetKey) return comparable(targetKey.replaceAll("|", "-"));
  return comparable(`${artifact.targetContext?.year || artifact.targetContext?.season}-${artifact.targetContext?.manufacturer}-${artifact.targetContext?.product}-${artifact.targetContext?.sport}`);
}

export function parseBeckettReferenceHtml(artifact: ChecklistSourceArtifact): ChecklistImportPlan {
  const html = contentText(artifact);
  const title = titleFrom(html);
  const target = artifact.targetContext || {};
  const issues: ChecklistImportValidationIssue[] = [];
  const manufacturer = clean(target.manufacturer);
  const product = clean(target.product);
  const releaseYear = clean(target.year) || clean(target.season).match(/\b(?:19|20)\d{2}(?:-\d{2})?\b/)?.[0] || null;
  const season = clean(target.season) || releaseYear;
  const sport = clean(target.sport) || "Sports Cards";
  if (!manufacturer || !product || !releaseYear || !sport) {
    issue(issues, "beckett_target_context_missing", "error", "Beckett imports require Sentinel sport, year/season, manufacturer, and product context.");
  }
  if (!targetMatchesPage(artifact, title)) {
    issue(issues, "beckett_target_page_mismatch", "error", `Beckett page title did not match target context: ${title || "(missing title)"}.`);
  }

  const parsed = dedupeRows(extractRows(html));
  if (!parsed.sawChecklistAnchor) {
    issue(issues, "beckett_checklist_anchor_missing", "error", "No Beckett checklist heading was found in the archived page.");
  }
  if (parsed.cards.length < 3) {
    issue(issues, "beckett_insufficient_card_rows", "error", `Only ${parsed.cards.length} deterministic checklist card rows were parsed.`);
  }
  if (!parsed.parallels.length) {
    issue(issues, "beckett_no_parallel_rows", "warning", "No deterministic parallel rows were parsed from this checklist source.");
  }

  const setNames = [...new Set(parsed.cards.map((card) => card.setName))];
  const sets = setNames.map((name, index) => ({
    sourceKey: `set-${index + 1}-${comparable(name)}`,
    name,
    normalizedName: clean(name).toLowerCase(),
    setType: inferSetType(name),
  }));
  const setByName = new Map(sets.map((set) => [set.name, set]));
  const cards = parsed.cards.map((card, index) => {
    const set = setByName.get(card.setName)!;
    return {
      ...card,
      sourceKey: `card-${index + 1}-${comparable(card.setName)}-${comparable(card.cardNumber)}`,
      setSourceKey: set.sourceKey,
      sourceNotes: `Beckett public checklist: ${title}`,
    };
  });
  const parallels = parsed.parallels
    .map((parallel, index) => {
      const set = setByName.get(parallel.setName);
      if (!set) return null;
      return {
        ...parallel,
        sourceKey: `parallel-${index + 1}-${comparable(parallel.setName)}-${comparable(parallel.name)}`,
        setSourceKey: set.sourceKey,
      };
    })
    .filter(Boolean) as Array<ChecklistImportParallel & { setName: string }>;

  const identities: ChecklistImportPlan["identities"] = [];
  for (const card of cards) {
    const set = sets.find((value) => value.sourceKey === card.setSourceKey)!;
    identities.push({
      cardSourceKey: card.sourceKey,
      parallelSourceKey: null,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear,
        season,
        manufacturer,
        brand: manufacturer || null,
        product,
        sport,
        league: leagueForSport(sport),
        setName: set.name,
        cardNumber: card.cardNumber,
        players: card.players,
        teams: card.teams,
        parallel: null,
        variation: card.variation,
        serialRun: null,
        autographStatus: card.autographStatus,
        memorabiliaStatus: card.memorabiliaStatus,
        configurationExclusivity: null,
      }),
    });
  }
  for (const parallel of parallels) {
    const set = sets.find((value) => value.sourceKey === parallel.setSourceKey);
    if (!set) continue;
    for (const card of cards.filter((value) => value.setSourceKey === parallel.setSourceKey)) {
      identities.push({
        cardSourceKey: card.sourceKey,
        parallelSourceKey: parallel.sourceKey,
        fingerprint: buildChecklistIdentityFingerprint({
          releaseYear,
          season,
          manufacturer,
          brand: manufacturer || null,
          product,
          sport,
          league: leagueForSport(sport),
          setName: set.name,
          cardNumber: card.cardNumber,
          players: card.players,
          teams: card.teams,
          parallel: parallel.name,
          variation: card.variation,
          serialRun: parallel.serialRun,
          autographStatus: card.autographStatus,
          memorabiliaStatus: card.memorabiliaStatus,
          configurationExclusivity: parallel.configurationExclusivity,
        }),
      });
    }
  }

  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: manufacturer || "beckett-reference",
    releaseSlug: releaseSlug(artifact),
    originalFilename: artifact.originalFilename,
    mimeType: artifact.mimeType,
    content: artifact.content,
  });
  const errors = issues.filter((value) => value.severity === "error");
  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: BECKETT_REFERENCE_HTML_ADAPTER_ID,
    adapterVersion: BECKETT_REFERENCE_HTML_ADAPTER_VERSION,
    source: {
      sourceUrl: artifact.sourceUrl,
      retrievedAt: artifact.retrievedAt,
      authority: artifact.authority,
      redistributionAllowed: artifact.redistributionAllowed,
      privateArchiveRequired: true,
      normalizedFactsInternalOnly: true,
      storage,
    },
    release: {
      manufacturer,
      brand: manufacturer || null,
      product,
      releaseYear,
      season,
      sport,
      league: leagueForSport(sport),
      releaseSlug: releaseSlug(artifact),
    },
    sets,
    cards,
    parallels,
    identities,
    validation: {
      status: errors.length ? "validation_required" : "passed",
      issues,
      counts: { sets: sets.length, cards: cards.length, parallels: parallels.length, identities: identities.length },
    },
  };
}

export const beckettReferenceHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: BECKETT_REFERENCE_HTML_ADAPTER_ID,
  version: BECKETT_REFERENCE_HTML_ADAPTER_VERSION,
  supports(artifact) {
    if (artifact.mimeType.toLowerCase() !== "text/html") return false;
    try {
      const host = new URL(artifact.sourceUrl).hostname.toLowerCase();
      return host === "beckett.com" || host === "www.beckett.com";
    } catch {
      return false;
    }
  },
  parse: parseBeckettReferenceHtml,
};