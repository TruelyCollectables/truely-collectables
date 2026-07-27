import type { InstaCompAiResult } from "./instacomp";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VISUAL_MODEL =
  process.env.INSTACOMP_COMP_VISUAL_MODEL ||
  process.env.INSTACOMP_OPENAI_FALLBACK_MODEL ||
  "gpt-4.1-mini";
const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VISUAL_CANDIDATES = 8;

type CandidateCategory = string;

export type InstaCompVisualCandidate = {
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceLabel: string;
  sourceCategory: CandidateCategory;
  matchScore: number | null;
  flags: string[];
  soldAt?: string | null;
  listedAt?: string | null;
  observedAt?: string | null;
};

type VisualVerdict = {
  verdict: "exact_visual_match" | "wrong_parallel" | "uncertain";
  confidence: number;
  targetParallel: string | null;
  candidateParallel: string | null;
  titleImageConflict: boolean;
  reason: string;
};

function parseJsonText(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Visual verifier returned no JSON object.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function detectedImageMime(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    view.length >= 12 &&
    String.fromCharCode(...view.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...view.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function dataUrlFromBytes(bytes: ArrayBuffer, contentType: string | null) {
  void contentType;
  const mime = detectedImageMime(bytes);
  if (!mime) throw new Error("Image bytes were not a real JPEG, PNG, or WebP file.");
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function fileToDataUrl(file: File) {
  return dataUrlFromBytes(await file.arrayBuffer(), file.type || "image/jpeg");
}

async function remoteImageToDataUrl(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "TCOS-InstaComp-VisualVerifier/1.0" },
  });
  if (!response.ok) throw new Error(`Candidate image returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("Candidate image was empty or larger than 5MB.");
  }
  return dataUrlFromBytes(bytes, response.headers.get("content-type"));
}

function requiresVisualVerification(candidate: InstaCompVisualCandidate) {
  if (
    candidate.flags.some((flag) =>
      /awaiting image proof|guidance comp|not used for pricing/i.test(flag),
    )
  ) {
    return true;
  }
  if (candidate.flags.some((flag) => /deterministic exact identity/i.test(flag))) return false;
  return candidate.flags.some((flag) =>
    /parallel mismatch|not exact parallel/i.test(flag),
  );
}

function cleanedExactFlags(candidate: InstaCompVisualCandidate, verdict: VisualVerdict) {
  const flags = candidate.flags.filter(
    (flag) =>
      !/parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag),
  );
  flags.push("listing image verified exact parallel");
  flags.push(`visual evidence: ${verdict.reason}`.slice(0, 120));
  if (verdict.titleImageConflict) flags.push("seller title mislabeled");
  return Array.from(new Set(flags)).slice(0, 20);
}

function rejectedFlags(candidate: InstaCompVisualCandidate, verdict: VisualVerdict | null, error?: unknown) {
  const flags = [...candidate.flags];
  if (verdict) {
    flags.push(
      verdict.verdict === "wrong_parallel"
        ? `visual mismatch: ${verdict.reason}`
        : `visual review inconclusive: ${verdict.reason}`,
    );
  } else {
    flags.push(
      `visual verification unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  return Array.from(new Set(flags.map((flag) => flag.slice(0, 120)))).slice(0, 20);
}

function inferredExactCategory(candidate: InstaCompVisualCandidate) {
  if (
    /^openai_web_/i.test(candidate.source) ||
    candidate.flags.some((flag) => /not independently verified for pricing/i.test(flag))
  ) {
    return "reference";
  }
  if (candidate.source === "ebay_active") return "marketplace";
  if (/sold/i.test(candidate.sourceLabel)) return "sold";
  return candidate.sourceCategory;
}

async function verifyOneCandidate(params: {
  targetDataUrl: string;
  targetAi: InstaCompAiResult;
  candidate: InstaCompVisualCandidate;
}): Promise<VisualVerdict> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  if (!params.candidate.imageUrl) throw new Error("Candidate listing has no usable image.");

  const candidateDataUrl = await remoteImageToDataUrl(params.candidate.imageUrl);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(35_000),
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISUAL_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "You are the TCOS image-first exact-card referee.",
                "Compare TARGET CARD IMAGE with CANDIDATE LISTING IMAGE.",
                "Seller titles are untrusted claims. The card images are ground truth.",
                "Judge the complete exact card identity: player, year/product, card number, parallel/variation, serial print-run denominator, autograph/relic state, raw/graded state, grading company, and grade. Color and printed pattern are necessary but not sufficient.",
                "Return JSON only with verdict, confidence, targetParallel, candidateParallel, titleImageConflict, reason.",
                "verdict must be exact_visual_match, wrong_parallel, or uncertain.",
                "Use exact_visual_match only when every identity field visible in both images agrees. Any wrong player, card number, product, parallel, print run, autograph/relic state, grader, or grade must be wrong_parallel or uncertain.",
                "If the image matches but the seller title names another color, use exact_visual_match and titleImageConflict=true.",
                `TARGET IDENTITY: ${JSON.stringify({
                  player: params.targetAi.player,
                  year: params.targetAi.year,
                  brand: params.targetAi.brand,
                  setName: params.targetAi.setName,
                  cardNumber: params.targetAi.cardNumber,
                  parallel: params.targetAi.parallel,
                  serialNumber: params.targetAi.serialNumber,
                  gradingCompany: params.targetAi.gradingCompany,
                  gradeValue: params.targetAi.gradeValue,
                })}`,
                `CANDIDATE SELLER TITLE (untrusted): ${params.candidate.title}`,
              ].join("\n"),
            },
            { type: "text", text: "TARGET CARD IMAGE" },
            { type: "image_url", image_url: { url: params.targetDataUrl, detail: "high" } },
            { type: "text", text: "CANDIDATE LISTING IMAGE" },
            { type: "image_url", image_url: { url: candidateDataUrl, detail: "high" } },
          ],
        },
      ],
    }),
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Visual verifier returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  const payload = JSON.parse(responseText);
  const parsed = parseJsonText(String(payload?.choices?.[0]?.message?.content || ""));
  const confidence = Number(parsed?.confidence);
  const verdict = String(parsed?.verdict || "uncertain") as VisualVerdict["verdict"];
  return {
    verdict: ["exact_visual_match", "wrong_parallel", "uncertain"].includes(verdict)
      ? verdict
      : "uncertain",
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    targetParallel: typeof parsed?.targetParallel === "string" ? parsed.targetParallel : null,
    candidateParallel:
      typeof parsed?.candidateParallel === "string" ? parsed.candidateParallel : null,
    titleImageConflict: parsed?.titleImageConflict === true,
    reason:
      typeof parsed?.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 300)
        : "No visual reason returned.",
  };
}

