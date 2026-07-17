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
    return "Too many failed login attempts. Try again shortly.";
  }

  if (errorCode === "blocked") {
    return "Admin login is blocked from this client.";
  }

  if (errorCode === "missing_password") {
    return "Admin password is not configured. Set ADMIN_PASSWORD and restart the server.";
  }

  if (errorCode === "invalid") {
    return "Invalid admin password.";
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="rounded-md border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase text-neutral-500">
          TCOS Admin
        </p>
        <h1 className="mt-2 text-3xl font-black">Admin Login</h1>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          Native login mode is active so the browser accepts the admin cookie
          during a full-page submit.
        </p>

        <form
          action={`/api/admin/login?next=${encodeURIComponent(nextPath)}`}
          method="post"
          className="mt-6 space-y-4"
        >
          <input type="hidden" name="next" value={nextPath} />
          <label className="block">
            <span className="text-sm font-bold text-neutral-700">Password</span>
            <input
              type="password"
              name="password"
              placeholder="Admin password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded border border-neutral-300 px-3 py-3"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800"
          >
            Login
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
