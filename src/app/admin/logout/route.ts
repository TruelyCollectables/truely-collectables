import { NextResponse } from "next/server";
import { configuredSiteOrigin } from "../../../lib/site-origin";

export async function GET() {
  const res = NextResponse.redirect(
    new URL("/admin/login", configuredSiteOrigin()),
  );

  res.cookies.set("admin_auth", "", {
    path: "/",
    maxAge: 0,
  });

  return res;
}
