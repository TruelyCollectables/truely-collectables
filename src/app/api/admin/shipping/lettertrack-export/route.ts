import {
  buildLetterTrackExport,
  getLetterTrackExportBatchMetadata,
  LETTERTRACK_EXPORTED_STATUS,
  LETTERTRACK_EXPORTABLE_STATUSES,
  LETTERTRACK_EXPORT_METADATA_KEY,
  letterTrackCsvContent,
  letterTrackExportMetadata,
  letterTrackSkippedReasonSummary,
  type LetterTrackExportBatchMetadata,
  type LetterTrackExportLabel,
  type LetterTrackExportOrder,
} from "../../../../../lib/lettertrack-export";
import { isDryRunShippingLabel } from "../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const exportableStatuses = [...LETTERTRACK_EXPORTABLE_STATUSES];
const MAX_LABELS = 500;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/;

type BatchMetadataWithPayload = LetterTrackExportBatchMetadata & {
  payloadDigest: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function batchPayloadDigest(label: LetterTrackExportLabel) {
  const value = label.metadata?.[LETTERTRACK_EXPORT_METADATA_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const digest = text((value as Record<string, unknown>).payload_digest);
  return digest || null;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function labelSetDigest(labels: LetterTrackExportLabel[]) {
  return sha256(
    labels
      .map((label) => label.id)
      .sort((a, b) => a.localeCompare(b))
      .join("\n"),
  );
}

function isExportable(label: LetterTrackExportLabel) {
  return (
    label.resolved_shipping_method === "STANDARD_ENVELOPE" &&
    exportableStatuses.includes(
      label.label_status as (typeof exportableStatuses)[number],
    )
  );
}

function hasExternalFulfillmentReference(label: LetterTrackExportLabel) {
  return Boolean(
    text(label.provider_label_id) ||
      text(label.provider_shipment_id) ||
      text(label.tracking_number),
  );
}

async function readIdempotencyKey(request: Request) {
  const headerKey = text(request.headers.get("Idempotency-Key"));
  if (headerKey) return headerKey;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return text(body?.idempotencyKey);
  }

  const form = await request.formData().catch(() => null);
  return text(form?.get("idempotencyKey"));
}

function csvResponse(params: {
  csv: string;
  exportedAt: string;
  rows: number;
  batchId: string;
  replayed: boolean;
}) {
  const exportedAt = params.exportedAt.replace(/[:.]/g, "-");
  return new Response(params.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="truely-collectables-lettertrack-${exportedAt}.csv"`,
      "Cache-Control": "no-store",
      "X-Truely-LetterTrack-Rows": String(params.rows),
      "X-Truely-LetterTrack-Skipped": "0",
      "X-Truely-LetterTrack-Batch": params.batchId,
      "X-Truely-LetterTrack-Replayed": params.replayed ? "1" : "0",
    },
  });
}

export async function GET() {
  const idempotencyKey = `lettertrack-${crypto.randomUUID()}`;
  const safeKey = escapeHtml(idempotencyKey);

  return new Response(
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LetterTrack Export</title></head>
<body style="font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#111">
  <h1>Hardened LetterTrack CSV export</h1>
  <p>This action validates every eligible Standard Envelope address, rejects dry-run or already-fulfilled labels, and atomically claims each label for this export batch before the CSV is returned.</p>
  <p><strong>Safe retry:</strong> submitting this same page again uses the same idempotency key and will replay the same batch instead of creating another fulfillment export.</p>
  <form method="post" action="/api/admin/shipping/lettertrack-export">
    <input type="hidden" name="idempotencyKey" value="${safeKey}">
    <button type="submit" style="background:#075985;color:white;border:0;border-radius:8px;padding:12px 18px;font-weight:800;cursor:pointer">Validate + export LetterTrack CSV</button>
  </form>
  <p style="margin-top:24px"><a href="/admin/shipping">Back to Shipping</a></p>
</body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const idempotencyKey = await readIdempotencyKey(request);
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return Response.json(
        {
          error:
            "A valid LetterTrack idempotency key is required. Start the export from the Shipping admin page.",
        },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

    const { data: labelsData, error: labelsError } = await supabase
      .from("order_shipping_labels")
      .select(
        "id,order_id,label_status,requested_shipping_method,resolved_shipping_method,coverage_amount,coverage_status,metadata,created_at,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: true })
      .limit(2000);

    if (labelsError) throw labelsError;

    const allLabels = (labelsData || []) as LetterTrackExportLabel[];
    const replayLabels = allLabels.filter(
      (label) =>
        getLetterTrackExportBatchMetadata(label)?.batchId === idempotencyKey,
    );

    let batchMetadata: BatchMetadataWithPayload;
    let candidateLabels: LetterTrackExportLabel[];
    const replayed = replayLabels.length > 0;

    if (replayed) {
      const stored = getLetterTrackExportBatchMetadata(replayLabels[0]);
      const payloadDigest = batchPayloadDigest(replayLabels[0]);
      if (!stored || !payloadDigest) {
        return Response.json(
          {
            error:
              "This LetterTrack batch has incomplete idempotency metadata and was blocked for manual review.",
            batchId: idempotencyKey,
          },
          { status: 409 },
        );
      }

      const inconsistent = replayLabels.some((label) => {
        const metadata = getLetterTrackExportBatchMetadata(label);
        return (
          !metadata ||
          metadata.batchId !== stored.batchId ||
          metadata.startedAt !== stored.startedAt ||
          metadata.candidateCount !== stored.candidateCount ||
          metadata.candidateDigest !== stored.candidateDigest ||
          batchPayloadDigest(label) !== payloadDigest
        );
      });
      if (inconsistent) {
        return Response.json(
          {
            error:
              "LetterTrack batch metadata is inconsistent across labels. Export was blocked without mutation.",
            batchId: idempotencyKey,
          },
          { status: 409 },
        );
      }

      batchMetadata = { ...stored, payloadDigest };
      const startedAtMs = new Date(stored.startedAt).getTime();
      const continuationLabels = allLabels.filter(
        (label) =>
          isExportable(label) &&
          new Date(label.created_at).getTime() <= startedAtMs,
      );
      candidateLabels = [...replayLabels, ...continuationLabels].filter(
        (label, index, rows) =>
          rows.findIndex((candidate) => candidate.id === label.id) === index,
      );

      const currentDigest = await labelSetDigest(candidateLabels);
      if (
        candidateLabels.length !== stored.candidateCount ||
        currentDigest !== stored.candidateDigest
      ) {
        return Response.json(
          {
            error:
              "The original LetterTrack batch membership changed before it completed. Export was blocked to prevent a mixed or duplicate batch.",
            batchId: idempotencyKey,
            expectedCount: stored.candidateCount,
            currentCount: candidateLabels.length,
          },
          { status: 409 },
        );
      }
    } else {
      const incompleteBatches = new Map<
        string,
        { expected: number; seen: number }
      >();
      for (const label of allLabels) {
        const metadata = getLetterTrackExportBatchMetadata(label);
        if (!metadata) continue;
        const current = incompleteBatches.get(metadata.batchId) || {
          expected: metadata.candidateCount,
          seen: 0,
        };
        current.seen += 1;
        incompleteBatches.set(metadata.batchId, current);
      }
      const unfinished = Array.from(incompleteBatches.entries()).find(
        ([, counts]) => counts.seen < counts.expected,
      );
      if (unfinished) {
        return Response.json(
          {
            error:
              "A prior LetterTrack export batch is incomplete. Retry that exact batch before starting another export.",
            batchId: unfinished[0],
          },
          { status: 409 },
        );
      }

      candidateLabels = allLabels.filter(isExportable).slice(0, MAX_LABELS);
      if (candidateLabels.length === 0) {
        return Response.json(
          { error: "There are no eligible Standard Envelope labels to export." },
          { status: 409 },
        );
      }

      const startedAt = new Date().toISOString();
      const candidateDigest = await labelSetDigest(candidateLabels);
      batchMetadata = {
        batchId: idempotencyKey,
        startedAt,
        exportedAt: startedAt,
        candidateCount: candidateLabels.length,
        candidateDigest,
        payloadDigest: "",
      };
    }

    const labelsNeedingClaim = candidateLabels.filter(isExportable);
    const blockedLabel = labelsNeedingClaim.find(
      (label) =>
        isDryRunShippingLabel(label) || hasExternalFulfillmentReference(label),
    );
    if (blockedLabel) {
      return Response.json(
        {
          error: isDryRunShippingLabel(blockedLabel)
            ? "A TCOS dry-run Standard Envelope label was present. LetterTrack export was blocked without mutation."
            : "A Standard Envelope label already has a provider or tracking reference. LetterTrack export was blocked without mutation.",
          labelId: blockedLabel.id,
          orderId: blockedLabel.order_id,
        },
        { status: 409 },
      );
    }

    const orderIds = Array.from(
      new Set(candidateLabels.map((label) => label.order_id)),
    );
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select(
        "id,customer_email,customer_name,shipping_name,shipping_address_line1,shipping_address_line2,shipping_city,shipping_state,shipping_postal_code,shipping_country,subtotal,total,item_count",
      )
      .eq("store_id", storeId)
      .in("id", orderIds);

    if (ordersError) throw ordersError;

    const ordersById = new Map(
      ((ordersData || []) as LetterTrackExportOrder[]).map((order) => [
        order.id,
        order,
      ]),
    );

    const preparedLabels = candidateLabels.map((label) => ({
      ...label,
      label_status: LETTERTRACK_EXPORTED_STATUS,
    }));
    const exportResult = buildLetterTrackExport({
      labels: preparedLabels,
      ordersById,
      exportedAt: batchMetadata.exportedAt,
    });

    if (exportResult.skipped.length > 0) {
      return Response.json(
        {
          error:
            "LetterTrack export failed address/order validation. Nothing was claimed or exported.",
          skipped: exportResult.skipped,
          skippedReasonSummary: letterTrackSkippedReasonSummary(
            exportResult.skipped,
          ),
        },
        { status: 422 },
      );
    }

    const csv = letterTrackCsvContent(exportResult.rows);
    const payloadDigest = await sha256(csv);
    if (replayed && payloadDigest !== batchMetadata.payloadDigest) {
      return Response.json(
        {
          error:
            "The LetterTrack CSV payload changed since this batch was first claimed. Replay was blocked to prevent shipping to changed data.",
          batchId: idempotencyKey,
        },
        { status: 409 },
      );
    }
    batchMetadata.payloadDigest = payloadDigest;

    const claimedThisRequest: LetterTrackExportLabel[] = [];
    for (const label of labelsNeedingClaim.sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      const metadata = {
        ...(label.metadata || {}),
        [LETTERTRACK_EXPORT_METADATA_KEY]: {
          ...letterTrackExportMetadata(batchMetadata),
          payload_digest: payloadDigest,
        },
      };

      const { data: claimedData, error: claimError } = await supabase
        .from("order_shipping_labels")
        .update({
          label_status: LETTERTRACK_EXPORTED_STATUS,
          metadata,
          updated_at: batchMetadata.exportedAt,
        })
        .eq("store_id", storeId)
        .eq("id", label.id)
        .eq("resolved_shipping_method", "STANDARD_ENVELOPE")
        .in("label_status", exportableStatuses)
        .select("id")
        .maybeSingle();

      if (claimError || !claimedData?.id) {
        for (const claimed of claimedThisRequest.reverse()) {
          await supabase
            .from("order_shipping_labels")
            .update({
              label_status: claimed.label_status,
              metadata: claimed.metadata || {},
              updated_at: new Date().toISOString(),
            })
            .eq("store_id", storeId)
            .eq("id", claimed.id)
            .eq("label_status", LETTERTRACK_EXPORTED_STATUS);
        }

        if (claimError) throw claimError;
        return Response.json(
          {
            error:
              "Another LetterTrack export changed this batch while it was being claimed. This request was rolled back; retry from Shipping.",
            batchId: idempotencyKey,
            labelId: label.id,
          },
          { status: 409 },
        );
      }

      claimedThisRequest.push(label);
    }

    return csvResponse({
      csv,
      exportedAt: batchMetadata.exportedAt,
      rows: exportResult.rows.length,
      batchId: idempotencyKey,
      replayed,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not export LetterTrack CSV." },
      { status: 500 },
    );
  }
}
