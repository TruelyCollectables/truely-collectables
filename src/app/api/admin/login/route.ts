import { NextResponse } from "next/server";
import {
  appendAdminSessionCookies,
  appendExpiredAdminSessionCookies,
  createAdminSessionValue,
  verifyAdminPassword,
} from "../../../../lib/admin-session";
import {
  checkAdminLoginAllowed,
  recordAdminLoginAttempt,
} from "../../../../lib/admin-login-security";
import { requestHostname, requestOrigin } from "../../../../lib/request-origin";

type LoginPayload = {
  password: string;
  nextPath: string;
  wantsRedirect: boolean;
  readable: boolean;
};

function safeNextPath(value: FormDataEntryValue | string | null | undefined) {
  const nextPath = String(value || "");

  if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    return nextPath;
  }

  return "/admin";
}

function loginRedirect(req: Request, code: string) {
  const url = new URL("/admin/login", requestOrigin(req));
  const nextPath = safeNextPath(new URL(req.url).searchParams.get("next"));

  url.searchParams.set("next", nextPath);
  url.searchParams.set("error", code);

  return NextResponse.redirect(url, 303);
}

async function readLoginPayload(req: Request): Promise<LoginPayload> {
  const contentType = req.headers.get("content-type") || "";
  const requestUrl = new URL(req.url);

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);

    return {
      password:
        body && typeof body === "object" && "password" in body
          ? String((body as { password?: unknown }).password || "")
          : "",
      nextPath: safeNextPath(requestUrl.searchParams.get("next")),
      wantsRedirect: false,
      readable: Boolean(body),
    };
  }

  const formData = await req.formData().catch(() => null);

  return {
    password: formData ? String(formData.get("password") || "") : "",
    nextPath: safeNextPath(
      formData?.get("next") || requestUrl.searchParams.get("next"),
    ),
    wantsRedirect: true,
    readable: Boolean(formData),
  };
}

export async function POST(req: Request) {
  const loginPayload = await readLoginPayload(req);
  const hostname = requestHostname(req);
  const loginCheck = await checkAdminLoginAllowed(req);

  if (!loginPayload.readable) {
    if (loginPayload.wantsRedirect) {
      return loginRedirect(req, "bad_request");
    }

    return NextResponse.json(
      {
        success: false,
        code: "bad_admin_login_request",
        error: "Admin login request was not readable.",
      },
      { status: 400 },
    );
  }

  if (!loginCheck.allowed) {
    await recordAdminLoginAttempt({
      check: loginCheck,
      success: false,
      failureReason: loginCheck.reason || "blocked",
    });

    if (loginPayload.wantsRedirect) {
      return loginRedirect(
        req,
        loginCheck.reason === "locked_out" ||
          loginCheck.reason === "too_many_failed_attempts"
          ? "locked"
          : "blocked",
      );
    }

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
    if (loginPayload.wantsRedirect) {
      return loginRedirect(req, "missing_password");
    }

    return NextResponse.json(
      {
        success: false,
        code: "admin_password_missing",
        error: "Admin password is not configured. Set ADMIN_PASSWORD and restart the server.",
      },
      { status: 500 }
    );
  }

  const isValidPassword = await verifyAdminPassword(loginPayload.password);

  if (!isValidPassword) {
    await recordAdminLoginAttempt({
      check: loginCheck,
      success: false,
      failureReason: "invalid_password",
    });

    if (loginPayload.wantsRedirect) {
      return loginRedirect(req, "invalid");
    }

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

  const res = loginPayload.wantsRedirect
    ? NextResponse.redirect(new URL(loginPayload.nextPath, requestOrigin(req)), 303)
    : NextResponse.json({ success: true });
  const sessionValue = await createAdminSessionValue();

  appendExpiredAdminSessionCookies(res.headers, hostname);
  appendAdminSessionCookies(res.headers, hostname, sessionValue);

  return res;
}
