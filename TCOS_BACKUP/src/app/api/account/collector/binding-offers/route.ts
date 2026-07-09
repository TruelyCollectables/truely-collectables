import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import {
  TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../../../lib/legal";
import { recordTermsAcceptance } from "../../../../../lib/tos-acceptance";
import { getActiveStoreId } from "../../../../../lib/stores";
import { trustedRequestOrigin } from "../../../../../lib/site-origin";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitPolicies,
  publicEndpointRateLimitResponse,
} from "../../../../../lib/public-endpoint-rate-limit";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanText(value: unknown, maxLength = 2000) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanMoney(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function defaultExpiryIso() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 3);
  return expiresAt.toISOString();
}

function isMissingBindingOfferTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_binding_offers") ||
    message.includes("account_conversations")
  );
}

function unavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Binding offers are not available until the collector messaging migration is applied.",
    },
    { status: 503 },
  );
}

async function requireConversationAccess(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  conversationId: string;
  accountId: string;
  storeId: string;
}) {
  const { data: conversation, error } = await params.supabase
    .from("account_conversations")
    .select("id,created_by_account_id,recipient_account_id,status")
    .eq("id", params.conversationId)
    .eq("store_id", params.storeId)
    .maybeSingle();

  if (error) {
    if (isMissingBindingOfferTables(error)) {
      return { error: unavailableResponse() };
    }

    return {
      error: NextResponse.json({ error: error.message }, { status: 400 }),
    };
  }

  if (!conversation) {
    return {
      error: NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      ),
    };
  }

  const isParticipant =
    conversation.created_by_account_id === params.accountId ||
    conversation.recipient_account_id === params.accountId;

  if (!isParticipant) {
    return {
      error: NextResponse.json(
        { error: "You do not have access to this conversation" },
        { status: 403 },
      ),
    };
  }

  if (conversation.status === "blocked" || conversation.status === "closed") {
    return {
      error: NextResponse.json(
        { error: "This conversation is not open for binding offers" },
        { status: 400 },
      ),
    };
  }

  return { conversation };
}

export async function POST(request: Request) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) {
      return NextResponse.json(
        { error: "Missing Stripe secret key" },
        { status: 500 },
      );
    }

    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);
    const offerAmount = cleanMoney(body.offerAmount);
    const shippingAmount = cleanMoney(body.shippingAmount);
    const taxAmount = cleanMoney(body.taxAmount);
    const totalAmount = offerAmount + shippingAmount + taxAmount;

    if (!tosAccepted) {
      return NextResponse.json(
        {
          error:
            "Terms of Service must be accepted before submitting a binding offer",
        },
        { status: 400 },
      );
    }

    if (offerAmount <= 0 || totalAmount <= 0) {
      return NextResponse.json(
        { error: "Offer amount must be greater than zero" },
        { status: 400 },
      );
    }

    const rateLimit = await checkPublicEndpointRateLimit({
      request,
      ...publicEndpointRateLimitPolicies.bindingOffer,
      subjectKey: account.id,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(
        blocked.body,
        { status: blocked.status },
      );
    }

    const identity = rateLimit.identity;

    const supabase = getSupabaseClient();
    const stripe = new Stripe(stripeKey);
    const storeId = getActiveStoreId();
    const tosAcceptanceEventId = await recordTermsAcceptance(supabase, {
      contextType: "binding_offer",
      tosKind: "buyer",
      tosVersion,
      identity,
      storeId,
    });

    let conversationId = cleanText(body.conversationId, 80);

    if (conversationId) {
      const access = await requireConversationAccess({
        supabase,
        conversationId,
        accountId: account.id,
        storeId,
      });

      if (access.error) return access.error;
    } else {
      const { data: conversation, error: conversationError } = await supabase
        .from("account_conversations")
        .insert({
          store_id: storeId,
          created_by_account_id: account.id,
          recipient_account_id: cleanText(body.sellerAccountId, 80),
          related_product_id: body.productId ? Number(body.productId) : null,
          related_collection_item_id: cleanText(body.collectionItemId, 80),
          related_wish_list_item_id: cleanText(body.wishListItemId, 80),
          subject: cleanText(body.subject, 200) || "Binding offer",
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (conversationError) {
        if (isMissingBindingOfferTables(conversationError)) {
          return unavailableResponse();
        }

        return NextResponse.json(
          { error: conversationError.message },
          { status: 400 },
        );
      }

      conversationId = conversation.id;
    }

    const { data: bindingOffer, error: offerError } = await supabase
      .from("account_binding_offers")
      .insert({
        store_id: storeId,
        conversation_id: conversationId,
        buyer_account_id: account.id,
        seller_account_id: cleanText(body.sellerAccountId, 80),
        product_id: body.productId ? Number(body.productId) : null,
        collection_item_id: cleanText(body.collectionItemId, 80),
        wish_list_item_id: cleanText(body.wishListItemId, 80),
        offer_amount: offerAmount,
        shipping_amount: shippingAmount,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        currency: "usd",
        status: "payment_required",
        payment_requirement: "card_required_before_submission",
        expires_at: cleanText(body.expiresAt, 80) || defaultExpiryIso(),
        tos_acceptance_event_id: tosAcceptanceEventId,
        tos_version: tosVersion,
        client_ip_address: identity.ipAddress,
        client_user_agent: identity.userAgent,
        client_identity_risk: identity.risk,
        client_identity_evidence: identity.evidence,
        notes: cleanText(body.notes),
      })
      .select("id")
      .single();

    if (offerError || !bindingOffer) {
      if (offerError && isMissingBindingOfferTables(offerError)) {
        return unavailableResponse();
      }

      return NextResponse.json(
        { error: offerError?.message || "Could not create binding offer" },
        { status: 400 },
      );
    }

    await supabase.from("account_conversation_messages").insert({
      conversation_id: conversationId,
      store_id: storeId,
      sender_account_id: account.id,
      message_type: "binding_offer",
      body:
        cleanText(body.message) ||
        `Binding offer started for $${totalAmount.toFixed(2)}. Payment method required before it is sent.`,
      metadata: {
        binding_offer_id: bindingOffer.id,
        status: "payment_required",
      },
    });

    const origin = trustedRequestOrigin(request);
    const metadata = {
      type: "collector_binding_offer_setup",
      binding_offer_id: bindingOffer.id,
      conversation_id: conversationId,
      store_id: storeId,
      buyer_account_id: account.id,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      payment_method_types: ["card"],
      customer_email: account.email || undefined,
      metadata,
      setup_intent_data: {
        metadata,
      },
      success_url: `${origin}/account?binding_offer=payment_saved&offer_id=${bindingOffer.id}`,
      cancel_url: `${origin}/account?binding_offer=payment_canceled&offer_id=${bindingOffer.id}`,
    });

    const setupIntentId =
      typeof session.setup_intent === "string" ? session.setup_intent : null;

    await supabase
      .from("account_binding_offers")
      .update({
        stripe_checkout_session_id: session.id,
        stripe_setup_intent_id: setupIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bindingOffer.id)
      .eq("store_id", storeId);

    return NextResponse.json({
      success: true,
      bindingOfferId: bindingOffer.id,
      conversationId,
      paymentRequired: true,
      url: session.url,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not start binding offer" },
      { status: 500 },
    );
  }
}
