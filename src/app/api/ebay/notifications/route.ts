import { ebayNotificationChallengeResponse, verifyEbayNotification } from "../../../../lib/ebay-notifications";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type AuthorizationRevocationPayload = {
  metadata?: {
    topic?: unknown;
    schemaVersion?: unknown;
  };
  notification?: {
    notificationId?: unknown;
    eventDate?: unknown;
    publishDate?: unknown;
    publishAttemptCount?: unknown;
    data?: {
      username?: unknown;
      userId?: unknown;
      eiasToken?: unknown;
      revokeReason?: unknown;
      revocationDate?: unknown;
    };
  };
};

type WebhookEventRow = {
  id: string;
  event_status: string;
  attempt_count: number;
};

type RevokedConnectionRow = {
  id: string;
  provider_metadata: Record<string, unknown> | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanText(value: unknown, maxLength = 300) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanDate(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function notificationEndpoint(request: Request, url: URL) {
  const configuredEndpoint = String(
    process.env.EBAY_NOTIFICATION_ENDPOINT_URL || "",
  ).trim();

  if (configuredEndpoint) {
    const configuredUrl = new URL(configuredEndpoint);
    configuredUrl.search = "";
    configuredUrl.hash = "";
    return configuredUrl.toString().replace(/\/$/, "");
  }

  const forwardedHost = cleanText(
    request.headers.get("x-forwarded-host") || request.headers.get("host"),
    300,
  );
  const forwardedProtocol = cleanText(
    request.headers.get("x-forwarded-proto"),
    20,
  );
  const protocol = forwardedProtocol || url.protocol.replace(":", "");

  return forwardedHost
    ? `${protocol}://${forwardedHost}${url.pathname}`
    : `${url.origin}${url.pathname}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const challengeCode = cleanText(url.searchParams.get("challenge_code"), 200);

    if (!challengeCode) {
      return Response.json({ error: "Missing challenge_code" }, { status: 400 });
    }

    const endpoint = notificationEndpoint(request, url);
    const challengeResponse = ebayNotificationChallengeResponse({
      challengeCode,
      endpoint,
    });

    return Response.json({ challengeResponse });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not validate eBay notification endpoint" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let eventId: string | null = null;
  const supabase = getSupabaseClient();

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);

    if (contentLength > 128 * 1024) {
      return Response.json({ error: "Notification payload is too large" }, { status: 413 });
    }

    const signatureHeader = request.headers.get("x-ebay-signature");

    if (!signatureHeader) {
      return Response.json({ error: "Missing X-EBAY-SIGNATURE" }, { status: 400 });
    }

    const rawBody = await request.text();

    if (Buffer.byteLength(rawBody, "utf8") > 128 * 1024) {
      return Response.json({ error: "Notification payload is too large" }, { status: 413 });
    }

    let message: AuthorizationRevocationPayload;

    try {
      message = JSON.parse(rawBody) as AuthorizationRevocationPayload;
    } catch {
      return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const verification = await verifyEbayNotification({
      message,
      signatureHeader,
    });

    if (!verification.valid) {
      return Response.json({ error: "Invalid eBay signature" }, { status: 412 });
    }

    const topic = cleanText(message.metadata?.topic, 120);

    if (topic !== "AUTHORIZATION_REVOCATION") {
      return new Response(null, { status: 204 });
    }

    const notificationId = cleanText(
      message.notification?.notificationId,
      200,
    );
    const userId = cleanText(message.notification?.data?.userId, 200);
    const username = cleanText(message.notification?.data?.username, 200);

    if (!notificationId || !userId) {
      return Response.json(
        { error: "Authorization revocation payload is incomplete" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const revokeReason = cleanText(
      message.notification?.data?.revokeReason,
      120,
    );
    const eventPayload = {
      provider: "ebay",
      notification_id: notificationId,
      topic,
      provider_user_id: userId,
      signature_key_id: verification.keyId,
      event_status: "received",
      revoke_reason: revokeReason,
      event_date: cleanDate(message.notification?.eventDate),
      publish_date: cleanDate(message.notification?.publishDate),
      revocation_date: cleanDate(message.notification?.data?.revocationDate),
      metadata: {
        schema_version: cleanText(message.metadata?.schemaVersion, 40),
        publish_attempt_count: Number(
          message.notification?.publishAttemptCount || 0,
        ),
      },
      updated_at: now,
    };
    const { data: insertedEvent, error: insertError } = await supabase
      .from("seller_marketplace_webhook_events")
      .upsert(eventPayload, {
        onConflict: "provider,notification_id",
        ignoreDuplicates: true,
      })
      .select("id,event_status,attempt_count")
      .maybeSingle();

    if (insertError) {
      throw insertError;
    }

    const eventWasInserted = Boolean(insertedEvent);
    let event = insertedEvent as unknown as WebhookEventRow | null;

    if (!event) {
      const { data: existingEvent, error: existingEventError } = await supabase
        .from("seller_marketplace_webhook_events")
        .select("id,event_status,attempt_count")
        .eq("provider", "ebay")
        .eq("notification_id", notificationId)
        .single();

      if (existingEventError || !existingEvent) {
        throw existingEventError || new Error("Could not load eBay webhook event");
      }

      event = existingEvent as unknown as WebhookEventRow;
    }

    eventId = event.id;

    if (event.event_status === "processed") {
      return new Response(null, { status: 204 });
    }

    await supabase
      .from("seller_marketplace_webhook_events")
      .update({
        event_status: "processing",
        attempt_count: eventWasInserted
          ? 1
          : Math.max(Number(event.attempt_count || 0), 0) + 1,
        last_error: null,
        updated_at: now,
      })
      .eq("id", event.id);

    const { data: userIdConnections, error: userIdConnectionError } =
      await supabase
        .from("seller_marketplace_connections")
        .select("id,provider_metadata")
        .eq("provider", "ebay")
        .eq("provider_account_id", userId);

    if (userIdConnectionError) {
      throw userIdConnectionError;
    }

    let connections = (userIdConnections || []) as unknown as RevokedConnectionRow[];

    if (connections.length === 0 && username) {
      const { data: usernameConnections, error: usernameConnectionError } =
        await supabase
          .from("seller_marketplace_connections")
          .select("id,provider_metadata")
          .eq("provider", "ebay")
          .eq("provider_account_label", username);

      if (usernameConnectionError) {
        throw usernameConnectionError;
      }

      connections = (usernameConnections || []) as unknown as RevokedConnectionRow[];
    }

    const connectionIds = connections.map((connection) => connection.id);

    if (connectionIds.length > 0) {
      const { error: tokenDeleteError } = await supabase
        .from("seller_marketplace_connection_tokens")
        .delete()
        .in("connection_id", connectionIds)
        .eq("provider", "ebay");

      if (tokenDeleteError) {
        throw tokenDeleteError;
      }

      for (const connection of connections) {
        const revokedAt =
          cleanDate(message.notification?.data?.revocationDate) || now;
        const { error: connectionUpdateError } = await supabase
          .from("seller_marketplace_connections")
          .update({
            connection_status: "revoked",
            sync_status: "paused",
            oauth_scope: [],
            token_storage_key: null,
            access_token_expires_at: null,
            refresh_token_expires_at: null,
            last_sync_error: revokeReason
              ? `eBay authorization revoked: ${revokeReason}`
              : "eBay authorization revoked",
            provider_metadata: {
              ...recordValue(connection.provider_metadata),
              authorization_revoked_at: revokedAt,
              authorization_revoke_reason: revokeReason,
              authorization_revocation_notification_id: notificationId,
              local_credentials_deleted: true,
            },
            updated_at: now,
          })
          .eq("id", connection.id)
          .eq("provider", "ebay");

        if (connectionUpdateError) {
          throw connectionUpdateError;
        }
      }
    }

    const eventStatus = connectionIds.length > 0 ? "processed" : "unmatched";
    const { error: eventUpdateError } = await supabase
      .from("seller_marketplace_webhook_events")
      .update({
        event_status: eventStatus,
        affected_connection_count: connectionIds.length,
        processed_at: now,
        updated_at: now,
      })
      .eq("id", event.id);

    if (eventUpdateError) {
      throw eventUpdateError;
    }

    return new Response(null, { status: 204 });
  } catch (error: any) {
    if (eventId) {
      await supabase
        .from("seller_marketplace_webhook_events")
        .update({
          event_status: "failed",
          last_error: String(error.message || "Webhook processing failed").slice(
            0,
            1000,
          ),
          updated_at: new Date().toISOString(),
        })
        .eq("id", eventId);
    }

    console.error("eBay authorization revocation webhook failed");
    return Response.json(
      { error: "Could not process eBay notification" },
      { status: 500 },
    );
  }
}
