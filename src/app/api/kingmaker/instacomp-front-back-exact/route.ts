import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocal,
  fetchInstaCompAiLocalScanImage,
  type InstaCompAiLocalScan,
} from "../../../../lib/instacomp-ai-local";
import type { InstaCompChecklistCandidate } from "../../../../lib/instacomp-checklist-first";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../lib/instacomp-checklist-first-server";
import {
  titleRegistryDimensionHints,
  titleSerialNumberHint,
} from "../../../../lib/instacomp-title-registry-hints";
import type { ParallelVisionDecision } from "../../../../lib/instacomp-checklist-parallel-vision";
import type { InstaCompCoreVisualEvidence } from "../../../../lib/instacomp-core-visual-evidence";
import {
  persistNormalizedInstaCompImagePair,
  type InstaCompImageOrientationReceipt,
} from "../../../../lib/instacomp-normalized-image-storage";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../lib/instacomp-provider-safety";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type JsonRecord = Record<string, unknown>;
type ImageRow = {
  image_url: string | null;
  alt_text: string | null;
  sort_order: number | null;
  is_primary: boolean | null;
};

type MacReceipt = {
  scanId: string | null;
  status: string | null;
  checklistOutcome: string | null;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  checklistIdentity: JsonRecord | null;
  checklistReasons: string[];
  pricingAllowed: boolean;
  learningAllowed: boolean;
  matchSource: string | null;
  attempts: number;
  canonicalImagesRecovered: boolean;
  imageOrientation: InstaCompAiLocalScan["image_orientation"];
  centering: {
    front: NonNullable<InstaCompAiLocalScan["local_vision"]>["front_centering"] | null;
    back: NonNullable<InstaCompAiLocalScan["local_vision"]>["back_centering"] | null;
  };
  error: string | null;
};

type MacArchiveResult = {
  receipt: MacReceipt;
  frontFile: File | null;
  backFile: File | null;
  orientation: InstaCompImageOrientationReceipt | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 2_000) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validUuid(value: unknown) {
  const normalizedUuid = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalizedUuid,
  )
    ? normalizedUuid
    : null;
}

function quarterTurn(value: unknown): 0 | 90 | 180 | 270 {
  const rotation = ((Math.round(Number(value) || 0) % 360) + 360) % 360;
  return rotation === 90 || rotation === 180 || rotation === 270
    ? rotation
    : 0;
}

function confidence(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function sha256Hex(value: unknown) {
  const hash = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

function trustedStoredPairOrientation(params: {
  previousInstaComp: JsonRecord;
  frontSha256: string;
  backSha256: string;
  hasProvidedPair: boolean;
}): InstaCompImageOrientationReceipt | null {
  if (params.hasProvidedPair) return null;

  const previousFrontSha256 = sha256Hex(params.previousInstaComp.frontSha256);
  const previousBackSha256 = sha256Hex(params.previousInstaComp.backSha256);
  const currentFrontSha256 = sha256Hex(params.frontSha256);
  const currentBackSha256 = sha256Hex(params.backSha256);
  const registryIdentityId = validUuid(
    params.previousInstaComp.registryIdentityId ??
      params.previousInstaComp.cardUuid,
  );
  const registryFingerprintSha256 = sha256Hex(
    params.previousInstaComp.registryFingerprintSha256 ??
      params.previousInstaComp.pricingGroupKey,
  );

  if (
    !previousFrontSha256 ||
    !previousBackSha256 ||
    !currentFrontSha256 ||
    !currentBackSha256 ||
    previousFrontSha256 === previousBackSha256 ||
    previousFrontSha256 !== currentFrontSha256 ||
    previousBackSha256 !== currentBackSha256 ||
    !registryIdentityId ||
    !registryFingerprintSha256 ||
    params.previousInstaComp.imagePersistenceVerified !== true
  ) {
    return null;
  }

  return {
    status: "completed",
    model: "kingmaker_verified_stored_pair_sha256",
    source: "kingmaker_verified_stored_pair_sha256",
    frontRotation: 0,
    backRotation: 0,
    frontConfidence: 1,
    backConfidence: 1,
    frontEvidenceText: [
      "front:current_sha256_matches_previously_verified_canonical_pair",
    ],
    backEvidenceText: [
      "back:current_sha256_matches_previously_verified_canonical_pair",
    ],
    backStandalonePrizm: null,
    backDesignationConfidence: 0,
    reason:
      "Current stored front/back bytes exactly match the previously verified canonical pair, so the Mac may reuse trusted 0-degree orientation while revalidating Registry identity.",
  };
}

function evidence(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, 120))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, 8)
    : [];
}

function textList(value: unknown, limit = 20) {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, 240))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

function registryFingerprintFromReceipts(value: unknown) {
  const receipt = textList(value, 20).find((entry) =>
    entry.startsWith("registry_fingerprint:"),
  );
  return text(receipt?.slice("registry_fingerprint:".length), 80);
}

function completedMacOrientation(
  scan: InstaCompAiLocalScan,
  webOrientation: InstaCompImageOrientationReceipt | null,
): InstaCompImageOrientationReceipt {
  if (!scan.image_orientation && webOrientation?.status === "completed") {
    return {
      ...webOrientation,
      status: "completed",
      reason:
        "The Mac revalidated the exact stored card pair while KINGMAKER preserved the previously verified canonical 0-degree orientation for the same SHA-256 front/back bytes.",
    };
  }

  const receipt = scan.image_orientation || {};
  const source = text(receipt.source, 120) || "mac_local_orientation";
  const frontSource = text(receipt.front_source, 120) || source;
  const backSource = text(receipt.back_source, 120) || source;
  const frontFromWeb = frontSource === "web_openai_orientation";
  const backFromWeb = backSource === "web_openai_orientation";
  const frontConfidence = frontFromWeb
    ? confidence(webOrientation?.frontConfidence)
    : confidence(receipt.front_confidence);
  const backConfidence = backFromWeb
    ? confidence(webOrientation?.backConfidence)
    : confidence(receipt.back_confidence);
  const frontEvidenceText = frontFromWeb
    ? evidence(webOrientation?.frontEvidenceText)
    : evidence(receipt.front_evidence);
  const backEvidenceText = backFromWeb
    ? evidence(webOrientation?.backEvidenceText)
    : evidence(receipt.back_evidence);
  const scanCompleted = text(receipt.status, 80) === "completed";
  const completed =
    scanCompleted &&
    frontConfidence >= MINIMUM_MAC_ORIENTATION_CONFIDENCE &&
    backConfidence >= MINIMUM_MAC_ORIENTATION_CONFIDENCE &&
    frontEvidenceText.length > 0 &&
    backEvidenceText.length > 0;
  return {
    status: completed ? "completed" : "review_required",
    model: source,
    source,
    frontRotation: quarterTurn(receipt.front_rotation),
    backRotation: quarterTurn(receipt.back_rotation),
    frontConfidence,
    backConfidence,
    frontEvidenceText,
    backEvidenceText,
    backStandalonePrizm: null,
    backDesignationConfidence: 0,
    reason: completed
      ? "The Mac normalized and archived both card sides; the website fetched those canonical pixels and verified the stored pair."
      : "The Mac archive did not return decisive orientation evidence for both card sides, so this card is held outside Pending Listings.",
  };
}

