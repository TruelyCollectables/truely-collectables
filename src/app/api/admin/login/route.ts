import { NextResponse } from "next/server";
import {
  adminSessionMaxAgeSeconds,
  createAdminSessionValue,
  verifyAdminPassword,
} from "../../../../lib/admin-session";
import {
  checkAdminLoginAllowed,
  recordAdminLoginAttempt,
} from "../../../../lib/admin-login-security";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  const loginCheck = await checkAdminLoginAllowed(req);

  if (!loginCheck.allowed) {
    await recordAdminLoginAttempt({
      check: loginCheck,
      success: false,
      failureReason: loginCheck.reason || "blocked",
    });

    return NextResponse.json(
      {
        success: false,
        error:
          loginCheck.reason === "locked_out" ||
          loginCheck.reason === "too_many_failed_attempts"
            ? "Too many failed login attempts. Try again later."
            : "Admin login is blocked from this client.",
        retryAfterSeconds: loginCheck.retryAfterSeconds,
      },
      {
        status:
          loginCheck.reason === "locked_out" ||
          loginCheck.reason === "too_many_failed_attempts"
            ? 429
            : 403,
      },
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: "Admin password is not configured" },
      { status: 500 }
    );
  }

  const isValidPassword = await verifyAdminPassword(String(password || ""));

  if (!isValidPassword) {
    await recordAdminLoginAttempt({
      check: loginCheck,
      success: false,
      failureReason: "invalid_password",
    });

    return NextResponse.json(
      {
        success: false,
        error: "Invalid password",
        attemptsRemaining: Math.max(
          loginCheck.maxFailedAttempts - loginCheck.failedAttempts - 1,
          0,
        ),
      },
      { status: 401 }
    );
  }

  await recordAdminLoginAttempt({
    check: loginCheck,
    success: true,
  });

  const res = NextResponse.json({ success: true });
  const sessionValue = await createAdminSessionValue();

  res.cookies.set("admin_auth", sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: adminSessionMaxAgeSeconds,
  });

  return res;
}
