import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;

  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function deleteAccountRows(accountId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const cleanup = [
    await supabase.from("account_auth_events").delete().eq("account_id", accountId),
    await supabase
      .from("account_store_memberships")
      .delete()
      .eq("account_id", accountId),
    await supabase.from("account_profiles").delete().eq("id", accountId),
  ];

  return cleanup
    .map((result) => result.error?.message || null)
    .filter((message): message is string => Boolean(message));
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body.action || "");
    const supabase = createSupabaseServerClient({ admin: true });

    if (action === "create") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const password = String(body.password || "");

      if (!email.endsWith("@example.com") || password.length < 20) {
        return json(
          {
            success: false,
            error:
              "Disposable live-test users require an @example.com address and a 20+ character password.",
          },
          400,
        );
      }

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: "TCOS Buyer Session Live Test",
          tcos_account_type: "buyer",
          live_test: true,
        },
      });

      if (error || !data.user) {
        return json(
          {
            success: false,
            error: error?.message || "Disposable buyer creation failed.",
          },
          500,
        );
      }

      return json({
        success: true,
        action,
        userId: data.user.id,
        email: data.user.email,
      });
    }

    if (action === "cleanup") {
      const userId = String(body.userId || "").trim();
      if (!userId) {
        return json({ success: false, error: "userId is required." }, 400);
      }

      const rowCleanupErrors = await deleteAccountRows(userId);
      const { error } = await supabase.auth.admin.deleteUser(userId);

      if (error) {
        return json(
          {
            success: false,
            error: error.message,
            rowCleanupErrors,
          },
          500,
        );
      }

      return json({
        success: true,
        action,
        userId,
        rowCleanupErrors,
      });
    }

    return json(
      { success: false, error: "Unknown action.", allowed: ["create", "cleanup"] },
      400,
    );
  } catch (error) {
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Live test failed.",
      },
      500,
    );
  }
}
