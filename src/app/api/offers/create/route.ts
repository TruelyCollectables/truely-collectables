import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../../lib/legal";
import { getClientIdentity } from "../../../../lib/client-identity";
import { recordTermsAcceptance } from "../../../../lib/tos-acceptance";
import { getStoreSettings } from "../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../lib/stores";

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

    const body = await req.json();
    const { productId, name, email, offerAmount } = body;
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);

    if (!tosAccepted) {
      return NextResponse.json(
        { error: "Terms of Service must be accepted before submitting an offer" },
        { status: 400 }
      );
    }

    const clientIdentity = await getClientIdentity(req);

    if (clientIdentity.blocked) {
      return NextResponse.json(
        {
          error:
            "Terms of Service cannot be accepted while client identity is masked or missing a public IP address",
          reason: clientIdentity.blockReason,
        },
        { status: 403 }
      );
    }

    const tosAcceptanceEventId = await recordTermsAcceptance(supabase, {
      contextType: "offer",
      tosKind: "buyer",
      tosVersion,
      identity: clientIdentity,
      storeId,
    });

    const offerPayload = {
      store_id: storeId,
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

      await resend.emails.send({
        from: `${storeSettings.displayName} Offers <${storeSettings.offersEmail}>`,
        to: storeSettings.salesEmail,
        subject: "New Best Offer Received",
        html: `
          <h2>New Best Offer Received</h2>

          <p><strong>Product:</strong> ${offer.products?.title || "Unknown product"}</p>
          <p><strong>Asking Price:</strong> $${Number(offer.products?.price || 0).toFixed(2)}</p>
          <p><strong>Offer Amount:</strong> $${Number(offer.offer_amount).toFixed(2)}</p>

          <hr />

          <p><strong>Customer Name:</strong> ${offer.customer_name}</p>
          <p><strong>Customer Email:</strong> ${offer.customer_email}</p>

          <p>
            <a href="https://truely-collectables-tt3b.vercel.app/admin/offers">
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
  } catch (err) {
    console.error("Offer create error:", err);

    return NextResponse.json(
      { error: "Failed to create offer" },
      { status: 500 }
    );
  }
}
