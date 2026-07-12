import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getStripeLiveSecretKey } from "../../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MARKER_KEY = "tcos_webhook_smoke";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stripeRequest(
  stripeKey: string,
  path: string,
  options: { method?: string; body?: URLSearchParams } = {},
) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      ...(options.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: options.body,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Stripe API ${response.status}: ${payload?.error?.message || "unknown error"}`,
    );
  }
  return payload;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body.confirmation !== "RUN LIVE WEBHOOK SMOKE") {
    return NextResponse.json(
      { error: "Type RUN LIVE WEBHOOK SMOKE exactly." },
      { status: 400 },
    );
  }

  const stripeKey = getStripeLiveSecretKey();
  if (!stripeKey) {
    return NextResponse.json(
      { error: "A valid live Stripe secret key is not configured." },
      { status: 409 },
    );
  }

  const markerValue = randomUUID();
  const startedAt = Math.floor(Date.now() / 1000) - 2;
  let account: any = null;
  let previousValue: string | undefined;
  let markerApplied = false;

  try {
    account = await stripeRequest(stripeKey, "/v1/account");
    previousValue = account.metadata?.[MARKER_KEY];

    const applyMarker = new URLSearchParams();
    applyMarker.set(`metadata[${MARKER_KEY}]`, markerValue);
    await stripeRequest(
      stripeKey,
      `/v1/accounts/${encodeURIComponent(account.id)}`,
      { method: "POST", body: applyMarker },
    );
    markerApplied = true;

    let matchingEvent: any = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const params = new URLSearchParams({
        type: "account.updated",
        limit: "10",
      });
      params.set("created[gte]", String(startedAt));
      const events = await stripeRequest(
        stripeKey,
        `/v1/events?${params.toString()}`,
      );
      matchingEvent = events.data.find(
        (event: any) =>
          event.data?.object?.metadata?.[MARKER_KEY] === markerValue,
      );
      if (matchingEvent?.pending_webhooks === 0) break;
      await sleep(1000);
    }

    if (!matchingEvent) {
      throw new Error("Stripe did not create the account.updated smoke event.");
    }
    if (matchingEvent.pending_webhooks !== 0) {
      throw new Error(
        `The live event still has ${matchingEvent.pending_webhooks} pending webhook delivery attempt(s).`,
      );
    }

    return NextResponse.json({
      success: true,
      eventId: matchingEvent.id,
      eventType: matchingEvent.type,
      pendingWebhooks: matchingEvent.pending_webhooks,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Live webhook smoke failed." },
      { status: 502 },
    );
  } finally {
    if (markerApplied && account?.id) {
      const restore = new URLSearchParams();
      restore.set(`metadata[${MARKER_KEY}]`, previousValue || "");
      try {
        await stripeRequest(
          stripeKey,
          `/v1/accounts/${encodeURIComponent(account.id)}`,
          { method: "POST", body: restore },
        );
      } catch {
        // The smoke response already captures delivery status. A failed metadata
        // restore remains visible in Stripe and can be safely cleared manually.
      }
    }
  }
}
