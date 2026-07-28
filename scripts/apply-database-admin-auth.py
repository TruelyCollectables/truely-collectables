from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_login_route() -> None:
    path = ROOT / "src/app/api/admin/login/route.ts"
    text = path.read_text(encoding="utf-8")
    import_anchor = '''import {
  appendAdminSessionCookies,
  appendExpiredAdminSessionCookies,
  createAdminSessionValue,
  verifyAdminPassword,
} from "../../../../lib/admin-session";
'''
    replacement = import_anchor + '''import {
  getDatabaseAdminCredentialStatus,
  verifyDatabaseAdminPasswordCandidates,
} from "../../../../lib/admin-credentials";
'''
    text = replace_once(text, import_anchor, replacement, "login credential import")

    old_verify = '''async function verifySubmittedAdminPassword(password: string, hostname: string) {
  if (await verifyAdminPassword(password)) {
    return true;
  }

  const trimmedPassword = password.trim();

  if (trimmedPassword !== password && (await verifyAdminPassword(trimmedPassword))) {
    return true;
  }

  return verifyLocalDevelopmentAdminPassword(password, hostname);
}
'''
    new_verify = '''async function verifySubmittedAdminPassword(password: string, hostname: string) {
  const trimmedPassword = password.trim();
  const candidates = Array.from(
    new Set([password, ...(trimmedPassword !== password ? [trimmedPassword] : [])]),
  );

  try {
    const databaseCredential = await verifyDatabaseAdminPasswordCandidates(candidates);
    if (databaseCredential.configured) {
      return databaseCredential.valid;
    }
  } catch (error) {
    console.error("Database-backed admin credential verification failed:", error);
    return false;
  }

  for (const candidate of candidates) {
    if (await verifyAdminPassword(candidate)) {
      return true;
    }
  }

  return verifyLocalDevelopmentAdminPassword(password, hostname);
}
'''
    text = replace_once(text, old_verify, new_verify, "database login verification")

    status_anchor = '''  const canUseLocalDevelopmentPasswordFile =
    isLocalDevelopmentAdminHost(hostname);
'''
    status_replacement = status_anchor + '''  const databaseCredentialStatus = await getDatabaseAdminCredentialStatus();
'''
    text = replace_once(text, status_anchor, status_replacement, "database credential status")

    old_missing = '''  if (
    !process.env.ADMIN_PASSWORD &&
    !isLocalDevelopmentLogin &&
    !canUseLocalDevelopmentPasswordFile
  ) {
'''
    new_missing = '''  if (
    !databaseCredentialStatus.configured &&
    !process.env.ADMIN_PASSWORD &&
    !isLocalDevelopmentLogin &&
    !canUseLocalDevelopmentPasswordFile
  ) {
'''
    text = replace_once(text, old_missing, new_missing, "missing credential condition")

    text = text.replace(
        '"Admin password is not configured. Set ADMIN_PASSWORD and restart the server.",',
        '"No durable database admin password or emergency ADMIN_PASSWORD fallback is configured.",',
    )
    path.write_text(text, encoding="utf-8")


