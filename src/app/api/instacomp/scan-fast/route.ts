import { NextRequest, NextResponse } from "next/server";
import { POST as runCoreInstaCompScan } from "../scan/route";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import {
  findFreshInstaCompCache,
  recordInstaCompCacheReplay,
  saveInstaCompLearningCache,
  sha256File,
  type ScanActor,
} from "../../../../lib/instacomp-learning-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

function cachedPayload(row: Awaited<ReturnType<typeof findFreshInstaCompCache>>) {
  if (!row) return null;

  return {
    ...row.response_payload,
    ok: true,
    knowledge: {
      mode: "exact_image_cache",
      cacheHit: true,
      cacheId: row.id,
      knowledgeEntryId: row.knowledge_entry_id,
      confirmationStatus: row.confirmation_status,
      identityConfidence: row.identity_confidence,
      trustedForPricing: row.trusted_for_pricing,
      observedAt: row.observed_at,
      marketExpiresAt: row.market_expires_at,
      priorHitCount: row.hit_count,
    },
    note: [
      row.response_payload?.note,
      "Exact front/back image knowledge was reused. The market snapshot is still inside its six-hour freshness window.",
    ]
      .filter(Boolean)
      .join(" "),
  };
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
      forceFresh,
    });

    if (cache) {
      await recordInstaCompCacheReplay({ cacheId: cache.id, actor: actorInfo });
      return NextResponse.json(cachedPayload(cache), {
        headers: {
          "x-instacomp-learning": "exact-image-cache-hit",
          "cache-control": "private, no-store",
        },
      });
    }

    const coreResponse = await runCoreInstaCompScan(
      coreRequestFrom(request, copyFormData(incoming)),
    );
    const payload = (await coreResponse.clone().json().catch(() => null)) as
      | Record<string, any>
      | null;

    if (!coreResponse.ok || !payload?.ok || !payload.scanId) {
      return coreResponse;
    }

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
          mode: learning.registryMatch
            ? "checklist_registry_confirmed"
            : "new_learning_observation",
          cacheHit: false,
          cacheId: learning.cache?.id || null,
          knowledgeEntryId: learning.cache?.knowledge_entry_id || null,
          confirmationStatus:
            learning.cache?.confirmation_status ||
            (learning.registryMatch ? "catalog_confirmed" : "scanner_observed"),
          registryMatch: learning.registryMatch,
          marketExpiresAt: learning.cache?.market_expires_at || null,
        },
      },
      {
        status: coreResponse.status,
        headers: {
          "x-instacomp-learning": learning.registryMatch
            ? "registry-confirmed"
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
