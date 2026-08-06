import "server-only";

import type { InstaCompChecklistCandidate } from "./instacomp-checklist-first";
import {
  INSTACOMP_PARALLEL_COLORS,
  INSTACOMP_PARALLEL_PATTERNS,
  resolveChecklistParallelFromVisualFeatures,
  type InstaCompParallelColor,
  type InstaCompParallelPattern,
  type InstaCompParallelVisualFeatures,
} from "./instacomp-parallel-pattern-matcher";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

export type ParallelVisionDecision = {
  status: "resolved" | "ambiguous" | "not_configured" | "error";
  selectedParallel: string | null;
  selectedIdentityId: string | null;
  confidence: number;
  evidence: string;
  candidateParallels: string[];
  features: InstaCompParallelVisualFeatures;
  matchedIdentityIds: string[];
  rejectionReasons: Record<string, string[]>;
};

const EMPTY_FEATURES: InstaCompParallelVisualFeatures = {
  dominantColor: null,
  pattern: "uncertain",
  serialStampPresent: null,
  serialStampText: null,
  serialRun: null,
  autographPresent: null,
  relicPresent: null,
  confidence: 0,
  evidence: [],
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}_/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function confidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function stringOrNull(value: unknown, maximum = 160) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function positiveIntegerOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedEvidence(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
}

function colorOrNull(value: unknown): InstaCompParallelColor | null {
  const target = normalized(value).replace(/\s+/g, "_");
  return (INSTACOMP_PARALLEL_COLORS as readonly string[]).includes(target)
    ? (target as InstaCompParallelColor)
    : null;
}

