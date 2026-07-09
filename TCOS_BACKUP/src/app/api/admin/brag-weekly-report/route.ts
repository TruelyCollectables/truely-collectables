import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function isoDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isMissingReportTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_brag_posts") ||
    message.includes("account_brag_post_clicks") ||
    message.includes("account_brag_weekly_reports")
  );
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const periodStart = isoDaysAgo(7);
    const periodEnd = new Date().toISOString();
    const [{ data: posts, error: postsError }, { data: clicks, error: clicksError }] =
      await Promise.all([
        supabase
          .from("account_brag_posts")
          .select("id,title,share_url,click_count,created_at")
          .eq("store_id", storeId)
          .gte("created_at", periodStart)
          .lte("created_at", periodEnd)
          .order("created_at", { ascending: false }),
        supabase
          .from("account_brag_post_clicks")
          .select("id,brag_post_id,share_slug,source,referrer,created_at")
          .eq("store_id", storeId)
          .gte("created_at", periodStart)
          .lte("created_at", periodEnd)
          .order("created_at", { ascending: false }),
      ]);

    if (postsError || clicksError) {
      const error = postsError || clicksError;
      if (error && isMissingReportTables(error)) {
        return NextResponse.json(
          { error: "Collector brag reporting migration has not been applied." },
          { status: 503 },
        );
      }

      throw error;
    }

    const clickRows = clicks ?? [];
    const clickCountByPost = new Map<string, number>();

    for (const click of clickRows) {
      clickCountByPost.set(
        click.brag_post_id,
        (clickCountByPost.get(click.brag_post_id) || 0) + 1,
      );
    }

    const topPosts = (posts ?? []).map((post) => ({
      id: post.id,
      title: post.title,
      shareUrl: post.share_url,
      clicks: clickCountByPost.get(post.id) || 0,
      createdAt: post.created_at,
    }));
    const reportJson = {
      periodStart,
      periodEnd,
      postCount: posts?.length ?? 0,
      clickCount: clickRows.length,
      topPosts,
      topSources: Object.entries(
        clickRows.reduce<Record<string, number>>((acc, click) => {
          const source = click.source || "direct";
          acc[source] = (acc[source] || 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([source, count]) => ({ source, count })),
      topReferrers: Object.entries(
        clickRows.reduce<Record<string, number>>((acc, click) => {
          const referrer = click.referrer || "direct";
          acc[referrer] = (acc[referrer] || 0) + 1;
          return acc;
        }, {}),
      )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([referrer, count]) => ({ referrer, count })),
    };
    const emailTo =
      process.env.BRAG_REPORT_EMAIL ||
      process.env.TRANSACTION_EVIDENCE_EMAIL ||
      "";
    let emailedAt: string | null = null;
    let emailError: string | null = null;

    if (process.env.RESEND_API_KEY && emailTo) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const htmlRows = topPosts
          .slice(0, 20)
          .map(
            (post) => `<tr>
  <td>${escapeHtml(post.title)}</td>
  <td>${escapeHtml(post.clicks)}</td>
  <td>${escapeHtml(post.shareUrl || "")}</td>
</tr>`,
          )
          .join("");
        const sourceRows = reportJson.topSources
          .map(
            (source) => `<tr>
  <td>${escapeHtml(source.source)}</td>
  <td>${escapeHtml(source.count)}</td>
</tr>`,
          )
          .join("");

        await resend.emails.send({
          from:
            process.env.TRANSACTION_EVIDENCE_FROM ||
            "TCOS Reports <onboarding@resend.dev>",
          to: emailTo,
          subject: "TCOS weekly brag link report",
          html: `<h1>TCOS weekly brag link report</h1>
<p>Period: ${escapeHtml(dateOnly(periodStart))} through ${escapeHtml(dateOnly(periodEnd))}</p>
<p>Brag posts: ${reportJson.postCount}</p>
<p>Tracked brag-link visits: ${reportJson.clickCount}</p>
<h2>Traffic by source</h2>
<table border="1" cellpadding="6" cellspacing="0">
  <thead><tr><th>Source</th><th>Visits</th></tr></thead>
  <tbody>${sourceRows || "<tr><td colspan=\"2\">No tracked visits.</td></tr>"}</tbody>
</table>
<h2>Top brag posts</h2>
<table border="1" cellpadding="6" cellspacing="0">
  <thead><tr><th>Post</th><th>Clicks</th><th>Share URL</th></tr></thead>
  <tbody>${htmlRows || "<tr><td colspan=\"3\">No brag activity.</td></tr>"}</tbody>
</table>`,
        });

        emailedAt = new Date().toISOString();
      } catch (error: any) {
        emailError = error.message || "Email failed";
      }
    } else if (!emailTo) {
      emailError = "BRAG_REPORT_EMAIL is not configured";
    } else {
      emailError = "RESEND_API_KEY is not configured";
    }

    const { data: report, error: reportError } = await supabase
      .from("account_brag_weekly_reports")
      .insert({
        store_id: storeId,
        period_start: dateOnly(periodStart),
        period_end: dateOnly(periodEnd),
        sent_to: emailTo || null,
        post_count: reportJson.postCount,
        click_count: reportJson.clickCount,
        report_json: reportJson,
        emailed_at: emailedAt,
        email_error: emailError,
      })
      .select("*")
      .single();

    if (reportError) {
      if (isMissingReportTables(reportError)) {
        return NextResponse.json(
          { error: "Collector brag reporting migration has not been applied." },
          { status: 503 },
        );
      }

      throw reportError;
    }

    return NextResponse.json({
      success: true,
      report,
      emailed: Boolean(emailedAt),
      emailError,
      summary: reportJson,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not build brag weekly report" },
      { status: 500 },
    );
  }
}
