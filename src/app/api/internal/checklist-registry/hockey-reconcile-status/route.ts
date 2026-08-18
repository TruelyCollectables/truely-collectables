import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const UPPER_DECK_INGEST_REVISION = "2026-08-18-hockey-context-v1";
const MIN_START_YEAR = 2021;

type CatalogRow = {
  source_url: string | null;
  status: string | null;
  sport: string | null;
  release_name: string | null;
  last_checked_at: string | null;
  imported_at: string | null;
  metadata: unknown;
  issue_summary: unknown;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Checklist Registry production credentials are unavailable.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function startYear(row: CatalogRow) {
  const metadata = metadataRecord(row.metadata);
  for (const value of [metadata?.season, metadata?.releaseYear, row.release_name, row.source_url]) {
    const match = String(value || "").match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function countBy(rows: CatalogRow[], key: "status" | "sport") {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = String(row[key] || "unknown");
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

export async function GET() {
  try {
    const db = serviceClient();
    const rows: CatalogRow[] = [];
    const pageSize = 1000;

    for (let start = 0; start < 5000; start += pageSize) {
      const { data, error } = await db
        .from("checklist_source_catalog")
        .select("source_url,status,sport,release_name,last_checked_at,imported_at,metadata,issue_summary")
        .eq("manufacturer", "Upper Deck")
        .range(start, start + pageSize - 1);
      if (error) throw error;
      const page = (data || []) as CatalogRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    const modern = rows.filter((row) => (startYear(row) ?? 0) >= MIN_START_YEAR);
    const currentRevision = modern.filter((row) => {
      const metadata = metadataRecord(row.metadata);
      return metadata?.ingestRevision === UPPER_DECK_INGEST_REVISION;
    });
    const currentHockey = currentRevision.filter((row) => row.sport === "Hockey");
    const unresolved = currentRevision
      .filter((row) => !["imported", "unchanged"].includes(String(row.status || "")))
      .slice(0, 50)
      .map((row) => ({
        sourceUrl: row.source_url,
        releaseName: row.release_name,
        status: row.status,
        sport: row.sport,
        lastCheckedAt: row.last_checked_at,
        issueSummary: row.issue_summary,
      }));
    const checkedTimes = currentRevision
      .map((row) => Date.parse(row.last_checked_at || ""))
      .filter(Number.isFinite);

    return NextResponse.json(
      {
        ok: true,
        ingestRevision: UPPER_DECK_INGEST_REVISION,
        generatedAt: new Date().toISOString(),
        upperDeck2021PlusCatalogRows: modern.length,
        currentRevisionRows: currentRevision.length,
        currentRevisionHockeyRows: currentHockey.length,
        statusCounts: countBy(currentRevision, "status"),
        sportCounts: countBy(currentRevision, "sport"),
        unresolvedCount: unresolved.length,
        unresolved,
        latestCheckedAt: checkedTimes.length
          ? new Date(Math.max(...checkedTimes)).toISOString()
          : null,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        ingestRevision: UPPER_DECK_INGEST_REVISION,
        error: error instanceof Error ? error.message : "Hockey reconcile status failed.",
      },
      { status: 500 },
    );
  }
}
