import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanText(value: unknown, maxLength = 2000) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function isMissingMessageTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_conversations") ||
    message.includes("account_conversation_messages")
  );
}

function unavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Collector messaging is not available until the messaging migration is applied.",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("account_conversations")
      .select(
        "id,subject,status,recipient_account_id,related_product_id,related_collection_item_id,related_wish_list_item_id,last_message_at,created_at,updated_at",
      )
      .eq("store_id", storeId)
      .or(
        `created_by_account_id.eq.${account.id},recipient_account_id.eq.${account.id}`,
      )
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      if (isMissingMessageTables(error)) return unavailableResponse();
      throw error;
    }

    return NextResponse.json({ success: true, conversations: data ?? [] });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load messages" },
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
    const messageBody = cleanText(body.body);
    const conversationId = cleanText(body.conversationId, 80);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (!messageBody) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    let activeConversationId = conversationId;

    if (!activeConversationId) {
      const { data: conversation, error: conversationError } = await supabase
        .from("account_conversations")
        .insert({
          store_id: storeId,
          created_by_account_id: account.id,
          recipient_account_id: cleanText(body.recipientAccountId, 80),
          related_product_id: body.productId ? Number(body.productId) : null,
          related_collection_item_id: cleanText(body.collectionItemId, 80),
          related_wish_list_item_id: cleanText(body.wishListItemId, 80),
          subject: cleanText(body.subject, 200),
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (conversationError) {
        if (isMissingMessageTables(conversationError)) return unavailableResponse();
        return NextResponse.json(
          { error: conversationError.message },
          { status: 400 },
        );
      }

      activeConversationId = conversation.id;
    }

    const { data: message, error: messageError } = await supabase
      .from("account_conversation_messages")
      .insert({
        conversation_id: activeConversationId,
        store_id: storeId,
        sender_account_id: account.id,
        body: messageBody,
      })
      .select("*")
      .single();

    if (messageError) {
      if (isMissingMessageTables(messageError)) return unavailableResponse();
      return NextResponse.json({ error: messageError.message }, { status: 400 });
    }

    await supabase
      .from("account_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeConversationId)
      .eq("store_id", storeId);

    return NextResponse.json({
      success: true,
      conversationId: activeConversationId,
      message,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not send message" },
      { status: 500 },
    );
  }
}
