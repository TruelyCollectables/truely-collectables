import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  LEGACY_ADMIN_SESSION_COOKIE_NAME,
  adminSessionCookieOptions,
  createAdminSessionValue,
  expiredAdminSessionCookieOptions,
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
        code:
          loginCheck.reason === "locked_out" ||
          loginCheck.reason === "too_many_failed_attempts"
            ? "admin_locked_out"
            : "admin_blocked",
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
      {
        success: false,
        code: "admin_password_missing",
        error: "Admin password is not configured. Set ADMIN_PASSWORD and restart the server.",
      },
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
        code: "invalid_admin_password",
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

  res.cookies.set(
    LEGACY_ADMIN_SESSION_COOKIE_NAME,
    "",
    expiredAdminSessionCookieOptions(),
  );
  res.cookies.set(
    ADMIN_SESSION_COOKIE_NAME,
    sessionValue,
    adminSessionCookieOptions(),
  );

  return res;
}
