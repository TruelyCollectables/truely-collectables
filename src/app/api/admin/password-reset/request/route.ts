import { NextResponse } from "next/server";
import { createAdminPasswordReset } from "../../../../../lib/admin-credentials";
import { safeAdminLoginNextPath } from "../../../../../lib/admin-login-destination";
import { requestOrigin } from "../../../../../lib/request-origin";
import { getStoreSettings } from "../../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToLogin(req: Request, status: string, nextPath: string) {
  const url = new URL("/admin/login", requestOrigin(req));
  url.searchParams.set("next", nextPath);
  url.searchParams.set("reset", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const formData = await req.formData().catch(() => null);
  const nextPath = safeAdminLoginNextPath(
    formData?.get("next") || new URL(req.url).searchParams.get("next"),
  );

  try {
    const reset = await createAdminPasswordReset();
    if (reset.suppressed || !reset.token) {
      return redirectToLogin(req, "sent", nextPath);
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("Admin password reset email failed: RESEND_API_KEY is missing.");
      return redirectToLogin(req, "email_error", nextPath);
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const settings = await getStoreSettings(supabase, getActiveStoreId());
    const resetUrl = new URL("/admin/reset-password", requestOrigin(req));
    resetUrl.searchParams.set("token", reset.token);
    resetUrl.searchParams.set("next", nextPath);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `admin-password-reset/${reset.token.slice(0, 24)}`,
      },
      body: JSON.stringify({
        from: settings.orderFromEmail,
        to: reset.email,
        subject: `${settings.displayName} admin password reset`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:620px;margin:0 auto;"><h1>Reset the admin password</h1><p>A password reset was requested for the private ${settings.displayName} administrator account.</p><p><a href="${resetUrl.toString()}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:8px;font-weight:700;">Choose a new admin password</a></p><p>This link expires in 30 minutes and can be used only once.</p><p>If you did not request this, ignore this email.</p></div>`,
        text: `Reset the ${settings.displayName} admin password:\n\n${resetUrl.toString()}\n\nThis link expires in 30 minutes and can be used only once.`,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.id) {
      console.error(
        "Admin password reset email failed:",
        result?.message || result?.error || `Resend returned ${response.status}.`,
      );
      return redirectToLogin(req, "email_error", nextPath);
    }

    return redirectToLogin(req, "sent", nextPath);
  } catch (error) {
    console.error("Admin password reset request failed:", error);
    return redirectToLogin(req, "storage_error", nextPath);
  }
}