function patternOrUncertain(value: unknown): InstaCompParallelPattern {
  const target = normalized(value).replace(/\s+/g, "_");
  return (INSTACOMP_PARALLEL_PATTERNS as readonly string[]).includes(target)
    ? (target as InstaCompParallelPattern)
    : "uncertain";
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Parallel feature reader returned no JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function uniqueCandidates(candidates: InstaCompChecklistCandidate[]) {
  const byIdentity = new Map<string, InstaCompChecklistCandidate>();
  for (const candidate of candidates) {
    if (candidate.identityId) byIdentity.set(candidate.identityId, candidate);
  }
  return [...byIdentity.values()];
}

function candidateLabels(candidates: InstaCompChecklistCandidate[]) {
  return candidates.map((candidate) => ({
    identityId: candidate.identityId,
    parallel: candidate.parallel || "Base",
    variation: candidate.variation || null,
    serialRun: candidate.serialRun || null,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
  }));
}

export async function resolveChecklistParallelFromVision(params: {
  frontDataUrl: string;
  backDataUrl?: string | null;
  candidates: InstaCompChecklistCandidate[];
}): Promise<ParallelVisionDecision> {
  const candidates = uniqueCandidates(params.candidates);
  const candidateParallels = Array.from(
    new Set(candidates.map((candidate) => candidate.parallel || "Base")),
  );

  if (!candidates.length) {
    return {
      status: "ambiguous",
      selectedParallel: null,
      selectedIdentityId: null,
      confidence: 0,
      evidence: "The checklist returned no valid identities for this card.",
      candidateParallels: [],
      features: EMPTY_FEATURES,
      matchedIdentityIds: [],
      rejectionReasons: {},
    };
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      status: "not_configured",
      selectedParallel: null,
      selectedIdentityId: null,
      confidence: 0,
      evidence:
        "OPENAI_API_KEY is not configured for checklist-constrained visual feature extraction.",
      candidateParallels,
      features: EMPTY_FEATURES,
      matchedIdentityIds: [],
      rejectionReasons: {},
    };
  }

  const model =
    String(
      process.env.INSTACOMP_PARALLEL_MODEL ||
        process.env.INSTACOMP_OPENAI_MODEL ||
        "gpt-4.1",
    ).trim() || "gpt-4.1";

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "You are the TCOS sports-card surface-feature reader.",
        "Do NOT choose a checklist identity and do NOT repeat a prior scanner label.",
        "Extract only what is visibly present on the FRONT and BACK, then software will match those features to the live checklist.",
        "Read the core visual facts independently: parallel treatment color, surface pattern geometry, serial stamp, autograph, and relic window.",
        "COLOR means the parallel foil/border treatment, not the player's uniform, team logo, photograph, or background scene.",
        "PATTERN DEFINITIONS:",
        "- velocity: orderly repeated diagonal bands, chevrons, arrows, or speed lines that all travel in a consistent direction.",
        "- cracked_ice: irregular random polygonal shards or shattered-glass facets with no single directional flow.",
        "- wave: repeated curved or sinusoidal lines.",
        "- pulsar: repeated radiating starburst or dotted pulse shapes.",
        "- mojo: repeated circular or ring-like tiled cells.",
        "- shimmer: fine glittering linear shimmer texture.",
        "- disco: repeated round bubbles or circles.",
        "- solid_prizm: colored or silver refractor/prizm foil with no named geometric texture.",
        "- base: no colored refractor treatment, no special geometric parallel texture, and no serial stamp.",
        "Velocity and Cracked Ice are never interchangeable. Directional speed-line geometry is Velocity. Random shattered polygon geometry is Cracked Ice.",
        "A Green Prizm or other colored solid prizm is not Base merely because the back lacks a separate PRIZM word.",
        "Read an exact serial stamp when visible, including its denominator. Do not infer a denominator from the checklist.",
        `The checklist candidates exist only to show which visual distinctions matter: ${JSON.stringify(candidateLabels(candidates))}`,
        "Return JSON only.",
      ].join("\n"),
    },
    { type: "text", text: "FRONT SIDE" },
    {
      type: "image_url",
      image_url: { url: params.frontDataUrl, detail: "high" },
    },
  ];
  if (params.backDataUrl) {
    content.push(
      { type: "text", text: "BACK SIDE" },
      {
        type: "image_url",
        image_url: { url: params.backDataUrl, detail: "high" },
      },
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(75_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "instacomp_parallel_visual_features",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                dominantColor: {
                  anyOf: [
                    {
                      type: "string",
                      enum: [...INSTACOMP_PARALLEL_COLORS],
                    },
                    { type: "null" },
                  ],
                },
                pattern: {
                  type: "string",
                  enum: [...INSTACOMP_PARALLEL_PATTERNS],
                },
                serialStampPresent: {
                  anyOf: [{ type: "boolean" }, { type: "null" }],
                },
                serialStampText: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                serialRun: {
                  anyOf: [
                    { type: "integer", minimum: 1, maximum: 1000000 },
                    { type: "null" },
                  ],
                },
                autographPresent: {
                  anyOf: [{ type: "boolean" }, { type: "null" }],
                },
                relicPresent: {
                  anyOf: [{ type: "boolean" }, { type: "null" }],
                },
                confidence: { type: "number" },
                evidence: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 20,
                },
              },
              required: [
                "dominantColor",
                "pattern",
                "serialStampPresent",
                "serialStampText",
                "serialRun",
                "autographPresent",
                "relicPresent",
                "confidence",
                "evidence",
              ],
            },
          },
        },
        messages: [{ role: "user", content }],
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Parallel feature reader returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    const payload = JSON.parse(body);
    const parsed = parseJsonObject(
      String(payload?.choices?.[0]?.message?.content || ""),
    );
    const features: InstaCompParallelVisualFeatures = {
      dominantColor: colorOrNull(parsed.dominantColor),
      pattern: patternOrUncertain(parsed.pattern),
      serialStampPresent: booleanOrNull(parsed.serialStampPresent),
      serialStampText: stringOrNull(parsed.serialStampText, 120),
      serialRun: positiveIntegerOrNull(parsed.serialRun),
      autographPresent: booleanOrNull(parsed.autographPresent),
      relicPresent: booleanOrNull(parsed.relicPresent),
      confidence: confidence(parsed.confidence),
      evidence: normalizedEvidence(parsed.evidence),
    };
    const decision = resolveChecklistParallelFromVisualFeatures({
      candidates,
      features,
    });
    return decision;
  } catch (error) {
    return {
      status: "error",
      selectedParallel: null,
      selectedIdentityId: null,
      confidence: 0,
      evidence: sanitizeInstaCompProviderError(
        error instanceof Error
          ? error.message
          : "Parallel feature extraction failed.",
      ),
      candidateParallels,
      features: EMPTY_FEATURES,
      matchedIdentityIds: [],
      rejectionReasons: {},
    };
  }
}
