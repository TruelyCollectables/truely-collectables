import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { PLATFORM_DOMAIN } from "../../../../../lib/legal";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type SocialConnection = {
  id: string;
  requester_account_id: string;
  target_account_id: string;
  connection_type: "follow" | "friend";
  status: string;
  created_at: string;
  updated_at: string;
};

type CollectorProfileRow = {
  account_id: string;
  collector_handle: string | null;
  bio: string | null;
  collecting_focus: string | null;
  location_label: string | null;
  visibility: string;
  updated_at: string;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanText(value: unknown, maxLength = 1000) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanVisibility(value: unknown) {
  const text = cleanText(value, 30) || "friends";

  return ["private", "friends", "followers", "community", "public"].includes(text)
    ? text
    : "friends";
}

function siteBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    `https://${PLATFORM_DOMAIN}`
  ).replace(/\/$/, "");
}

function createShareSlug() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  return random.replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase();
}

function isMissingSocialTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_social_connections") ||
    message.includes("account_brag_posts")
  );
}

function socialUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Collector social features are not available until the social migration is applied.",
    },
    { status: 503 },
  );
}

function collectorSocialListHeaders(params: {
  collectorCount: number;
  followingCount: number;
  friendCount: number;
  incomingFriendRequestCount: number;
  outgoingFriendRequestCount: number;
  feedCount: number;
}) {
  return {
    "X-TCOS-Collector-Social-Collectors": String(params.collectorCount),
    "X-TCOS-Collector-Social-Following": String(params.followingCount),
    "X-TCOS-Collector-Social-Friends": String(params.friendCount),
    "X-TCOS-Collector-Social-Incoming-Friend-Requests": String(
      params.incomingFriendRequestCount,
    ),
    "X-TCOS-Collector-Social-Outgoing-Friend-Requests": String(
      params.outgoingFriendRequestCount,
    ),
    "X-TCOS-Collector-Social-Feed": String(params.feedCount),
  };
}

function collectorSocialMutationHeaders(params: {
  action:
    | "follow"
    | "friend_request"
    | "accept_friend"
    | "create_brag"
    | "remove_connection";
  status: string;
  connectionType: "follow" | "friend" | "brag";
  resourceId: string | null;
}) {
  return {
    "X-TCOS-Collector-Social-Action": params.action,
    "X-TCOS-Collector-Social-Status": params.status,
    "X-TCOS-Collector-Social-Connection-Type": params.connectionType,
    "X-TCOS-Collector-Social-Resource-Id": params.resourceId || "none",
  };
}

function profileLabel(profile: CollectorProfileRow | undefined, fallback: string) {
  return profile?.collector_handle || fallback;
}

function serializeConnection(
  connection: SocialConnection,
  accountId: string,
  profiles: Map<string, CollectorProfileRow>,
) {
  const otherAccountId =
    connection.requester_account_id === accountId
      ? connection.target_account_id
      : connection.requester_account_id;

  return {
    id: connection.id,
    otherAccountId,
    type: connection.connection_type,
    status: connection.status,
    direction:
      connection.requester_account_id === accountId ? "outgoing" : "incoming",
    profile: profiles.get(otherAccountId) ?? null,
  };
}

