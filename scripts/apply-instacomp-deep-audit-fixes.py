from pathlib import Path


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if marker in text:
        print(f"Deep-audit hardening already present: {path} ({marker})")
        return
    if old not in text:
        raise SystemExit(f"Could not locate deep-audit source block in {path}: {marker}")
    file_path.write_text(text.replace(old, new, 1))
    print(f"Applied deep-audit hardening: {path} ({marker})")


def add_import(path: str, anchor: str, import_line: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if import_line in text:
        return
    if anchor not in text:
        raise SystemExit(f"Could not locate import anchor in {path}: {anchor}")
    file_path.write_text(text.replace(anchor, anchor + import_line, 1))


LIVE_SCAN = "src/app/api/instacomp/live-scan/route.ts"
add_import(
    LIVE_SCAN,
    'import { verifyInstaCompCompetitionImages } from "../../../../lib/instacomp-comp-visual-verification";\n',
    'import { sanitizeInstaCompProviderError } from "../../../../lib/instacomp-provider-safety";\n',
)
replace_once(
    LIVE_SCAN,
    '''function providerAfterVisualReview(params: {
  provider: InstaCompProviderResult;
  accepted: Awaited<ReturnType<typeof verifyInstaCompCompetitionImages>>["accepted"];
  rejectedCount: number;
}) {
  return {
    ...params.provider,
    status: params.accepted.length ? "live" : "no_matches",
    message: params.accepted.length
      ? `${params.accepted.length} candidate image${params.accepted.length === 1 ? "" : "s"} passed exact-card visual proof.`
      : `${params.rejectedCount} title candidate${params.rejectedCount === 1 ? " was" : "s were"} rejected or inconclusive after image proof.`,
    results: params.accepted.map((row) => ({
      ...row,
      sourceCategory: normalizedVisualSourceCategory(row.sourceCategory),
      matchScore: row.matchScore ?? 0,
    })),
  } satisfies InstaCompProviderResult;
}
''',
    '''function providerAfterVisualReview(params: {
  provider: InstaCompProviderResult;
  accepted: Awaited<ReturnType<typeof verifyInstaCompCompetitionImages>>["accepted"];
  rejectedCount: number;
}) {
  if (!params.provider.results.length) return params.provider;
  return {
    ...params.provider,
    status: params.accepted.length ? "live" : "no_matches",
    message: params.accepted.length
      ? `${params.accepted.length} candidate image${params.accepted.length === 1 ? "" : "s"} passed exact-card visual proof.`
      : `${params.rejectedCount} title candidate${params.rejectedCount === 1 ? " was" : "s were"} rejected or inconclusive after image proof.`,
    results: params.accepted.map((row) => ({
      ...row,
      sourceCategory: normalizedVisualSourceCategory(row.sourceCategory),
      matchScore: row.matchScore ?? 0,
    })),
  } satisfies InstaCompProviderResult;
}
''',
    "if (!params.provider.results.length) return params.provider;",
)
replace_once(
    LIVE_SCAN,
    '''function settledMessage(value: PromiseSettledResult<unknown>) {
  if (value.status === "fulfilled") return null;
  return value.reason instanceof Error
    ? value.reason.message
    : String(value.reason || "Provider request failed.");
}
''',
    '''function settledMessage(value: PromiseSettledResult<unknown>) {
  if (value.status === "fulfilled") return null;
  return sanitizeInstaCompProviderError(
    value.reason instanceof Error
      ? value.reason.message
      : String(value.reason || "Provider request failed."),
  );
}
''',
    "return sanitizeInstaCompProviderError(\n    value.reason instanceof Error",
)

EXACT_PROVIDER = "src/lib/instacomp-exact-market-provider.ts"
add_import(
    EXACT_PROVIDER,
    'import { createClient } from "@supabase/supabase-js";\n',
    'import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";\n',
)
replace_once(
    EXACT_PROVIDER,
    'message: `SerpApi eBay ${lane} search failed: ${String(payload?.error || response.statusText)}`,',
    'message: sanitizeInstaCompProviderError(`SerpApi eBay ${lane} search failed: ${String(payload?.error || response.statusText)}`),',
    "sanitizeInstaCompProviderError(`SerpApi eBay ${lane} search failed:",
)
replace_once(
    EXACT_PROVIDER,
    'message: `SerpApi eBay ${lane} search failed: ${error instanceof Error ? error.message : "request error"}`,',
    'message: sanitizeInstaCompProviderError(`SerpApi eBay ${lane} search failed: ${error instanceof Error ? error.message : "request error"}`),',
    "sanitizeInstaCompProviderError(`SerpApi eBay ${lane} search failed: ${error instanceof Error",
)

OPENAI_PROVIDER = "src/lib/instacomp-openai-web-market-provider.ts"
add_import(
    OPENAI_PROVIDER,
    'import { createClient } from "@supabase/supabase-js";\n',
    'import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";\n',
)
replace_once(
    OPENAI_PROVIDER,
    '''function errorResult(message: string): OpenAiWebMarketProviderResult {
  return {
    model: null,
    responseId: null,
    citedItemIds: [],
    notes: message,
    sold: providerResult({ lane: "sold", results: [], message, status: OPENAI_API_KEY ? "error" : "not_configured" }),
    active: providerResult({ lane: "active", results: [], message, status: OPENAI_API_KEY ? "error" : "not_configured" }),
    cached: false,
  };
}
''',
    '''function errorResult(message: string): OpenAiWebMarketProviderResult {
  const safeMessage = sanitizeInstaCompProviderError(message);
  return {
    model: null,
    responseId: null,
    citedItemIds: [],
    notes: safeMessage,
    sold: providerResult({ lane: "sold", results: [], message: safeMessage, status: OPENAI_API_KEY ? "error" : "not_configured" }),
    active: providerResult({ lane: "active", results: [], message: safeMessage, status: OPENAI_API_KEY ? "error" : "not_configured" }),
    cached: false,
  };
}
''',
    "const safeMessage = sanitizeInstaCompProviderError(message);",
)
replace_once(
    OPENAI_PROVIDER,
    '''        `OpenAI exact web market search failed (${response.status}): ${clean(payload?.error?.message) || response.statusText}`,
''',
    '''        sanitizeInstaCompProviderError(
          `OpenAI exact web market search failed (${response.status}): ${clean(payload?.error?.message) || response.statusText}`,
        ),
''',
    "sanitizeInstaCompProviderError(\n          `OpenAI exact web market search failed (${response.status})",
)
replace_once(
    OPENAI_PROVIDER,
    '''      `OpenAI exact web market search failed: ${error instanceof Error ? error.message : "unknown error"}`,
''',
    '''      sanitizeInstaCompProviderError(
        `OpenAI exact web market search failed: ${error instanceof Error ? error.message : "unknown error"}`,
      ),
''',
    "sanitizeInstaCompProviderError(\n        `OpenAI exact web market search failed: ${error instanceof Error",
)

VISUAL = "src/lib/instacomp-comp-visual-verification.ts"
add_import(
    VISUAL,
    'import type { InstaCompAiResult } from "./instacomp";\n',
    '''import {
  assertSafeInstaCompRemoteImageUrl,
  sanitizeInstaCompProviderError,
} from "./instacomp-provider-safety";
''',
)
replace_once(
    VISUAL,
    'const MAX_VISUAL_CANDIDATES = 8;\n',
    'const MAX_VISUAL_CANDIDATES = 6;\nconst VISUAL_REVIEW_CONCURRENCY = 2;\n',
    "const VISUAL_REVIEW_CONCURRENCY = 2;",
)
replace_once(
    VISUAL,
    '''async function remoteImageToDataUrl(url: string) {
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
''',
    '''async function remoteImageToDataUrl(url: string) {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(url, { ebayOnly: true });
  const response = await fetch(safeUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "TCOS-InstaComp-VisualVerifier/1.0" },
  });
  if (!response.ok) throw new Error(`Candidate image returned HTTP ${response.status}.`);
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("Candidate image was larger than 5MB.");
  }
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error("Candidate image was empty or larger than 5MB.");
  }
  return dataUrlFromBytes(bytes, response.headers.get("content-type"));
}
''',
    "const safeUrl = assertSafeInstaCompRemoteImageUrl(url, { ebayOnly: true });",
)
replace_once(
    VISUAL,
    '''      `visual verification unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
''',
    '''      `visual verification unavailable: ${sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : "unknown error",
      )}`,
''',
    "visual verification unavailable: ${sanitizeInstaCompProviderError(",
)
replace_once(
    VISUAL,
    '''  if (!response.ok) throw new Error(`Visual verifier returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
''',
    '''  if (!response.ok) {
    throw new Error(
      sanitizeInstaCompProviderError(`Visual verifier returned HTTP ${response.status}: ${responseText}`),
    );
  }
''',
    "sanitizeInstaCompProviderError(`Visual verifier returned HTTP ${response.status}",
)
visual_path = Path(VISUAL)
visual_text = visual_path.read_text()
visual_marker = "const indexedAccepted: Array<{ index: number; row: InstaCompVisualCandidate }> = [];"
if visual_marker not in visual_text:
    function_start = visual_text.find("export async function verifyInstaCompCompetitionImages(params: {")
    if function_start < 0:
        raise SystemExit("Could not locate visual-verification function")
    visual_function = '''export async function verifyInstaCompCompetitionImages(params: {
  targetFrontImage: File;
  targetAi: InstaCompAiResult;
  candidates: InstaCompVisualCandidate[];
}) {
  const indexedAccepted: Array<{ index: number; row: InstaCompVisualCandidate }> = [];
  const indexedRejected: Array<{ index: number; row: InstaCompVisualCandidate }> = [];
  const targetDataUrl = await fileToDataUrl(params.targetFrontImage);
  let nextIndex = 0;
  let reviewedCount = 0;
  let titleOverrides = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= params.candidates.length) return;
      const candidate = params.candidates[index];

      if (!requiresVisualVerification(candidate)) {
        indexedAccepted.push({ index, row: candidate });
        continue;
      }

      if (reviewedCount >= MAX_VISUAL_CANDIDATES) {
        indexedRejected.push({
          index,
          row: {
            ...candidate,
            flags: [...candidate.flags, "visual review cap reached"].slice(0, 20),
          },
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
          indexedAccepted.push({
            index,
            row: {
              ...candidate,
              sourceCategory: inferredExactCategory(candidate),
              matchScore:
                candidate.matchScore === null
                  ? 25
                  : Math.max(0, candidate.matchScore + 150) + 25,
              flags: cleanedExactFlags(candidate, verdict),
            },
          });
        } else {
          indexedRejected.push({
            index,
            row: { ...candidate, flags: rejectedFlags(candidate, verdict) },
          });
        }
      } catch (error) {
        indexedRejected.push({
          index,
          row: { ...candidate, flags: rejectedFlags(candidate, null, error) },
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          VISUAL_REVIEW_CONCURRENCY,
          Math.max(1, params.candidates.length),
        ),
      },
      () => worker(),
    ),
  );

  return {
    accepted: indexedAccepted
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.row),
    rejected: indexedRejected
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.row),
    reviewedCount,
    titleOverrides,
    configured: Boolean(OPENAI_API_KEY),
    model: VISUAL_MODEL,
  };
}
'''
    visual_path.write_text(visual_text[:function_start] + visual_function)
    print(f"Applied deep-audit hardening: {VISUAL} (bounded visual concurrency)")

ORIENTATION = "src/lib/instacomp-image-orientation.ts"
add_import(
    ORIENTATION,
    '} from "./instacomp-image-safety";\n',
    'import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";\n',
)
replace_once(
    ORIENTATION,
    'export type InstaCompRotation = 0 | 90 | 180 | 270;\n',
    '''const requestedMinimumOrientationConfidence = Number(
  process.env.INSTACOMP_ORIENTATION_MIN_CONFIDENCE || 0.75,
);
const MINIMUM_ORIENTATION_CONFIDENCE = Number.isFinite(
  requestedMinimumOrientationConfidence,
)
  ? Math.max(0.5, Math.min(0.99, requestedMinimumOrientationConfidence))
  : 0.75;
const MAX_ORIENTATION_INPUT_PIXELS = 40_000_000;

export type InstaCompRotation = 0 | 90 | 180 | 270;
''',
    "const MINIMUM_ORIENTATION_CONFIDENCE =",
)
replace_once(
    ORIENTATION,
    '''    return {
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
''',
    '''    const frontConfidence = normalizedConfidence(parsed.frontConfidence);
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
      reason: lowConfidenceSides.length
        ? `${baseReason} Model rotation was not applied to low-confidence side(s): ${lowConfidenceSides.join(", ")}.`
        : baseReason,
    };
''',
    "const recommendedFrontRotation = normalizeInstaCompRotation(parsed.frontRotation);",
)
replace_once(
    ORIENTATION,
    'reason: error instanceof Error ? error.message : "Orientation detection failed.",',
    'reason: sanitizeInstaCompProviderError(error instanceof Error ? error.message : "Orientation detection failed."),',
    "reason: sanitizeInstaCompProviderError(error instanceof Error",
)
replace_once(
    ORIENTATION,
    'let pipeline = sharp(Buffer.from(params.bytes), { failOn: "warning" })',
    'let pipeline = sharp(Buffer.from(params.bytes), { failOn: "warning", limitInputPixels: MAX_ORIENTATION_INPUT_PIXELS })',
    "limitInputPixels: MAX_ORIENTATION_INPUT_PIXELS",
)

INVENTORY = "src/app/api/account/seller/inventory/instacomp/route.ts"
add_import(
    INVENTORY,
    'import { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";\n',
    '''import {
  assertSafeInstaCompRemoteImageUrl,
  sanitizeInstaCompProviderError,
} from "../../../../../../lib/instacomp-provider-safety";
''',
)
replace_once(
    INVENTORY,
    '''async function downloadImage(url: string, index: number) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-ExactMarket/1.0" },
  });
  if (!response.ok) throw new Error(`Image ${index + 1} returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error(`Image ${index + 1} was not a real JPEG, PNG, or WebP image.`);
  }
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, { type });
}
''',
    '''async function downloadImage(url: string, index: number) {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(url);
  const response = await fetch(safeUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-ExactMarket/1.0" },
  });
  if (!response.ok) throw new Error(`Image ${index + 1} returned HTTP ${response.status}.`);
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is larger than 12MB.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error(`Image ${index + 1} was not a real JPEG, PNG, or WebP image.`);
  }
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, { type });
}
''',
    "const safeUrl = assertSafeInstaCompRemoteImageUrl(url);",
)
replace_once(
    INVENTORY,
    '''function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active") {
  if (!row.priceIncludesShipping) return false;
''',
    '''function isPricingEligibleEvidence(row: Evidence, lane: "sold" | "active") {
  if (
    row.sourceCategory === "reference" ||
    row.source.toLowerCase().startsWith("openai_web_") ||
    row.flags.some((flag) =>
      /not independently verified for pricing|discovery(?: only| candidate)?|not used for pricing/i.test(
        flag,
      ),
    )
  ) {
    return false;
  }
  if (!row.priceIncludesShipping) return false;
''',
    'row.source.toLowerCase().startsWith("openai_web_")',
)
replace_once(
    INVENTORY,
    'error: error?.message || "Seller inventory InstaComp exact-market scan failed.",',
    'error: sanitizeInstaCompProviderError(error?.message || "Seller inventory InstaComp exact-market scan failed."),',
    "error: sanitizeInstaCompProviderError(error?.message",
)

BENCHMARK = "src/app/api/instacomp/benchmark/ebay-25/route.ts"
add_import(
    BENCHMARK,
    'import { createSupabaseServerClient } from "../../../../../lib/supabase-server";\n',
    '''import {
  assertSafeInstaCompRemoteImageUrl,
  sanitizeInstaCompProviderError,
} from "../../../../../lib/instacomp-provider-safety";
''',
)
replace_once(
    BENCHMARK,
    '''      `eBay application-token request failed (${response.status}): ${clean(payload?.error_description || payload?.error || response.statusText)}`,
''',
    '''      sanitizeInstaCompProviderError(
        `eBay application-token request failed (${response.status}): ${clean(payload?.error_description || payload?.error || response.statusText)}`,
      ),
''',
    "sanitizeInstaCompProviderError(\n        `eBay application-token request failed",
)
replace_once(
    BENCHMARK,
    '''async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "TCOS-InstaComp-Benchmark/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
''',
    '''async function downloadImage(url: string, fileName: string) {
  const safeUrl = assertSafeInstaCompRemoteImageUrl(url, { ebayOnly: true });
  const response = await fetch(safeUrl, {
    cache: "no-store",
    redirect: "error",
    headers: { "User-Agent": "TCOS-InstaComp-Benchmark/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
''',
    "const safeUrl = assertSafeInstaCompRemoteImageUrl(url, { ebayOnly: true });",
)

MATERIALIZATION = "scripts/run-instacomp-final-materialization.py"
replace_once(
    MATERIALIZATION,
    '''    "scripts/harden-instacomp-final-library-extraction.py",
    "scripts/assert-instacomp-final-source.py",
''',
    '''    "scripts/harden-instacomp-final-library-extraction.py",
    "scripts/apply-instacomp-deep-audit-fixes.py",
    "scripts/assert-instacomp-final-source.py",
''',
    '"scripts/apply-instacomp-deep-audit-fixes.py",',
)

LIVE_WORKFLOW = ".github/workflows/instacomp-live-pipeline.yml"
replace_once(
    LIVE_WORKFLOW,
    '''      - name: Run multi-card drag-drop regressions
        run: node --import tsx scripts/run-instacomp-batch-drop-regressions.ts
''',
    '''      - name: Run provider-safety regressions
        run: node --import tsx scripts/run-instacomp-provider-safety-regressions.ts

      - name: Run multi-card drag-drop regressions
        run: node --import tsx scripts/run-instacomp-batch-drop-regressions.ts
''',
    "Run provider-safety regressions",
)
replace_once(
    LIVE_WORKFLOW,
    '''          src/lib/instacomp-live-pipeline.ts
          scripts/run-instacomp-batch-drop-regressions.ts
''',
    '''          src/lib/instacomp-live-pipeline.ts
          src/lib/instacomp-provider-safety.ts
          scripts/run-instacomp-provider-safety-regressions.ts
          scripts/run-instacomp-batch-drop-regressions.ts
''',
    "src/lib/instacomp-provider-safety.ts",
)

MATERIALIZATION_WORKFLOW = ".github/workflows/instacomp-ebay-25-benchmark.yml"
replace_once(
    MATERIALIZATION_WORKFLOW,
    '''            node --import tsx scripts/run-instacomp-live-pipeline-regressions.ts
            node --import tsx scripts/run-instacomp-batch-drop-regressions.ts
''',
    '''            node --import tsx scripts/run-instacomp-live-pipeline-regressions.ts
            node --import tsx scripts/run-instacomp-provider-safety-regressions.ts
            node --import tsx scripts/run-instacomp-batch-drop-regressions.ts
''',
    "node --import tsx scripts/run-instacomp-provider-safety-regressions.ts",
)
replace_once(
    MATERIALIZATION_WORKFLOW,
    '''            src/lib/instacomp-image-orientation.ts \\
            scripts/run-instacomp-exact-market-proof-regressions.ts \\
''',
    '''            src/lib/instacomp-image-orientation.ts \\
            src/lib/instacomp-provider-safety.ts \\
            scripts/run-instacomp-provider-safety-regressions.ts \\
            scripts/run-instacomp-exact-market-proof-regressions.ts \\
''',
    "scripts/run-instacomp-provider-safety-regressions.ts \\",
)

PROOF_WORKFLOW = ".github/workflows/temporary-instacomp-exact-market-proof-main.yml"
replace_once(
    PROOF_WORKFLOW,
    '''          node --import tsx scripts/run-instacomp-live-pipeline-regressions.ts >> .codex-run/instacomp-exact-market-proof.log 2>&1
          LIVE_REGRESSIONS=$?
''',
    '''          node --import tsx scripts/run-instacomp-live-pipeline-regressions.ts >> .codex-run/instacomp-exact-market-proof.log 2>&1
          LIVE_REGRESSIONS=$?
          node --import tsx scripts/run-instacomp-provider-safety-regressions.ts >> .codex-run/instacomp-exact-market-proof.log 2>&1
          SAFETY_REGRESSIONS=$?
''',
    "SAFETY_REGRESSIONS=$?",
)
replace_once(
    PROOF_WORKFLOW,
    '''          echo "live_regressions=$LIVE_REGRESSIONS" >> "$GITHUB_OUTPUT"
          test "$PASS1" -eq 0 && test "$PASS2" -eq 0 && test "$PASS3" -eq 0 && test "$LIVE_REGRESSIONS" -eq 0
''',
    '''          echo "live_regressions=$LIVE_REGRESSIONS" >> "$GITHUB_OUTPUT"
          echo "safety_regressions=$SAFETY_REGRESSIONS" >> "$GITHUB_OUTPUT"
          test "$PASS1" -eq 0 && test "$PASS2" -eq 0 && test "$PASS3" -eq 0 && test "$LIVE_REGRESSIONS" -eq 0 && test "$SAFETY_REGRESSIONS" -eq 0
''',
    'echo "safety_regressions=$SAFETY_REGRESSIONS"',
)
replace_once(
    PROOF_WORKFLOW,
    '''            echo "live_pipeline_regressions=${{ steps.regressions.outputs.live_regressions }}"
            echo "provider_env=${{ steps.provider_env.outcome }}"
''',
    '''            echo "live_pipeline_regressions=${{ steps.regressions.outputs.live_regressions }}"
            echo "provider_safety_regressions=${{ steps.regressions.outputs.safety_regressions }}"
            echo "provider_env=${{ steps.provider_env.outcome }}"
''',
    "provider_safety_regressions=",
)

print("InstaComp deep-audit hardening completed.")
