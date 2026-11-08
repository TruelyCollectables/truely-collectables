from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, found {count}")
    file.write_text(source.replace(old, new, 1))
    print(f"patched: {label}")


# 1. Extend the existing narrow orientation referee so it also reports whether
# the back has a standalone PRIZM parallel designation. Product copyright text
# such as 'Panini - WNBA Prizm Basketball' is explicitly not enough.
orientation_path = "src/lib/instacomp-image-orientation.ts"
replace_once(
    orientation_path,
    """  frontConfidence: number;\n  backConfidence: number;\n  reason: string;\n};""",
    """  frontConfidence: number;\n  backConfidence: number;\n  backStandalonePrizm: boolean | null;\n  backDesignationConfidence: number;\n  reason: string;\n};""",
    "orientation receipt fields",
)
replace_once(
    orientation_path,
    """      frontConfidence: 0,\n      backConfidence: 0,\n      reason:\n        \"OPENAI_API_KEY is not configured; only embedded EXIF orientation can be normalized.\",""",
    """      frontConfidence: 0,\n      backConfidence: 0,\n      backStandalonePrizm: null,\n      backDesignationConfidence: 0,\n      reason:\n        \"OPENAI_API_KEY is not configured; only embedded EXIF orientation can be normalized.\",""",
    "orientation not-configured receipt",
)
replace_once(
    orientation_path,
    """        \"Use printed player names, team names, logos, card numbers, copyright text, grading labels, and serial stamps as orientation evidence.\",\n        \"A horizontal card may correctly require 90 or 270 degrees. The back may require a different rotation from the front.\",\n        \"Do not identify, price, or compare the card. Return JSON only.\",""",
    """        \"Use printed player names, team names, logos, card numbers, copyright text, grading labels, and serial stamps as orientation evidence.\",\n        \"A horizontal card may correctly require 90 or 270 degrees. The back may require a different rotation from the front.\",\n        \"Also inspect the BACK for a standalone PRIZM parallel designation printed separately from the product/legal line.\",\n        \"The phrase Panini - WNBA Prizm Basketball in copyright or product text does NOT prove a Prizm parallel. Return backStandalonePrizm=false unless a separate PRIZM designation is visibly printed on the card back.\",\n        \"Do not identify, price, or compare the card. Return JSON only.\",""",
    "orientation designation prompt",
)
replace_once(
    orientation_path,
    """                backConfidence: { type: \"number\" },\n                reason: { type: \"string\" },""",
    """                backConfidence: { type: \"number\" },\n                backStandalonePrizm: { type: \"boolean\" },\n                backDesignationConfidence: { type: \"number\" },\n                reason: { type: \"string\" },""",
    "orientation designation schema",
)
replace_once(
    orientation_path,
    """                \"frontConfidence\",\n                \"backConfidence\",\n                \"reason\",""",
    """                \"frontConfidence\",\n                \"backConfidence\",\n                \"backStandalonePrizm\",\n                \"backDesignationConfidence\",\n                \"reason\",""",
    "orientation designation required fields",
)
replace_once(
    orientation_path,
    """    const recommendedFrontRotation = normalizeInstaCompRotation(parsed.frontRotation);\n    const recommendedBackRotation = params.backDataUrl\n      ? normalizeInstaCompRotation(parsed.backRotation)\n      : 0;""",
    """    const recommendedFrontRotation = normalizeInstaCompRotation(parsed.frontRotation);\n    const recommendedBackRotation = params.backDataUrl\n      ? normalizeInstaCompRotation(parsed.backRotation)\n      : 0;\n    const backStandalonePrizm = params.backDataUrl\n      ? parsed.backStandalonePrizm === true\n      : null;\n    const backDesignationConfidence = params.backDataUrl\n      ? normalizedConfidence(parsed.backDesignationConfidence)\n      : 0;""",
    "orientation designation parsing",
)
replace_once(
    orientation_path,
    """      frontConfidence,\n      backConfidence,\n      reason: lowConfidenceSides.length""",
    """      frontConfidence,\n      backConfidence,\n      backStandalonePrizm,\n      backDesignationConfidence,\n      reason: lowConfidenceSides.length""",
    "orientation designation success receipt",
)
replace_once(
    orientation_path,
    """      frontConfidence: 0,\n      backConfidence: 0,\n      reason: sanitizeInstaCompProviderError(error instanceof Error ? error.message : \"Orientation detection failed.\"),""",
    """      frontConfidence: 0,\n      backConfidence: 0,\n      backStandalonePrizm: null,\n      backDesignationConfidence: 0,\n      reason: sanitizeInstaCompProviderError(error instanceof Error ? error.message : \"Orientation detection failed.\"),""",
    "orientation error receipt",
)

