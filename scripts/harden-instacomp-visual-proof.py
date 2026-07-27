from __future__ import annotations

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def patch_visual_verifier() -> None:
    path = Path("src/lib/instacomp-comp-visual-verification.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function dataUrlFromBytes(bytes: ArrayBuffer, contentType: string | null) {
  const mime = String(contentType || "image/jpeg").split(";")[0].trim() || "image/jpeg";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
''',
        '''function detectedImageMime(bytes: ArrayBuffer) {
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

function dataUrlFromBytes(bytes: ArrayBuffer, _contentType: string | null) {
  const mime = detectedImageMime(bytes);
  if (!mime) throw new Error("Image bytes were not a real JPEG, PNG, or WebP file.");
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}
''',
        "visual image-byte validation",
    )

    text = replace_once(
        text,
        '''function requiresVisualVerification(candidate: InstaCompVisualCandidate) {
  if (candidate.flags.some((flag) => /deterministic exact identity/i.test(flag))) return false;
  return candidate.flags.some((flag) =>
    /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag),
  );
}
''',
        '''function requiresVisualVerification(candidate: InstaCompVisualCandidate) {
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
''',
        "visual-verification bypass",
    )

    text = replace_once(
        text,
        '''function inferredExactCategory(candidate: InstaCompVisualCandidate) {
  if (candidate.source === "ebay_active") return "marketplace";
  if (/sold/i.test(candidate.sourceLabel)) return "sold";
  return candidate.sourceCategory;
}
''',
        '''function inferredExactCategory(candidate: InstaCompVisualCandidate) {
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
''',
        "AI candidate category guard",
    )

    text = text.replace(
        '"Judge the exact parallel/variation, especially color and printed pattern.",',
        '"Judge the complete exact card identity: player, year/product, card number, parallel/variation, serial print-run denominator, autograph/relic state, raw/graded state, grading company, and grade. Color and printed pattern are necessary but not sufficient.",',
    )
    text = text.replace(
        '"Use exact_visual_match only when the candidate image shows the same exact parallel/variation as the target image.",',
        '"Use exact_visual_match only when every identity field visible in both images agrees. Any wrong player, card number, product, parallel, print run, autograph/relic state, grader, or grade must be wrong_parallel or uncertain.",',
    )
    text = text.replace(
        'if (verdict.verdict === "exact_visual_match" && verdict.confidence >= 0.78) {',
        'if (verdict.verdict === "exact_visual_match" && verdict.confidence >= 0.85) {',
    )

    path.write_text(text)


def patch_seller_image_download() -> None:
    path = Path("src/app/api/account/seller/inventory/instacomp/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''function imageType(url: string, responseType: string | null) {
  const normalized = String(responseType || "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(normalized)) return normalized;
  if (/\\.png(?:\\?|$)/i.test(url)) return "image/png";
  if (/\\.webp(?:\\?|$)/i.test(url)) return "image/webp";
  return "image/jpeg";
}
''',
        '''function imageType(bytes: ArrayBuffer) {
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
''',
        "seller image type detection",
    )

    text = replace_once(
        text,
        '''  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(url, response.headers.get("content-type"));
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, { type });
''',
        '''  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
    throw new Error(`Image ${index + 1} was not a real JPEG, PNG, or WebP image.`);
  }
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, { type });
''',
        "seller image magic-byte enforcement",
    )

    path.write_text(text)


def patch_live_scan_visual_proof() -> None:
    path = Path("src/app/api/instacomp/live-scan/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";
''',
        '''import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";
import { verifyInstaCompCompetitionImages } from "../../../../lib/instacomp-comp-visual-verification";
''',
        "live visual verifier import",
    )

    text = replace_once(
        text,
        '''function settledMessage(value: PromiseSettledResult<unknown>) {
''',
        '''function forceVisualProof(provider: InstaCompProviderResult) {
  return {
    ...provider,
    results: provider.results.map((row) => ({
      ...row,
      flags: Array.from(
        new Set([
          ...row.flags,
          "guidance comp",
          "strict exact title awaiting image proof",
        ]),
      ).slice(0, 20),
    })),
  } satisfies InstaCompProviderResult;
}

function providerAfterVisualReview(params: {
  provider: InstaCompProviderResult;
  accepted: InstaCompProviderResult["results"];
  rejectedCount: number;
}) {
  return {
    ...params.provider,
    status: params.accepted.length ? "live" : "no_matches",
    message: params.accepted.length
      ? `${params.accepted.length} candidate image${params.accepted.length === 1 ? "" : "s"} passed exact-card visual proof.`
      : `${params.rejectedCount} title candidate${params.rejectedCount === 1 ? " was" : "s were"} rejected or inconclusive after image proof.`,
    results: params.accepted,
  } satisfies InstaCompProviderResult;
}

function settledMessage(value: PromiseSettledResult<unknown>) {
''',
        "live visual proof helpers",
    )

    text = replace_once(
        text,
        '''  let frontReceived = false;
  let backReceived = false;
''',
        '''  let frontReceived = false;
  let backReceived = false;
  let targetFrontImage: File | null = null;
''',
        "live target image state",
    )

    text = replace_once(
        text,
        '''    frontReceived = inspection.get("frontImage") instanceof File;
    backReceived = inspection.get("backImage") instanceof File;
''',
        '''    const inspectedFront = inspection.get("frontImage");
    const inspectedBack = inspection.get("backImage");
    targetFrontImage = inspectedFront instanceof File ? inspectedFront : null;
    frontReceived = Boolean(targetFrontImage);
    backReceived = inspectedBack instanceof File;
''',
        "live target image capture",
    )

    text = replace_once(
        text,
        '''  const summary = mergeExactMarketSources([serpSource, officialActiveSource]);
  const exactProviders = [
    serpSource.sold,
    serpSource.active,
    officialActiveSource.active,
    openAiSource.sold,
    openAiSource.active,
  ];
''',
        '''  const visualTarget = targetFrontImage;
  if (!visualTarget) {
    return json({ ok: false, error: "The exact-market verifier lost the target front image." }, 500);
  }
  const serpSoldForReview = forceVisualProof(serpSource.sold);
  const serpActiveForReview = forceVisualProof(serpSource.active);
  const officialActiveForReview = forceVisualProof(officialActiveSource.active);
  const [serpSoldReview, serpActiveReview, officialActiveReview] = await Promise.all([
    verifyInstaCompCompetitionImages({
      targetFrontImage: visualTarget,
      targetAi: ai,
      candidates: serpSoldForReview.results,
    }),
    verifyInstaCompCompetitionImages({
      targetFrontImage: visualTarget,
      targetAi: ai,
      candidates: serpActiveForReview.results,
    }),
    verifyInstaCompCompetitionImages({
      targetFrontImage: visualTarget,
      targetAi: ai,
      candidates: officialActiveForReview.results,
    }),
  ]);
  const verifiedSerpSource: InstaCompExactMarketSource = {
    sold: providerAfterVisualReview({
      provider: serpSource.sold,
      accepted: serpSoldReview.accepted,
      rejectedCount: serpSoldReview.rejected.length,
    }),
    active: providerAfterVisualReview({
      provider: serpSource.active,
      accepted: serpActiveReview.accepted,
      rejectedCount: serpActiveReview.rejected.length,
    }),
  };
  const verifiedOfficialActiveSource: InstaCompExactMarketSource = {
    sold: officialActiveSource.sold,
    active: providerAfterVisualReview({
      provider: officialActiveSource.active,
      accepted: officialActiveReview.accepted,
      rejectedCount: officialActiveReview.rejected.length,
    }),
  };
  const summary = mergeExactMarketSources([
    verifiedSerpSource,
    verifiedOfficialActiveSource,
  ]);
  const exactProviders = [
    verifiedSerpSource.sold,
    verifiedSerpSource.active,
    verifiedOfficialActiveSource.active,
    openAiSource.sold,
    openAiSource.active,
  ];
''',
        "live visual proof execution",
    )

    text = replace_once(
        text,
        '''        openAiWeb: {
          soldStatus: openAiSource.sold.status,
''',
        '''        visualProof: {
          configured:
            serpSoldReview.configured &&
            serpActiveReview.configured &&
            officialActiveReview.configured,
          model: serpSoldReview.model,
          soldReviewed: serpSoldReview.reviewedCount,
          soldRejected: serpSoldReview.rejected.length,
          serpActiveReviewed: serpActiveReview.reviewedCount,
          serpActiveRejected: serpActiveReview.rejected.length,
          officialActiveReviewed: officialActiveReview.reviewedCount,
          officialActiveRejected: officialActiveReview.rejected.length,
        },
        openAiWeb: {
          soldStatus: openAiSource.sold.status,
''',
        "live visual diagnostics",
    )

    path.write_text(text)


def patch_benchmark_pricing_grade() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''  } else if (!Number(scan?.exactMarket?.soldCount || 0)) {
''',
        '''  } else if (
    !Number(
      scan?.exactMarket?.pricingEligibleSoldCount ?? scan?.exactMarket?.soldCount ?? 0,
    )
  ) {
''',
        "benchmark pricing-eligible sold gate",
    )
    text = replace_once(
        text,
        '''  if (scan?.exactMarket?.trustedSuggestedPrice && !Number(scan?.exactMarket?.soldCount || 0)) {
''',
        '''  if (
    scan?.exactMarket?.trustedSuggestedPrice &&
    !Number(
      scan?.exactMarket?.pricingEligibleSoldCount ?? scan?.exactMarket?.soldCount ?? 0,
    )
  ) {
''',
        "benchmark unsupported price gate",
    )

    path.write_text(text)


def main() -> None:
    patch_visual_verifier()
    patch_seller_image_download()
    patch_live_scan_visual_proof()
    patch_benchmark_pricing_grade()


if __name__ == "__main__":
    main()
