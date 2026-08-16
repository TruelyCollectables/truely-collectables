import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dbClient } from "./mainstream-checklist/registry-tools.mjs";

const OUTPUT = resolve(
  process.cwd(),
  process.env.PRIORITY_CHECKLIST_VERIFY_OUTPUT || ".checklist-discovery/priority-production-proof.json",
);

const TARGETS = [
  { group: "wnba", key: "basketball|2024|panini|origins-wnba", slug: "2024-panini-origins-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2024|panini|select-wnba", slug: "2024-panini-select-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2024|panini|prizm-wnba", slug: "2024-panini-prizm-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2025|panini|donruss-wnba", slug: "2025-panini-donruss-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2025|panini|prizm-wnba", slug: "2025-panini-prizm-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2025|panini|select-wnba", slug: "2025-panini-select-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2025|panini|impeccable-wnba", slug: "2025-panini-impeccable-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "wnba", key: "basketball|2025|panini|one-and-one-wnba", slug: "2025-panini-one-and-one-wnba-basketball", parserVersion: "1.2.0", minCards: 25 },
  { group: "hockey", key: "hockey|2021-22|upper-deck|sp-authentic", slug: "2021-22-upper-deck-sp-authentic-hockey", parserVersion: "1.2.0", minCards: 200 },
  { group: "hockey", key: "hockey|2024-25|upper-deck|artifacts", slug: "2024-25-upper-deck-artifacts-hockey", parserVersion: "1.2.0", minCards: 100 },
  { group: "hockey", key: "hockey|2025-26|upper-deck|star-rookies-box-set", slug: "2025-26-upper-deck-star-rookies-box-set-hockey", parserVersion: "1.2.0", minCards: 20 },
];

async function verifyTarget(db, target) {
  const failures = [];
  const { data: releases, error: releaseError } = await db
    .from("checklist_releases")
    .select("id,slug,season,product_name,checklist_status,import_status")
    .eq("slug", target.slug)
    .limit(3);
  if (releaseError) throw new Error(`${target.key}: release query failed: ${releaseError.message}`);
  if ((releases || []).length !== 1) {
    return { ...target, verified: false, failures: [`expected one release, found ${(releases || []).length}`] };
  }
  const release = releases[0];
  if (release.checklist_status !== "live") failures.push(`release checklist_status=${release.checklist_status}`);
  if (release.import_status !== "successful") failures.push(`release import_status=${release.import_status}`);

  const { data: versions, error: versionError } = await db
    .from("checklist_versions")
    .select("id,source_file_id,parser_version,status,is_active,normalized_card_count,normalized_identity_count,activated_at")
    .eq("release_id", release.id)
    .eq("is_active", true)
    .limit(3);
  if (versionError) throw new Error(`${target.key}: active-version query failed: ${versionError.message}`);
  if ((versions || []).length !== 1) {
    return { ...target, release, verified: false, failures: [...failures, `expected one active version, found ${(versions || []).length}`] };
  }
  const version = versions[0];
  if (version.status !== "live") failures.push(`version status=${version.status}`);
  if (String(version.parser_version || "") !== target.parserVersion) {
    failures.push(`parser_version=${version.parser_version}, expected ${target.parserVersion}`);
  }

  const { count: cardCount, error: cardError } = await db
    .from("checklist_cards")
    .select("id", { count: "exact", head: true })
    .eq("version_id", version.id);
  if (cardError) throw new Error(`${target.key}: card-count query failed: ${cardError.message}`);
  const { count: identityCount, error: identityError } = await db
    .from("checklist_card_identities")
    .select("id", { count: "exact", head: true })
    .eq("version_id", version.id);
  if (identityError) throw new Error(`${target.key}: identity-count query failed: ${identityError.message}`);

  if (Number(cardCount) < target.minCards) failures.push(`only ${cardCount} cards; minimum ${target.minCards}`);
  if (Number(version.normalized_card_count) !== Number(cardCount)) {
    failures.push(`version normalized_card_count=${version.normalized_card_count}, table count=${cardCount}`);
  }
  if (Number(version.normalized_identity_count) !== Number(identityCount)) {
    failures.push(`version normalized_identity_count=${version.normalized_identity_count}, table count=${identityCount}`);
  }
  if (Number(identityCount) < Number(cardCount)) failures.push(`identity count ${identityCount} below card count ${cardCount}`);

  const { data: catalogRows, error: catalogError } = await db
    .from("checklist_source_catalog")
    .select("source_url,status,validation_counts,adapter_id,adapter_version,imported_at,last_checked_at,metadata")
    .eq("release_slug", target.slug)
    .in("status", ["imported", "unchanged"])
    .order("last_checked_at", { ascending: false })
    .limit(1);
  if (catalogError) throw new Error(`${target.key}: catalog query failed: ${catalogError.message}`);
  const catalog = (catalogRows || [])[0] || null;
  if (!catalog) {
    failures.push("no imported/unchanged source catalog row");
  } else {
    const expectedCards = Number(catalog.validation_counts?.cards || 0);
    const expectedIdentities = Number(catalog.validation_counts?.identities || 0);
    if (expectedCards !== Number(cardCount)) failures.push(`catalog cards=${expectedCards}, table count=${cardCount}`);
    if (expectedIdentities !== Number(identityCount)) failures.push(`catalog identities=${expectedIdentities}, table count=${identityCount}`);
    if (String(catalog.adapter_version || "") !== target.parserVersion) {
      failures.push(`catalog adapter_version=${catalog.adapter_version}, expected ${target.parserVersion}`);
    }
  }

  return {
    ...target,
    verified: failures.length === 0,
    release: {
      id: release.id,
      product: release.product_name,
      season: release.season,
      checklistStatus: release.checklist_status,
      importStatus: release.import_status,
    },
    version: {
      id: version.id,
      parserVersion: version.parser_version,
      status: version.status,
      active: version.is_active,
      cards: Number(cardCount),
      identities: Number(identityCount),
      activatedAt: version.activated_at,
    },
    catalog: catalog ? {
      status: catalog.status,
      sourceUrl: catalog.source_url,
      adapterId: catalog.adapter_id,
      adapterVersion: catalog.adapter_version,
      validationCounts: catalog.validation_counts,
      importedAt: catalog.imported_at,
      checkedAt: catalog.last_checked_at,
    } : null,
    failures,
  };
}

async function main() {
  const db = dbClient();
  const startedAt = new Date().toISOString();
  const results = [];
  for (const target of TARGETS) {
    try {
      results.push(await verifyTarget(db, target));
    } catch (error) {
      results.push({ ...target, verified: false, failures: [error instanceof Error ? error.message : String(error)] });
    }
  }
  const verified = results.filter((result) => result.verified).length;
  const byGroup = Object.fromEntries(
    [...new Set(TARGETS.map((target) => target.group))].map((group) => {
      const groupResults = results.filter((result) => result.group === group);
      return [group, { expected: groupResults.length, verified: groupResults.filter((result) => result.verified).length }];
    }),
  );
  const proof = {
    schema: "tcos.checklist.priorityProductionProof.v1",
    startedAt,
    checkedAt: new Date().toISOString(),
    expected: TARGETS.length,
    verified,
    failed: TARGETS.length - verified,
    byGroup,
    complete: verified === TARGETS.length,
    results,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(proof, null, 2));
  if (!proof.complete) process.exitCode = 1;
}

await main();
