import { NextResponse } from "next/server";

export async function GET() {
  const res = NextResponse.redirect(new URL("/admin/login", process.env.NEXT_PUBLIC_SITE_URL || "https://truely-collectables-tt3b.vercel.app"));

  res.cookies.set("admin_auth", "", {
    path: "/",
    maxAge: 0,
  });

  return res;
}