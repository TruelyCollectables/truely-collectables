import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createOrUpdateAccountProfile,
  ensureAccountStoreMembership,
  recordAccountAuthEvent,
} from "../../../../lib/account-auth";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function POST(request: Request) {
  let email = "";

  try {
    const body = await request.json();
    email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      await recordAccountAuthEvent({
        request,
        email,
        eventType: "login",
        success: false,
      });

      return NextResponse.json(
        { error: error?.message || "Account login failed" },
        { status: 401 },
      );
    }

    await createOrUpdateAccountProfile({
      accountId: data.user.id,
      email,
      displayName:
        typeof data.user.user_metadata?.display_name === "string"
          ? data.user.user_metadata.display_name
          : null,
      defaultAccountType: "buyer",
    });

    await ensureAccountStoreMembership({
      accountId: data.user.id,
      role: "buyer",
    });

    await recordAccountAuthEvent({
      request,
      accountId: data.user.id,
      email,
      eventType: "login",
      success: true,
    });

    return NextResponse.json({
      success: true,
      userId: data.user.id,
      email,
      session: data.session,
    });
  } catch (error: any) {
    await recordAccountAuthEvent({
      request,
      email,
      eventType: "login",
      success: false,
    }).catch(() => undefined);

    return NextResponse.json(
      { error: error.message || "Account login failed" },
      { status: 500 },
    );
  }
}
