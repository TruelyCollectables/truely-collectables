import { NextRequest, NextResponse } from "next/server";
import { POST as runCoreInstaCompScan } from "../scan/route";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { hardenInstaCompMarketPayload } from "../../../../lib/instacomp-market-evidence";
import {
  findFreshInstaCompCache,
  materializeInstaCompCacheReplay,
  saveInstaCompLearningCache,
  sha256File,
  type CacheRow,
  type ScanActor,
} from "../../../../lib/instacomp-learning-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 20 * 1024 * 1024;

function actorSnapshot(actor: Awaited<ReturnType<typeof requireInstaCompJobActor>>) {
  return {
    type: actor.type,
    storeId: actor.storeId,
    sellerAccountId:
      actor.type === "seller" ? actor.sellerAccountId : null,
  } as ScanActor;
}

function copyFormData(source: FormData) {
  const target = new FormData();

  for (const [name, value] of source.entries()) {
    if (value instanceof File) {
      target.append(name, value, value.name);
    } else {
      target.append(name, value);
    }
  }

  return target;
}

function coreRequestFrom(request: NextRequest, formData: FormData) {
  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");

  return new NextRequest(new URL("/api/instacomp/scan", request.url), {
    method: "POST",
    headers,
    body: formData,
  });
}

function cachedPayload(
  row: CacheRow,
  replay: Awaited<ReturnType<typeof materializeInstaCompCacheReplay>>,
) {
  const replayPayload = replay.payload as Record<string, any>;

  return {
    ...replayPayload,
    ok: true,
    scanId: replay.scanId,
    knowledge: {
      mode: "tenant_scoped_exact_image_cache",
      cacheHit: true,
      cacheId: row.id,
      knowledgeEntryId: row.knowledge_entry_id,
      confirmationStatus: row.confirmation_status,
      identityConfidence: row.identity_confidence,
      trustedForPricing: row.trusted_for_pricing,
      observedAt: row.observed_at,
      marketExpiresAt: row.market_expires_at,
      priorHitCount: row.hit_count,
      replayMaterializedAsNewScan: true,
    },
    note: [
      replayPayload.note,
      "Tenant-scoped exact-image identity evidence was reused, but this request received a new permanent scan record and learning observation.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function preliminaryUploadError(frontImage: File, backImage: File | null) {
  if (frontImage.size > MAX_SOURCE_IMAGE_BYTES) {
    return { status: 413, error: "Front card image must be 12MB or smaller." };
  }
  if (backImage && backImage.size > MAX_SOURCE_IMAGE_BYTES) {
    return { status: 413, error: "Back card image must be 12MB or smaller." };
  }
  if (frontImage.size + (backImage?.size || 0) > MAX_TOTAL_INPUT_BYTES) {
    return {
      status: 413,
      error: "One InstaComp card scan may contain at most 20MB of source image data.",
    };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();

  // Persistent queued jobs use JSON and keep the full durable queue workflow.
  // The scan ledger trigger still records those results automatically.
  if (contentType.includes("application/json")) {
    return runCoreInstaCompScan(request);
  }

  try {
    const actor = await requireInstaCompJobActor(request);
    const actorInfo = actorSnapshot(actor);
    const incoming = await request.formData();
    const frontValue = incoming.get("frontImage");
    const backValue = incoming.get("backImage");
    const frontImage = frontValue instanceof File ? frontValue : null;
    const backImage = backValue instanceof File && backValue.size > 0 ? backValue : null;
    const forceFresh = String(incoming.get("forceFresh") || "") === "true";

    if (!frontImage) {
      return NextResponse.json(
        { ok: false, error: "Upload a front card image." },
        { status: 400 },
      );
    }

    const uploadError = preliminaryUploadError(frontImage, backImage);
    if (uploadError) {
      return NextResponse.json(
        { ok: false, error: uploadError.error },
        { status: uploadError.status },
      );
    }

    const [frontHash, backHash] = await Promise.all([
      sha256File(frontImage),
      sha256File(backImage),
    ]);

    if (!frontHash) {
      return NextResponse.json(
        { ok: false, error: "The front card image could not be hashed." },
        { status: 400 },
      );
    }

    const cache = await findFreshInstaCompCache({
      frontHash,
      backHash,
      actor: actorInfo,
      forceFresh,
    });

    if (cache) {
      try {
        const replay = await materializeInstaCompCacheReplay({
          cache,
          actor: actorInfo,
        });
        return NextResponse.json(cachedPayload(cache, replay), {
          headers: {
            "x-instacomp-learning": "tenant-scoped-cache-hit-new-scan",
            "cache-control": "private, no-store",
          },
        });
      } catch (cacheReplayError) {
        console.error(
          "InstaComp cache replay could not be materialized; running a fresh scan:",
          cacheReplayError,
        );
      }
    }

    const coreResponse = await runCoreInstaCompScan(
      coreRequestFrom(request, copyFormData(incoming)),
    );
    const rawPayload = (await coreResponse.clone().json().catch(() => null)) as
      | Record<string, any>
      | null;

    if (!coreResponse.ok || !rawPayload?.ok || !rawPayload.scanId) {
      return coreResponse;
    }

    const payload = hardenInstaCompMarketPayload(rawPayload);
    const learning = await saveInstaCompLearningCache({
      scanId: String(payload.scanId),
      frontHash,
      backHash,
      payload,
      actor: actorInfo,
    });

    return NextResponse.json(
      {
        ...learning.payload,
        knowledge: {
          mode:
            learning.registryMatch &&
            learning.cache?.confirmation_status === "catalog_confirmed"
              ? "checklist_registry_confirmed"
              : "new_learning_observation",
          cacheHit: false,
          cacheId: learning.cache?.id || null,
          knowledgeEntryId: learning.cache?.knowledge_entry_id || null,
          confirmationStatus:
            learning.cache?.confirmation_status || "scanner_observed",
          registryMatch: learning.registryMatch,
          marketExpiresAt: learning.cache?.market_expires_at || null,
          persistenceWarnings: learning.warnings,
        },
      },
      {
        status: coreResponse.status,
        headers: {
          "x-instacomp-learning":
            learning.registryMatch &&
            learning.cache?.confirmation_status === "catalog_confirmed"
              ? "registry-confirmed"
              : learning.warnings.length
                ? "observation-recorded-with-warnings"
                : "observation-recorded",
          "cache-control": "private, no-store",
        },
      },
    );
  } catch (error) {
    console.error("InstaComp learning gateway failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "InstaComp learning gateway failed.",
      },
      { status: 500 },
    );
  }
}
