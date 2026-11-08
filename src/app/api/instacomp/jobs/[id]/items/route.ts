import { randomUUID } from "crypto";
import {
  INSTACOMP_JOB_IMAGE_BUCKET,
  INSTACOMP_JOB_ITEM_CHUNK_LIMIT,
  INSTACOMP_JOB_ITEM_TABLE,
  INSTACOMP_JOB_MAX_IMAGE_BYTES,
  InstaCompJobServerError,
  boundedInstaCompInteger,
  buildInstaCompJobImagePath,
  cleanInstaCompText,
  createInstaCompSignedUpload,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  isAllowedInstaCompImageType,
  readInstaCompJson,
  refreshInstaCompJobCounts,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
} from "../../../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type RegisteredImage = {
  name: string;
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
};

type RegisteredItem = {
  id: string;
  clientItemId: string;
  position: number;
  front: RegisteredImage;
  back: RegisteredImage | null;
  pairingConfidence: number | null;
};

function optionalSha256(value: unknown, label: string) {
  const hash = cleanInstaCompText(value, 64);

  if (!hash) {
    throw new InstaCompJobServerError(
      `${label} is required for every private card image.`,
      400,
      "INSTACOMP_IMAGE_HASH_REQUIRED",
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new InstaCompJobServerError(
      `${label} must be a 64-character SHA-256 hex digest.`,
      400,
      "INSTACOMP_INVALID_IMAGE_HASH",
    );
  }

  return hash.toLowerCase();
}

function parseImage(params: {
  raw: Record<string, any>;
  side: "front" | "back";
  required: boolean;
}) {
  const prefix = params.side;
  const nameValue = params.raw[`${prefix}Name`];
  const typeValue = params.raw[`${prefix}Type`];
  const sizeValue =
    params.raw[`${prefix}Size`] ?? params.raw[`${prefix}SizeBytes`];
  const hashValue =
    params.raw[`${prefix}Sha256`] ?? params.raw[`${prefix}ImageSha256`];
  const hasAnyValue = [nameValue, typeValue, sizeValue, hashValue].some(
    (value) => value !== null && value !== undefined && value !== "",
  );

  if (!params.required && !hasAnyValue) return null;

  const name = cleanInstaCompText(nameValue, 260, {
    required: true,
    label: `${prefix}Name`,
  })!;
  const contentType = String(typeValue || "").trim().toLowerCase();

  if (!isAllowedInstaCompImageType(contentType)) {
    throw new InstaCompJobServerError(
      `${prefix}Type must be image/jpeg, image/png, or image/webp.`,
      400,
      "INSTACOMP_UNSUPPORTED_IMAGE_TYPE",
    );
  }

  const sizeBytes = boundedInstaCompInteger({
    value: sizeValue,
    label: `${prefix}Size`,
    minimum: 1,
    maximum: INSTACOMP_JOB_MAX_IMAGE_BYTES,
  });

  return {
    name,
    contentType,
    sizeBytes,
    sha256: optionalSha256(hashValue, `${prefix}Sha256`),
  } satisfies RegisteredImage;
}

function parsePairingConfidence(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InstaCompJobServerError(
      "pairingConfidence must be between 0 and 1.",
      400,
      "INSTACOMP_INVALID_PAIRING_CONFIDENCE",
    );
  }

  return parsed;
}

function parseItems(value: unknown, totalItems: number) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InstaCompJobServerError(
      "items must contain at least one card row.",
      400,
      "INSTACOMP_ITEMS_REQUIRED",
    );
  }

  if (value.length > INSTACOMP_JOB_ITEM_CHUNK_LIMIT) {
    throw new InstaCompJobServerError(
      `Register at most ${INSTACOMP_JOB_ITEM_CHUNK_LIMIT} card rows per request.`,
      400,
      "INSTACOMP_ITEM_CHUNK_TOO_LARGE",
    );
  }

  const clientIds = new Set<string>();
  const positions = new Set<number>();

  return value.map<RegisteredItem>((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new InstaCompJobServerError(
        `items[${index}] must be a JSON object.`,
        400,
        "INSTACOMP_INVALID_ITEM",
      );
    }

    const raw = entry as Record<string, any>;
    const clientItemId = cleanInstaCompText(raw.clientItemId, 200, {
      required: true,
      label: `items[${index}].clientItemId`,
    })!;
    const position = boundedInstaCompInteger({
      value: raw.position,
      label: `items[${index}].position`,
      minimum: 0,
      maximum: Math.max(0, totalItems - 1),
    });

    if (clientIds.has(clientItemId)) {
      throw new InstaCompJobServerError(
        `clientItemId ${clientItemId} appears more than once in this chunk.`,
        400,
        "INSTACOMP_DUPLICATE_CLIENT_ITEM",
      );
    }

    if (positions.has(position)) {
      throw new InstaCompJobServerError(
        `position ${position} appears more than once in this chunk.`,
        400,
        "INSTACOMP_DUPLICATE_POSITION",
      );
    }

    clientIds.add(clientItemId);
    positions.add(position);

    return {
      id: randomUUID(),
      clientItemId,
      position,
      front: parseImage({ raw, side: "front", required: true })!,
      back: parseImage({ raw, side: "back", required: false }),
      pairingConfidence: parsePairingConfidence(raw.pairingConfidence),
    };
  });
}

