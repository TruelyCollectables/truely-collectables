import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../../lib/legal";
import { recordTermsAcceptance } from "../../../../lib/tos-acceptance";
import { getStoreSettings } from "../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../lib/stores";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import {
  InventoryEngineError,
  inventoryEngine,
} from "../../../../modules/inventory";
import { configuredSiteOrigin } from "../../../../lib/site-origin";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitPolicies,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MIN_OFFER_AMOUNT = 1;
const MAX_OFFER_AMOUNT = 100_000;

function cleanText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : "";
}

function cleanEmail(value: unknown) {
  return cleanText(value, MAX_EMAIL_LENGTH).toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function cleanMoney(value: unknown) {
  const text = String(value || "").replace(/[$,]/g, "").trim();
  const amount = Number(text);

  if (!Number.isFinite(amount)) return null;

  return Math.round(amount * 100) / 100;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);
    const account = await getAuthenticatedAccountFromRequest(req);

    const body = await req.json();
    const productId = Number(body.productId);
    const name = cleanText(body.name, MAX_NAME_LENGTH);
    const email = cleanEmail(body.email);
    const offerAmount = cleanMoney(body.offerAmount);
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);

    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json(
        { error: "A valid product is required" },
        { status: 400 }
      );
    }

    if (!name) {
      return NextResponse.json(
        { error: "Customer name is required" },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "A valid customer email is required" },
        { status: 400 }
      );
    }

    if (
      offerAmount === null ||
      offerAmount < MIN_OFFER_AMOUNT ||
      offerAmount > MAX_OFFER_AMOUNT
    ) {
      return NextResponse.json(
        { error: "Offer amount must be between $1 and $100,000" },
        { status: 400 }
      );
    }

    if (!tosAccepted) {
      return NextResponse.json(
        { error: "Terms of Service must be accepted before submitting an offer" },
        { status: 400 }
      );
    }

    const rateLimit = await checkPublicEndpointRateLimit({
      request: req,
      ...publicEndpointRateLimitPolicies.publicOfferCreate,
      subjectKey: account?.id || `${email}:${productId}`,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(
        blocked.body,
        { status: blocked.status }
      );
    }

    const clientIdentity = rateLimit.identity;

    const [product] = await inventoryEngine.requireAvailableCartItems([
      { id: productId, quantity: 1 },
    ]);

    const tosAcceptanceEventId = await recordTermsAcceptance(supabase, {
      contextType: "offer",
      tosKind: "buyer",
      tosVersion,
      identity: clientIdentity,
      storeId,
    });

    const offerPayload = {
      store_id: storeId,
      account_id: account?.id || null,
      product_id: productId,
      customer_name: name,
      customer_email: email,
      offer_amount: offerAmount,
      tos_accepted: true,
      tos_version: tosVersion,
      tos_accepted_at: new Date().toISOString(),
      tos_acceptance_event_id: tosAcceptanceEventId,
      tos_ip_address: clientIdentity.ipAddress,
      tos_user_agent: clientIdentity.userAgent,
      tos_ip_risk: clientIdentity.risk,
      tos_ip_block_reason: clientIdentity.blockReason,
      tos_ip_evidence: clientIdentity.evidence,
    };

    const { data: offer, error } = await supabase
      .from("offers")
      .insert([offerPayload])
      .select("*, products(title, price)")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (resendApiKey) {
      const resend = new Resend(resendApiKey);
      const adminOffersUrl = `${configuredSiteOrigin()}/admin/offers`;

      await resend.emails.send({
        from: `${storeSettings.displayName} Offers <${storeSettings.offersEmail}>`,
        to: storeSettings.salesEmail,
        subject: "New Best Offer Received",
        html: `
          <h2>New Best Offer Received</h2>

          <p><strong>Product:</strong> ${escapeHtml(offer.products?.title || product.title)}</p>
          <p><strong>Asking Price:</strong> $${Number(offer.products?.price || product.price || 0).toFixed(2)}</p>
          <p><strong>Offer Amount:</strong> $${Number(offer.offer_amount).toFixed(2)}</p>

          <hr />

          <p><strong>Customer Name:</strong> ${escapeHtml(offer.customer_name)}</p>
          <p><strong>Customer Email:</strong> ${escapeHtml(offer.customer_email)}</p>

          <p>
            <a href="${escapeHtml(adminOffersUrl)}">
              Review this offer
            </a>
          </p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      offer,
    });
  } catch (err: any) {
    console.error("Offer create error:", err);

    if (err instanceof InventoryEngineError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      { error: "Failed to create offer" },
      { status: 500 }
    );
  }
}
