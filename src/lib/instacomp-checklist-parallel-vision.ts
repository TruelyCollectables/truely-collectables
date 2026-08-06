import "server-only";

import type { InstaCompChecklistCandidate } from "./instacomp-checklist-first";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

type ParallelVisionDecision = {
  status: "resolved" | "ambiguous" | "not_configured" | "error";
  selectedParallel: string | null;
  selectedIdentityId: string | null;
  confidence: number;
  evidence: string;
  candidateParallels: string[];
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function confidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function uniqueCandidates(candidates: InstaCompChecklistCandidate[]) {
  const byIdentity = new Map<string, InstaCompChecklistCandidate>();
  for (const candidate of candidates) {
    if (!candidate.identityId) continue;
    byIdentity.set(candidate.identityId, candidate);
  }
  return [...byIdentity.values()];
}

function exactCandidateForParallel(
  candidates: InstaCompChecklistCandidate[],
  parallel: unknown,
) {
  const target = normalized(parallel);
  if (!target) return null;
  const matches = candidates.filter(
    (candidate) => normalized(candidate.parallel || "Base") === target,
  );
  return matches.length === 1 ? matches[0] : null;
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Parallel referee returned no JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function resolveChecklistParallelFromVision(params: {
  frontDataUrl: string;
  backDataUrl?: string | null;
  candidates: InstaCompChecklistCandidate[];
  aiParallel?: string | null;
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
    };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    return {
      status: "resolved",
      selectedParallel: only.parallel || "Base",
      selectedIdentityId: only.identityId,
      confidence: 1,
      evidence: "Only one checklist identity exists after the printed identity fields were matched.",
      candidateParallels,
    };
  }

  const aiCandidate = exactCandidateForParallel(candidates, params.aiParallel);
  if (aiCandidate) {
    return {
      status: "resolved",
      selectedParallel: aiCandidate.parallel || "Base",
      selectedIdentityId: aiCandidate.identityId,
      confidence: 0.9,
      evidence: "The scan parallel exactly matched one valid checklist identity.",
      candidateParallels,
    };
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      status: "not_configured",
      selectedParallel: null,
      selectedIdentityId: null,
      confidence: 0,
      evidence: "OPENAI_API_KEY is not configured for checklist-constrained parallel review.",
      candidateParallels,
    };
  }

  const model =
    String(
      process.env.INSTACOMP_PARALLEL_MODEL ||
        process.env.INSTACOMP_OPENAI_MODEL ||
        "gpt-4.1",
    ).trim() || "gpt-4.1";
  const labels = candidates.map((candidate) => ({
    identityId: candidate.identityId,
    parallel: candidate.parallel || "Base",
    variation: candidate.variation || null,
    serialRun: candidate.serialRun || null,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
  }));

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "You are the TCOS checklist-constrained sports-card parallel referee.",
        "The card's year, manufacturer, card number, and player already matched the checklist.",
        "Choose only from the supplied checklist identity IDs. Never invent a parallel.",
        "Judge foil color, border color, background pattern, refractor/prizm finish, wave/ice/velocity pattern, serial stamp, autograph, memorabilia, and variation marks visible on the FRONT and BACK.",
        "The absence of a standalone PRIZM word on the back is NOT evidence that the card is Base.",
        "Choose Base only when the visible design is consistent with Base and no listed parallel treatment is visible.",
        "If the images do not distinguish one identity with high confidence, return selectedIdentityId=null.",
        `VALID CHECKLIST IDENTITIES: ${JSON.stringify(labels)}`,
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
      signal: AbortSignal.timeout(60_000),
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
            name: "instacomp_checklist_parallel",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                selectedIdentityId: {
                  anyOf: [{ type: "string" }, { type: "null" }],
                },
                confidence: { type: "number" },
                evidence: { type: "string" },
              },
              required: ["selectedIdentityId", "confidence", "evidence"],
            },
          },
        },
        messages: [{ role: "user", content }],
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Parallel referee returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    const payload = JSON.parse(body);
    const parsed = parseJsonObject(
      String(payload?.choices?.[0]?.message?.content || ""),
    );
    const selectedId = String(parsed.selectedIdentityId || "").trim();
    const selected = candidates.find(
      (candidate) => candidate.identityId === selectedId,
    );
    const score = confidence(parsed.confidence);
    const evidence = sanitizeInstaCompProviderError(
      String(parsed.evidence || "No parallel evidence returned."),
    );

    if (!selected || score < 0.78) {
      return {
        status: "ambiguous",
        selectedParallel: null,
        selectedIdentityId: null,
        confidence: score,
        evidence,
        candidateParallels,
      };
    }

    return {
      status: "resolved",
      selectedParallel: selected.parallel || "Base",
      selectedIdentityId: selected.identityId,
      confidence: score,
      evidence,
      candidateParallels,
    };
  } catch (error) {
    return {
      status: "error",
      selectedParallel: null,
      selectedIdentityId: null,
      confidence: 0,
      evidence: sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : "Parallel review failed.",
      ),
      candidateParallels,
    };
  }
}
