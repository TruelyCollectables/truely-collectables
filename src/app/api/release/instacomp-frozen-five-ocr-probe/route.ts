import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PLAYERS = /sonia citron|dominique malonga|paige bueckers|rickea jackson/i;
const START = "2026-08-07T19:45:00.000Z";
const END = "2026-08-07T20:20:00.000Z";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function secretMatches(provided: string, expected: string) {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sanitizeArchive(payload: any) {
  const localVision = payload?.local_vision || null;
  const suggestion = payload?.local_suggestion || null;
  const sanitizeOcr = (rows: any[]) =>
    Array.isArray(rows)
      ? rows.map((row) => ({
          text: text(row?.text),
          confidence: Number(row?.confidence ?? 0),
          side: text(row?.side),
          source: text(row?.source),
          box: row?.box || null,
        }))
      : [];
  return {
    scanId: text(payload?.scan_id),
    createdAt: payload?.created_at || null,
    status: payload?.status || null,
    checklist: payload?.checklist || null,
    localSuggestion: suggestion
      ? {
          identity: suggestion.identity || null,
          confidence: suggestion.confidence ?? null,
          evidence: suggestion.evidence || null,
          explanation: suggestion.explanation || null,
        }
      : null,
    localVision: localVision
      ? {
          identityHints: localVision.identity_hints || null,
          combinedText: text(localVision.combined_text),
          appleVisionAvailable: localVision.apple_vision_available === true,
          front: {
            ocr: sanitizeOcr(localVision.front?.ocr),
            errors: localVision.front?.errors || [],
          },
          back: localVision.back
            ? {
                ocr: sanitizeOcr(localVision.back?.ocr),
                errors: localVision.back?.errors || [],
              }
            : null,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  const expected = text(process.env.INSTACOMP_DIAGNOSTIC_TOKEN);
  const provided = text(req.headers.get("x-tcos-instacomp-diagnostic-token"));
  if (expected.length < 32 || !provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const localUrl = text(process.env.INSTACOMP_AI_LOCAL_URL).replace(/\/+$/, "");
  const localKey = text(process.env.INSTACOMP_AI_LOCAL_KEY);
  if (!localUrl || localKey.length < 32) {
    return NextResponse.json(
      { ok: false, error: "Mac bridge is not configured" },
      { status: 503 },
    );
  }

  const db = createSupabaseServerClient({ admin: true });
  const { data, error } = await db
    .from("instacomp_scans")
    .select("id,created_at,raw_ai_result,raw_comp_results")
    .gte("created_at", START)
    .lte("created_at", END)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json(
      { ok: false, error: `Scan lookup failed: ${error.message}` },
      { status: 500 },
    );
  }

  const scans = (data || [])
    .filter((row: any) => PLAYERS.test(text(row?.raw_ai_result?.player)))
    .map((row: any) => ({
      id: text(row.id),
      createdAt: row.created_at,
      ai: {
        player: row.raw_ai_result?.player ?? null,
        year: row.raw_ai_result?.year ?? null,
        brand: row.raw_ai_result?.brand ?? null,
        setName: row.raw_ai_result?.setName ?? null,
        cardNumber: row.raw_ai_result?.cardNumber ?? null,
        parallel: row.raw_ai_result?.parallel ?? null,
        internalScanId: row.raw_ai_result?.internalScanId ?? null,
        internalStatus: row.raw_ai_result?.internalStatus ?? null,
        internalChecklistOutcome: row.raw_ai_result?.internalChecklistOutcome ?? null,
        internalChecklistReasons: row.raw_ai_result?.internalChecklistReasons ?? null,
        internalMatchSource: row.raw_ai_result?.internalMatchSource ?? null,
      },
      registry: row.raw_comp_results?.checklistRegistry || null,
      identityDecision: row.raw_comp_results?.identityDecision || null,
    }));

  const archives: any[] = [];
  const seen = new Set<string>();
  for (const row of scans) {
    const scanId = text(row.ai.internalScanId);
    if (!scanId || seen.has(scanId)) continue;
    seen.add(scanId);
    try {
      const response = await fetch(
        `${localUrl}/v1/scans/${encodeURIComponent(scanId)}/archive`,
        {
          headers: {
            "X-InstaComp-AI-Key": localKey,
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
      const raw = await response.text();
      let payload: any = {};
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { parseError: raw.slice(0, 300) };
      }
      archives.push(
        response.ok
          ? { httpStatus: response.status, ...sanitizeArchive(payload) }
          : { scanId, httpStatus: response.status, error: payload },
      );
    } catch (error) {
      archives.push({
        scanId,
        httpStatus: null,
        error: error instanceof Error ? error.message : "Archive request failed",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    window: { start: START, end: END },
    scanCount: scans.length,
    archiveCount: archives.length,
    scans,
    archives,
  });
}