function existingItemMatches(existing: Record<string, any>, item: RegisteredItem) {
  return (
    Number(existing.position) === item.position &&
    existing.front_original_filename === item.front.name &&
    existing.front_content_type === item.front.contentType &&
    Number(existing.front_size_bytes) === item.front.sizeBytes &&
    (existing.front_image_sha256 || null) === item.front.sha256 &&
    (existing.back_original_filename || null) === (item.back?.name || null) &&
    (existing.back_content_type || null) === (item.back?.contentType || null) &&
    Number(existing.back_size_bytes || 0) === (item.back?.sizeBytes || 0) &&
    (existing.back_image_sha256 || null) === (item.back?.sha256 || null)
  );
}

function publicItem(item: Record<string, any>) {
  const { lease_token: _leaseToken, ...safeItem } = item;
  void _leaseToken;
  return safeItem;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const { id } = await context.params;
    const jobId = requireUuid(id, "Job ID");
    const job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
    });

    if (job.status !== "uploading") {
      throw new InstaCompJobServerError(
        `Card rows cannot be registered while the job is ${job.status}.`,
        409,
        "INSTACOMP_JOB_NOT_UPLOADING",
      );
    }

    const body = await readInstaCompJson(request);
    const requestedItems = parseItems(body.items, Number(job.total_items));
    const requestedClientIds = requestedItems.map((item) => item.clientItemId);
    const { data: existingData, error: existingError } = await supabase
      .from(INSTACOMP_JOB_ITEM_TABLE)
      .select("*")
      .eq("job_id", jobId)
      .in("client_item_id", requestedClientIds);

    if (existingError) throwInstaCompDatabaseError(existingError);

    const existingByClientId = new Map(
      (existingData || []).map((item) => [item.client_item_id, item]),
    );
    const missingItems = requestedItems.filter(
      (item) => !existingByClientId.has(item.clientItemId),
    );
    const rowsToInsert = missingItems.map((item) => {
      const frontPath = buildInstaCompJobImagePath({
        actor,
        sellerAccountId: job.seller_account_id,
        jobId,
        itemId: item.id,
        side: "front",
        mimeType: item.front.contentType,
      });
      const backPath = item.back
        ? buildInstaCompJobImagePath({
            actor,
            sellerAccountId: job.seller_account_id,
            jobId,
            itemId: item.id,
            side: "back",
            mimeType: item.back.contentType,
          })
        : null;

      return {
        id: item.id,
        job_id: jobId,
        position: item.position,
        client_item_id: item.clientItemId,
        status: "awaiting_upload",
        front_original_filename: item.front.name,
        back_original_filename: item.back?.name || null,
        front_content_type: item.front.contentType,
        back_content_type: item.back?.contentType || null,
        front_size_bytes: item.front.sizeBytes,
        back_size_bytes: item.back?.sizeBytes || null,
        front_storage_path: frontPath,
        back_storage_path: backPath,
        front_image_sha256: item.front.sha256,
        back_image_sha256: item.back?.sha256 || null,
        pairing_confidence: item.pairingConfidence,
      };
    });

    if (rowsToInsert.length) {
      const { data: inserted, error: insertError } = await supabase
        .from(INSTACOMP_JOB_ITEM_TABLE)
        .insert(rowsToInsert)
        .select("*");

      if (insertError) {
        if (insertError.code === "23505") {
          throw new InstaCompJobServerError(
            "A card row already uses one of these positions or clientItemIds.",
            409,
            "INSTACOMP_ITEM_CONFLICT",
          );
        }

        throwInstaCompDatabaseError(insertError);
      }

      (inserted || []).forEach((item) =>
        existingByClientId.set(item.client_item_id, item),
      );
    }

    const responseItems = await Promise.all(
      requestedItems.map(async (requestedItem) => {
        const item = existingByClientId.get(requestedItem.clientItemId);

        if (!item) {
          throw new InstaCompJobServerError(
            "A registered card row could not be reloaded.",
            500,
            "INSTACOMP_ITEM_RELOAD_FAILED",
          );
        }

        if (!existingItemMatches(item, requestedItem)) {
          throw new InstaCompJobServerError(
            `clientItemId ${requestedItem.clientItemId} already has different image metadata.`,
            409,
            "INSTACOMP_CLIENT_ITEM_CONFLICT",
          );
        }

        const canUpload = item.status === "awaiting_upload";
        const [frontUpload, backUpload] = canUpload
          ? await Promise.all([
              createInstaCompSignedUpload({
                supabase,
                path: item.front_storage_path,
              }),
              item.back_storage_path
                ? createInstaCompSignedUpload({
                    supabase,
                    path: item.back_storage_path,
                  })
                : Promise.resolve(null),
            ])
          : [null, null];

        return {
          item: publicItem(item),
          alreadyRegistered: !missingItems.some(
            (entry) => entry.clientItemId === requestedItem.clientItemId,
          ),
          frontUpload,
          backUpload,
        };
      }),
    );

    await refreshInstaCompJobCounts(supabase, jobId);

    return Response.json(
      {
        jobId,
        bucket: INSTACOMP_JOB_IMAGE_BUCKET,
        items: responseItems,
      },
      { status: missingItems.length ? 201 : 200 },
    );
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const supabase = requireInstaCompJobSupabase();
    const { id } = await context.params;
    const jobId = requireUuid(id, "Job ID");
    const job = await getAccessibleInstaCompJob({
      supabase,
      actor,
      jobId,
      select: "id,status",
    });

    if (job.status !== "uploading") {
      throw new InstaCompJobServerError(
        `Upload confirmation is unavailable while the job is ${job.status}.`,
        409,
        "INSTACOMP_JOB_NOT_UPLOADING",
      );
    }

    const body = await readInstaCompJson(request);

    if (!Array.isArray(body.itemIds) || body.itemIds.length === 0) {
      throw new InstaCompJobServerError(
        "itemIds must contain at least one registered card row.",
        400,
        "INSTACOMP_ITEM_IDS_REQUIRED",
      );
    }

    if (body.itemIds.length > INSTACOMP_JOB_ITEM_CHUNK_LIMIT) {
      throw new InstaCompJobServerError(
        `Confirm at most ${INSTACOMP_JOB_ITEM_CHUNK_LIMIT} card rows per request.`,
        400,
        "INSTACOMP_ITEM_CHUNK_TOO_LARGE",
      );
    }

    const itemIds = Array.from(
      new Set(body.itemIds.map((itemId: unknown) => requireUuid(itemId, "Item ID"))),
    );
    const { data, error } = await supabase
      .from(INSTACOMP_JOB_ITEM_TABLE)
      .select(
        "id,status,front_storage_path,back_storage_path,front_content_type,back_content_type,front_size_bytes,back_size_bytes",
      )
      .eq("job_id", jobId)
      .in("id", itemIds);

    if (error) throwInstaCompDatabaseError(error);

    if ((data || []).length !== itemIds.length) {
      throw new InstaCompJobServerError(
        "One or more upload rows were not found in this job.",
        404,
        "INSTACOMP_JOB_ITEM_NOT_FOUND",
      );
    }

    const awaitingItems = (data || []).filter(
      (item) => item.status === "awaiting_upload",
    );

    await Promise.all(
      awaitingItems.flatMap((item) =>
        [
          {
            path: item.front_storage_path,
            sizeBytes: Number(item.front_size_bytes),
            contentType: item.front_content_type,
          },
          item.back_storage_path
            ? {
                path: item.back_storage_path,
                sizeBytes: Number(item.back_size_bytes),
                contentType: item.back_content_type,
              }
            : null,
        ]
          .filter(
            (image): image is {
              path: string;
              sizeBytes: number;
              contentType: string;
            } => Boolean(image?.path),
          )
          .map(async (image) => {
            const { data: info, error: infoError } = await supabase.storage
              .from(INSTACOMP_JOB_IMAGE_BUCKET)
              .info(image.path);

            if (infoError || !info) {
              throw new InstaCompJobServerError(
                infoError?.message ||
                  "A required private card image has not finished uploading.",
                409,
                "INSTACOMP_IMAGES_NOT_UPLOADED",
                { path: image.path },
              );
            }

            if (
              Number(info.size) !== image.sizeBytes ||
              String(info.contentType || "").toLowerCase() !==
                image.contentType.toLowerCase()
            ) {
              throw new InstaCompJobServerError(
                "A private card image does not match its registered size or type.",
                409,
                "INSTACOMP_IMAGE_METADATA_MISMATCH",
                {
                  path: image.path,
                  expectedSize: image.sizeBytes,
                  actualSize: Number(info.size),
                  expectedType: image.contentType,
                  actualType: info.contentType || null,
                },
              );
            }
          }),
      ),
    );

    if (awaitingItems.length) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from(INSTACOMP_JOB_ITEM_TABLE)
        .update({
          status: "queued",
          next_attempt_at: now,
          completed_at: null,
          last_error_code: null,
          last_error: null,
          updated_at: now,
        })
        .eq("job_id", jobId)
        .in(
          "id",
          awaitingItems.map((item) => item.id),
        )
        .eq("status", "awaiting_upload");

      if (updateError) throwInstaCompDatabaseError(updateError);
    }

    await refreshInstaCompJobCounts(supabase, jobId);

    return Response.json({
      jobId,
      confirmedItemIds: itemIds,
      newlyQueuedCount: awaitingItems.length,
    });
  } catch (error) {
    return instaCompJobErrorResponse(error);
  }
}
