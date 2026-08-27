import {
  instaCompImageDataUrl,
  instaCompImageExtension,
  readValidatedInstaCompImage,
  type InstaCompImageMime,
} from "./instacomp-image-safety";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

const requestedMinimumOrientationConfidence = Number(
  process.env.INSTACOMP_ORIENTATION_MIN_CONFIDENCE || 0.55,
);
const MINIMUM_ORIENTATION_CONFIDENCE = Number.isFinite(
  requestedMinimumOrientationConfidence,
)
  ? Math.max(0.5, Math.min(0.99, requestedMinimumOrientationConfidence))
  : 0.55;

type CloudflareFetchGlobal = typeof globalThis & {
  __TRUELY_CLOUDFLARE_NATIVE_FETCH__?: typeof fetch;
};

export type InstaCompRotation = 0 | 90 | 180 | 270;

export type InstaCompOrientationDecision = {
  status: "completed" | "not_configured" | "error";
  model: string | null;
  frontRotation: InstaCompRotation;
  backRotation: InstaCompRotation;
  frontConfidence: number;
  backConfidence: number;
  frontEvidenceText: string[];
  backEvidenceText: string[];
  backStandalonePrizm: boolean | null;
  backDesignationConfidence: number;
  reason: string;
};

function runningOnCloudflareWorker() {
  return typeof (globalThis as CloudflareFetchGlobal)
    .__TRUELY_CLOUDFLARE_NATIVE_FETCH__ === "function";
}

