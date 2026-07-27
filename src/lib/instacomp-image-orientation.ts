import sharp from "sharp";
import {
  instaCompImageDataUrl,
  instaCompImageExtension,
  readValidatedInstaCompImage,
  type InstaCompImageMime,
} from "./instacomp-image-safety";

export type InstaCompRotation = 0 | 90 | 180 | 270;

export type InstaCompOrientationDecision = {
  status: "completed" | "not_configured" | "error";
  model: string | null;
  frontRotation: InstaCompRotation;
  backRotation: InstaCompRotation;
  frontConfidence: number;
  backConfidence: number;
  reason: string;
};

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

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Orientation model returned no JSON object.");
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
        process.env.INSTACOMP_OPENAI_FALLBACK_MODEL ||
        "gpt-4.1-mini",
    ).trim() || "gpt-4.1-mini";

  if (!apiKey) {
    return {
      status: "not_configured",
      model: null,
      frontRotation: 0,
      backRotation: 0,
      frontConfidence: 0,
      backConfidence: 0,
      reason: "OPENAI_API_KEY is not configured; only embedded EXIF orientation can be normalized.",
    };
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "You are the TCOS sports-card orientation referee.",
        "Judge FRONT and BACK independently. Return the clockwise rotation needed to make each physical card upright and readable.",
        "Allowed values are exactly 0, 90, 180, or 270 degrees.",
        "Use printed player names, team names, logos, card numbers, copyright text, grading labels, and serial stamps as orientation evidence.",
        "A horizontal card may correctly require 90 or 270 degrees. The back may require a different rotation from the front.",
        "Do not identify, price, or compare the card. Return JSON only.",
      ].join("\n"),
    },
    { type: "text", text: "FRONT SIDE" },
    { type: "image_url", image_url: { url: params.frontDataUrl, detail: "low" } },
  ];
  if (params.backDataUrl) {
    content.push(
      { type: "text", text: "BACK SIDE" },
      { type: "image_url", image_url: { url: params.backDataUrl, detail: "low" } },
    );
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(45_000),
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
                reason: { type: "string" },
              },
              required: [
                "frontRotation",
                "backRotation",
                "frontConfidence",
                "backConfidence",
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
      throw new Error(`Orientation model returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const payload = JSON.parse(body);
    const parsed = parseJsonObject(String(payload?.choices?.[0]?.message?.content || ""));
    return {
      status: "completed",
      model,
      frontRotation: normalizeInstaCompRotation(parsed.frontRotation),
      backRotation: params.backDataUrl ? normalizeInstaCompRotation(parsed.backRotation) : 0,
      frontConfidence: normalizedConfidence(parsed.frontConfidence),
      backConfidence: params.backDataUrl ? normalizedConfidence(parsed.backConfidence) : 0,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim().slice(0, 500)
          : "No orientation reason returned.",
    };
  } catch (error) {
    return {
      status: "error",
      model,
      frontRotation: 0,
      backRotation: 0,
      frontConfidence: 0,
      backConfidence: 0,
      reason: error instanceof Error ? error.message : "Orientation detection failed.",
    };
  }
}

export async function rotateInstaCompImageBytes(params: {
  bytes: Uint8Array;
  mime: InstaCompImageMime;
  rotation: InstaCompRotation;
}) {
  let pipeline = sharp(Buffer.from(params.bytes), { failOn: "warning" })
    .rotate()
    .rotate(params.rotation);
  if (params.mime === "image/png") pipeline = pipeline.png();
  else if (params.mime === "image/webp") pipeline = pipeline.webp({ quality: 95 });
  else pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
  return new Uint8Array(await pipeline.toBuffer());
}

export async function normalizeInstaCompSideImages(params: {
  frontImage: File;
  backImage?: File | null;
}) {
  const front = await readValidatedInstaCompImage(params.frontImage, "Front image");
  const back = params.backImage
    ? await readValidatedInstaCompImage(params.backImage, "Back image")
    : null;
  const orientation = await detectInstaCompSideOrientations({
    frontDataUrl: front.dataUrl,
    backDataUrl: back?.dataUrl || null,
  });
  const [frontBytes, backBytes] = await Promise.all([
    rotateInstaCompImageBytes({
      bytes: front.bytes,
      mime: front.mime,
      rotation: orientation.frontRotation,
    }),
    back
      ? rotateInstaCompImageBytes({
          bytes: back.bytes,
          mime: back.mime,
          rotation: orientation.backRotation,
        })
      : Promise.resolve(null),
  ]);
  const frontFile = new File(
    [frontBytes],
    `front-normalized.${instaCompImageExtension(front.mime)}`,
    { type: front.mime },
  );
  const backFile = back && backBytes
    ? new File(
        [backBytes],
        `back-normalized.${instaCompImageExtension(back.mime)}`,
        { type: back.mime },
      )
    : null;
  return {
    frontFile,
    backFile,
    frontDataUrl: instaCompImageDataUrl(frontBytes, front.mime),
    backDataUrl: back && backBytes ? instaCompImageDataUrl(backBytes, back.mime) : undefined,
    orientation,
  };
}