export async function verifyInstaCompCompetitionImages(params: {
  targetFrontImage: File;
  targetAi: InstaCompAiResult;
  candidates: InstaCompVisualCandidate[];
}) {
  const accepted: InstaCompVisualCandidate[] = [];
  const rejected: InstaCompVisualCandidate[] = [];
  const targetDataUrl = await fileToDataUrl(params.targetFrontImage);
  let reviewedCount = 0;
  let titleOverrides = 0;

  for (const candidate of params.candidates) {
    if (!requiresVisualVerification(candidate)) {
      accepted.push(candidate);
      continue;
    }

    if (reviewedCount >= MAX_VISUAL_CANDIDATES) {
      rejected.push({
        ...candidate,
        flags: [...candidate.flags, "visual review cap reached"].slice(0, 20),
      });
      continue;
    }

    reviewedCount += 1;
    try {
      const verdict = await verifyOneCandidate({
        targetDataUrl,
        targetAi: params.targetAi,
        candidate,
      });
      if (verdict.verdict === "exact_visual_match" && verdict.confidence >= 0.85) {
        if (verdict.titleImageConflict) titleOverrides += 1;
        accepted.push({
          ...candidate,
          sourceCategory: inferredExactCategory(candidate),
          matchScore:
            candidate.matchScore === null
              ? 25
              : Math.max(0, candidate.matchScore + 150) + 25,
          flags: cleanedExactFlags(candidate, verdict),
        });
      } else {
        rejected.push({
          ...candidate,
          flags: rejectedFlags(candidate, verdict),
        });
      }
    } catch (error) {
      rejected.push({
        ...candidate,
        flags: rejectedFlags(candidate, null, error),
      });
    }
  }

  return {
    accepted,
    rejected,
    reviewedCount,
    titleOverrides,
    configured: Boolean(OPENAI_API_KEY),
    model: VISUAL_MODEL,
  };
}
