import Link from "next/link";
import AdminSubmitButton from "../AdminSubmitButton";
import { safeAdminLoginNextPath } from "../../../lib/admin-login-destination";

function resetErrorMessage(value: string | string[] | undefined) {
  const code = Array.isArray(value) ? value[0] : value;
  if (code === "mismatch") return "The two password entries did not match.";
  if (code === "policy") return "Use at least 12 characters for the new password.";
  if (code === "storage_error") {
    return "The private credential store was unavailable. Try the reset link again in a moment.";
  }
  if (code === "invalid") {
    return "This reset link is invalid, expired, or has already been used. Request a new link from the admin login page.";
  }
  return "";
}

export default async function AdminResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenValue = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = String(tokenValue || "").trim();
  const nextPath = safeAdminLoginNextPath(params.next);
  const error = resetErrorMessage(params.error);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl items-center">
        <section className="w-full rounded-[2rem] border border-neutral-200 bg-white/95 p-8 shadow-2xl shadow-neutral-950/10 ring-1 ring-black/[0.02] lg:p-10">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">
            TCOS Owner Recovery
          </p>
          <h1 className="mt-3 text-3xl font-black tracking-tight">
            Choose a permanent admin password
          </h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-neutral-600">
            This password is stored as a private database hash. Vercel deployments,
            environment refreshes, and code releases cannot replace it.
          </p>

          {token ? (
            <form
              action="/api/admin/password-reset/confirm"
              method="post"
              className="mt-7 space-y-4"
            >
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="next" value={nextPath} />
              <label className="block">
                <span className="text-sm font-black text-neutral-700">
                  New password
                </span>
                <input
                  type="password"
                  name="password"
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                  autoFocus
                  className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold shadow-inner outline-none focus:border-neutral-950 focus:ring-4 focus:ring-black/10"
                />
              </label>
              <label className="block">
                <span className="text-sm font-black text-neutral-700">
                  Confirm new password
                </span>
                <input
                  type="password"
                  name="confirmation"
                  minLength={12}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                  className="mt-1 w-full rounded-2xl border border-neutral-300 px-4 py-3 font-semibold shadow-inner outline-none focus:border-neutral-950 focus:ring-4 focus:ring-black/10"
                />
              </label>
              <AdminSubmitButton
                className="w-full rounded-2xl bg-neutral-950 px-4 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800"
                pendingChildren="Saving permanent password..."
              >
                Save Password and Open Admin
              </AdminSubmitButton>
            </form>
          ) : (
            <p className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950">
              No reset token was provided. Request a fresh owner reset link from the
              admin login page.
            </p>
          )}

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-black text-rose-900">
              {error}
            </p>
          ) : null}

          <p className="mt-6 text-center text-sm font-bold text-neutral-600">
            <Link className="underline" href={`/admin/login?next=${encodeURIComponent(nextPath)}`}>
              Return to admin login
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
