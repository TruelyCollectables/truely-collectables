import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
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

const LOCAL_ADMIN_PASSWORD_FILES = [".env.development.local", ".env.local"];

type LoginPayload = {
  password: string;
  nextPath: string;
  wantsRedirect: boolean;
  readable: boolean;
  localDevelopmentLogin: boolean;
};

function safeNextPath(value: FormDataEntryValue | string | null | undefined) {
  const nextPath = String(value || "");

  if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    return nextPath;
  }

  return "/admin";
}

function isLocalDevelopmentAdminHost(hostname: string) {
  return (
    process.env.NODE_ENV !== "production" &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1")
  );
}

function unquoteEnvValue(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function adminPasswordFromEnvFile(contents: string) {
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*ADMIN_PASSWORD\s*=\s*(.*)\s*$/.exec(line);

    if (match) {
      return unquoteEnvValue(match[1] || "");
    }
  }

  return "";
}

function safeTextEqual(left: string, right: string) {
  const leftValue = new TextEncoder().encode(left);
  const rightValue = new TextEncoder().encode(right);
  const length = Math.max(leftValue.length, rightValue.length);
  let mismatch = leftValue.length ^ rightValue.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftValue[index] ?? 0) ^ (rightValue[index] ?? 0);
  }

  return mismatch === 0;
}

async function verifyLocalDevelopmentAdminPassword(
  password: string,
  hostname: string,
) {
  if (!isLocalDevelopmentAdminHost(hostname)) return false;

  const configuredPasswords = new Set<string>();

  for (const fileName of LOCAL_ADMIN_PASSWORD_FILES) {
    try {
      const contents = await readFile(`${process.cwd()}/${fileName}`, "utf8");
      const configuredPassword = adminPasswordFromEnvFile(contents);

      if (configuredPassword) {
        configuredPasswords.add(configuredPassword);
      }
    } catch {
      // Local development convenience only; missing files should not block login.
    }
  }

  for (const configuredPassword of configuredPasswords) {
    if (safeTextEqual(password.trim(), configuredPassword.trim())) {
      return true;
    }
  }

  return false;
}

async function verifySubmittedAdminPassword(password: string, hostname: string) {
  if (await verifyAdminPassword(password)) {
    return true;
  }

  const trimmedPassword = password.trim();

  if (trimmedPassword !== password && (await verifyAdminPassword(trimmedPassword))) {
    return true;
  }

  return verifyLocalDevelopmentAdminPassword(password, hostname);
}

function loginRedirect(req: Request, code: string, nextPath?: string) {
  const url = new URL("/admin/login", requestOrigin(req));
  const redirectNextPath =
    nextPath || safeNextPath(new URL(req.url).searchParams.get("next"));

  url.searchParams.set("next", redirectNextPath);
  url.searchParams.set("error", code);

  return NextResponse.redirect(url, 303);
}

function jsonBodyNextPath(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;

  const record = body as Record<string, unknown>;

  return safeNextPath(
    typeof record.next === "string"
      ? record.next
      : typeof record.nextPath === "string"
      ? record.nextPath
      : fallback,
  );
}

async function readLoginPayload(req: Request): Promise<LoginPayload> {
  const contentType = req.headers.get("content-type") || "";
  const requestUrl = new URL(req.url);

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const queryNextPath = safeNextPath(requestUrl.searchParams.get("next"));

    return {
      password:
        body && typeof body === "object" && "password" in body
          ? String((body as { password?: unknown }).password || "")
          : "",
      nextPath: jsonBodyNextPath(body, queryNextPath),
      wantsRedirect: false,
      readable: Boolean(body),
      localDevelopmentLogin: false,
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
    localDevelopmentLogin: formData?.get("localDevelopmentLogin") === "1",
  };
}

export async function POST(req: Request) {
  const loginPayload = await readLoginPayload(req);
  const hostname = requestHostname(req);
  const loginCheck = await checkAdminLoginAllowed(req);
  const isSoftLockout =
    loginCheck.reason === "locked_out" ||
    loginCheck.reason === "too_many_failed_attempts";
  const isLocalDevelopmentLogin =
    loginPayload.localDevelopmentLogin &&
    isLocalDevelopmentAdminHost(hostname);
  const canUseLocalDevelopmentPasswordFile =
    isLocalDevelopmentAdminHost(hostname);

  if (!loginPayload.readable) {
    if (loginPayload.wantsRedirect) {
      return loginRedirect(req, "bad_request", loginPayload.nextPath);
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

  if (!loginCheck.allowed && !isSoftLockout) {
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
        loginPayload.nextPath,
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

  if (
    !process.env.ADMIN_PASSWORD &&
    !isLocalDevelopmentLogin &&
    !canUseLocalDevelopmentPasswordFile
  ) {
    if (loginPayload.wantsRedirect) {
      return loginRedirect(req, "missing_password", loginPayload.nextPath);
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

  const isValidPassword =
    isLocalDevelopmentLogin ||
    (await verifySubmittedAdminPassword(loginPayload.password, hostname));

  if (!isValidPassword) {
    await recordAdminLoginAttempt({
      check: loginCheck,
      success: false,
      failureReason: "invalid_password",
    });

    if (loginPayload.wantsRedirect) {
      return loginRedirect(
        req,
        isSoftLockout ? "locked" : "invalid",
        loginPayload.nextPath,
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: isSoftLockout ? "admin_locked_out" : "invalid_admin_password",
        error: isSoftLockout
          ? "Too many failed login attempts. Enter the correct admin password to unlock this session."
          : "Invalid password",
        retryAfterSeconds: isSoftLockout
          ? loginCheck.retryAfterSeconds
          : undefined,
        attemptsRemaining: isSoftLockout
          ? 0
          : Math.max(
              loginCheck.maxFailedAttempts - loginCheck.failedAttempts - 1,
              0,
            ),
      },
      { status: isSoftLockout ? 429 : 401 }
    );
  }

  let sessionValue: string;

  try {
    sessionValue = await createAdminSessionValue();
  } catch (error) {
    console.error("Admin session creation failed after password verification:", error);

    if (loginPayload.wantsRedirect) {
      const sessionErrorResponse = loginRedirect(
        req,
        "session_error",
        loginPayload.nextPath,
      );

      appendExpiredAdminSessionCookies(sessionErrorResponse.headers, hostname);

      return sessionErrorResponse;
    }

    const sessionErrorResponse = NextResponse.json(
      {
        success: false,
        code: "admin_session_not_created",
        error:
          "Admin password was accepted, but the server could not create an admin session. Set ADMIN_SESSION_SECRET or ADMIN_PASSWORD and restart the server.",
      },
      { status: 500 },
    );

    appendExpiredAdminSessionCookies(sessionErrorResponse.headers, hostname);

    return sessionErrorResponse;
  }

  const res = loginPayload.wantsRedirect
    ? NextResponse.redirect(new URL(loginPayload.nextPath, requestOrigin(req)), 303)
    : NextResponse.json({ success: true, nextPath: loginPayload.nextPath });

  await recordAdminLoginAttempt({
    check: loginCheck,
    success: true,
  });

  appendExpiredAdminSessionCookies(res.headers, hostname);
  appendAdminSessionCookies(res.headers, hostname, sessionValue);

  return res;
}
