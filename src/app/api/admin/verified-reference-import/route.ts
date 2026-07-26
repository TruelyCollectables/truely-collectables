import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  INSTACOMP_JOB_IMAGE_BUCKET,
  InstaCompJobServerError,
  instaCompImageExtension,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
} from "../../../../lib/instacomp-job-server";
import {
  parsePhysicalSerial,
  verifyGraderCertification,
} from "../../../../lib/collectible-assets";
import {
  InventoryEngine,
  InventoryRepository,
} from "../../../../modules/inventory";
import type { AuthenticityProfile } from "../../../../lib/authenticity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_REFERENCE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DRAFT_IMAGE_URL_TTL_SECONDS = 30 * 24 * 60 * 60;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type VerifiedField = {
  originalValue?: unknown;
  finalValue?: unknown;
  status?: unknown;
  corrected?: unknown;
};

type VerifiedRecord = {
  recordId?: unknown;
  cardId?: unknown;
  batch?: unknown;
  verificationStatus?: unknown;
  overallGrade?: unknown;
  reviewerNotes?: unknown;
  pairing?: {
    status?: unknown;
    pairingConfidence?: unknown;
    pairingEvidence?: unknown;
  };
  scans?: {
    front?: { sourceLabel?: unknown; imageDataUrl?: unknown };
    back?: { sourceLabel?: unknown; imageDataUrl?: unknown };
  };
  title?: unknown;
  fields?: Record<string, VerifiedField | string | number | boolean | null>;
  evidence?: unknown;
  sourceNotes?: unknown;
  trustBoundary?: unknown;
};

type VerifiedExport = {
  schema?: unknown;
  batch?: unknown;
  recordCount?: unknown;
  scanCount?: unknown;
  records?: unknown;
};

type UploadedImage = {
  file: File;
  bytes: Uint8Array;
  sha256: string;
  contentType: string;
};

function textValue(value: unknown, maxLength = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function listValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function safeKey(value: unknown, fallback: string) {
  const key = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return key || fallback;
}

function verifiedField(record: VerifiedRecord, names: string[]) {
  const fields = recordValue(record.fields);
  for (const name of names) {
    const raw = fields[name];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const field = raw as VerifiedField;
      const value = field.finalValue ?? field.originalValue;
      const text = textValue(value);
      if (text) return text;
    } else {
      const text = textValue(raw);
      if (text) return text;
    }
  }
  return null;
}

function yesValue(value: unknown) {
  return /^(yes|true|1)\b/i.test(String(value || "").trim());
}

function parseYear(value: unknown) {
  const year = Number(String(value || "").match(/\b(19|20)\d{2}\b/)?.[0]);
  return Number.isInteger(year) ? year : null;
}

function parseGrading(value: unknown, certNumber: unknown) {
  const text = textValue(value, 120);
  const cert = textValue(certNumber, 120);
  if (!text || /raw|ungraded|not graded/i.test(text)) {
    return {
      company: null,
      grade: null,
      certNumber: cert,
    };
  }

  const match = text.match(
    /^(PSA|SGC|BGS|BECKETT|CGC|HGA|TAG)\s+(.+)$/i,
  );
  return {
    company: match ? match[1].toUpperCase().replace("BECKETT", "BGS") : null,
    grade: match ? match[2].trim() : text,
    certNumber: cert,
  };
}

function inferSport(params: {
  title: string;
  productSet: string | null;
  team: string | null;
}) {
  const text = `${params.title} ${params.productSet || ""} ${params.team || ""}`.toLowerCase();
  if (
    /\b(football|nfl|browns|jaguars|quarterback|running back|wide receiver)\b/.test(
      text,
    )
  ) {
    return "Football";
  }
  if (/\b(baseball|mlb|brewers|pitcher|prospects)\b/.test(text)) {
    return "Baseball";
  }
  return "Sports Cards";
}

