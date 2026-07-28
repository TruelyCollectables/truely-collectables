import AdminSubmitButton from "../AdminSubmitButton";
import { getDatabaseAdminCredentialStatus } from "../../../lib/admin-credentials";
import { safeAdminLoginNextPath } from "../../../lib/admin-login-destination";

function resetStatusMessage(code: string | string[] | undefined) {
  const resetCode = Array.isArray(code) ? code[0] : code;
  if (resetCode === "sent") {
    return {
      tone: "success" as const,
      message:
        "A one-time password reset link was sent to the private owner recovery email. Check the inbox and spam folder.",
    };
  }
  if (resetCode === "email_error") {
    return {
      tone: "error" as const,
      message:
        "The reset request was saved, but the recovery email could not be delivered. Check the Resend configuration.",
    };
  }
  if (resetCode === "storage_error") {
    return {
      tone: "error" as const,
      message:
        "The private database credential store was unavailable. Try again in a moment.",
    };
  }
  return null;
}

function loginErrorMessage(code: string | string[] | undefined) {
  const errorCode = Array.isArray(code) ? code[0] : code;

  if (errorCode === "locked") {
    return "Too many failed attempts were recorded. Stop retrying unknown passwords and use the owner reset link below.";
  }

  if (errorCode === "blocked") {
    return "Admin login is blocked from this client.";
  }

  if (errorCode === "missing_password") {
    return "No permanent database password or emergency fallback is configured. Use the owner reset link below.";
  }

  if (errorCode === "session_error") {
    return "The password was accepted, but the secure admin session could not be created. Try again or use the owner reset link.";
  }

  if (errorCode === "invalid") {
    return "Invalid admin password. Stop guessing and use the owner reset link below to set a permanent password.";
  }

  if (errorCode === "bad_request") {
    return "Admin login request was not readable. Refresh and try again.";
  }

  return "";
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const nextPath = safeAdminLoginNextPath(params.next);
  const error = loginErrorMessage(params.error);
  const resetStatus = resetStatusMessage(params.reset);
  const localDevelopmentLoginAvailable = process.env.NODE_ENV !== "production";
  const databaseCredential = await getDatabaseAdminCredentialStatus();
  const emergencyPasswordConfigured = Boolean(process.env.ADMIN_PASSWORD);
  const adminPasswordConfigured =
    databaseCredential.configured || emergencyPasswordConfigured;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1120px] items-center">
        <section className="grid w-full overflow-hidden rounded-[2rem] border border-neutral-200 bg-white/95 shadow-2xl shadow-neutral-950/10 ring-1 ring-black/[0.02] lg:grid-cols-[0.95fr_1.05fr]">
          <div className="bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.24),_transparent_34%),linear-gradient(135deg,_#111827,_#050505)] p-8 text-white lg:p-10">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              TCOS Admin
            </p>
            <h1 className="mt-4 text-4xl font-black tracking-tight">
              Admin Login
            </h1>
            <p className="mt-4 text-sm font-semibold leading-6 text-neutral-300">
              Sign in with the permanent owner password stored in the private TCOS
              database. Once created, Vercel deployments cannot replace it.
            </p>

            <dl className="mt-8 space-y-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Password source
                </dt>
                <dd className="mt-1 font-black">
                  {databaseCredential.configured
                    ? "Permanent database owner password configured"
                    : emergencyPasswordConfigured
                      ? "Temporary Vercel fallback configured"
                      : "No owner password configured"}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Destination
                </dt>
                <dd className="mt-1 break-all font-black">{nextPath}</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Copy/paste guard
                </dt>
                <dd className="mt-1 font-black">
                  Leading/trailing pasted spaces are ignored server-side.
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white/95 p-8 lg:p-10">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-neutral-500">
              Secure owner entry
            </p>
            <h2 className="mt-2 text-2xl font-black">Enter admin password</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              Do not keep guessing an uncertain password. Use the private owner reset
              link below and create one permanent password.
            </p>

            <form
              action={`/api/admin/login?next=${encodeURIComponent(nextPath)}`}
              method="post"
              className="mt-6 space-y-4"
            >
              <input type="hidden" name="next" value={nextPath} />
              <label className="block">
                <span className="text-sm font-black text-neutral-700">
                  Password
                </span>
                <input
                  type="password"
                  name="password"
                  placeholder="Admin password"
                  autoComplete="current-password"
                  required
                  autoFocus
                  className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold shadow-inner outline-none focus:border-neutral-950 focus:ring-4 focus:ring-black/10"
                />
              </label>

              <AdminSubmitButton
                className="w-full rounded-2xl bg-neutral-950 px-4 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800"
                pendingChildren="Signing in..."
                title="Submit the permanent database owner password and create the admin session cookie for this browser."
              >
                Login
              </AdminSubmitButton>
              <p className="text-xs font-bold leading-5 text-neutral-500">
                Once the permanent database password exists, deployments cannot replace
                it. If the password is uncertain, reset it instead of retrying guesses.
              </p>
            </form>

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
                The link expires in 30 minutes. The new password is stored privately in
                the database and survives every deployment.
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
              <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900 shadow-sm ring-1 ring-rose-950/5">
                {error}
              </p>
            ) : null}

            {!adminPasswordConfigured ? (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950 shadow-sm ring-1 ring-amber-950/5">
                No permanent database password or emergency fallback is configured. Use
                the owner reset link to create the durable password.
              </p>
            ) : null}

            {localDevelopmentLoginAvailable ? (
              <form
                action={`/api/admin/login?next=${encodeURIComponent(nextPath)}`}
                method="post"
                className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm ring-1 ring-amber-950/5"
              >
                <input type="hidden" name="next" value={nextPath} />
                <input type="hidden" name="localDevelopmentLogin" value="1" />
                <AdminSubmitButton
                  className="w-full rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-black text-amber-950 shadow-sm transition hover:bg-amber-100"
                  pendingChildren="Opening admin..."
                  title="Open the admin locally without the password box; this route is accepted only on localhost in non-production."
                >
                  Open Admin Locally
                </AdminSubmitButton>
                <p className="mt-2 text-xs font-semibold leading-5 text-amber-950">
                  Localhost-only rescue button. It does not use the typed password field.
                  Disabled in production and rejected for non-local hosts.
                </p>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
