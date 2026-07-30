import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../../lib/admin-session";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function hasValidAdminSession() {
  const cookieStore = await cookies();

  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    if (await isValidAdminSessionValue(cookieStore.get(cookieName)?.value)) {
      return true;
    }
  }

  return false;
}

export async function GET() {
  if (!(await hasValidAdminSession())) {
    return NextResponse.json(
      {
        ok: false,
        check: "admin-orders-service-role",
        error: "unauthorized",
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const { error } = await supabase.from("orders").select("id").limit(1);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        check: "admin-orders-service-role",
        error: error.message,
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      check: "admin-orders-service-role",
      deployment: "fulfillment-hotfix-2026-07-29-2018-mt",
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
