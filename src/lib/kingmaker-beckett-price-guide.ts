import { createHash } from "node:crypto";
import { z } from "zod";

import {
  buildKingmakerEntityKey,
  type KingmakerObservationInput,
} from "./kingmaker-intelligence-fusion";

export const KINGMAKER_BECKETT_BUNDLE_SCHEMA =
  "tcos.kingmaker.beckettPriceGuideBundle.v1" as const;
export const KINGMAKER_BECKETT_PARSER_VERSION = "1.1.0" as const;

export const BeckettEntryKindSchema = z.enum([
  "card",
  "complete_set",
  "common",
  "semistar",
  "unlisted_star",
  "wrapper",
  "multiplier",
  "other",
]);

export const BeckettPriceGuideManifestSchema = z.object({
  schema: z.literal(KINGMAKER_BECKETT_BUNDLE_SCHEMA),
  parserVersion: z.string().min(1),
  guide: z.object({
    title: z.string().min(1),
    sport: z.string().min(1),
    issueCode: z.string().nullable().optional(),
    editionDate: z.string().date(),
    originalFilename: z.string().min(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageCount: z.number().int().positive(),
    priceGuideStartPage: z.number().int().positive(),
    priceGuideEndPage: z.number().int().positive(),
    redistributionAllowed: z.literal(false),
  }),
  files: z.object({
    pages: z.string().min(1),
    entries: z.string().min(1),
    originalPdf: z.string().nullable().optional(),
  }),
  counts: z.object({
    pages: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  extraction: z.object({
    engine: z.string().min(1),
    generatedAt: z.string().datetime(),
    command: z.string().nullable().optional(),
  }),
});

export const BeckettPriceGuidePageSchema = z.object({
  pageNumber: z.number().int().positive(),
  printedPageNumber: z.string().nullable().optional(),
  sectionName: z.string().nullable().optional(),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  ocrEngine: z.string().min(1),
  ocrConfidence: z.number().min(0).max(1).nullable().optional(),
  ocrText: z.string().nullable().optional(),
  layout: z.record(z.unknown()).default({}),
  status: z.enum(["parsed", "validation_required", "accepted", "rejected"]),
  metadata: z.record(z.unknown()).default({}),
});

export const BeckettPriceGuideEntrySchema = z
  .object({
    pageNumber: z.number().int().positive(),
    rowOrder: z.number().int().nonnegative(),
    sourceRowKey: z.string().min(1),
    entryKind: BeckettEntryKindSchema,
    releaseYear: z.string().nullable().optional(),
    season: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    brand: z.string().nullable().optional(),
    product: z.string().nullable().optional(),
    setName: z.string().nullable().optional(),
    parallelName: z.string().nullable().optional(),
    cardNumber: z.string().nullable().optional(),
    playerName: z.string().nullable().optional(),
    teamName: z.string().nullable().optional(),
    rookieDesignation: z.boolean().nullable().optional(),
    autographDesignation: z.boolean().nullable().optional(),
    memorabiliaDesignation: z.boolean().nullable().optional(),
    shortPrintDesignation: z.boolean().nullable().optional(),
    errorDesignation: z.boolean().nullable().optional(),
    variation: z.string().nullable().optional(),
    serialRun: z.number().int().positive().nullable().optional(),
    conditionBasis: z.string().nullable().optional(),
    valueLow: z.number().nonnegative().nullable().optional(),
    valueHigh: z.number().nonnegative().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
    multiplierLow: z.number().nonnegative().nullable().optional(),
    multiplierHigh: z.number().nonnegative().nullable().optional(),
    rawText: z.string().min(1),
    parseConfidence: z.number().min(0).max(1),
    validationStatus: z.enum(["accepted", "review", "rejected"]),
    validationReasons: z.array(z.string()).default([]),
    entityKey: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).default({}),
  })
  .superRefine((entry, context) => {
    const hasPrice = entry.valueLow != null || entry.valueHigh != null;
    const hasMultiplier =
      entry.multiplierLow != null || entry.multiplierHigh != null;
    if (!hasPrice && !hasMultiplier) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A price entry requires a value or multiplier.",
      });
    }
    if (
      entry.valueLow != null &&
      entry.valueHigh != null &&
      entry.valueLow > entry.valueHigh
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "valueLow cannot exceed valueHigh.",
      });
    }
    if (entry.entryKind === "card") {
      for (const [field, value] of [
        ["cardNumber", entry.cardNumber],
        ["playerName", entry.playerName],
      ] as const) {
        if (!clean(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `Card entries require ${field}.`,
          });
        }
      }
    }
  });

export type BeckettPriceGuideManifest = z.infer<
  typeof BeckettPriceGuideManifestSchema