function titleCardNumber(value: string) {
  const match = value.match(
    /(?:#|no\.?|card\s*(?:no\.?|number)?\s*[:#.-]?)\s*([a-z]{0,6}-?\d{1,5}[a-z]{0,3})\b/i,
  );
  return match?.[1] || null;
}

function titleYear(value: string) {
  return value.match(/\b((?:19|20)\d{2})\b/)?.[1] || null;
}

function titleManufacturer(value: string) {
  const names = ["Panini", "Bowman", "Topps", "Upper Deck", "Donruss", "Leaf", "Fleer", "Score", "SkyBox", "Pacific"];
  const matches = names.filter((name) =>
    new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(value),
  );
  return matches.length === 1 ? matches[0] : null;
}

function titlePlayer(value: string, cardNumber: string | null) {
  if (!cardNumber) return null;
  const escaped = cardNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `#${escaped}\\s+(.+?)(?=\\s+(?:Base|Silver|Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White|Cracked|Velocity|Wave|Holo|Prizm|Prizms|Flash|Auto|Autograph|Rookie|RC)\\b|$)`,
    "i",
  ).exec(value)?.[1]?.trim() || null;
  if (!match) return null;
  const normalized = match.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    /\b(all american|crunch time|base|chrome|prizm|prizms|parallel|insert|subset)\b/i.test(
      normalized,
    )
  ) {
    return null;
  }
  return match;
}

function titleSurfaceHint(value: string) {
  return (
    value.match(
      /\b(silver flash prizm|silver prizm|green prizm|blue prizm|red prizm|gold prizm|orange prizm|purple prizm|pink prizm|black prizm|white prizm|cracked ice|wave|holo|mojo|disco|shimmer|velocity|ice)\b/i,
    )?.[1] || null
  );
}

function titleAutoRelic(title: string) {
  // Absence of auto/relic words in a weak provisional title is NOT negative
  // evidence. Only explicit positive text may constrain Registry candidates.
  return {
    isAuto: /\b(auto|autograph|autographed|signature)\b/i.test(title) ? true : null,
    isRelic: /\b(relic|memorabilia|patch|jersey|game[- ]?used)\b/i.test(title) ? true : null,
  };
}

const MINIMUM_MAC_ORIENTATION_CONFIDENCE = 0.55;

