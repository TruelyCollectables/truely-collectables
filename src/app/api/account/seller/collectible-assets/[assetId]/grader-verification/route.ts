import {
  ensureAccountStoreMembership,
  getAuthenticatedSellerAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  officialGraderVerificationUrl,
  verifyGraderCertification,
} from "../../../../../../../lib/collectible-assets";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWNER_EMAILS = new Set([
  "sales@truelycollectables.com",
  "sales@trulycollectables.com",
]);

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown, maximum = 500) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maximum) : null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const account = await getAuthenticatedSellerAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const { assetId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = body.action === "manual_verify" ? "manual_verify" : "refresh";
    const note = textValue(body.note, 1000);
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = OWNER_EMAILS.has(String(account.email || "").toLowerCase());

    const { data: asset, error: assetError } = await supabase
      .from("collectible_assets")
      .select("*")
      .eq("id", assetId)
      .eq("store_id", storeId)
      .single();

    if (assetError || !asset) {
      return Response.json({ error: "Collectible asset was not found." }, { status: 404 });
    }

    const allowed =
      asset.seller_account_id === account.id ||
      (owner && asset.seller_account_id === null);
    if (!allowed) {
      return Response.json({ error: "Collectible asset was not found." }, { status: 404 });
    }

    if (!asset.grading_company || !asset.grading_cert_number) {
      return Response.json(
        { error: "This asset does not have grading certification details." },
        { status: 409 },
      );
    }

    let verification;
    if (action === "manual_verify") {
      if (!note) {
        return Response.json(
          {
            error:
              "Add a note confirming what you checked on the official grader page.",
          },
          { status: 400 },
        );
      }

      const checkedAt = new Date().toISOString();
      verification = {
        provider: asset.grading_company,
        certNumber: asset.grading_cert_number,
        status: "manual_verified" as const,
        verificationUrl:
          asset.grader_verification_url ||
          officialGraderVerificationUrl(
            asset.grading_company,
            asset.grading_cert_number,
          ),
        checkedAt,
        expectedIdentity: {
          year: asset.card_year,
          manufacturer: asset.manufacturer,
          player: asset.player,
          cardNumber: asset.card_number,
          grade: asset.grading_grade,
        },
        observedIdentity: {
          humanConfirmationNote: note,
        },
        mismatchReasons: [],
        providerScanUrls: [],
        rawEvidence: {
          confirmedByAccountId: account.id,
          confirmationNote: note,
        },
      };
    } else {
      verification = await verifyGraderCertification({
        provider: asset.grading_company,
        certNumber: asset.grading_cert_number,
        expected: {
          year: asset.card_year,
          manufacturer: asset.manufacturer,
          player: asset.player,
          cardNumber: asset.card_number,
          grade: asset.grading_grade,
        },
      });
    }

    const verificationPayload = {
      provider: verification.provider,
      certNumber: verification.certNumber,
      status: verification.status,
      verificationUrl: verification.verificationUrl,
      checkedAt: verification.checkedAt,
      expectedIdentity: verification.expectedIdentity,
      observedIdentity: verification.observedIdentity,
      mismatchReasons: verification.mismatchReasons,
      providerScanUrls: verification.providerScanUrls,
      rawEvidence: verification.rawEvidence,
    };

    const { error: updateError } = await supabase
      .from("collectible_assets")
      .update({
        grader_verification_status: verification.status,
        grader_verification_url: verification.verificationUrl,
        grader_verified_at: ["verified", "manual_verified"].includes(
          verification.status,
        )
          ? verification.checkedAt
          : null,
        grader_verification_payload: verificationPayload,
      })
      .eq("id", assetId)
      .eq("store_id", storeId);

    if (updateError) throw updateError;

    const { error: verificationError } = await supabase
      .from("collectible_grader_verifications")
      .insert({
        asset_id: assetId,
        store_id: storeId,
        provider: asset.grading_company,
        cert_number: asset.grading_cert_number,
        status:
          verification.status === "not_applicable" ||
          verification.status === "pending"
            ? "failed"
            : verification.status,
        verification_url: verification.verificationUrl,
        checked_at: verification.checkedAt || new Date().toISOString(),
        expected_identity: verification.expectedIdentity,
        observed_identity: verification.observedIdentity,
        mismatch_reasons: verification.mismatchReasons,
        provider_scan_urls: verification.providerScanUrls,
        raw_evidence: verification.rawEvidence,
      });
    if (verificationError) throw verificationError;

    if (asset.inventory_item_id) {
      const { data: inventory } = await supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", asset.inventory_item_id)
        .eq("store_id", storeId)
        .maybeSingle();
      const metadata = recordValue(inventory?.metadata);
      const collectibleAsset = recordValue(metadata.collectible_asset);

      await supabase
        .from("inventory_items")
        .update({
          metadata: {
            ...metadata,
            collectible_asset: {
              ...collectibleAsset,
              asset_id: assetId,
              grader_verification_status: verification.status,
              grader_verification_url: verification.verificationUrl,
            },
            grader_verification: verificationPayload,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", asset.inventory_item_id)
        .eq("store_id", storeId);
    }

    await supabase.from("collectible_asset_events").insert({
      asset_id: assetId,
      store_id: storeId,
      event_type:
        action === "manual_verify"
          ? "grader_manually_verified"
          : "grader_verification_refreshed",
      previous_status: asset.grader_verification_status,
      new_status: verification.status,
      source: "seller_collectible_assets",
      source_reference: asset.grading_cert_number,
      event_payload: verificationPayload,
    });

    return Response.json({
      success: true,
      assetId,
      verification: verificationPayload,
    });
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Grader verification failed." },
      { status: 500 },
    );
  }
}
