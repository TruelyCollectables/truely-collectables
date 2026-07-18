import AdminSubmitButton from "../AdminSubmitButton";

function safeNextPath(value: string | string[] | undefined) {
  const nextPath = Array.isArray(value) ? value[0] : value;

  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
    return nextPath;
  }

  return "/admin";
}

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
  const nextPath = safeNextPath(params.next);
  const error = loginErrorMessage(params.error);
  const localDevelopmentLoginAvailable = process.env.NODE_ENV !== "production";
  const adminPasswordConfigured = Boolean(process.env.ADMIN_PASSWORD);

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-12 text-neutral-950">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl items-center">
        <section className="grid w-full overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-xl lg:grid-cols-[0.95fr_1.05fr]">
          <div className="bg-[#101418] p-8 text-white lg:p-10">
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
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Password source
                </dt>
                <dd className="mt-1 font-black">
                  {adminPasswordConfigured
                    ? "ADMIN_PASSWORD is configured"
                    : "ADMIN_PASSWORD missing in process env"}
                </dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Destination
                </dt>
                <dd className="mt-1 break-all font-black">{nextPath}</dd>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <dt className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                  Copy/paste guard
                </dt>
                <dd className="mt-1 font-black">
                  Leading/trailing pasted spaces are ignored server-side.
                </dd>
              </div>
            </dl>
          </div>

          <div className="p-8 lg:p-10">
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
                  className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold outline-none focus:border-neutral-950"
                />
              </label>

              <AdminSubmitButton
                className="w-full rounded-2xl bg-neutral-950 px-4 py-3 font-black text-white hover:bg-neutral-800"
                pendingChildren="Signing in..."
              >
                Login
              </AdminSubmitButton>
            </form>

            {error ? (
              <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900">
                {error}
              </p>
            ) : null}

            {!adminPasswordConfigured ? (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950">
                This process does not expose ADMIN_PASSWORD. In local
                development, TCOS will also check .env.local and
                .env.development.local.
              </p>
            ) : null}

            {localDevelopmentLoginAvailable ? (
              <form
                action={`/api/admin/login?next=${encodeURIComponent(nextPath)}`}
                method="post"
                className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"
              >
                <input type="hidden" name="next" value={nextPath} />
                <input type="hidden" name="localDevelopmentLogin" value="1" />
                <AdminSubmitButton
                  className="w-full rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-black text-amber-950 hover:bg-amber-100"
                  pendingChildren="Opening admin..."
                >
                  Open Admin Locally
                </AdminSubmitButton>
                <p className="mt-2 text-xs font-semibold leading-5 text-amber-950">
                  Localhost-only rescue button. Disabled in production and
                  rejected for non-local hosts.
                </p>
              </form>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
