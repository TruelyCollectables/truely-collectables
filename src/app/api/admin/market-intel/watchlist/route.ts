import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

function numberField(formData: FormData, name: string, fallback: number) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const handoff = adminHandoffFromUrl(url);

  try {
    const formData = await request.formData();
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2) throw new Error("Player name is required.");

    const priority = Math.round(numberField(formData, "priority", 50));
    const minimumDiscountPct = numberField(formData, "minimumDiscountPct", 20);
    const minimumNetProfit = numberField(formData, "minimumNetProfit", 15);

    if (priority < 0 || priority > 100) {
      throw new Error("Priority must be between 0 and 100.");
    }
    if (minimumDiscountPct < 0 || minimumNetProfit < 0) {
      throw new Error("Deal thresholds cannot be negative.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: existingSubject, error: subjectLookupError } = await supabase
      .from("tcos_mi_subjects")
      .select("id")
      .eq("subject_type", "player")
      .ilike("name", name)
      .limit(1)
      .maybeSingle();

    if (subjectLookupError) throw new Error(subjectLookupError.message);

    let subjectId = existingSubject?.id as string | undefined;
    const subjectPayload = {
      subject_type: "player",
      name,
      sport_or_category:
        String(formData.get("sportOrCategory") ?? "").trim() || null,
      league_or_brand:
        String(formData.get("leagueOrBrand") ?? "").trim() || null,
      team_or_affiliation:
        String(formData.get("teamOrAffiliation") ?? "").trim() || null,
      priority,
      active: true,
      notes: String(formData.get("notes") ?? "").trim() || null,
    };

    if (subjectId) {
      const { error } = await supabase
        .from("tcos_mi_subjects")
        .update(subjectPayload)
        .eq("id", subjectId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase
        .from("tcos_mi_subjects")
        .insert(subjectPayload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      subjectId = data.id;
    }

    const { data: existingWatch, error: watchLookupError } = await supabase
      .from("tcos_mi_watchlist")
      .select("id")
      .eq("subject_id", subjectId)
      .is("collectible_identity_id", null)
      .limit(1)
      .maybeSingle();

    if (watchLookupError) throw new Error(watchLookupError.message);

    const watchPayload = {
      subject_id: subjectId,
      collectible_identity_id: null,
      priority,
      minimum_discount_pct: minimumDiscountPct,
      minimum_estimated_net_profit: minimumNetProfit,
      include_raw: formData.get("includeRaw") === "on",
      include_graded: formData.get("includeGraded") === "on",
      include_lots: formData.get("includeLots") === "on",
      active: true,
      notes: String(formData.get("notes") ?? "").trim() || null,
    };

    const writeResult = existingWatch?.id
      ? await supabase
          .from("tcos_mi_watchlist")
          .update(watchPayload)
          .eq("id", existingWatch.id)
      : await supabase.from("tcos_mi_watchlist").insert(watchPayload);

    if (writeResult.error) throw new Error(writeResult.error.message);

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/watchlist?saved=1",
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save player.";
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/watchlist?error=${encodeURIComponent(message)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