function descriptionLines(params: {
  title: string;
  player: string | null;
  year: number | null;
  manufacturer: string | null;
  productSet: string | null;
  insertSubset: string | null;
  cardNumber: string | null;
  parallel: string | null;
  exactSerialNumber: string | null;
  gradingCompany: string | null;
  gradingGrade: string | null;
  gradingCertNumber: string | null;
  autograph: string | null;
  memorabilia: string | null;
}) {
  return [
    params.title,
    params.player ? `Player/subject: ${params.player}.` : null,
    params.year ? `Year: ${params.year}.` : null,
    params.manufacturer ? `Manufacturer: ${params.manufacturer}.` : null,
    params.productSet ? `Product/set: ${params.productSet}.` : null,
    params.insertSubset ? `Insert/subset: ${params.insertSubset}.` : null,
    params.cardNumber ? `Card number: ${params.cardNumber}.` : null,
    params.parallel ? `Parallel/variety: ${params.parallel}.` : null,
    params.exactSerialNumber
      ? `Exact physical copy stamp: ${params.exactSerialNumber}.`
      : null,
    params.gradingCompany
      ? `Grading: ${params.gradingCompany} ${params.gradingGrade || ""}.`
      : null,
    params.gradingCertNumber
      ? `Grading certification number: ${params.gradingCertNumber}.`
      : null,
    params.autograph ? `Autograph: ${params.autograph}.` : null,
    params.memorabilia ? `Memorabilia: ${params.memorabilia}.` : null,
    "Human-verified InstaComp™ reference import. Front/back pairing and identity were approved before this private draft was created.",
    "Pending listing: set the final price and review the official grader-verification result before activation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function decodeDataImage(
  value: unknown,
  side: "front" | "back",
  sourceLabel: unknown,
): UploadedImage {
  const dataUrl = String(value || "");
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    throw new InstaCompJobServerError(
      `${side} scan is missing or is not a JPEG, PNG, or WebP data URL.`,
      400,
      "VERIFIED_REFERENCE_IMAGE_INVALID",
    );
  }

  const contentType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new InstaCompJobServerError(
      `${side} scan uses an unsupported image type.`,
      400,
      "VERIFIED_REFERENCE_IMAGE_TYPE_INVALID",
    );
  }

  const bytes = Uint8Array.from(Buffer.from(match[2].replace(/\s+/g, ""), "base64"));
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new InstaCompJobServerError(
      `${side} scan must be between 1 byte and 12MB.`,
      bytes.byteLength > MAX_IMAGE_BYTES ? 413 : 400,
      "VERIFIED_REFERENCE_IMAGE_SIZE_INVALID",
    );
  }

  const extension = instaCompImageExtension(contentType);
  const label = safeKey(sourceLabel, side);
  return {
    bytes,
    contentType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    file: new File([bytes], `${label}-${side}.${extension}`, {
      type: contentType,
    }),
  };
}

