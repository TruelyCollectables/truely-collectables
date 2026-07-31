import { ebayListingContentProblems } from "./ebay-listing-content";
import {
  handleDualMarketplaceGet,
  handleDualMarketplacePost,
} from "./dual-marketplace-admin-route";
import { MAX_DUAL_MARKETPLACE_REQUEST_ITEMS } from "./dual-marketplace-workflow";

type UnknownRecord = Record<string, unknown>;

const PERCENT_ENV_NAMES = [
  "TCOS_EBAY_FEE_PERCENT",
  "TCOS_EBAY_PROMOTED_PERCENT",
  "TCOS_WEBSITE_PROCESSING_PERCENT",
  "TCOS_MINIMUM_WEBSITE_DISCOUNT_PERCENT",
] as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePercentEnvironment() {
  for (const name of PERCENT_ENV_NAMES) {
    const raw = process.env[name];
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
      process.env[name] = String(parsed / 100);
    }
  }
}

function normalizeCategoryCondition(item: UnknownRecord) {
  const categoryId = text(item.ebayCategoryId);
  const condition = text(item.cardCondition);
  let normalizedCondition = condition;

  if (categoryId === "183454") {
    if (condition === "Excellent") normalizedCondition = "Lightly Played (Excellent)";
    if (condition === "Very Good") normalizedCondition = "Moderately Played (Very Good)";
    if (condition === "Poor") normalizedCondition = "Heavily Played (Poor)";
  } else {
    if (condition === "Lightly Played (Excellent)") normalizedCondition = "Excellent";
    if (condition === "Moderately Played (Very Good)") normalizedCondition = "Very Good";
    if (condition === "Heavily Played (Poor)") normalizedCondition = "Poor";
  }

  return { ...item, cardCondition: normalizedCondition };
}

function prewriteProblems(item: UnknownRecord) {
  const problems: string[] = [];
  const websiteTitle = text(item.websiteTitle);
  const websiteDescription = text(item.websiteDescription);
  const ebayTitle = text(item.ebayTitle);
  const ebayDescription = text(item.ebayDescription);

  if (websiteTitle.length > 200) problems.push("website title is over 200 characters");
  if (websiteDescription.length > 100_000) {
    problems.push("website description is over 100,000 characters");
  }
  if (ebayTitle.length > 80) problems.push("eBay title is over 80 characters");
  if (ebayDescription.length > 100_000) {
    problems.push("eBay description is over 100,000 characters");
  }
  problems.push(...ebayListingContentProblems(ebayDescription));

  for (const [name, rawValues] of Object.entries(record(item.aspects))) {
    if (!name.trim()) problems.push("eBay item-specific name is blank");
    if (name.trim().length > 40) {
      problems.push(`eBay item-specific name is over 40 characters: ${name}`);
    }
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    if (values.some((value) => text(value).length > 50)) {
      problems.push(`eBay item-specific value is over 50 characters: ${name}`);
    }
  }

  return Array.from(new Set(problems));
}

export async function handleGuardedDualMarketplaceGet(request: Request) {
  normalizePercentEnvironment();
  const response = await handleDualMarketplaceGet(request);
  if (!response.ok) return response;

  const data = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.rows)) return Response.json(data);

  data.rows = data.rows.map((row: UnknownRecord) => {
    const lastError = text(row.lastError);
    if (/^Website is active,/i.test(lastError)) {
      return { ...row, websiteStatus: "reconciliation_required" };
    }
    if (/^eBay is live,/i.test(lastError)) {
      return { ...row, ebayStatus: "reconciliation_required" };
    }
    return row;
  });

  return Response.json(data);
}

export async function handleGuardedDualMarketplacePost(request: Request) {
  normalizePercentEnvironment();
  const body = await request.json().catch(() => ({}));
  const items = (Array.isArray(body.items) ? body.items : []).map((item: unknown) =>
    normalizeCategoryCondition(record(item)),
  );

  if (items.length > MAX_DUAL_MARKETPLACE_REQUEST_ITEMS) {
    return Response.json(
      {
        success: false,
        error: `The safe per-request limit is ${MAX_DUAL_MARKETPLACE_REQUEST_ITEMS}; use the listing studio's automatic batching.`,
      },
      { status: 413 },
    );
  }

  const errors = items
    .map((item: UnknownRecord) => {
      const problems = prewriteProblems(item);
      return problems.length
        ? {
            inventoryItemId: text(item.inventoryItemId) || null,
            saved: false,
            error: problems.join("; "),
          }
        : null;
    })
    .filter(Boolean);

  if (errors.length) {
    return Response.json(
      {
        success: false,
        action: text(body.action),
        resultCount: 0,
        errorCount: errors.length,
        results: [],
        errors,
        message: `${errors.length} unsafe or over-limit listing draft${
          errors.length === 1 ? "" : "s"
        } rejected before any database write.`,
      },
      { status: 400 },
    );
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const forwardedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...body, items }),
  });
  return handleDualMarketplacePost(forwardedRequest);
}