function validateFile(file: File, side: "front" | "back") {
  if (!file.size || file.size > MAX_IMAGE_BYTES) {
    throw new Error(`${side} image is empty or larger than 12MB.`);
  }
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${side} image is not JPEG, PNG, or WebP.`);
  }
  return file;
}

function selectedPair(rows: ImageRow[]) {
  const images = rows
    .map((row) => ({
      url: text(row.image_url),
      alt: text(row.alt_text, 300),
      order: Number(row.sort_order || 0),
      primary: row.is_primary === true,
    }))
    .filter(
      (
        row,
      ): row is {
        url: string;
        alt: string | null;
        order: number;
        primary: boolean;
      } => Boolean(row.url),
    )
    .sort((left, right) => {
      if (left.primary !== right.primary) return left.primary ? -1 : 1;
      return left.order - right.order;
    });

  const front =
    images.find((image) => /\bfront\b/i.test(image.alt || "")) ||
    images.find((image) => image.primary) ||
    images[0] ||
    null;
  const back =
    images.find(
      (image) =>
        /\bback\b/i.test(image.alt || "") && image.url !== front?.url,
    ) ||
    images.find((image) => !image.primary && image.url !== front?.url) ||
    images.find((image) => image.url !== front?.url) ||
    null;

  return { front, back, count: images.length };
}

async function downloadImage(url: string, side: "front" | "back") {
  const response = await fetch(assertSafeInstaCompRemoteImageUrl(url), {
    // Cloudflare Workers supports follow/manual, but rejects the Fetch-standard
    // `error` mode at runtime. Manual still fails closed because every redirect
    // response is rejected before any bytes are accepted.
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "TCOS-InstaComp-FirstTimeIdentity/1.0" },
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${side} image redirect was blocked.`);
  }
  if (!response.ok) {
    throw new Error(`${side} image returned HTTP ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  const type =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ||
    "image/jpeg";
  const extension =
    type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return validateFile(new File([bytes], `${side}.${extension}`, { type }), side);
}

async function digest(file: File) {
  return createHash("sha256")
    .update(Buffer.from(await file.arrayBuffer()))
    .digest("hex");
}

function cleanSetName(candidate: InstaCompChecklistCandidate) {
  const manufacturer = String(candidate.manufacturer || "").trim();
  const setName = String(candidate.setName || candidate.product || "").trim();
  if (!manufacturer || !setName) return setName || null;
  return setName.replace(new RegExp(`^${manufacturer}\\s+`, "i"), "").trim();
}

function titleSetName(
  candidate: InstaCompChecklistCandidate,
  core: InstaCompCoreVisualEvidence,
) {
  const setName = cleanSetName(candidate) || core.setName || core.product;
  if (normalized(setName) !== "base") return setName;
  const brand = text(candidate.brand, 120);
  if (brand && normalized(brand) !== normalized(candidate.manufacturer)) {
    return brand;
  }
  const coreSet = text(core.setName || core.product, 160);
  return coreSet && normalized(coreSet) !== "base" ? coreSet : null;
}

function buildCardReadSummary(params: {
  candidate?: InstaCompChecklistCandidate | null;
  core: InstaCompCoreVisualEvidence;
  parallelDecision?: ParallelVisionDecision | null;
}) {
  const candidate = params.candidate || null;
  const year = candidate?.year || params.core.year;
  const manufacturer = candidate?.manufacturer || params.core.manufacturer;
  const setName = titleSetName(candidate || ({} as InstaCompChecklistCandidate), params.core);
  const cardNumber = candidate?.cardNumber || params.core.cardNumber;
  const player = candidate?.player || params.core.player;
  const team = candidate?.team || params.core.team;
  const surfaceVariation = params.core.surfaceVariationHint || candidate?.variation || null;
  const parallel = candidate?.parallel && normalized(candidate.parallel) !== "base"
    ? candidate.parallel
    : params.parallelDecision?.selectedParallel && normalized(params.parallelDecision.selectedParallel) !== "base"
      ? params.parallelDecision.selectedParallel
      : null;

  const identity = [
    year,
    manufacturer,
    setName,
    cardNumber ? `#${cardNumber}` : null,
    player,
    team ? `(${team})` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const details = [
    surfaceVariation ? `Surface variation: ${surfaceVariation}.` : null,
    parallel ? `Parallel: ${parallel}.` : null,
    params.core.identitySummary && params.core.identitySummary !== identity
      ? `Vision note: ${params.core.identitySummary}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [identity ? `Card read: ${identity}.` : null, details || null]
    .filter(Boolean)
    .join(" ")
    .trim() || null;
}

function canonicalTitle(params: {
  candidate: InstaCompChecklistCandidate;
  core: InstaCompCoreVisualEvidence;
}) {
  return [
    params.candidate.year || params.core.year,
    params.candidate.manufacturer || params.core.manufacturer,
    titleSetName(params.candidate, params.core),
    params.candidate.cardNumber ? `#${params.candidate.cardNumber}` : null,
    params.candidate.player || params.core.player,
    params.candidate.parallel || "Base",
    params.core.rookie === true ? "RC" : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function reviewTitle(core: InstaCompCoreVisualEvidence, currentTitle: string) {
  if (currentTitle && !/^(?:InstaComp scan pending|Untitled card)$/i.test(currentTitle)) {
    return currentTitle;
  }
  return (
    [
      core.year,
      core.manufacturer,
      core.setName || core.product,
      core.cardNumber ? `#${core.cardNumber}` : null,
      core.player,
      "Identity Review Required",
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() || "InstaComp card — identity review required"
  );
}

function candidateAi(
  candidate: InstaCompChecklistCandidate,
  core: InstaCompCoreVisualEvidence,
  parallelDecision: ParallelVisionDecision,
) {
  const exactParallel = candidate.parallel || "Base";
  const storedParallel = normalized(exactParallel) === "base" ? null : exactParallel;
  const notes = buildCardReadSummary({
    candidate,
    core,
    parallelDecision,
  });
  return {
    year: candidate.year || core.year,
    manufacturer: candidate.manufacturer || core.manufacturer,
    brand: candidate.brand || candidate.manufacturer || core.manufacturer,
    product: candidate.product || core.product,
    setName: candidate.setName || candidate.product || core.setName || core.product,
    cardNumber: candidate.cardNumber || core.cardNumber,
    card_number: candidate.cardNumber || core.cardNumber,
    player: candidate.player || core.player,
    playerName: candidate.player || core.player,
    parallel: storedParallel,
    parallelName: storedParallel,
    checklistParallel: exactParallel,
    variation: candidate.variation || null,
    serialNumber:
      parallelDecision.features.serialStampText ||
      (candidate.serialRun ? `/${candidate.serialRun}` : null),
    printRun: candidate.serialRun ? `/${candidate.serialRun}` : null,
    isRookie: core.rookie === true,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
    team: candidate.team || core.team,
    sport: candidate.sport || core.sport,
    league: candidate.league || core.league,
    frontVisibleText: core.frontVisibleText,
    backVisibleText: core.backVisibleText,
    coreVisualConfidence: core.confidence,
    parallelVisualFeatures: parallelDecision.features,
    checklistIdentityId: candidate.identityId,
    checklistFingerprintSha256: candidate.fingerprintSha256 || null,
    notes,
  };
}

function integerOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function booleanValue(value: unknown) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function macTrustedCandidate(
  receipt: MacReceipt,
): InstaCompChecklistCandidate | null {
  // Identity truth and pricing permission are separate gates. A physical scan
  // with an exact Mac-local Registry UUID + fingerprint is an identified card
  // even when comps/pricing remain blocked for further review.
  if (receipt.checklistOutcome !== "exact_match") return null;
  const identityId = validUuid(receipt.registryIdentityId);
  const fingerprintSha256 = text(receipt.registryFingerprintSha256, 80);
  const identity = record(receipt.checklistIdentity);
  const year = text(identity.year, 20);
  const manufacturer = text(identity.manufacturer, 120);
  const cardNumber = text(identity.card_number ?? identity.cardNumber, 80);
  const player = text(identity.player, 200);
  if (!identityId || !fingerprintSha256 || !year || !manufacturer || !cardNumber || !player) {
    return null;
  }
  return {
    identityId,
    fingerprintSha256,
    year,
    manufacturer,
    brand: text(identity.brand, 120) || manufacturer,
    product: text(identity.product ?? identity.set_name ?? identity.setName, 200),
    setName: text(identity.set_name ?? identity.setName ?? identity.product, 200),
    cardNumber,
    player,
    serialRun: integerOrNull(identity.serial_run ?? identity.serialRun),
    isAuto: booleanValue(identity.autograph ?? identity.isAuto),
    isRelic: booleanValue(identity.memorabilia ?? identity.isRelic),
    parallel: text(identity.parallel, 160) || "Base",
    variation: text(identity.variation, 160),
    team: text(identity.team, 160),
    sport: text(identity.sport, 100),
    league: text(identity.league, 100),
  };
}

function macCoreEvidence(
  candidate: InstaCompChecklistCandidate,
  receipt: MacReceipt,
): InstaCompCoreVisualEvidence {
  const identity = record(receipt.checklistIdentity);
  const identitySummary = [
    candidate.year,
    candidate.manufacturer,
    candidate.product || candidate.setName || null,
    candidate.cardNumber ? `#${candidate.cardNumber}` : null,
    candidate.player,
    candidate.team ? `(${candidate.team})` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    status: "completed",
    model: "mac_instacomp_ai_registry",
    year: candidate.year,
    manufacturer: candidate.manufacturer,
    product: candidate.product || candidate.setName || null,
    setName: candidate.setName || candidate.product || null,
    subset: candidate.subset || null,
    player: candidate.player,
    cardNumber: candidate.cardNumber,
    team: candidate.team || null,
    sport: candidate.sport || null,
    league: candidate.league || null,
    rookie: typeof identity.rookie === "boolean" ? identity.rookie : null,
    surfaceVariationHint: text(candidate.variation, 160),
    identitySummary: identitySummary
      ? `Card read: ${identitySummary}.`
      : null,
    frontVisibleText: evidence(receipt.imageOrientation?.front_evidence),
    backVisibleText: evidence(receipt.imageOrientation?.back_evidence),
    confidence: 0.99,
    reason:
      "Mac InstaComp AI returned a complete trusted Checklist Registry identity receipt.",
  };
}

function macParallelDecision(candidate: InstaCompChecklistCandidate) {
  const serialRun = candidate.serialRun || null;
  const parallel = candidate.parallel || "Base";
  const matchedIdentityIds = candidate.identityId ? [candidate.identityId] : [];
  return {
    status: "resolved" as const,
    selectedParallel: parallel,
    selectedIdentityId: candidate.identityId,
    confidence: 0.99,
    evidence:
      "Mac InstaComp AI supplied a trusted exact Registry identity; no second visual parallel vote was required.",
    candidateParallels: [parallel],
    features: {
      dominantColor: null,
      pattern: "uncertain" as const,
      serialStampPresent: serialRun ? true : null,
      serialStampText: serialRun ? `/${serialRun}` : null,
      serialRun,
      autographPresent: candidate.isAuto,
      relicPresent: candidate.isRelic,
      confidence: 0.99,
      evidence: ["mac_trusted_registry_identity"],
    },
    matchedIdentityIds,
    rejectionReasons: {},
  };
}

async function archiveWithMacBestEffort(params: {
  frontFile: File;
  backFile: File;
  webOrientation: InstaCompImageOrientationReceipt | null;
}): Promise<MacArchiveResult> {
  let scan: InstaCompAiLocalScan | null = null;
  let attempts = 0;
  let lastError: unknown = null;
  try {
    // Stay well inside the public request ceiling. A slow/hung Mac scan must
    // return a saved review item instead of letting Cloudflare/browser abort the
    // request after ~200 seconds with no useful handoff.
    const deadline = Date.now() + 45_000;
    const webOrientationTrusted =
      params.webOrientation?.status === "completed";
    for (const requestedTimeout of [40_000]) {
      attempts += 1;
      try {
        scan = await analyzeWithInstaCompAiLocal({
          // Only a completed web receipt may supply rotation hints. When the
          // outside referee fails or is unavailable, pass no rotations so the
          // Mac-local orientation engine remains authoritative.
          front: params.frontFile,
          back: params.backFile,
          frontRotation: webOrientationTrusted
            ? quarterTurn(params.webOrientation?.frontRotation)
            : undefined,
          backRotation: webOrientationTrusted
            ? quarterTurn(params.webOrientation?.backRotation)
            : undefined,
          timeoutMs: Math.max(
            5_000,
            Math.min(requestedTimeout, deadline - Date.now()),
          ),
        });
        break;
      } catch (error) {
        lastError = error;
        if (Date.now() >= deadline - 5_000) break;
      }
    }
    if (!scan) throw lastError || new Error("Mac archive did not respond.");
    const scanId = text(scan.scan_id, 100);
    if (!scanId) throw new Error("Mac archive returned no scan ID.");
    const [frontFile, backFile] = await Promise.all([
      fetchInstaCompAiLocalScanImage({ scanId, side: "front", timeoutMs: 10_000 }),
      fetchInstaCompAiLocalScanImage({ scanId, side: "back", timeoutMs: 10_000 }),
    ]);
    const resolvedOrientation = completedMacOrientation(scan, params.webOrientation);
    return {
      receipt: {
        scanId,
        status: text(scan.status, 100),
        checklistOutcome: text(scan.checklist?.outcome, 120),
        registryIdentityId: validUuid(scan.checklist?.identity_id),
        registryFingerprintSha256: registryFingerprintFromReceipts(
          scan.checklist?.source_receipts,
        ),
        checklistIdentity: record(scan.checklist?.identity),
        checklistReasons: textList(scan.checklist?.reasons, 20),
        pricingAllowed: scan.pricing_allowed === true,
        learningAllowed: scan.learning_allowed === true,
        matchSource: text(scan.match_source, 100),
        attempts,
        canonicalImagesRecovered: true,
        imageOrientation: scan.image_orientation || null,
        centering: {
          front: scan.local_vision?.front_centering || null,
          back: scan.local_vision?.back_centering || null,
        },
        error:
          resolvedOrientation.status === "completed"
            ? null
            : "Mac archive orientation requires review.",
      },
      frontFile,
      backFile,
      orientation: resolvedOrientation,
    };
  } catch (error) {
    return {
      receipt: {
        scanId: text(scan?.scan_id, 100),
        status: text(scan?.status, 100),
        checklistOutcome: text(scan?.checklist?.outcome, 120),
        registryIdentityId: validUuid(scan?.checklist?.identity_id),
        registryFingerprintSha256: registryFingerprintFromReceipts(
          scan?.checklist?.source_receipts,
        ),
        checklistIdentity: record(scan?.checklist?.identity),
        checklistReasons: textList(scan?.checklist?.reasons, 20),
        pricingAllowed: scan?.pricing_allowed === true,
        learningAllowed: scan?.learning_allowed === true,
        matchSource: text(scan?.match_source, 100),
        attempts,
        canonicalImagesRecovered: false,
        imageOrientation: scan?.image_orientation || null,
        centering: {
          front: scan?.local_vision?.front_centering || null,
          back: scan?.local_vision?.back_centering || null,
        },
        error: text(
          error instanceof Error ? error.message : "Mac archive failed.",
          500,
        ),
      },
      frontFile: null,
      backFile: null,
      orientation: scan ? completedMacOrientation(scan, params.webOrientation) : null,
    };
  }
}

async function saveFailure(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  inventoryItemId: string;
  error: string;
  code: string;
  stage: string;
}) {
  if (!params.inventoryItemId) return;
  try {
    const { data } = await params.supabase
      .from("inventory_items")
      .select("metadata")
      .eq("id", params.inventoryItemId)
      .eq("store_id", params.storeId)
      .eq("status", "draft")
      .maybeSingle();
    const metadata = record(data?.metadata);
    const instaComp = record(metadata.instacomp);
    await params.supabase
      .from("inventory_items")
      .update({
        metadata: {
          ...metadata,
          instacomp: {
            ...instaComp,
            lastStatus: "failed",
            lastStage: params.stage,
            lastError: params.error,
            lastErrorCode: params.code,
            lastFailedAt: new Date().toISOString(),
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.inventoryItemId)
      .eq("store_id", params.storeId)
      .eq("status", "draft");
  } catch {
    // Preserve the original error.
  }
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  let inventoryItemId = "";

  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: "KINGMAKER exact scan is owner-only." },
        { status: 403 },
      );
    }

    const multipart =
      request.headers.get("content-type")?.includes("multipart/form-data") ===
      true;
    const body = multipart
      ? await request.formData()
      : await request.json().catch(() => ({}));
    const value = (key: string) =>
      multipart ? body.get(key) : (body as JsonRecord)?.[key];
    inventoryItemId = String(value("inventoryItemId") || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json(
        { success: false, error: "Choose a card to scan." },
        { status: 400 },
      );
    }

    const { data: item, error: itemError } = await supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft")
      .or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return NextResponse.json(
        { success: false, error: "The selected KINGMAKER draft was not found." },
        { status: 404 },
      );
    }

    const metadata = record(item.metadata);
    const previousInstaComp = record(metadata.instacomp);
    const identityTraceStartedAt = new Date().toISOString();
    const identityTraceStartedMs = Date.now();
    const replaceManualIdentity =
      value("replaceManualIdentity") === true ||
      value("replaceManualIdentity") === "true";
    if (
      previousInstaComp.manualIdentityLocked === true &&
      !replaceManualIdentity
    ) {
      return NextResponse.json(
        {
          success: true,
          identityComplete: previousInstaComp.identityComplete === true,
          title: item.title,
          stage: "manual_lock",
          locked: true,
          message:
            "Seller correction remains locked. Explicit replacement approval is required to rescan it.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: rows, error: imageError } = await supabase
      .from("inventory_images")
      .select("image_url,alt_text,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });
    if (imageError) throw imageError;
    const pair = selectedPair((rows || []) as ImageRow[]);
    const providedFront = multipart ? value("frontImage") : null;
    const providedBack = multipart ? value("backImage") : null;
    const hasProvidedPair =
      providedFront instanceof File &&
      providedFront.size > 0 &&
      providedBack instanceof File &&
      providedBack.size > 0;
    if (
      !hasProvidedPair &&
      (!pair.front?.url || !pair.back?.url || pair.front.url === pair.back.url)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "One distinct stored front and one distinct stored back are required.",
          code: "INVALID_STORED_PAIR",
          stage: "image_pair",
        },
        { status: 409 },
      );
    }

    let frontFile: File;
    let backFile: File;
    if (hasProvidedPair) {
      frontFile = validateFile(providedFront, "front");
      backFile = validateFile(providedBack, "back");
    } else {
      [frontFile, backFile] = await Promise.all([
        downloadImage(pair.front!.url, "front"),
        downloadImage(pair.back!.url, "back"),
      ]);
    }

    const [frontSha256, backSha256] = await Promise.all([
      digest(frontFile),
      digest(backFile),
    ]);
    if (frontSha256 === backSha256) {
      return NextResponse.json(
        {
          success: false,
          error: "Front and back are the same image bytes.",
          code: "DUPLICATE_NORMALIZED_IMAGES",
          stage: "image_pair",
        },
        { status: 409 },
      );
    }

    let preserveInputPromise: Promise<{
      frontImageUrl: string;
      backImageUrl: string;
    } | null> = Promise.resolve(null);
    if (hasProvidedPair) {
      const rawPreservationOrientation: InstaCompImageOrientationReceipt = {
        status: "review_required",
        model: null,
        source: "kingmaker_raw_intake_preservation",
        frontRotation: 0,
        backRotation: 0,
        frontConfidence: 0,
        backConfidence: 0,
        frontEvidenceText: [],
        backEvidenceText: [],
        backStandalonePrizm: null,
        backDesignationConfidence: 0,
        reason:
          "Original front/back uploads were preserved while the Mac performed orientation and exact Registry identification.",
      };
      preserveInputPromise = persistNormalizedInstaCompImagePair({
        supabase,
        storeId,
        inventoryItemId,
        title: item.title || "Card",
        frontFile,
        backFile,
        orientation: rawPreservationOrientation,
        previousFrontImageUrl: pair.front?.url || null,
        previousBackImageUrl: pair.back?.url || null,
      }).then((preserved) => ({
        frontImageUrl: preserved.frontImageUrl,
        backImageUrl: preserved.backImageUrl,
      }));
    }

    const storedPairOrientation = trustedStoredPairOrientation({
      previousInstaComp,
      frontSha256,
      backSha256,
      hasProvidedPair,
    });

    // Preserve the original upload and run the Mac scan at the same time. For
    // an unchanged previously verified canonical pair, feed the hash-proven
    // 0-degree orientation back to the Mac so its exact-pair fast path can
    // revalidate identity without paying the full orientation pipeline again.
    const [macArchive, preservedInputPair] = await Promise.all([
      archiveWithMacBestEffort({
        frontFile,
        backFile,
        webOrientation: storedPairOrientation,
      }),
      preserveInputPromise,
    ]);

    let macReceipt = macArchive.receipt;
    const macIdentityBeforeOrientation = macTrustedCandidate(macReceipt);
    if (
      (
        !macArchive.frontFile ||
        !macArchive.backFile ||
        !macArchive.orientation ||
        macArchive.orientation.status !== "completed"
      ) &&
      !macIdentityBeforeOrientation
    ) {
      if (macReceipt.scanId) {
        const reviewAt = new Date().toISOString();
        const reviewOrientation: InstaCompImageOrientationReceipt =
          macArchive.orientation || {
            status: "review_required",
            model: null,
            source: "mac_local_orientation",
            frontRotation: 0,
            backRotation: 0,
            frontConfidence: 0,
            backConfidence: 0,
            frontEvidenceText: [],
            backEvidenceText: [],
            backStandalonePrizm: null,
            backDesignationConfidence: 0,
            reason:
              macReceipt.error ||
              "The local Mac scan was recorded but orientation still needs review.",
          };
        const frontImageUrl =
          preservedInputPair?.frontImageUrl ||
          text(previousInstaComp.frontImageUrl, 2_000);
        const backImageUrl =
          preservedInputPair?.backImageUrl ||
          text(previousInstaComp.backImageUrl, 2_000);
        const pairPersisted = Boolean(
          frontImageUrl &&
            backImageUrl &&
            frontImageUrl !== backImageUrl,
        );
        const nextMetadata = {
          ...metadata,
          instacomp: {
            ...previousInstaComp,
            source:
              text(previousInstaComp.source, 120) ||
              "kingmaker_exact_scan_intake_v2",
            scanId: macReceipt.scanId,
            macReceipt,
            centering: macReceipt.centering,
            physicalScanRecorded: true,
            imageOrientation: reviewOrientation,
            imageOrientationVerified: false,
            imageOrientationPersisted: false,
            imagePersistenceVerified: pairPersisted,
            frontImageUrl: frontImageUrl || null,
            backImageUrl: backImageUrl || null,
            hasBackImage: Boolean(backImageUrl),
            identityComplete: false,
            identityRefreshRequired: true,
            identitySource: "mac_scan_receipt_review_pending",
            pricingStatus: "blocked_identity_review_required",
            pricingReason:
              "The physical scan is recorded. Exact orientation and Checklist identity must be resolved before pricing.",
            publicationStatus: "review_required",
            publicationReviewReasons: ["orientation_review_required"],
            lastStatus: "review_required",
            lastStage: "orientation_review",
            lastError: null,
            lastErrorCode: null,
            scannedAt: reviewAt,
          },
        };
        const { error: reviewUpdateError } = await supabase
          .from("inventory_items")
          .update({ metadata: nextMetadata, updated_at: reviewAt })
          .eq("id", inventoryItemId)
          .eq("store_id", storeId)
          .eq("status", "draft");
        if (reviewUpdateError) throw reviewUpdateError;

        return NextResponse.json(
          {
            success: true,
            stage: "orientation_review",
            identityComplete: false,
            scanId: macReceipt.scanId,
            title: item.title,
            imageOrientation: reviewOrientation,
            normalizedImages: {
              frontImageUrl: frontImageUrl || null,
              backImageUrl: backImageUrl || null,
            },
            pricingStatus: "blocked_identity_review_required",
            physicalScanRecorded: true,
            imagesPreserved: pairPersisted,
            nothingPublished: true,
            message:
              "Physical scan recorded. Orientation/identity review is still required; do not rescan this card.",
          },
          {
            status: 202,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }
      throw new Error(
        macReceipt.error ||
          macArchive.orientation?.reason ||
          "Automatic card orientation could not be verified. The card was held outside Pending Listings for an automatic retry.",
      );
    }

    const finalFrontFile = macArchive.frontFile ?? frontFile;
    const finalBackFile = macArchive.backFile ?? backFile;
    const finalOrientation: InstaCompImageOrientationReceipt =
      macArchive.orientation ??
      storedPairOrientation ?? {
        status: "review_required",
        model: null,
        source: "mac_registry_exact_orientation_pending",
        frontRotation: 0,
        backRotation: 0,
        frontConfidence: 0,
        backConfidence: 0,
        frontEvidenceText: [],
        backEvidenceText: [],
        backStandalonePrizm: null,
        backDesignationConfidence: 0,
        reason:
          "The Mac locked an exact Registry identity, but canonical orientation still needs review before publication.",
      };

    const [finalFrontSha256, finalBackSha256] = await Promise.all([
      digest(finalFrontFile),
      digest(finalBackFile),
    ]);
    if (finalFrontSha256 === finalBackSha256) {
      throw new Error("Mac archive returned identical front and back images.");
    }

    let macCandidate = macTrustedCandidate(macReceipt);
    const receiptIdentity = record(macReceipt.checklistIdentity);
    let core: InstaCompCoreVisualEvidence = macCandidate
      ? macCoreEvidence(macCandidate, macReceipt)
      : {
          status: "error",
          model: "mac_instacomp_ai_registry",
          year: text(receiptIdentity.year, 20),
          manufacturer: text(
            receiptIdentity.manufacturer ?? receiptIdentity.brand,
            120,
          ),
          product: text(
            receiptIdentity.product ??
              receiptIdentity.set_name ??
              receiptIdentity.setName,
            200,
          ),
          setName: text(
            receiptIdentity.set_name ??
              receiptIdentity.setName ??
              receiptIdentity.product,
            200,
          ),
          subset: text(receiptIdentity.subset, 160),
          player: text(receiptIdentity.player, 200),
          cardNumber: text(
            receiptIdentity.card_number ?? receiptIdentity.cardNumber,
            80,
          ),
          team: text(receiptIdentity.team, 160),
          sport: text(receiptIdentity.sport, 100),
          league: text(receiptIdentity.league, 100),
          rookie:
            typeof receiptIdentity.rookie === "boolean"
              ? receiptIdentity.rookie
              : null,
          surfaceVariationHint: text(receiptIdentity.variation, 160),
          identitySummary: null,
          frontVisibleText: evidence(macReceipt.imageOrientation?.front_evidence),
          backVisibleText: evidence(macReceipt.imageOrientation?.back_evidence),
          confidence: 0,
          reason:
            "Mac Registry did not lock one exact identity. The fast seller path stops here for review instead of waiting on weaker remote identity inference.",
        };
    const titleText = String(item.title || "");
    const titleCard = titleCardNumber(titleText);
    const titleHints = {
      year: titleYear(titleText),
      manufacturer: titleManufacturer(titleText),
      cardNumber: titleCard,
      player: titlePlayer(titleText, titleCard),
      surfaceVariationHint: titleSurfaceHint(titleText),
      ...titleAutoRelic(titleText),
    };
    const previousAi = record(previousInstaComp.ai);
    const titleDimensionHints = titleRegistryDimensionHints({
      title: titleText,
      manufacturer: titleHints.manufacturer,
      cardNumber: titleHints.cardNumber,
      previousBrand: text(previousAi.brand, 120),
      previousProduct: text(previousAi.product, 200),
      previousSetName: text(previousAi.setName, 200),
    });
    const titleSerialHint =
      titleSerialNumberHint(titleText) ||
      text(previousAi.serialNumber ?? previousAi.printRun, 80);
    const titleParallelHint =
      titleHints.surfaceVariationHint ||
      text(previousAi.checklistParallel ?? previousAi.parallel, 160);
    const titleVariationHint = text(previousAi.variation, 160);
    const recoveryTeam = text(previousAi.team, 160) || core.team || null;
    const recoverySport = text(previousAi.sport, 100) || core.sport || null;
    const recoveryLeague = text(previousAi.league, 100) || core.league || null;
    const recoveryOcrText = [
      ...evidence(macReceipt.imageOrientation?.front_evidence),
      ...evidence(macReceipt.imageOrientation?.back_evidence),
    ].join("\n");
    const registryRecoveryAttempts: Array<{
      phase: string;
      label: string;
      brand: string | null;
      setName: string | null;
      status: string;
      candidateCount: number;
      reasons: string[];
      identityId: string | null;
      fingerprintSha256: string | null;
      elapsedMs: number;
    }> = [];
    const recoveryMatches = new Map<string, InstaCompChecklistCandidate>();

    // The first physical scan can fail closed because OCR misses a printed label
    // even when strong title evidence already exists. Retry only against the SAME
    // Mac-local Registry, in bounded stages, and only accept a UUID+fingerprint
    // exact match. Title text is evidence, never identity authority.
    if (
      !macCandidate &&
      titleHints.year &&
      titleHints.manufacturer &&
      titleHints.cardNumber &&
      titleHints.player
    ) {
      const attemptHints = [
        ...titleDimensionHints,
        { label: "core_only", brand: null, setName: null },
      ].slice(0, 8);
      const typedEvidencePresent = Boolean(
        titleSerialHint ||
          titleParallelHint ||
          titleVariationHint ||
          titleHints.isAuto === true ||
          titleHints.isRelic === true,
      );

      const runRecoveryPhase = async (
        phase: "core_set" | "typed_finish",
        collectForLock: boolean,
      ) => {
        const typed = phase === "typed_finish";
        const phaseMatches = new Map<string, InstaCompChecklistCandidate>();

        for (const hint of attemptHints) {
          const started = Date.now();
          const decision = await resolveInstaCompChecklistFirstFromRegistry(
            {
              year: titleHints.year,
              manufacturer: titleHints.manufacturer,
              // Product/set title segments are narrowing evidence. The Mac
              // Registry remains the authority and must still return one exact
              // UUID + fingerprint before this can lock.
              brand: hint.brand || titleHints.manufacturer,
              setName: hint.setName,
              cardNumber: titleHints.cardNumber,
              player: titleHints.player,
              team: recoveryTeam,
              sport: recoverySport,
              league: recoveryLeague,
              serialNumber: typed ? titleSerialHint : null,
              isAuto: typed ? titleHints.isAuto : null,
              isRelic: typed ? titleHints.isRelic : null,
              parallel: typed ? titleParallelHint : null,
              variation: typed ? titleVariationHint : null,
              ocrText: recoveryOcrText,
            },
            12_000,
          );
          const recovered = decision.match;
          const recoveredIdentityId = validUuid(recovered?.identityId);
          const recoveredFingerprint = text(
            recovered?.fingerprintSha256,
            80,
          );
          registryRecoveryAttempts.push({
            phase,
            label: hint.label,
            brand: hint.brand,
            setName: hint.setName,
            status: decision.status,
            candidateCount: decision.candidates.length,
            reasons: decision.reasons,
            identityId: recoveredIdentityId,
            fingerprintSha256: recoveredFingerprint,
            elapsedMs: Date.now() - started,
          });

          if (
            decision.status === "exact_match" &&
            recovered &&
            recoveredIdentityId &&
            recoveredFingerprint &&
            recovered.year &&
            recovered.manufacturer &&
            recovered.cardNumber &&
            recovered.player
          ) {
            phaseMatches.set(recoveredIdentityId, {
              ...recovered,
              identityId: recoveredIdentityId,
              fingerprintSha256: recoveredFingerprint,
            });
            if (collectForLock) {
              recoveryMatches.set(recoveredIdentityId, {
                ...recovered,
                identityId: recoveredIdentityId,
                fingerprintSha256: recoveredFingerprint,
              });
            }

            // Two independent exact parses agreeing on one UUID are enough.
            // A second distinct UUID is a conflict and therefore stays review.
            const confirmations = registryRecoveryAttempts.filter(
              (attempt) =>
                attempt.phase === phase &&
                attempt.status === "exact_match" &&
                attempt.identityId === recoveredIdentityId,
            ).length;
            if (phaseMatches.size > 1 || confirmations >= 2) break;
          }
        }
        return phaseMatches;
      };

      if (typedEvidencePresent) {
        // Explicit serial/parallel/auto/relic evidence must win. Never accept a
        // Base/core-only result first and then ignore a visible /199 or finish.
        await runRecoveryPhase("typed_finish", true);
      } else {
        await runRecoveryPhase("core_set", true);
      }
      if (recoveryMatches.size === 1) {
        const recovered = [...recoveryMatches.values()][0];
        const recoveredIdentityId = validUuid(recovered.identityId);
        const recoveredFingerprint = text(recovered.fingerprintSha256, 80);
        if (recoveredIdentityId && recoveredFingerprint) {
          macCandidate = {
            ...recovered,
            identityId: recoveredIdentityId,
            fingerprintSha256: recoveredFingerprint,
          };
          macReceipt = {
            ...macReceipt,
            status: "identified",
            checklistOutcome: "exact_match",
            registryIdentityId: recoveredIdentityId,
            registryFingerprintSha256: recoveredFingerprint,
            checklistIdentity: {
              id: recoveredIdentityId,
              identity_id: recoveredIdentityId,
              fingerprint_sha256: recoveredFingerprint,
              year: recovered.year,
              manufacturer: recovered.manufacturer,
              brand: recovered.brand || recovered.manufacturer,
              product: recovered.product || recovered.setName || null,
              set_name: recovered.setName || recovered.product || null,
              subset: recovered.subset || null,
              card_number: recovered.cardNumber,
              player: recovered.player,
              serial_run: recovered.serialRun ?? null,
              autograph: recovered.isAuto,
              memorabilia: recovered.isRelic,
              parallel: recovered.parallel || "Base",
              variation: recovered.variation || null,
              team: recovered.team || null,
              sport: recovered.sport || null,
              league: recovered.league || null,
            },
            checklistReasons: [
              ...macReceipt.checklistReasons,
              "mac_registry_title_hint_recovery_exact",
            ],
            pricingAllowed: true,
            learningAllowed: true,
            matchSource: "mac_registry_title_hint_recovery",
            error: null,
          };
          core = macCoreEvidence(macCandidate, macReceipt);
        }
      }
    }

    const visualYear = macCandidate?.year || core.year || titleHints.year;
    const visualManufacturer = macCandidate?.manufacturer || core.manufacturer || titleHints.manufacturer;
    const visualCardNumber = macCandidate?.cardNumber || core.cardNumber || titleHints.cardNumber;
    const visualPlayer = macCandidate?.player || core.player || titleHints.player;
    const visualSurfaceVariationHint = macCandidate?.variation || core.surfaceVariationHint || titleHints.surfaceVariationHint;
    const visualProduct = macCandidate?.product || core.product || core.setName || null;
    const visualSetName = macCandidate?.setName || core.setName || core.product || null;
    // Do not use the web database as an identity authority. The Mac receipt is
    // the only exact Registry lock accepted here; missing locks remain review-only.
    const parallelDecision = (macCandidate
      ? macParallelDecision(macCandidate)
      : {
          status: "ambiguous",
          selectedParallel: null,
          selectedIdentityId: null,
          confidence: 0,
          evidence:
            "Mac Registry exact identity is required before parallel selection on the fast seller path.",
          candidateParallels: [],
          features: {
            dominantColor: null,
            pattern: "uncertain",
            serialStampPresent: null,
            serialStampText: null,
            serialRun: null,
            autographPresent: null,
            relicPresent: null,
            confidence: 0,
            evidence: [
              "mac_registry_exact_identity_required",
              "remote_parallel_inference_deferred",
            ],
          },
          matchedIdentityIds: [],
          rejectionReasons: {},
        }) as ParallelVisionDecision;
    // Exact means exact: never promote a partial visual read to completed identity.
    // A card is complete only after the Mac Registry returns a trusted exact UUID + fingerprint.
    const identityComplete = Boolean(macCandidate);
    const resolvedAi = macCandidate
      ? candidateAi(macCandidate, core, parallelDecision)
      : {
      year: visualYear,
      manufacturer: visualManufacturer,
      brand: visualManufacturer,
      product: visualProduct,
      setName: visualSetName || visualProduct,
      player: visualPlayer,
      cardNumber: visualCardNumber,
      parallel: (parallelDecision.selectedParallel && normalized(parallelDecision.selectedParallel) !== "base" ? parallelDecision.selectedParallel : null),
      variation: visualSurfaceVariationHint || null,
      team: core.team,
      sport: core.sport,
      league: core.league,
      isRookie: core.rookie === true,
      isAuto: titleHints.isAuto,
      isRelic: titleHints.isRelic,
      frontVisibleText: core.frontVisibleText,
      backVisibleText: core.backVisibleText,
      coreVisualConfidence: core.confidence,
      parallelVisualFeatures: parallelDecision.features,
      notes: buildCardReadSummary({
        core: {
          ...core,
          year: visualYear,
          manufacturer: visualManufacturer,
          product: visualProduct,
          setName: visualSetName,
          player: visualPlayer,
          cardNumber: visualCardNumber,
          surfaceVariationHint: visualSurfaceVariationHint,
          identitySummary:
            core.identitySummary ||
            [
              visualYear,
              visualManufacturer,
              visualSetName || visualProduct,
              visualCardNumber ? `#${visualCardNumber}` : null,
              visualPlayer,
              core.team ? `(${core.team})` : null,
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
        },
        parallelDecision,
      }),
        };

    const identityTrace = {
      schema: "tcos.instacomp.identity-trace.v1",
      startedAt: identityTraceStartedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - identityTraceStartedMs,
      failureStage: identityComplete
        ? null
        : macReceipt.checklistOutcome === "input_incomplete"
          ? "registry_core_input"
          : registryRecoveryAttempts.length
            ? "registry_narrowing"
            : "physical_read",
      stages: [
        {
          stage: "front_back_pair",
          status: "pass",
          detail: "Distinct front/back pixels are stored for this physical card.",
        },
        {
          stage: "orientation",
          status: finalOrientation.status === "completed" ? "pass" : "review",
          detail: finalOrientation.reason,
        },
        {
          stage: "physical_read",
          status:
            macReceipt.checklistOutcome === "exact_match" ? "pass" : "review",
          detail: macReceipt.checklistOutcome,
          reasons: macReceipt.checklistReasons,
        },
        {
          stage: "core_fields",
          status:
            visualYear &&
            visualManufacturer &&
            visualCardNumber &&
            visualPlayer
              ? "pass"
              : "review",
          evidence: {
            year: visualYear,
            manufacturer: visualManufacturer,
            cardNumber: visualCardNumber,
            player: visualPlayer,
          },
        },
        {
          stage: "registry_narrowing",
          status: identityComplete ? "pass" : "review",
          attempts: registryRecoveryAttempts,
          titleDimensionHints,
        },
        {
          stage: "parallel_serial",
          status: identityComplete ? "pass" : "review",
          evidence: {
            serialNumber: titleSerialHint,
            parallel: titleParallelHint,
            variation: titleVariationHint,
          },
        },
        {
          stage: "exact_lock",
          status: identityComplete ? "pass" : "review",
          registryIdentityId: macCandidate?.identityId || null,
          registryFingerprintSha256:
            macCandidate?.fingerprintSha256 || null,
        },
      ],
    };

    const storedImages = await persistNormalizedInstaCompImagePair({
      supabase,
      storeId,
      inventoryItemId,
      title: item.title || "Card",
      frontFile: finalFrontFile,
      backFile: finalBackFile,
      orientation: finalOrientation,
      previousFrontImageUrl:
        preservedInputPair?.frontImageUrl || pair.front?.url || null,
      previousBackImageUrl:
        preservedInputPair?.backImageUrl || pair.back?.url || null,
    });

    const checkedAt = new Date().toISOString();
    const collectibleAsset = record(metadata.collectible_asset);
    const selectedParallel = resolvedAi.parallel || null;
    const selectedIsBase = normalized(selectedParallel) === "base";
    const selectedRegistryIdentityId = macCandidate?.identityId || null;
    const selectedRegistryFingerprintSha256 = macCandidate?.fingerprintSha256 || null;
    const nextTitle = macCandidate
      ? canonicalTitle({ candidate: macCandidate, core })
      : reviewTitle(core, titleText);

    const nextMetadata = {
      ...metadata,
      collectible_asset: {
        ...collectibleAsset,
        parallel_name:
          !selectedIsBase && selectedParallel ? selectedParallel : null,
        exact_serial_number:
          parallelDecision.features.serialStampText || null,
        serial_run: parallelDecision.features.serialRun || null,
        rookie: core.rookie === true,
      },
      instacomp: {
        ...previousInstaComp,
        source: macCandidate
          ? "mac_registry_scanner"
          : text(previousInstaComp.source, 120) || "kingmaker_exact_scan_intake_v2",
        schema: "truely.instacompInventoryIdentity.v6",
        scanId: macReceipt.scanId,
        macReceipt,
        centering: macReceipt.centering,
        ai: resolvedAi,
        coreVisualEvidence: core,
        imageOrientation: finalOrientation,
        imageOrientationVerified: finalOrientation.status === "completed",
        imageOrientationNormalizedAt:
          finalOrientation.status === "completed" ? checkedAt : null,
        imageOrientationPersisted: finalOrientation.status === "completed",
        imagePersistenceVerified: storedImages.verified === true,
        frontImageUrl: storedImages.frontImageUrl,
        backImageUrl: storedImages.backImageUrl,
        frontSha256: finalFrontSha256,
        backSha256: finalBackSha256,
        cardUuid:
          selectedRegistryIdentityId ||
          text(previousInstaComp.cardUuid, 80) ||
          null,
        registryIdentityId: selectedRegistryIdentityId,
        registryFingerprintSha256: selectedRegistryFingerprintSha256,
        pricingGroupKey: selectedRegistryFingerprintSha256,
        checklistDecision: macCandidate
          ? {
              status: "exact_match",
              reasons: ["mac_trusted_registry_identity_preserved"],
              candidateCount: 1,
              candidateIdentityIds: [macCandidate.identityId],
              productFamilies: [macCandidate.product || macCandidate.setName].filter(Boolean),
              productFilterApplied: true,
            }
          : {
              status: "review_required",
              reasons: Array.from(
                new Set([
                  ...macReceipt.checklistReasons,
                  macReceipt.error,
                  "mac_registry_exact_identity_required",
                ].filter((value): value is string => Boolean(value))),
              ),
              candidateCount: 0,
              candidateIdentityIds: [],
              productFamilies: [],
              productFilterApplied: false,
            },
        checklistIdentity: {
          status: macCandidate ? "identified" : "review_required",
          source: "checklist_registry",
          aiIdentificationRequired: !macCandidate,
          registryIdentityId: selectedRegistryIdentityId,
          registryFingerprintSha256: selectedRegistryFingerprintSha256,
          lockedFields: macCandidate
            ? {
                year: resolvedAi.year,
                manufacturer: resolvedAi.manufacturer,
                brand: resolvedAi.brand || resolvedAi.manufacturer || null,
                product: resolvedAi.product || null,
                setName: resolvedAi.setName || resolvedAi.product || null,
                cardNumber: resolvedAi.cardNumber,
                player: resolvedAi.player,
                team: resolvedAi.team || null,
                sport: resolvedAi.sport || null,
                league: resolvedAi.league || null,
                parallel: resolvedAi.parallel || "Base",
                variation: resolvedAi.variation || null,
                serialRun: parallelDecision.features.serialRun ?? null,
                isAuto: resolvedAi.isAuto,
                isRelic: resolvedAi.isRelic,
              }
            : {},
          reviewFields: macCandidate
            ? undefined
            : {
                year: resolvedAi.year,
                manufacturer: resolvedAi.manufacturer,
                product: resolvedAi.product || null,
                setName: resolvedAi.setName || resolvedAi.product || null,
                cardNumber: resolvedAi.cardNumber,
                player: resolvedAi.player,
                parallel: resolvedAi.parallel || null,
                variation: resolvedAi.variation || null,
              },
          reasons: macCandidate
            ? ["mac_trusted_registry_identity_preserved"]
            : ["mac_registry_exact_identity_required"],
          checkedAt,
        },
        parallelDecision,
        parallelVisualFeatures: parallelDecision.features,
        identityTrace,
        identitySource: macCandidate ? "mac_registry_exact" : "first_time_visual_only",
        identityComplete,
        identityRuleApplied: "year_product_player_card_then_color_pattern_serial",
        hasBackImage: true,
        humanVerified: false,
        trustedForIdentity: Boolean(macCandidate),
        manualIdentityEdit: false,
        manualIdentityLocked: false,
        identityRefreshRequired: !identityComplete,
        suggestedPrice: null,
        listingPrice: null,
        listingPriceSource: null,
        publicationStatus: "review_required",
        publicationReviewReasons: identityComplete
          ? [
              ...(finalOrientation.status === "completed"
                ? []
                : ["orientation_review_required"]),
              "seller_listing_review_required",
            ]
          : ["checklist_identity_review_required"],
        pricingStatus: identityComplete ? "identity_complete_pricing_pending" : "identity_review_required",
        pricingReason: identityComplete
          ? "Exact Registry identity locked; pricing may proceed."
          : "Exact Registry identity is not locked; pricing is blocked pending review.",
        lastStatus: identityComplete ? "identity_complete" : "review_required",
        lastStage: identityComplete ? "complete" : "identity_review",
        lastError: null,
        lastErrorCode: null,
        scannedAt: checkedAt,
      },
    };

    const updatePayload: JsonRecord = {
      title: nextTitle,
      metadata: nextMetadata,
      updated_at: checkedAt,
    };
    if (selectedRegistryIdentityId) {
      updatePayload.card_uuid = selectedRegistryIdentityId;
    }

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update(updatePayload)
      .eq("id", inventoryItemId)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (updateError) throw updateError;

    return NextResponse.json(
      {
        success: true,
        stage: identityComplete ? "complete" : "identity_review",
        identityComplete,
        cardUuid: selectedRegistryIdentityId,
        registryIdentityId: selectedRegistryIdentityId,
        registryFingerprintSha256: selectedRegistryFingerprintSha256,
        title: nextTitle,
        ai: resolvedAi,
        coreVisualEvidence: core,
        checklistDecision: macCandidate
          ? {
              status: "exact_match",
              reasons: ["mac_trusted_registry_identity_preserved"],
              candidateCount: 1,
              candidateIdentityIds: [macCandidate.identityId],
              productFamilies: [macCandidate.product || macCandidate.setName].filter(Boolean),
              productFilterApplied: true,
            }
          : {
              status: "review_required",
              reasons: Array.from(
                new Set([
                  ...macReceipt.checklistReasons,
                  macReceipt.error,
                  "mac_registry_exact_identity_required",
                ].filter((value): value is string => Boolean(value))),
              ),
              candidateCount: 0,
              candidateIdentityIds: [],
              productFamilies: [],
              productFilterApplied: false,
            },
        parallelDecision,
        identityTrace,
        macReceipt,
        imageOrientation: finalOrientation,
        normalizedImages: storedImages,
        pricingStatus: identityComplete ? "identity_complete_pricing_pending" : "identity_review_required",
        nothingPublished: true,
      },
      { status: identityComplete ? 200 : 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure =
      error instanceof Error
        ? error.message
        : "First-time visual checklist scan failed.";
    await saveFailure({
      supabase,
      storeId,
      inventoryItemId,
      error: failure,
      code: "INSTACOMP_FIRST_TIME_SCAN_FAILED",
      stage: "automatic_pipeline",
    });
    return NextResponse.json(
      {
        success: false,
        error: failure,
        code: "INSTACOMP_FIRST_TIME_SCAN_FAILED",
        stage: "automatic_pipeline",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