# 2. Normalize the actual listing upload before the Mac scan and permanently
# persist the corrected pair to inventory_images after the draft is created.
intake_path = "src/app/api/account/seller/instacomp-scan/intake/route.ts"
replace_once(
    intake_path,
    """import type { InstaCompAiResult } from \"../../../../../../lib/instacomp\";\nimport { getActiveStoreId } from \"../../../../../../lib/stores\";""",
    """import type { InstaCompAiResult } from \"../../../../../../lib/instacomp\";\nimport { normalizeInstaCompSideImages } from \"../../../../../../lib/instacomp-image-orientation\";\nimport { persistNormalizedInstaCompImagePair } from \"../../../../../../lib/instacomp-normalized-image-storage\";\nimport { getActiveStoreId } from \"../../../../../../lib/stores\";""",
    "scanner intake imports",
)
replace_once(
    intake_path,
    """    const scan = await analyzeWithInstaCompAiLocal({ front, back });""",
    """    const frontFile =\n      front instanceof File\n        ? front\n        : new File([front], \"front-upload.jpg\", {\n            type: front.type || \"image/jpeg\",\n          });\n    const backFile =\n      back instanceof File\n        ? back\n        : new File([back], \"back-upload.jpg\", {\n            type: back.type || \"image/jpeg\",\n          });\n    const normalizedSides = await normalizeInstaCompSideImages({\n      frontImage: frontFile,\n      backImage: backFile,\n    });\n    if (!normalizedSides.backFile) {\n      throw new Error(\"Back image normalization did not return an image.\");\n    }\n    const scan = await analyzeWithInstaCompAiLocal({\n      front: normalizedSides.frontFile,\n      back: normalizedSides.backFile,\n    });""",
    "normalize listing images before scan",
)
replace_once(
    intake_path,
    """    const fields = canonicalFields(identity);""",
    """    let fields = canonicalFields(identity);""",
    "allow evidence rule to refine fields",
)
replace_once(
    intake_path,
    """    const imagePairSha256 = text(scan.image_pair_sha256, 128);""",
    """    const isWnbaProduct = /\\bwnba\\b/i.test(\n      [fields.league, fields.setName].filter(Boolean).join(\" \"),\n    );\n    const claimsPrizmParallel = Boolean(\n      fields.parallel &&\n        /\\b(?:silver|green|red|blue|gold|orange|purple|pink|black|white|ice|wave|velocity|cracked\\s+ice)(?:\\s+prizm)?\\b/i.test(\n          fields.parallel,\n        ),\n    );\n    const forcedBaseFromBack =\n      isWnbaProduct &&\n      claimsPrizmParallel &&\n      normalizedSides.orientation.backStandalonePrizm === false &&\n      normalizedSides.orientation.backDesignationConfidence >= 0.8;\n    if (forcedBaseFromBack) {\n      fields = { ...fields, parallel: null, variation: null };\n    }\n\n    const imagePairSha256 = text(scan.image_pair_sha256, 128);""",
    "enforce WNBA Base from back designation",
)
replace_once(
    intake_path,
    """        scanReceipt: scan,\n        localEvidence:""",
    """        scanReceipt: scan,\n        imageOrientation: normalizedSides.orientation,\n        identityRuleApplied: forcedBaseFromBack\n          ? \"wnba_back_without_standalone_prizm_forced_base\"\n          : null,\n        localEvidence:""",
    "persist orientation and Base rule receipt",
)
replace_once(
    intake_path,
    """    if (insertError) throw insertError;\n\n    const requestId = `scan-${scan.scan_id}`;""",
    """    if (insertError) throw insertError;\n\n    const persistedImages = await persistNormalizedInstaCompImagePair({\n      supabase,\n      storeId,\n      inventoryItemId: inserted.id,\n      title: inserted.title,\n      frontFile: normalizedSides.frontFile,\n      backFile: normalizedSides.backFile,\n      orientation: normalizedSides.orientation,\n    });\n\n    const requestId = `scan-${scan.scan_id}`;""",
    "persist normalized pair after draft creation",
)
replace_once(
    intake_path,
    """        pricingSucceeded: pricingResponse.ok,\n        durationMs: Date.now() - startedAt,""",
    """        pricingSucceeded: pricingResponse.ok,\n        imageOrientation: normalizedSides.orientation,\n        normalizedImages: persistedImages,\n        identityRuleApplied: forcedBaseFromBack\n          ? \"wnba_back_without_standalone_prizm_forced_base\"\n          : null,\n        durationMs: Date.now() - startedAt,""",
    "return normalized image receipt",
)

