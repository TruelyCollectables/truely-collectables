import { NextResponse } from "next/server";
import {
  isValidInstaCompServiceRequest,
  requireInstaCompJobSupabase,
} from "../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isValidInstaCompServiceRequest(request)) {
      return NextResponse.json(
        {
          ok: false,
          registryAuthenticated: false,
          error: "Valid InstaComp service authentication is required.",
        },
        { status: 401 },
      );
    }

    const supabase = requireInstaCompJobSupabase();
    const [versionsResult, cardsResult] = await Promise.all([
      supabase
        .from("checklist_versions")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true)
        .eq("status", "live"),
      supabase
        .from("checklist_cards")
        .select(
          "id,version:checklist_versions!inner(id,is_active,status)",
          { count: "exact", head: true },
        )
        .eq("version.is_active", true)
        .eq("version.status", "live"),
    ]);

    if (versionsResult.error) throw versionsResult.error;
    if (cardsResult.error) throw cardsResult.error;

    const activeLiveVersions = Number(versionsResult.count || 0);
    const activeLiveCards = Number(cardsResult.count || 0);

    return NextResponse.json(
      {
        ok: activeLiveVersions > 0 && activeLiveCards > 0,
        registryAuthenticated: true,
        activeLiveVersions,
        activeLiveCards,
        lookupScope: "all active/live checklist versions and their card rows",
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        registryAuthenticated: true,
        activeLiveVersions: 0,
        activeLiveCards: 0,
        error:
          error instanceof Error
            ? error.message
            : "Checklist coverage audit failed.",
      },
      { status: 500 },
    );
  }
}
