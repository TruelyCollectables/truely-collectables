import { NextResponse } from "next/server";
import {
  adminSessionMaxAgeSeconds,
  createAdminSessionValue,
} from "../../../../lib/admin-session";

export async function POST(req: Request) {
  const { password } = await req.json();

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "Admin password is not configured" },
      { status: 500 }
    );
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "Invalid password" },
      { status: 401 }
    );
  }

  const res = NextResponse.json({ success: true });
  const sessionValue = await createAdminSessionValue();

  res.cookies.set("admin_auth", sessionValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: adminSessionMaxAgeSeconds,
  });

  return res;
}
