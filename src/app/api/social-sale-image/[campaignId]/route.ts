import React from "react";
import { ImageResponse } from "next/og";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

function shortDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Denver",
  }).format(date);
}

function scopeLabel(scopeType: string, scope: Record<string, unknown>) {
  if (scopeType === "all") return "SITEWIDE SALE";
  if (scopeType === "products") {
    const count = Array.isArray(scope.productIds) ? scope.productIds.length : 0;
    return count ? `${count} SELECT ITEMS` : "SELECT ITEMS";
  }
  const sections = Array.isArray(scope.sections)
    ? scope.sections.map(String).filter(Boolean)
    : [];
  if (sections.length === 1) return `${sections[0].toUpperCase()} SALE`;
  return "SELECT INVENTORY";
}

function text(value: unknown, size: number, weight = 800, color = "#0a0a0a") {
  return React.createElement(
    "div",
    { style: { fontSize: size, fontWeight: weight, color, textAlign: "center" as const, lineHeight: 1.05 } },
    String(value),
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await context.params;
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("store_sales_campaigns")
    .select("id,name,percent_off,scope_type,scope,ends_at")
    .eq("store_id", getActiveStoreId())
    .eq("id", campaignId)
    .maybeSingle();

  if (error || !data) {
    return new Response("Sale graphic not found", {
      status: 404,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  const scope = data.scope && typeof data.scope === "object"
    ? (data.scope as Record<string, unknown>)
    : {};
  const saleScope = scopeLabel(String(data.scope_type || "all"), scope);
  const end = shortDate(data.ends_at ? String(data.ends_at) : null);
  const subtitle = end ? `${saleScope} • ENDS ${end.toUpperCase()}` : saleScope;

  const card = React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#ffffff",
        border: "54px solid #0a0a0a",
        padding: "32px 56px 70px",
        fontFamily: "sans-serif",
      },
    },
    React.createElement(
      "div",
      {
        style: {
          width: "100%",
          height: 190,
          borderRadius: 28,
          background: "#b91c1c",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      text("TRUELY COLLECTABLES", 38, 900, "#ffffff"),
      React.createElement("div", { style: { height: 14 } }),
      text(saleScope, 24, 800, "#fee2e2"),
    ),
    React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center" } },
      text(`${Number(data.percent_off)}%`, 184, 900, "#b91c1c"),
      text("OFF", 72, 900),
    ),
    React.createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: 1000 } },
      text(String(data.name || "Store Sale").slice(0, 40), 52, 900),
      React.createElement("div", { style: { height: 28 } }),
      text(subtitle, 30, 800, "#525252"),
    ),
    React.createElement(
      "div",
      {
        style: {
          width: 700,
          height: 110,
          borderRadius: 55,
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        },
      },
      text("SHOP THE SALE", 35, 900, "#ffffff"),
    ),
    text("TRUELYCOLLECTABLES.COM", 28, 800, "#737373"),
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 1200,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "content-type": "image/png",
    },
  });
}
