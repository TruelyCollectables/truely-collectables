import AdminSubmitButton from "../AdminSubmitButton";
import { safeAdminLoginNextPath } from "../../../lib/admin-login-destination";

function loginErrorMessage(code: string | string[] | undefined) {
  const errorCode = Array.isArray(code) ? code[0] : code;

  if (errorCode === "locked") {
    return "Too many failed attempts were recorded. The correct admin password will unlock this session; pasted leading/trailing spaces are ignored.";
  }

  if (errorCode === "blocked") {
    return "Admin login is blocked from this client.";
  }

  if (errorCode === "missing_password") {
    return "Admin password is not configured. Set ADMIN_PASSWORD and restart the server.";
  }

  if (errorCode === "session_error") {
    return "Admin password was accepted, but the server could not create an admin session. Set ADMIN_SESSION_SECRET or ADMIN_PASSWORD for this running server, restart it, and try again.";
  }

  if (errorCode === "invalid") {
    return "Invalid admin password. Confirm you are using the ADMIN_PASSWORD value for this running server.";
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
  const localDevelopmentLoginAvailable = process.env.NODE_ENV !== "production";
  const adminPasswordConfigured = Boolean(process.env.ADMIN_PASSWORD);

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
              Sign in with the password configured on this running server. TCOS
              sets the native admin cookie through a full-page submit so Chrome
              accepts the session cleanly.
            </p>

            <dl className="mt-8 space-y-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Password source
                </dt>
                <dd className="mt-1 font-black">
                  {adminPasswordConfigured
                    ? "ADMIN_PASSWORD is configured"
                    : "ADMIN_PASSWORD missing in process env"}
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
              Secure operator entry
            </p>
            <h2 className="mt-2 text-2xl font-black">Enter admin password</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              If a bad password locks the session, enter the correct password
              here to clear the lockout and continue.
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
                title="Submit the typed ADMIN_PASSWORD and create the admin session cookie for this browser."
              >
                Login
              </AdminSubmitButton>
              <p className="text-xs font-bold leading-5 text-neutral-500">
                Uses the password box above. If accepted, TCOS refreshes the admin cookie and
                sends this browser to the destination shown on the left.
              </p>
            </form>

            {error ? (
              <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900 shadow-sm ring-1 ring-rose-950/5">
                {error}
              </p>
            ) : null}

            {!adminPasswordConfigured ? (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950 shadow-sm ring-1 ring-amber-950/5">
                This process does not expose ADMIN_PASSWORD. In local
                development, TCOS will also check .env.local and
                .env.development.local.
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