# 3. Image edits must invalidate and unlock the old identity because the
# physical evidence changed.
image_edit_path = "src/app/api/admin/card-listing-images/route.ts"
replace_once(
    image_edit_path,
    """      frontImageUrl: params.front,\n      backImageUrl: params.back || null,\n    },""",
    """      frontImageUrl: params.front,\n      backImageUrl: params.back || null,\n      humanVerified: false,\n      trustedForIdentity: false,\n      manualIdentityEdit: false,\n      manualIdentityLocked: false,\n      identityRefreshRequired: true,\n      identityResolutionStatus: \"awaiting_front_back_registry_rescan\",\n    },""",
    "image edit invalidates locked identity",
)

# 4. KINGMAKER must not disable rotation merely because a stale identity is
# locked. The server edit above safely unlocks and invalidates it.
page_path = "src/app/kingmaker/instacomp-audit/page.tsx"
replace_once(
    page_path,
    """  const cardNumber =\n    status?.cardNumber || item.extractedInput.cardNumber || \"\";\n  const manufacturer =\n    status?.manufacturer || item.extractedInput.manufacturer || \"\";\n  const contradiction = hasImpossibleBaseParallelTitle(item.title);\n  const title = contradiction ? correctedBaseTitle(item.title) : item.title;\n\n  return {\n    title: status?.title || title,""",
    """  const cardNumber =\n    status?.cardNumber || item.extractedInput.cardNumber || \"\";\n  const manufacturer =\n    status?.manufacturer || item.extractedInput.manufacturer || \"\";\n  const sourceTitle = status?.title || item.title;\n  const contradiction = hasImpossibleBaseParallelTitle(sourceTitle);\n  const title = contradiction ? correctedBaseTitle(sourceTitle) : sourceTitle;\n\n  return {\n    title,""",
    "locked stale title cannot bypass Base correction",
)
replace_once(
    page_path,
    """    const locked = statuses[item.inventoryItemId]?.locked === true;\n    if (locked) {\n      setAction(item.inventoryItemId, {\n        error: \"Unlock the identity before changing its image evidence.\",\n        notice: \"\",\n      });\n      return;\n    }\n    setAction(item.inventoryItemId, {""",
    """    setAction(item.inventoryItemId, {""",
    "allow image edits on locked drafts",
)
page = Path(page_path)
source = page.read_text()
for old, new, label in [
    (
        "disabled={locked || Boolean(action?.busy)}",
        "disabled={Boolean(action?.busy)}",
        "enable swap while identity is locked",
    ),
    (
        "disabled={locked || Boolean(action?.busy) || !url}",
        "disabled={Boolean(action?.busy) || !url}",
        "enable rotate while identity is locked",
    ),
]:
    count = source.count(old)
    expected = 1 if "swap" in label else 2
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    source = source.replace(old, new)
source = source.replace(
    "Rotate and swap save immediately. Lock the identity after the\n                        images are correct.",
    "Rotate and swap save immediately. Any image change automatically\n                        unlocks and invalidates the old identity before a fresh scan.",
    1,
)
page.write_text(source)
print("patched: KINGMAKER rotation controls")

print("Applied automatic orientation persistence, WNBA back designation rule, and safe rotation unlocking.")