async function uploadReferenceImage(params: {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  storeId: string;
  batch: string;
  recordKey: string;
  side: "front" | "back";
  image: UploadedImage;
}) {
  const path = [
    "verified-reference",
    params.storeId,
    safeKey(params.batch, "batch"),
    safeKey(params.recordKey, "record"),
    `${params.side}.${instaCompImageExtension(params.image.contentType)}`,
  ].join("/");

  const { error: uploadError } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .upload(path, params.image.file, {
      contentType: params.image.contentType,
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) {
    throw new InstaCompJobServerError(
      uploadError.message,
      500,
      "VERIFIED_REFERENCE_IMAGE_UPLOAD_FAILED",
    );
  }

  const { data: signedData, error: signedError } =
    await params.supabase.storage
      .from(INSTACOMP_JOB_IMAGE_BUCKET)
      .createSignedUrl(path, DRAFT_IMAGE_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    throw new InstaCompJobServerError(
      signedError?.message || "Could not authorize the verified scan preview.",
      500,
      "VERIFIED_REFERENCE_IMAGE_SIGNING_FAILED",
    );
  }

  return { path, signedUrl: signedData.signedUrl };
}

function authenticityProfile(params: {
  gradingCompany: string | null;
  gradingCertNumber: string | null;
  isAuto: boolean;
  autographText: string | null;
}): AuthenticityProfile {
  if (params.gradingCompany) {
    return {
      status: "verified_cert",
      autographSource: "none",
      certProvider: params.gradingCompany,
      certNumber: params.gradingCertNumber,
      guaranteedAuthenticators: [],
      provenanceEvidence: null,
      authenticityNotes:
        "Grading company and certification number were read from the slab label. Official certification lookup evidence is stored separately on the collectible asset.",
    };
  }

  if (params.isAuto) {
    return {
      status: "provenance_only",
      autographSource: "other",
      certProvider: null,
      certNumber: null,
      guaranteedAuthenticators: [],
      provenanceEvidence:
        params.autographText ||
        "The card states that the autograph is guaranteed by the manufacturer.",
      authenticityNotes:
        "Manufacturer autograph language is provenance evidence; it is not a separate third-party autograph certification.",
    };
  }

  return {
    status: "not_applicable",
    autographSource: "none",
    certProvider: null,
    certNumber: null,
    guaranteedAuthenticators: [],
    provenanceEvidence: null,
    authenticityNotes: null,
  };
}

function missingCollectibleAssetTables(error: { code?: string; message?: string }) {
  const message = String(error.message || "").toLowerCase();
  return error.code === "42P01" || message.includes("collectible_assets");
}

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);
    if (actor.type !== "admin") {
      throw new InstaCompJobServerError(
        "Verified-reference import is restricted to the Truely Collectables administrator.",
        403,
        "VERIFIED_REFERENCE_ADMIN_REQUIRED",
      );
    }

    const formData = await request.formData();
    const referenceFile = formData.get("verifiedReferenceFile");
    if (!(referenceFile instanceof File) || referenceFile.size <= 0) {
      throw new InstaCompJobServerError(
        "Choose the verified-reference JSON export.",
        400,
        "VERIFIED_REFERENCE_FILE_REQUIRED",
      );
    }
    if (referenceFile.size > MAX_REFERENCE_FILE_BYTES) {
      throw new InstaCompJobServerError(
        "Verified-reference JSON must be 50MB or smaller.",
        413,
        "VERIFIED_REFERENCE_FILE_TOO_LARGE",
      );
    }

    let payload: VerifiedExport;
    try {
      payload = JSON.parse(await referenceFile.text()) as VerifiedExport;
    } catch {
      throw new InstaCompJobServerError(
        "The selected file is not valid JSON.",
        400,
        "VERIFIED_REFERENCE_JSON_INVALID",
      );
    }

    if (payload.schema !== "tcos.instacomp.verifiedReferenceDatabase.v1") {
      throw new InstaCompJobServerError(
        "This is not an InstaComp verified-reference database export.",
        400,
        "VERIFIED_REFERENCE_SCHEMA_INVALID",
      );
    }

    const records = listValue(payload.records) as VerifiedRecord[];
    if (records.length === 0 || records.length > 50) {
      throw new InstaCompJobServerError(
        "The import must contain between 1 and 50 verified cards.",
        400,
        "VERIFIED_REFERENCE_RECORD_COUNT_INVALID",
      );
    }

    const supabase = requireInstaCompJobSupabase();
    const repository = new InventoryRepository(actor.storeId, supabase);
    const engine = new InventoryEngine(actor.storeId, repository, supabase);
    const batch = safeKey(payload.batch, "unbatched");
    const results: Array<Record<string, unknown>> = [];

    for (const [index, record] of records.entries()) {
      const recordId = safeKey(record.recordId || record.cardId, `card-${index + 1}`);
      const sourceRecordKey = `verified-reference:${batch}:${recordId}`;
      let uploadedPaths: string[] = [];
      let legacyProductId: number | null = null;
      let inventoryItemId: string | null = null;
      let assetCreated = false;

      try {
        if (
          record.verificationStatus !== "human_verified" ||
          record.overallGrade !== "correct" ||
          record.pairing?.status !== "correct"
        ) {
          throw new InstaCompJobServerError(
            `${recordId} was not approved as a fully human-verified card and pairing.`,
            400,
            "VERIFIED_REFERENCE_NOT_APPROVED",
          );
        }

        const { data: existingAsset, error: existingError } = await supabase
          .from("collectible_assets")
          .select("id,inventory_item_id,legacy_product_id,title")
          .eq("store_id", actor.storeId)
          .eq("source_record_key", sourceRecordKey)
          .maybeSingle();

        if (existingError) {
          if (missingCollectibleAssetTables(existingError)) {
            throw new InstaCompJobServerError(
              "Collectible lifecycle tables are not installed yet. Apply the collectible-asset migration before importing.",
              503,
              "COLLECTIBLE_ASSET_MIGRATION_REQUIRED",
            );
          }
          throw existingError;
        }

        if (existingAsset) {
          results.push({
            recordId,
            status: "skipped_existing",
            assetId: existingAsset.id,
            inventoryItemId: existingAsset.inventory_item_id,
            legacyProductId: existingAsset.legacy_product_id,
            title: existingAsset.title,
            editUrl: existingAsset.inventory_item_id
              ? `/seller/inventory?status=draft&search=${encodeURIComponent(recordId)}`
              : null,
          });
          continue;
        }

        const title = textValue(record.title, 240);
        if (!title) {
          throw new InstaCompJobServerError(
            `${recordId} is missing its verified title.`,
            400,
            "VERIFIED_REFERENCE_TITLE_REQUIRED",
          );
        }

        const player = verifiedField(record, ["Player"]);
        const year = parseYear(verifiedField(record, ["Year"]));
        const manufacturer = verifiedField(record, ["Manufacturer"]);
        const productSet = verifiedField(record, ["Product / Set", "Set"]);
        const insertSubset = verifiedField(record, ["Insert / Subset", "Insert"]);
        const cardNumber = verifiedField(record, ["Card Number"]);
        const parallel = verifiedField(record, ["Parallel / Variety", "Parallel"]);
        const serialText = verifiedField(record, ["Serial Number"]);
        const team = verifiedField(record, ["Team", "Team / Organization"]);
        const rookieStatus = verifiedField(record, ["Rookie Status"]);
        const autographText = verifiedField(record, ["Autograph"]);
        const memorabiliaText = verifiedField(record, ["Memorabilia"]);
        const gradingText = verifiedField(record, ["Grading"]);
        const gradingCertNumber = verifiedField(record, ["Certification Number"]);
        const grading = parseGrading(gradingText, gradingCertNumber);
        const serial = parsePhysicalSerial(serialText);
        const isAuto = yesValue(autographText);
        const isRelic = yesValue(memorabiliaText);
        const sport = inferSport({ title, productSet, team });
        const condition = grading.company ? "Graded" : "Near Mint or Better";

        const frontScan = record.scans?.front;
        const backScan = record.scans?.back;
        const frontImage = decodeDataImage(
          frontScan?.imageDataUrl,
          "front",
          frontScan?.sourceLabel,
        );
        const backImage = decodeDataImage(
          backScan?.imageDataUrl,
          "back",
          backScan?.sourceLabel,
        );

        const [front, back, graderVerification] = await Promise.all([
          uploadReferenceImage({
            supabase,
            storeId: actor.storeId,
            batch,
            recordKey: recordId,
            side: "front",
            image: frontImage,
          }),
          uploadReferenceImage({
            supabase,
            storeId: actor.storeId,
            batch,
            recordKey: recordId,
            side: "back",
            image: backImage,
          }),
          verifyGraderCertification({
            provider: grading.company,
            certNumber: grading.certNumber,
            expected: {
              year,
              manufacturer,
              player,
              cardNumber,
              grade: grading.grade,
            },
          }),
        ]);
        uploadedPaths = [front.path, back.path];

        const sku = `VR-${batch}-${recordId}`
          .toUpperCase()
          .replace(/[^A-Z0-9-]+/g, "-")
          .slice(0, 80);

        const description = descriptionLines({
          title,
          player,
          year,
          manufacturer,
          productSet,
          insertSubset,
          cardNumber,
          parallel,
          exactSerialNumber: serial.exactSerialNumber,
          gradingCompany: grading.company,
          gradingGrade: grading.grade,
          gradingCertNumber: grading.certNumber,
          autograph: autographText,
          memorabilia: memorabiliaText,
        });

        const draft = await engine.createSellerDraftProduct({
          sellerAccountId: null,
          title,
          description,
          category: "sports_cards",
          condition,
          price: 0,
          quantity: 1,
          imageUrl: front.signedUrl,
          sku,
          ebayItemId: null,
          authenticity: authenticityProfile({
            gradingCompany: grading.company,
            gradingCertNumber: grading.certNumber,
            isAuto,
            autographText,
          }),
        });

        legacyProductId = draft.legacyProductId;
        inventoryItemId = draft.inventoryItemId;
        if (!inventoryItemId) {
          throw new Error("The draft product was created without an inventory item.");
        }

        const now = new Date().toISOString();
        const verificationPayload = {
          provider: graderVerification.provider,
          certNumber: graderVerification.certNumber,
          status: graderVerification.status,
          verificationUrl: graderVerification.verificationUrl,
          checkedAt: graderVerification.checkedAt,
          expectedIdentity: graderVerification.expectedIdentity,
          observedIdentity: graderVerification.observedIdentity,
          mismatchReasons: graderVerification.mismatchReasons,
          providerScanUrls: graderVerification.providerScanUrls,
          rawEvidence: graderVerification.rawEvidence,
        };
        const collectibleMetadata = {
          schema: "truely.collectibleAssetReference.v1",
          source_record_key: sourceRecordKey,
          human_verified: true,
          exact_serial_number: serial.exactSerialNumber,
          serial_copy_number: serial.serialCopyNumber,
          serial_print_run: serial.serialPrintRun,
          grading_company: grading.company,
          grading_grade: grading.grade,
          grading_cert_number: grading.certNumber,
          grader_verification_status: graderVerification.status,
          grader_verification_url: graderVerification.verificationUrl,
          price_pending: true,
        };
        const inventoryMetadata = {
          source: "instacomp_human_verified_reference",
          instacomp: {
            schema: "truely.instacompHumanVerifiedReference.v1",
            source: "human_verified_reference",
            scanId: sourceRecordKey,
            humanVerified: true,
            trustedForIdentity: true,
            hasBackImage: true,
            referenceBatch: batch,
            referenceRecordId: recordId,
            ai: {
              player,
              year: year ? String(year) : null,
              brand: manufacturer,
              setName: productSet,
              insertName: insertSubset,
              cardNumber,
              parallel,
              serialNumber: serial.exactSerialNumber,
              team,
              sport,
              isRookie: yesValue(rookieStatus),
              isAuto,
              isRelic,
              gradingCompany: grading.company,
              gradeValue: grading.grade,
              gradingCertNumber: grading.certNumber,
            },
          },
          collectible_asset: collectibleMetadata,
          grader_verification: verificationPayload,
          verified_reference: {
            schema: payload.schema,
            batch,
            record_id: recordId,
            pairing_confidence: Number(record.pairing?.pairingConfidence || 0) || null,
            pairing_evidence: listValue(record.pairing?.pairingEvidence).slice(0, 20),
            evidence: listValue(record.evidence).slice(0, 30),
            source_notes: listValue(record.sourceNotes).slice(0, 20),
            reviewer_notes: textValue(record.reviewerNotes, 1000),
            front_storage_path: front.path,
            back_storage_path: back.path,
            front_sha256: frontImage.sha256,
            back_sha256: backImage.sha256,
          },
        };

        const updates = await Promise.all([
          supabase
            .from("products")
            .update({
              player,
              sport,
              last_seen_at: now,
            })
            .eq("id", legacyProductId)
            .eq("store_id", actor.storeId),
          supabase
            .from("inventory_items")
            .update({
              category: "sports_cards",
              condition,
              metadata: inventoryMetadata,
              updated_at: now,
            })
            .eq("id", inventoryItemId)
            .eq("store_id", actor.storeId),
          repository.addImage({
            inventoryItemId,
            imageUrl: back.signedUrl,
            altText: `${title} back`,
            sortOrder: 1,
            isPrimary: false,
          }),
        ]);
        if (updates[0].error) throw updates[0].error;
        if (updates[1].error) throw updates[1].error;

        const { data: asset, error: assetError } = await supabase
          .from("collectible_assets")
          .insert({
            store_id: actor.storeId,
            seller_account_id: null,
            inventory_item_id: inventoryItemId,
            legacy_product_id: legacyProductId,
            source_system: "instacomp_verified_reference",
            source_record_key: sourceRecordKey,
            lifecycle_status: "pending_listing",
            title,
            player,
            card_year: year,
            manufacturer,
            product_set: productSet,
            insert_subset: insertSubset,
            card_number: cardNumber,
            parallel_variant: parallel,
            team,
            sport,
            rookie_status: rookieStatus,
            autograph_status: autographText,
            memorabilia_status: memorabiliaText,
            condition,
            exact_serial_number: serial.exactSerialNumber,
            serial_copy_number: serial.serialCopyNumber,
            serial_print_run: serial.serialPrintRun,
            grading_company: grading.company,
            grading_grade: grading.grade,
            grading_cert_number: grading.certNumber,
            grader_verification_status: graderVerification.status,
            grader_verification_url: graderVerification.verificationUrl,
            grader_verified_at:
              graderVerification.status === "verified"
                ? graderVerification.checkedAt
                : null,
            grader_verification_payload: verificationPayload,
            front_storage_path: front.path,
            back_storage_path: back.path,
            front_sha256: frontImage.sha256,
            back_sha256: backImage.sha256,
            listing_price: null,
            post_sale_tracking_enabled: true,
            metadata: {
              verified_reference_schema: payload.schema,
              batch,
              record_id: recordId,
              evidence: listValue(record.evidence).slice(0, 30),
              source_notes: listValue(record.sourceNotes).slice(0, 20),
              reviewer_notes: textValue(record.reviewerNotes, 1000),
            },
          })
          .select("id")
          .single();

        if (assetError) throw assetError;
        assetCreated = true;

        const assetId = asset.id as string;
        await supabase
          .from("inventory_items")
          .update({
            metadata: {
              ...inventoryMetadata,
              collectible_asset: {
                ...collectibleMetadata,
                asset_id: assetId,
              },
            },
            updated_at: now,
          })
          .eq("id", inventoryItemId)
          .eq("store_id", actor.storeId);

        const followups = [
          supabase.from("collectible_asset_events").insert({
            asset_id: assetId,
            store_id: actor.storeId,
            event_type: "pending_listing_created",
            previous_status: null,
            new_status: "pending_listing",
            source: "verified_reference_import",
            source_reference: sourceRecordKey,
            event_payload: {
              inventory_item_id: inventoryItemId,
              legacy_product_id: legacyProductId,
              sku,
              title,
              price_pending: true,
            },
          }),
        ];

        if (grading.company && grading.certNumber) {
          followups.push(
            supabase.from("collectible_grader_verifications").insert({
              asset_id: assetId,
              store_id: actor.storeId,
              provider: grading.company,
              cert_number: grading.certNumber,
              status:
                graderVerification.status === "not_applicable" ||
                graderVerification.status === "pending"
                  ? "failed"
                  : graderVerification.status,
              verification_url: graderVerification.verificationUrl,
              checked_at: graderVerification.checkedAt || now,
              expected_identity: graderVerification.expectedIdentity,
              observed_identity: graderVerification.observedIdentity,
              mismatch_reasons: graderVerification.mismatchReasons,
              provider_scan_urls: graderVerification.providerScanUrls,
              raw_evidence: graderVerification.rawEvidence,
            }),
          );
        }

        await Promise.all(
          followups.map((query) =>
            query.then(({ error }) => {
              if (error) {
                console.error("Verified-reference follow-up write failed:", error);
              }
            }),
          ),
        );

        results.push({
          recordId,
          status: "created",
          assetId,
          inventoryItemId,
          legacyProductId,
          sku,
          title,
          graderVerificationStatus: graderVerification.status,
          graderVerificationUrl: graderVerification.verificationUrl,
          editUrl: `/seller/inventory?status=draft&search=${encodeURIComponent(sku)}`,
        });
      } catch (error: any) {
        if (!assetCreated) {
          try {
            if (inventoryItemId) {
              await supabase
                .from("inventory_images")
                .delete()
                .eq("inventory_item_id", inventoryItemId);
              await supabase
                .from("inventory_items")
                .delete()
                .eq("id", inventoryItemId)
                .eq("store_id", actor.storeId);
            }
            if (legacyProductId) {
              await supabase
                .from("products")
                .delete()
                .eq("id", legacyProductId)
                .eq("store_id", actor.storeId);
            }
            if (uploadedPaths.length > 0) {
              await supabase.storage
                .from(INSTACOMP_JOB_IMAGE_BUCKET)
                .remove(uploadedPaths);
            }
          } catch (cleanupError) {
            console.error("Verified-reference import cleanup failed:", cleanupError);
          }
        }

        results.push({
          recordId,
          status: "failed",
          error: error?.message || "Verified-reference card import failed.",
          code: error?.code || null,
        });
      }
    }

    const created = results.filter((result) => result.status === "created").length;
    const skipped = results.filter(
      (result) => result.status === "skipped_existing",
    ).length;
    const failed = results.filter((result) => result.status === "failed").length;

    return NextResponse.json({
      success: failed === 0,
      batch,
      summary: {
        received: records.length,
        created,
        skipped,
        failed,
      },
      pendingListingsUrl: "/seller/inventory?status=draft&source=instacomp",
      collectibleAssetsUrl: "/seller/collectible-assets",
      results,
    });
  } catch (error: any) {
    if (error instanceof InstaCompJobServerError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status },
      );
    }

    console.error("Verified-reference import failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Verified-reference import failed.",
        code: "VERIFIED_REFERENCE_IMPORT_FAILED",
      },
      { status: 500 },
    );
  }
}