export function normalizeInstaCompRotation(value: unknown): InstaCompRotation {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const normalized = ((Math.round(number / 90) * 90) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

function normalizedConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function normalizedEvidence(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Orientation model returned no JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

export async function detectInstaCompSideOrientations(params: {
  frontDataUrl: string;
  backDataUrl?: string | null;
}): Promise<InstaCompOrientationDecision> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model =
    String(
      process.env.INSTACOMP_ORIENTATION_MODEL ||
        process.env.INSTACOMP_OPENAI_MODEL ||
        "gpt-4.1",
    ).trim() || "gpt-4.1";

  if (!apiKey) {
    return {
      status: "not_configured",
      model: null,
      frontRotation: 0,
      backRotation: 0,
      frontConfidence: 0,
      backConfidence: 0,
      frontEvidenceText: [],
      backEvidenceText: [],
      backStandalonePrizm: null,
      backDesignationConfidence: 0,
      reason:
        "OPENAI_API_KEY is not configured; embedded EXIF orientation was still normalized.",
    };
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "You are the TCOS sports-card text-orientation referee.",
        "Judge FRONT and BACK independently and return the clockwise rotation needed to make the physical card upright.",
        "Allowed rotations are exactly 0, 90, 180, or 270 degrees.",
        "Mentally test all four rotations for each side.",
        "Use the direction of printed writing as the primary evidence: player name, team name, card number, copyright line, statistics, biography, serial stamp, autograph wording, logos containing letters, and grading labels.",
        "The correct rotation makes the majority of readable text run left-to-right and places normal text baselines below the letters rather than above them.",
        "A horizontal card is valid; choose the orientation that makes its writing naturally readable, not the orientation that makes the card portrait-shaped.",
        "Transcribe a few short text fragments from each side that prove the chosen direction.",
        "Do not identify the card, do not determine its parallel, and do not use color or foil to decide orientation.",
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
            name: "instacomp_side_orientation",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                frontRotation: { type: "integer", enum: [0, 90, 180, 270] },
                backRotation: { type: "integer", enum: [0, 90, 180, 270] },
                frontConfidence: { type: "number" },
                backConfidence: { type: "number" },
                frontEvidenceText: { type: "array", items: { type: "string" } },
                backEvidenceText: { type: "array", items: { type: "string" } },
                reason: { type: "string" },
              },
              required: [
                "frontRotation",
                "backRotation",
                "frontConfidence",
                "backConfidence",
                "frontEvidenceText",
                "backEvidenceText",
                "reason",
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
        `Orientation model returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    const payload = JSON.parse(body);
    const parsed = parseJsonObject(
      String(payload?.choices?.[0]?.message?.content || ""),
    );
    const frontConfidence = normalizedConfidence(parsed.frontConfidence);
    const backConfidence = params.backDataUrl
      ? normalizedConfidence(parsed.backConfidence)
      : 0;
    const recommendedFrontRotation = normalizeInstaCompRotation(parsed.frontRotation);
    const recommendedBackRotation = params.backDataUrl
      ? normalizeInstaCompRotation(parsed.backRotation)
      : 0;
    const frontRotation =
      frontConfidence >= MINIMUM_ORIENTATION_CONFIDENCE
        ? recommendedFrontRotation
        : 0;
    const backRotation =
      backConfidence >= MINIMUM_ORIENTATION_CONFIDENCE
        ? recommendedBackRotation
        : 0;
    const frontEvidenceText = normalizedEvidence(parsed.frontEvidenceText);
    const backEvidenceText = params.backDataUrl
      ? normalizedEvidence(parsed.backEvidenceText)
      : [];
    const lowConfidenceSides = [
      frontRotation !== recommendedFrontRotation ? "front" : "",
      params.backDataUrl && backRotation !== recommendedBackRotation ? "back" : "",
    ].filter(Boolean);
    const baseReason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? sanitizeInstaCompProviderError(parsed.reason)
        : "No orientation reason returned.";
    return {
      status: "completed",
      model,
      frontRotation,
      backRotation,
      frontConfidence,
      backConfidence,
      frontEvidenceText,
      backEvidenceText,
      backStandalonePrizm: null,
      backDesignationConfidence: 0,
      reason: lowConfidenceSides.length
        ? `${baseReason} Rotation was not applied to low-confidence side(s): ${lowConfidenceSides.join(", ")}.`
        : baseReason,
    };
  } catch (error) {
    return {
      status: "error",
      model,
      frontRotation: 0,
      backRotation: 0,
      frontConfidence: 0,
      backConfidence: 0,
      frontEvidenceText: [],
      backEvidenceText: [],
      backStandalonePrizm: null,
      backDesignationConfidence: 0,
      reason: sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : "Orientation detection failed.",
      ),
    };
  }
}

export async function rotateInstaCompImageBytes(params: {
  bytes: Uint8Array;
  mime: InstaCompImageMime;
  rotation: InstaCompRotation;
  addScanFrame?: boolean;
}) {
  if (runningOnCloudflareWorker()) {
    return new Uint8Array(params.bytes);
  }

  const { rotateInstaCompImageBytesWithSharp } = await import(
    "./instacomp-image-orientation-sharp"
  );
  return rotateInstaCompImageBytesWithSharp(params);
}

export async function normalizeInstaCompSideImages(params: {
  frontImage: File;
  backImage?: File | null;
  addScanFrame?: boolean;
}) {
  const front = await readValidatedInstaCompImage(params.frontImage, "Front image");
  const back = params.backImage
    ? await readValidatedInstaCompImage(params.backImage, "Back image")
    : null;

  // Cloudflare cannot run Sharp, but it can and must still obtain the rotation
  // decision. Listing intake forwards that decision to the Mac, which applies
  // it to the archived pixels before the website stores either side.
  const orientation = await detectInstaCompSideOrientations({
    frontDataUrl: front.dataUrl,
    backDataUrl: back?.dataUrl || null,
  });

  const [frontBytes, backBytes] = await Promise.all([
    rotateInstaCompImageBytes({
      bytes: front.bytes,
      mime: front.mime,
      rotation: orientation.frontRotation,
      addScanFrame: params.addScanFrame,
    }),
    back
      ? rotateInstaCompImageBytes({
          bytes: back.bytes,
          mime: back.mime,
          rotation: orientation.backRotation,
          addScanFrame: params.addScanFrame,
        })
      : Promise.resolve(null),
  ]);

  const frontFile = new File(
    [frontBytes],
    `front-normalized-whole-card.${instaCompImageExtension(front.mime)}`,
    { type: front.mime },
  );
  const backFile =
    back && backBytes
      ? new File(
          [backBytes],
          `back-normalized-whole-card.${instaCompImageExtension(back.mime)}`,
          { type: back.mime },
        )
      : null;

  return {
    frontFile,
    backFile,
    frontDataUrl: instaCompImageDataUrl(frontBytes, front.mime),
    backDataUrl:
      back && backBytes ? instaCompImageDataUrl(backBytes, back.mime) : undefined,
    orientation,
  };
}
