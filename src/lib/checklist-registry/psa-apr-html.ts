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

export const PSA_APR_HTML_ADAPTER_ID = "psa-apr-set-html" as const;
export const PSA_APR_HTML_ADAPTER_VERSION = "1.1.0" as const;

function clean(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    if (/^#x/i.test(token)) {
      const codePoint = Number.parseInt(token.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (token.startsWith("#")) {
      const codePoint = Number.parseInt(token.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[token.toLowerCase()] ?? entity;
  });
}

function htmlText(value: string) {
  return clean(
    decodeHtml(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function contentText(artifact: ChecklistSourceArtifact) {
  return typeof artifact.content === "string"
    ? artifact.content
    : Buffer.from(artifact.content).toString("utf8");
}

function extractH1(html: string) {
  return htmlText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
}

function tableRows(html: string) {
  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(
      (row) =>
        [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(
          (cell) => htmlText(cell[1]),
        ),
    );
    const headerIndex = rows.findIndex((cells) => {
      const headers = cells.map((cell) => comparable(cell));
      return (
        headers.some((cell) => cell === "no" || cell === "number") &&
        headers.includes("subject") &&
        headers.some((cell) => cell.includes("auction-results"))
      );
    });
    if (headerIndex >= 0) {
      return rows.slice(headerIndex + 1).filter((cells) => cells.length >= 2 && cells.some(Boolean));
    }
  }
  return [] as string[][];
}

function hasPagination(html: string) {
  const stripped = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  return (
    /<(?:a|button)\b[^>]*(?:aria-label\s*=\s*["']?next\b|rel\s*=\s*["']next["'])/i.test(stripped) ||
    /<(?:a|button)\b[^>]*>\s*Next\s*<\/(?:a|button)>/i.test(stripped) ||
    /\b(?:pageCount|totalPages)\b\s*[:=]\s*["']?([2-9]|\d{2,})/i.test(stripped)
  );
}

const VARIATION_SUFFIX = new RegExp(
  String.raw`\s+(` +
    [
      "Status Aspirations(?: Autograph)?",
      "Status Autograph",
      "Status",
      "Century Proof Gold(?: Autograph)?",
      "Century Proof Silver(?: Autograph)?",
      "Aspirations(?: Autograph)?",
      "Autograph Patch",
      "Autograph",
      "Jersey",
      "Patch",
      "Materials?",
      "Relic",
      "Prime",
      "Dazzle",
      "Refractor",
      "Prizm",
    ].join("|") +
    String.raw`)\s*$`,
  "i",
);

function parseSubject(rawSubject: string) {
  const subject = clean(rawSubject);
  const match = subject.match(VARIATION_SUFFIX);
  const descriptor = clean(match?.[1]);
  const player = clean(match ? subject.slice(0, match.index) : subject);
  const autograph = /\b(?:autograph|signature)\b/i.test(descriptor);
  const memorabilia = /\b(?:jersey|patch|material|relic)\b/i.test(descriptor);
  const parallel = clean(
    descriptor
      .replace(/\b(?:autograph|signature|jersey|patch|materials?|relic)\b/gi, " ")
      .replace(/\s+/g, " "),
  );
  return {
    player,
    descriptor: descriptor || null,
    parallel: parallel || null,
    autographStatus: autograph ? "autograph" : "non-auto",
    memorabiliaStatus: memorabilia ? "memorabilia" : "non-memorabilia",
  };
}

function sportFrom(value: unknown) {
  const normalized = comparable(value);
  if (normalized.includes("basketball")) return { sport: "Basketball", league: "NBA" };
  if (normalized.includes("football")) return { sport: "Football", league: "NFL" };
  if (normalized.includes("baseball")) return { sport: "Baseball", league: "MLB" };
  if (normalized.includes("hockey")) return { sport: "Hockey", league: "NHL" };
  if (normalized.includes("soccer")) return { sport: "Soccer", league: null };
  if (normalized.includes("golf")) return { sport: "Golf", league: null };
  if (normalized.includes("racing")) return { sport: "Racing", league: null };
  return { sport: clean(value) || "Sports Cards", league: null };
}

function releaseSlug(artifact: ChecklistSourceArtifact) {
  const key = clean(artifact.targetContext?.targetKey);
  if (key) return comparable(key.replaceAll("|", "-"));
  try {
    return comparable(new URL(artifact.sourceUrl).pathname.split("/").filter(Boolean).at(-2));
  } catch {
    return "psa-apr-set";
  }
}

function expectedPsaReleaseSlug(
  releaseYear: string | null,
  manufacturer: string,
  product: string,
) {
  const manufacturerTokens = comparable(manufacturer).split("-").filter(Boolean);
  let productTokens = comparable(product).split("-").filter(Boolean);
  if (
    manufacturerTokens.length > 0 &&
    manufacturerTokens.every((token, index) => productTokens[index] === token)
  ) {
    productTokens = productTokens.slice(manufacturerTokens.length);
  }
  if (productTokens.join("-") === manufacturerTokens.join("-")) {
    productTokens = [];
  }
  return [releaseYear || "", ...manufacturerTokens, ...productTokens]
    .filter(Boolean)
    .join("-");
}

function actualPsaReleaseSlug(sourceUrl: string) {
  try {
    const parts = new URL(sourceUrl).pathname.split("/").filter(Boolean);
    return comparable(parts[2] || "");
  } catch {
    return "";
  }
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

export function parsePsaAprHtmlChecklist(artifact: ChecklistSourceArtifact): ChecklistImportPlan {
  const html = contentText(artifact);
  const h1 = extractH1(html);
  const target = artifact.targetContext || {};
  const manufacturer = clean(target.manufacturer);
  const product = clean(target.product);
  const releaseYear = clean(target.year) || clean(target.season).match(/\b(?:19|20)\d{2}\b/)?.[0] || null;
  const season = clean(target.season) || releaseYear;
  const sportInfo = sportFrom(target.sport || artifact.sourceUrl);
  const issues: ChecklistImportValidationIssue[] = [];

  if (!manufacturer || !product || (!releaseYear && !season)) {
    issue(
      issues,
      "psa_target_context_missing",
      "error",
      "PSA APR imports require Sentinel target manufacturer, product, and year/season context.",
    );
  }

  const expectedSlug = expectedPsaReleaseSlug(releaseYear, manufacturer, product);
  const actualSlug = actualPsaReleaseSlug(artifact.sourceUrl);
  if (expectedSlug && actualSlug !== expectedSlug) {
    issue(
      issues,
      "psa_release_slug_mismatch",
      "error",
      `PSA release slug ${actualSlug || "(missing)"} did not exactly match target ${expectedSlug}; subset/insert pages cannot satisfy a whole-release checklist.`,
    );
  }

  const expectedTokens = new Set(
    comparable(`${releaseYear || season} ${manufacturer} ${product}`).split("-").filter(Boolean),
  );
  const pageTokens = new Set(comparable(`${h1} ${artifact.sourceUrl}`).split("-").filter(Boolean));
  const missingTokens = [...expectedTokens].filter((token) => !pageTokens.has(token));
  if (missingTokens.length) {
    issue(
      issues,
      "psa_target_identity_mismatch",
      "error",
      `PSA page did not visibly match target tokens: ${missingTokens.join(", ")}.`,
    );
  }

  if (!/\bItems in Set\b/i.test(htmlText(html))) {
    issue(
      issues,
      "psa_items_in_set_missing",
      "error",
      "PSA APR page did not expose an Items in Set section.",
    );
  }

  if (hasPagination(html)) {
    issue(
      issues,
      "psa_apr_pagination_incomplete",
      "error",
      "PSA APR set is paginated; Sentinel must collect every page before Registry promotion.",
    );
  }

  const rawRows = tableRows(html);
  if (!rawRows.length) {
    issue(
      issues,
      "psa_apr_rows_missing",
      "error",
      "PSA APR page did not expose deterministic No./Subject/Auction Results rows.",
    );
  }

  const setSourceKey = "psa:base-set";
  const cards: ChecklistImportCard[] = [];
  const parallelByName = new Map<string, ChecklistImportParallel>();

  rawRows.forEach((cells, index) => {
    const cardNumber = clean(cells[0]).replace(/^#\s*/, "");
    const rawSubject = clean(cells[1]);
    const parsed = parseSubject(rawSubject);
    if (!cardNumber || !parsed.player) {
      issue(
        issues,
        "psa_apr_row_incomplete",
        "error",
        "PSA APR row is missing card number or subject.",
        `row-${index + 1}`,
      );
      return;
    }
    const cardSourceKey = `psa:${index + 1}:${comparable(cardNumber)}:${comparable(rawSubject)}`;
    cards.push({
      sourceKey: cardSourceKey,
      setSourceKey,
      cardNumber,
      players: [parsed.player],
      teams: [],
      rookieDesignation: null,
      firstBowmanDesignation: null,
      autographStatus: parsed.autographStatus,
      memorabiliaStatus: parsed.memorabiliaStatus,
      variation: parsed.descriptor,
      sourceNotes: `PSA APR subject: ${rawSubject}`,
    });
    if (parsed.parallel) {
      const key = comparable(parsed.parallel);
      if (!parallelByName.has(key)) {
        parallelByName.set(key, {
          sourceKey: `psa:parallel:${key}`,
          setSourceKey,
          name: parsed.parallel,
          serialRun: null,
          configurationExclusivity: null,
        });
      }
    }
  });

  if (cards.length > 0 && cards.length < 5) {
    issue(
      issues,
      "psa_apr_thin_set",
      "warning",
      `PSA APR exposed only ${cards.length} row${cards.length === 1 ? "" : "s"}; retain source provenance for review.`,
    );
  }

  const parallels = [...parallelByName.values()];
  const identities = cards.map((card) => {
    const parsed = parseSubject(clean(card.sourceNotes).replace(/^PSA APR subject:\s*/i, ""));
    const parallel = parsed.parallel ? parallelByName.get(comparable(parsed.parallel)) || null : null;
    return {
      cardSourceKey: card.sourceKey,
      parallelSourceKey: parallel?.sourceKey || null,
      fingerprint: buildChecklistIdentityFingerprint({
        releaseYear,
        season,
        manufacturer: manufacturer || "Unknown",
        brand: manufacturer || null,
        product: product || "Unknown",
        sport: sportInfo.sport,
        league: sportInfo.league,
        setName: "Base Set",
        cardNumber: card.cardNumber,
        players: card.players,
        parallel: parallel?.name || null,
        variation: card.variation,
        autographStatus: card.autographStatus,
        memorabiliaStatus: card.memorabiliaStatus,
      }),
    };
  });

  const slug = releaseSlug(artifact);
  const storage = buildChecklistSourceStorageReceipt({
    manufacturerSlug: manufacturer || "psa-reference",
    releaseSlug: slug,
    originalFilename: artifact.archiveFilename || artifact.originalFilename,
    mimeType: artifact.archiveMimeType || artifact.mimeType,
    content: artifact.archiveContent ?? artifact.content,
  });
  const hasErrors = issues.some((entry) => entry.severity === "error");

  return {
    schema: "tcos.checklist.importPlan.v1",
    adapterId: PSA_APR_HTML_ADAPTER_ID,
    adapterVersion: PSA_APR_HTML_ADAPTER_VERSION,
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
      manufacturer: manufacturer || "Unknown",
      brand: manufacturer || null,
      product: product || "Unknown",
      releaseYear,
      season,
      sport: sportInfo.sport,
      league: sportInfo.league,
      releaseSlug: slug,
    },
    sets: [
      {
        sourceKey: setSourceKey,
        name: "Base Set",
        normalizedName: "base-set",
        setType: "base",
      },
    ],
    cards,
    parallels,
    identities,
    validation: {
      status: hasErrors ? "validation_required" : "passed",
      issues,
      counts: {
        sets: 1,
        cards: cards.length,
        parallels: parallels.length,
        identities: identities.length,
      },
    },
  };
}

export const psaAprHtmlChecklistAdapter: ChecklistSourceAdapter = {
  id: PSA_APR_HTML_ADAPTER_ID,
  version: PSA_APR_HTML_ADAPTER_VERSION,
  supports(artifact) {
    return (
      artifact.mimeType.toLowerCase() === "text/html" &&
      /^https:\/\/(?:www\.)?psacard\.com\/auctionprices\/[^/]+\/[^/]+\/\d+(?:[/?#]|$)/i.test(
        artifact.sourceUrl,
      )
    );
  },
  parse: parsePsaAprHtmlChecklist,
};