def patch_login_page() -> None:
    path = ROOT / "src/app/admin/login/page.tsx"
    text = path.read_text(encoding="utf-8")
    import_anchor = 'import AdminSubmitButton from "../AdminSubmitButton";\n'
    replacement = import_anchor + 'import { getDatabaseAdminCredentialStatus } from "../../../lib/admin-credentials";\n'
    text = replace_once(text, import_anchor, replacement, "login page credential import")

    text = text.replace(
        'return "Admin password is not configured. Set ADMIN_PASSWORD and restart the server.";',
        'return "No permanent database password or emergency fallback is configured. Use the owner reset link below.";',
    )
    text = text.replace(
        'return "Admin password was accepted, but the server could not create an admin session. Set ADMIN_SESSION_SECRET or ADMIN_PASSWORD for this running server, restart it, and try again.";',
        'return "The password was accepted, but the secure admin session could not be created. Try again or use the owner reset link.";',
    )
    text = text.replace(
        'return "Invalid admin password. Confirm you are using the ADMIN_PASSWORD value for this running server.";',
        'return "Invalid admin password. Stop guessing and use the owner reset link below to set a permanent password.";',
    )

    function_anchor = '''function loginErrorMessage(code: string | string[] | undefined) {
'''
    reset_function = '''function resetStatusMessage(code: string | string[] | undefined) {
  const resetCode = Array.isArray(code) ? code[0] : code;
  if (resetCode === "sent") {
    return {
      tone: "success" as const,
      message: "A one-time password reset link was sent to the private owner recovery email. Check the inbox and spam folder.",
    };
  }
  if (resetCode === "email_error") {
    return {
      tone: "error" as const,
      message: "The reset request was saved, but the recovery email could not be delivered. Check the Resend configuration.",
    };
  }
  if (resetCode === "storage_error") {
    return {
      tone: "error" as const,
      message: "The private database credential store was unavailable. Try again in a moment.",
    };
  }
  return null;
}

'''
    text = replace_once(text, function_anchor, reset_function + function_anchor, "reset status helper")

    old_params = '''  const nextPath = safeAdminLoginNextPath(params.next);
  const error = loginErrorMessage(params.error);
  const localDevelopmentLoginAvailable = process.env.NODE_ENV !== "production";
  const adminPasswordConfigured = Boolean(process.env.ADMIN_PASSWORD);
'''
    new_params = '''  const nextPath = safeAdminLoginNextPath(params.next);
  const error = loginErrorMessage(params.error);
  const resetStatus = resetStatusMessage(params.reset);
  const localDevelopmentLoginAvailable = process.env.NODE_ENV !== "production";
  const databaseCredential = await getDatabaseAdminCredentialStatus();
  const emergencyPasswordConfigured = Boolean(process.env.ADMIN_PASSWORD);
  const adminPasswordConfigured =
    databaseCredential.configured || emergencyPasswordConfigured;
'''
    text = replace_once(text, old_params, new_params, "login page status")

    text = text.replace(
        '''               Sign in with the password configured on this running server. TCOS
               sets the native admin cookie through a full-page submit so Chrome
               accepts the session cleanly.''',
        '''               Sign in with the permanent owner password stored in the private
               TCOS database. The Vercel environment password is now only an emergency
               fallback until the permanent password is created.''',
    )

    old_source = '''                  {adminPasswordConfigured
                    ? "ADMIN_PASSWORD is configured"
                    : "ADMIN_PASSWORD missing in process env"}
'''
    new_source = '''                  {databaseCredential.configured
                    ? "Permanent database owner password configured"
                    : emergencyPasswordConfigured
                      ? "Temporary Vercel fallback configured"
                      : "No owner password configured"}
'''
    text = replace_once(text, old_source, new_source, "password source display")

    text = text.replace(
        'title="Submit the typed ADMIN_PASSWORD and create the admin session cookie for this browser."',
        'title="Submit the permanent database owner password and create the admin session cookie for this browser."',
    )
    text = text.replace(
        '''                 Uses the password box above. If accepted, TCOS refreshes the admin cookie and
                 sends this browser to the destination shown on the left.''',
        '''                 Once the permanent database password exists, Vercel deployments cannot replace it.
                 If the password is uncertain, use the reset link instead of repeatedly guessing.''',
    )

    form_end = '''            </form>

            {error ? (
'''
    recovery_form = '''            </form>

            <form
              action={`/api/admin/password-reset/request?next=${encodeURIComponent(nextPath)}`}
              method="post"
              className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm ring-1 ring-amber-950/5"
            >
              <input type="hidden" name="next" value={nextPath} />
              <AdminSubmitButton
                className="w-full rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-black text-amber-950 shadow-sm transition hover:bg-amber-100"
                pendingChildren="Sending private reset link..."
                title="Send a one-time password reset link to the private owner recovery email."
              >
                Email Owner Reset Link
              </AdminSubmitButton>
              <p className="mt-2 text-xs font-semibold leading-5 text-amber-950">
                The link expires in 30 minutes. The new password is stored privately in the database and survives deployments.
              </p>
            </form>

            {resetStatus ? (
              <p
                className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-black shadow-sm ring-1 ${
                  resetStatus.tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 ring-emerald-950/5"
                    : "border-rose-200 bg-rose-50 text-rose-900 ring-rose-950/5"
                }`}
              >
                {resetStatus.message}
              </p>
            ) : null}

            {error ? (
'''
    text = replace_once(text, form_end, recovery_form, "owner recovery form")

    text = text.replace(
        '''                 This process does not expose ADMIN_PASSWORD. In local
                 development, TCOS will also check .env.local and
                 .env.development.local.''',
        '''                 No permanent database password or emergency fallback is configured.
                 Use the owner reset link to create the durable password.''',
    )
    path.write_text(text, encoding="utf-8")


def patch_token_route() -> None:
    path = ROOT / "src/app/api/admin/market-intel/profit-hunter-token/route.ts"
    text = path.read_text(encoding="utf-8")
    old = '''  if (!(await requireAdmin(request))) {
    return response({ error: "Unauthorized" }, 401);
  }
'''
    new = '''  if (!(await requireAdmin(request))) {
    const acceptsHtml = String(request.headers.get("accept") || "").includes(
      "text/html",
    );
    if (acceptsHtml) {
      const loginUrl = new URL("/admin/login", request.nextUrl.origin);
      loginUrl.searchParams.set(
        "next",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      return NextResponse.redirect(loginUrl, 303);
    }
    return response({ error: "Unauthorized" }, 401);
  }
'''
    text = replace_once(text, old, new, "browser login redirect")
    path.write_text(text, encoding="utf-8")


def patch_reset_request_imports() -> None:
    path = ROOT / "src/app/api/admin/password-reset/request/route.ts"
    text = path.read_text(encoding="utf-8")
    text = text.replace('"../../../../../../lib/', '"../../../../../lib/')
    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_login_route()
    patch_login_page()
    patch_token_route()
    patch_reset_request_imports()


if __name__ == "__main__":
    main()
