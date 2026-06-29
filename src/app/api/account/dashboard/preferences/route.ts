import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

type PreferenceKind = "sports_favorite" | "market_watchlist";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanKey(value: unknown) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}

function cleanSymbol(value: unknown) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9._-]/g, "");
}

function isMissingDashboardTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_sports_favorites") ||
    message.includes("account_market_watchlist_items")
  );
}

function dashboardUnavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Dashboard preferences are not available until the sports/market dashboard migration is applied.",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const [sportsResult, marketResult] = await Promise.all([
      supabase
        .from("account_sports_favorites")
        .select(
          "id,favorite_type,sport_key,league_key,team_name,team_abbreviation,display_order,is_active,include_news,include_scores,include_schedule,include_odds,created_at",
        )
        .eq("store_id", storeId)
        .eq("account_id", account.id)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false }),
      supabase
        .from("account_market_watchlist_items")
        .select(
          "id,asset_type,symbol,display_name,exchange_key,display_order,is_active,include_price,include_news,include_alerts,created_at",
        )
        .eq("store_id", storeId)
        .eq("account_id", account.id)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false }),
    ]);

    if (sportsResult.error || marketResult.error) {
      const error = sportsResult.error || marketResult.error;
      if (error && isMissingDashboardTables(error)) {
        return dashboardUnavailableResponse();
      }

      throw error;
    }

    return NextResponse.json({
      success: true,
      sportsFavorites: sportsResult.data ?? [],
      marketWatchlist: marketResult.data ?? [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load dashboard preferences" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const kind = cleanText(body.kind) as PreferenceKind;
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (kind === "sports_favorite") {
      const teamName = cleanText(body.teamName);
      const sportKey = cleanKey(body.sportKey || body.sport || "sports");
      const leagueKey = cleanKey(body.leagueKey || body.league || sportKey);

      if (!teamName || !sportKey || !leagueKey) {
        return NextResponse.json(
          { error: "Sport, league, and team are required" },
          { status: 400 },
        );
      }

      const { data, error } = await supabase
        .from("account_sports_favorites")
        .insert({
          account_id: account.id,
          store_id: storeId,
          favorite_type: "team",
          sport_key: sportKey,
          league_key: leagueKey,
          team_name: teamName,
          team_abbreviation: cleanText(body.teamAbbreviation) || null,
          include_news: body.includeNews !== false,
          include_scores: body.includeScores !== false,
          include_schedule: body.includeSchedule !== false,
          include_odds: body.includeOdds === true,
        })
        .select("*")
        .single();

      if (error) {
        if (isMissingDashboardTables(error)) return dashboardUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, sportsFavorite: data });
    }

    if (kind === "market_watchlist") {
      const assetType = cleanKey(body.assetType || "stock");
      const symbol = cleanSymbol(body.symbol);

      if (!assetType || !symbol) {
        return NextResponse.json(
          { error: "Asset type and symbol are required" },
          { status: 400 },
        );
      }

      const { data, error } = await supabase
        .from("account_market_watchlist_items")
        .insert({
          account_id: account.id,
          store_id: storeId,
          asset_type: assetType,
          symbol,
          display_name: cleanText(body.displayName) || null,
          exchange_key: cleanText(body.exchangeKey) || null,
          include_price: body.includePrice !== false,
          include_news: body.includeNews !== false,
          include_alerts: body.includeAlerts === true,
        })
        .select("*")
        .single();

      if (error) {
        if (isMissingDashboardTables(error)) return dashboardUnavailableResponse();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      return NextResponse.json({ success: true, marketWatchlistItem: data });
    }

    return NextResponse.json(
      { error: "Unsupported dashboard preference type" },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not save dashboard preference" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const kind = cleanText(body.kind) as PreferenceKind;
    const id = cleanText(body.id);
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    if (!id) {
      return NextResponse.json({ error: "Preference ID is required" }, { status: 400 });
    }

    const table =
      kind === "sports_favorite"
        ? "account_sports_favorites"
        : kind === "market_watchlist"
          ? "account_market_watchlist_items"
          : null;

    if (!table) {
      return NextResponse.json(
        { error: "Unsupported dashboard preference type" },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from(table)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("account_id", account.id)
      .eq("store_id", storeId);

    if (error) {
      if (isMissingDashboardTables(error)) return dashboardUnavailableResponse();
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not remove dashboard preference" },
      { status: 500 },
    );
  }
}
