import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../lib/admin-handoff";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

const CURRENT_RESEARCH_LIST = [
  { name: "Ivan Demidov", sport: "Hockey", league: "NHL", priority: 100 },
  { name: "Caitlin Clark", sport: "Basketball", league: "WNBA", priority: 100 },
  { name: "Paige Bueckers", sport: "Basketball", league: "WNBA", priority: 95 },
  { name: "Dominique Malonga", sport: "Basketball", league: "WNBA", priority: 80 },
  { name: "Angel Reese", sport: "Basketball", league: "WNBA", priority: 90 },
  { name: "Cameron Brink", sport: "Basketball", league: "WNBA", priority: 85 },
  { name: "Kamilla Cardoso", sport: "Basketball", league: "WNBA", priority: 80 },
  { name: "Sonia Citron", sport: "Basketball", league: "WNBA", priority: 75 },
  { name: "Kiki Iriafen", sport: "Basketball", league: "WNBA", priority: 75 },
  { name: "Rickea Jackson", sport: "Basketball", league: "WNBA", priority: 80 },
  { name: "Kate Martin", sport: "Basketball", league: "WNBA", priority: 70 },
] as const;

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const supabase = createSupabaseServerClient({ admin: true });

    for (const target of CURRENT_RESEARCH_LIST) {
      const { data: existingSubject, error: lookupError } = await supabase
        .from("tcos_mi_subjects")
        .select("id")
        .eq("subject_type", "player")
        .ilike("name", target.name)
        .limit(1)
        .maybeSingle();

      if (lookupError) throw new Error(lookupError.message);

      let subjectId = existingSubject?.id as string | undefined;
      const subjectPayload = {
        subject_type: "player",
        name: target.name,
        sport_or_category: target.sport,
        league_or_brand: target.league,
        priority: target.priority,
        active: true,
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
        priority: target.priority,
        minimum_discount_pct: 20,
        minimum_estimated_net_profit: 15,
        include_raw: true,
        include_graded: true,
        include_lots: true,
        active: true,
        notes: "Seeded from the unified Beta One research list.",
      };

      const result = existingWatch?.id
        ? await supabase
            .from("tcos_mi_watchlist")
            .update(watchPayload)
            .eq("id", existingWatch.id)
        : await supabase.from("tcos_mi_watchlist").insert(watchPayload);

      if (result.error) throw new Error(result.error.message);
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        "/admin/market-intel/watchlist?seeded=1",
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to seed watchlist.";
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