async function loadProfiles(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  accountIds?: string[];
}) {
  let query = params.supabase
    .from("account_collector_profiles")
    .select(
      "account_id,collector_handle,bio,collecting_focus,location_label,visibility,updated_at",
    )
    .eq("store_id", params.storeId);

  if (params.accountIds) {
    if (params.accountIds.length === 0) return [];
    query = query.in("account_id", params.accountIds);
  } else {
    query = query.in("visibility", ["community", "public"]);
  }

  const { data, error } = await query
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data ?? []) as CollectorProfileRow[];
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: connections, error: connectionsError } = await supabase
      .from("account_social_connections")
      .select(
        "id,requester_account_id,target_account_id,connection_type,status,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .or(`requester_account_id.eq.${account.id},target_account_id.eq.${account.id}`)
      .order("updated_at", { ascending: false });

    if (connectionsError) {
      if (isMissingSocialTables(connectionsError)) return socialUnavailableResponse();
      throw connectionsError;
    }

    const connectionRows = (connections ?? []) as SocialConnection[];
    const relatedAccountIds = Array.from(
      new Set(
        connectionRows.flatMap((connection) => [
          connection.requester_account_id,
          connection.target_account_id,
        ]),
      ),
    );
    const [relatedProfiles, discoverProfiles] = await Promise.all([
      loadProfiles({ supabase, storeId, accountIds: relatedAccountIds }),
      loadProfiles({ supabase, storeId }),
    ]);
    const profiles = new Map<string, CollectorProfileRow>();

    for (const profile of [...relatedProfiles, ...discoverProfiles]) {
      profiles.set(profile.account_id, profile);
    }

    const followingIds = new Set(
      connectionRows
        .filter(
          (connection) =>
            connection.connection_type === "follow" &&
            connection.requester_account_id === account.id &&
            connection.status === "active",
        )
        .map((connection) => connection.target_account_id),
    );
    const friendIds = new Set(
      connectionRows
        .filter(
          (connection) =>
            connection.connection_type === "friend" &&
            connection.status === "accepted",
        )
        .map((connection) =>
          connection.requester_account_id === account.id
            ? connection.target_account_id
            : connection.requester_account_id,
        ),
    );
    const feedAuthorIds = Array.from(
      new Set([account.id, ...followingIds, ...friendIds]),
    );
    const { data: feedRows, error: feedError } = await supabase
      .from("account_brag_posts")
      .select(
        "id,account_id,order_id,collection_item_id,product_id,title,body,image_url,share_slug,share_url,visibility,reaction_count,comment_count,click_count,metadata,created_at",
      )
      .eq("store_id", storeId)
      .in("account_id", feedAuthorIds)
      .order("created_at", { ascending: false })
      .limit(50);

    if (feedError) {
      if (isMissingSocialTables(feedError)) return socialUnavailableResponse();
      throw feedError;
    }

    const feed = (feedRows ?? []).filter((post) => {
      if (post.account_id === account.id) return true;
      if (post.visibility === "public" || post.visibility === "community") return true;
      if (post.visibility === "followers") return followingIds.has(post.account_id);
      if (post.visibility === "friends") return friendIds.has(post.account_id);
      return false;
    });

    const serializedConnections = connectionRows.map((connection) =>
      serializeConnection(connection, account.id, profiles),
    );
    const relationshipByAccountId = new Map<string, string>();

    for (const connection of serializedConnections) {
      relationshipByAccountId.set(
        connection.otherAccountId,
        `${connection.type}:${connection.status}:${connection.direction}`,
      );
    }

    const collectors = discoverProfiles
      .filter((profile) => profile.account_id !== account.id)
      .map((profile) => ({
        ...profile,
        relationship: relationshipByAccountId.get(profile.account_id) || null,
      }));
    const following = serializedConnections.filter(
      (connection) => connection.type === "follow" && connection.status === "active",
    );
    const friends = serializedConnections.filter(
      (connection) => connection.type === "friend" && connection.status === "accepted",
    );
    const incomingFriendRequests = serializedConnections.filter(
      (connection) =>
        connection.type === "friend" &&
        connection.status === "pending" &&
        connection.direction === "incoming",
    );
    const outgoingFriendRequests = serializedConnections.filter(
      (connection) =>
        connection.type === "friend" &&
        connection.status === "pending" &&
        connection.direction === "outgoing",
    );
    const feedItems = feed.map((post) => ({
      ...post,
      authorLabel: profileLabel(profiles.get(post.account_id), "Collector"),
    }));

    return NextResponse.json(
      {
        success: true,
        collectors,
        following,
        friends,
        incomingFriendRequests,
        outgoingFriendRequests,
        feed: feedItems,
      },
      {
        headers: collectorSocialListHeaders({
          collectorCount: collectors.length,
          followingCount: following.length,
          friendCount: friends.length,
          incomingFriendRequestCount: incomingFriendRequests.length,
          outgoingFriendRequestCount: outgoingFriendRequests.length,
          feedCount: feedItems.length,
        }),
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load collector social data" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const action = cleanText(body.action, 40);
    const targetAccountId = cleanText(body.targetAccountId, 80);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (action === "follow") {
      if (!targetAccountId || targetAccountId === account.id) {
        return NextResponse.json({ error: "Collector is required" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("account_social_connections")
        .upsert(
          {
            store_id: storeId,
            requester_account_id: account.id,
            target_account_id: targetAccountId,
            connection_type: "follow",
            status: "active",
            updated_at: new Date().toISOString(),
          },
          {
            onConflict:
              "store_id,requester_account_id,target_account_id,connection_type",
          },
        )
        .select("*")
        .single();

      if (error) {
        if (isMissingSocialTables(error)) return socialUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json(
        { success: true, connection: data },
        {
          headers: collectorSocialMutationHeaders({
            action,
            status: "active",
            connectionType: "follow",
            resourceId: String(data.id),
          }),
        },
      );
    }

    if (action === "friend_request") {
      if (!targetAccountId || targetAccountId === account.id) {
        return NextResponse.json({ error: "Collector is required" }, { status: 400 });
      }

      const { data: reverseRequest } = await supabase
        .from("account_social_connections")
        .select("id")
        .eq("store_id", storeId)
        .eq("requester_account_id", targetAccountId)
        .eq("target_account_id", account.id)
        .eq("connection_type", "friend")
        .eq("status", "pending")
        .maybeSingle();
      const status = reverseRequest?.id ? "accepted" : "pending";

      if (reverseRequest?.id) {
        await supabase
          .from("account_social_connections")
          .update({
            status: "accepted",
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", reverseRequest.id)
          .eq("store_id", storeId);
      }

      const { data, error } = await supabase
        .from("account_social_connections")
        .upsert(
          {
            store_id: storeId,
            requester_account_id: account.id,
            target_account_id: targetAccountId,
            connection_type: "friend",
            status,
            responded_at: status === "accepted" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict:
              "store_id,requester_account_id,target_account_id,connection_type",
          },
        )
        .select("*")
        .single();

      if (error) {
        if (isMissingSocialTables(error)) return socialUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json(
        { success: true, connection: data },
        {
          headers: collectorSocialMutationHeaders({
            action,
            status,
            connectionType: "friend",
            resourceId: String(data.id),
          }),
        },
      );
    }

    if (action === "accept_friend") {
      const connectionId = cleanText(body.connectionId, 80);

      if (!connectionId) {
        return NextResponse.json({ error: "Request is required" }, { status: 400 });
      }

      const { data: connection, error: lookupError } = await supabase
        .from("account_social_connections")
        .select("*")
        .eq("id", connectionId)
        .eq("store_id", storeId)
        .eq("target_account_id", account.id)
        .eq("connection_type", "friend")
        .eq("status", "pending")
        .single();

      if (lookupError) {
        if (isMissingSocialTables(lookupError)) return socialUnavailableResponse();
        return NextResponse.json({ error: "Friend request not found" }, { status: 404 });
      }

      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("account_social_connections")
        .update({
          status: "accepted",
          responded_at: now,
          updated_at: now,
        })
        .eq("id", connectionId)
        .eq("store_id", storeId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      await supabase.from("account_social_connections").upsert(
        {
          store_id: storeId,
          requester_account_id: account.id,
          target_account_id: connection.requester_account_id,
          connection_type: "friend",
          status: "accepted",
          responded_at: now,
          updated_at: now,
        },
        {
          onConflict:
            "store_id,requester_account_id,target_account_id,connection_type",
        },
      );

      return NextResponse.json(
        { success: true },
        {
          headers: collectorSocialMutationHeaders({
            action,
            status: "accepted",
            connectionType: "friend",
            resourceId: connectionId,
          }),
        },
      );
    }

    if (action === "create_brag") {
      const orderId = Number(body.orderId);
      const title = cleanText(body.title, 240);
      const bodyText = cleanText(body.body, 2000);
      const visibility = cleanVisibility(body.visibility);

      if (!Number.isFinite(orderId) || orderId <= 0) {
        return NextResponse.json({ error: "Order is required" }, { status: 400 });
      }

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id,item_count,total,account_id,store_id")
        .eq("id", orderId)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .single();

      if (orderError || !order) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }

      const { data: orderItems } = await supabase
        .from("order_items")
        .select("product_id,title,price,quantity")
        .eq("order_id", orderId)
        .eq("store_id", storeId)
        .order("id", { ascending: true })
        .limit(5);
      const firstItem = orderItems?.[0];
      const bragTitle =
        title ||
        (firstItem?.title
          ? `Made it mine: ${firstItem.title}`
          : `New collection pickup from order #${orderId}`);
      const shareSlug = createShareSlug();
      const shareUrl = `${siteBaseUrl()}/brag/${shareSlug}`;

      const { data, error } = await supabase
        .from("account_brag_posts")
        .insert({
          store_id: storeId,
          account_id: account.id,
          order_id: orderId,
          product_id: firstItem?.product_id ?? null,
          title: bragTitle,
          body: bodyText,
          share_slug: shareSlug,
          share_url: shareUrl,
          visibility,
          metadata: {
            order_item_count: order.item_count,
            order_total: order.total,
            order_items: orderItems ?? [],
            share_footer: `Find your next collectable at ${PLATFORM_DOMAIN}`,
          },
        })
        .select("*")
        .single();

      if (error) {
        if (isMissingSocialTables(error)) return socialUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json(
        { success: true, bragPost: data },
        {
          headers: collectorSocialMutationHeaders({
            action,
            status: data.visibility || visibility,
            connectionType: "brag",
            resourceId: data.share_slug || data.id,
          }),
        },
      );
    }

    return NextResponse.json({ error: "Unsupported social action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not update collector social data" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const targetAccountId = cleanText(body.targetAccountId, 80);
    const connectionType = cleanText(body.connectionType, 20);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (!targetAccountId || !["follow", "friend"].includes(connectionType || "")) {
      return NextResponse.json({ error: "Connection is required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("account_social_connections")
      .delete()
      .eq("store_id", storeId)
      .eq("connection_type", connectionType)
      .or(
        `and(requester_account_id.eq.${account.id},target_account_id.eq.${targetAccountId}),and(requester_account_id.eq.${targetAccountId},target_account_id.eq.${account.id})`,
      );

    if (error) {
      if (isMissingSocialTables(error)) return socialUnavailableResponse();
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { success: true },
      {
        headers: collectorSocialMutationHeaders({
          action: "remove_connection",
          status: "removed",
          connectionType: connectionType as "follow" | "friend",
          resourceId: null,
        }),
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not remove collector connection" },
      { status: 500 },
    );
  }
}
