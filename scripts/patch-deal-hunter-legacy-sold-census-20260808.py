from pathlib import Path

route = Path('src/app/api/release/instacomp-deal-hunter-history-status/route.ts')
text = route.read_text(encoding='utf-8')

anchor = '''    const rows = data || [];\n    const identityId = String(rows[0]?.registry_identity_id || "").trim();\n'''
insert = '''    const cutoff90 = new Date(Date.now() - 90 * 86_400_000).toISOString();\n    const [legacyAll, legacyRecent, legacyIdentities] = await Promise.all([\n      supabase\n        .from("tcos_mi_sold_comps")\n        .select("id", { count: "exact", head: true })\n        .eq("verified", true)\n        .eq("excluded", false)\n        .eq("outlier_flag", false),\n      supabase\n        .from("tcos_mi_sold_comps")\n        .select("collectible_identity_id,sold_at,match_confidence", { count: "exact" })\n        .eq("verified", true)\n        .eq("excluded", false)\n        .eq("outlier_flag", false)\n        .gte("sold_at", cutoff90)\n        .gte("match_confidence", 95)\n        .order("sold_at", { ascending: false })\n        .limit(1000),\n      supabase\n        .from("tcos_mi_collectible_identities")\n        .select("id", { count: "exact", head: true })\n        .eq("active", true),\n    ]);\n    for (const [label, result] of [\n      ["Legacy sold all-time", legacyAll],\n      ["Legacy sold 90-day", legacyRecent],\n      ["Legacy identity", legacyIdentities],\n    ] as const) {\n      if (result.error) throw new Error(`${label} census failed: ${result.error.message}`);\n    }\n    const legacyRecentRows = legacyRecent.data || [];\n    const legacyRecentIdentityCount = new Set(\n      legacyRecentRows.map((row) => String(row.collectible_identity_id || "")).filter(Boolean),\n    ).size;\n\n    const rows = data || [];\n    const identityId = String(rows[0]?.registry_identity_id || "").trim();\n'''
if text.count(anchor) != 1:
    raise SystemExit('History route census anchor missing; refusing fuzzy patch.')
text = text.replace(anchor, insert, 1)

response_anchor = '''      observationCountSince: rows.length,\n      recent: rows.map((row) => ({\n'''
response_insert = '''      observationCountSince: rows.length,\n      legacySoldCensus: {\n        verifiedIncludedAllTime: Number(legacyAll.count || 0),\n        verifiedHighConfidenceLast90Days: Number(legacyRecent.count || legacyRecentRows.length || 0),\n        identitiesWithRecentSold: legacyRecentIdentityCount,\n        activeLegacyIdentities: Number(legacyIdentities.count || 0),\n        cutoff90,\n        newestSoldAt: legacyRecentRows[0]?.sold_at || null,\n        oldestReturnedSoldAt: legacyRecentRows[legacyRecentRows.length - 1]?.sold_at || null,\n      },\n      recent: rows.map((row) => ({\n'''
if text.count(response_anchor) != 1:
    raise SystemExit('History route response anchor missing; refusing fuzzy patch.')
text = text.replace(response_anchor, response_insert, 1)

route.write_text(text, encoding='utf-8')
print('Protected legacy exact-sold census added to Deal Hunter diagnostics.')