>;
export type BeckettPriceGuidePage = z.infer<
  typeof BeckettPriceGuidePageSchema
>;
export type BeckettPriceGuideEntry = z.infer<
  typeof BeckettPriceGuideEntrySchema
>;

export function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function comparable(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildBeckettSourceRowKey(input: {
  sourceSha256: string;
  pageNumber: number;
  rowOrder: number;
  rawText: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha256: input.sourceSha256,
        pageNumber: input.pageNumber,
        rowOrder: input.rowOrder,
        rawText: clean(input.rawText),
      }),
    )
    .digest("hex");
}

export function buildBeckettEntityKey(
  manifest: BeckettPriceGuideManifest,
  entry: BeckettPriceGuideEntry,
) {
  const subject =
    clean(entry.playerName) ||
    clean(entry.setName) ||
    clean(entry.product) ||
    entry.entryKind.replaceAll("_", " ");
  const grade = clean(entry.conditionBasis) || "raw";
  return buildKingmakerEntityKey({
    category: manifest.guide.sport,
    year: entry.releaseYear || entry.season,
    manufacturer: entry.manufacturer,
    subject,
    set: [entry.product, entry.setName].map(clean).filter(Boolean).join(" - "),
    cardNumber: entry.cardNumber,
    parallel: entry.parallelName,
    grade,
  });
}

export function validateBeckettEntry(
  manifest: BeckettPriceGuideManifest,
  rawEntry: unknown,
) {
  const parsed = BeckettPriceGuideEntrySchema.parse(rawEntry);
  const expectedRowKey = buildBeckettSourceRowKey({
    sourceSha256: manifest.guide.sourceSha256,
    pageNumber: parsed.pageNumber,
    rowOrder: parsed.rowOrder,
    rawText: parsed.rawText,
  });
  if (parsed.sourceRowKey !== expectedRowKey) {
    throw new Error(
      `Source-row key mismatch on page ${parsed.pageNumber}, row ${parsed.rowOrder}.`,
    );
  }
  if (
    parsed.pageNumber < manifest.guide.priceGuideStartPage ||
    parsed.pageNumber > manifest.guide.priceGuideEndPage
  ) {
    throw new Error(
      `Page ${parsed.pageNumber} is outside the declared price-guide range.`,
    );
  }
  return {
    ...parsed,
    entityKey: parsed.entityKey || buildBeckettEntityKey(manifest, parsed),
  };
}

export function beckettEntryToObservations(
  manifest: BeckettPriceGuideManifest,
  entry: BeckettPriceGuideEntry,
): KingmakerObservationInput[] {
  if (entry.validationStatus !== "accepted") return [];
  const entityKey = entry.entityKey || buildBeckettEntityKey(manifest, entry);
  const baseEvidence = {
    sourceKind: "printed_price_guide",
    publisher: "Beckett",
    guideTitle: manifest.guide.title,
    issueCode: manifest.guide.issueCode || null,
    editionDate: manifest.guide.editionDate,
    pageNumber: entry.pageNumber,
    sourceRowKey: entry.sourceRowKey,
    entryKind: entry.entryKind,
    releaseYear: entry.releaseYear || null,
    manufacturer: entry.manufacturer || null,
    product: entry.product || null,
    setName: entry.setName || null,
    parallelName: entry.parallelName || null,
    cardNumber: entry.cardNumber || null,
    playerName: entry.playerName || null,
    conditionBasis: entry.conditionBasis || null,
    parseConfidence: entry.parseConfidence,
  };
  const observations: KingmakerObservationInput[] = [];
  if (entry.valueLow != null) {
    observations.push({
      source: "beckett",
      sourceRecordKey: `${entry.sourceRowKey}:low`,
      entityKey,
      observationType: "book_value_low",
      observedAt: `${manifest.guide.editionDate}T00:00:00.000Z`,
      expiresAt: null,
      confidence: entry.parseConfidence,
      amount: entry.valueLow,
      currency: entry.currency,
      directUrl: null,
      evidence: { ...baseEvidence, valueSide: "low" },
    });
  }
  if (entry.valueHigh != null) {
    observations.push({
      source: "beckett",
      sourceRecordKey: `${entry.sourceRowKey}:high`,
      entityKey,
      observationType: "book_value_high",
      observedAt: `${manifest.guide.editionDate}T00:00:00.000Z`,
      expiresAt: null,
      confidence: entry.parseConfidence,
      amount: entry.valueHigh,
      currency: entry.currency,
      directUrl: null,
      evidence: { ...baseEvidence, valueSide: "high" },
    });
  }
  return observations;
}
