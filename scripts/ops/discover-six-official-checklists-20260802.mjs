import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = ".checklist-work/six-release-discovery";
const PRIVATE = join(ROOT, "private");
const RECEIPT = join(ROOT, "discovery.json");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36 TCOS-Checklist-Registry/1.0";

const releases = [
  {
    id: "2024-bowman-chrome-baseball",
    manufacturer: "Topps",
    rowSourceAuthority: "third_party_verified",
    rowSourceUrl:
      "https://www.checklistcenter.com/wp-content/uploads/2024/08/2024-Bowman-Chrome-Baseball.xlsx",
    rowSourceLandingUrl:
      "https://www.checklistcenter.com/2024-bowman-chrome-baseball-card-checklist/",
    officialCorroborationUrl:
      "https://www.topps.com/pages/education/2024-bowman-chrome-baseball",
    expectedType: "xlsx",
  },
  {
    id: "2025-bowman-baseball",
    manufacturer: "Topps",
    rowSourceAuthority: "official_manufacturer",
    rowSourceUrl:
      "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2507-2025BowmanBaseballChecklist2.pdf?v=1746543006",
    rowSourceLandingUrl: "https://www.topps.com/pages/checklists",
    officialCorroborationUrl: "https://www.topps.com/pages/checklists",
    expectedType: "pdf",
  },
  {
    id: "2024-panini-prizm-wnba",
    manufacturer: "Panini",
    rowSourceAuthority: "third_party_verified",
    rowSourceUrl:
      "https://www.checklistcenter.com/wp-content/uploads/2025/02/2024-Panini-WNBA-Prizm-Basketball.xlsx",
    rowSourceLandingUrl:
      "https://www.checklistcenter.com/2024-panini-prizm-wnba-basketball-card-checklist/",
    officialCorroborationUrl:
      "https://www.paniniamerica.net/2024-panini-prizm-wnba-trading-card-box-hobby.html",
    expectedType: "xlsx",
  },
  {
    id: "2025-panini-prizm-wnba",
    manufacturer: "Panini",
    rowSourceAuthority: "third_party_verified",
    rowSourceUrl:
      "https://www.checklistcenter.com/wp-content/uploads/2026/03/2025-Panini-Prizm-WNBA.xlsx",
    rowSourceLandingUrl:
      "https://www.checklistcenter.com/2025-panini-prizm-wnba-basketball-card-checklist/",
    officialCorroborationUrl:
      "https://www.paniniamerica.net/2025-panini-prizm-wnba-trading-card-box-hobby",
    expectedType: "xlsx",
  },
  {
    id: "2024-panini-select-wnba",
    manufacturer: "Panini",
    rowSourceAuthority: "third_party_verified",
    rowSourceUrl:
      "https://www.checklistcenter.com/wp-content/uploads/2024/10/2024-Panini-Select-WNBA.xlsx",
    rowSourceLandingUrl:
      "https://www.checklistcenter.com/2024-panini-select-wnba-basketball-card-checklist/",
    officialCorroborationUrl:
      "https://www.paniniamerica.net/2024-panini-select-wnba-trading-card-box-hobby.html",
    expectedType: "xlsx",
  },
  {
    id: "2025-panini-select-wnba",
    manufacturer: "Panini",
    rowSourceAuthority: "third_party_verified",
    rowSourceUrl:
      "https://www.checklistcenter.com/wp-content/uploads/2026/05/2025-Panini-WNBA-Select-Basketball.xlsx",
    rowSourceLandingUrl:
      "https://www.checklistcenter.com/2025-panini-select-wnba-basketball-card-checklist/",
    officialCorroborationUrl:
      "https://www.paniniamerica.net/2025-panini-select-wnba-trading-card-box-hobby",
    expectedType: "xlsx",
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function typeMatches(body, contentType, expectedType) {
  if (expectedType === "pdf") {
    return body.subarray(0, 4).toString("ascii") === "%PDF";
  }
  if (expectedType === "xlsx") {
    return body[0] === 0x50 && body[1] === 0x4b;
  }
  return false;
}

async function fetchSource(source) {
  const outputDir = join(PRIVATE, source.id);
  await mkdir(outputDir, { recursive: true });
  const response = await fetch(source.rowSourceUrl, {
    headers: {
      Accept:
        source.expectedType === "pdf"
          ? "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Referer: source.rowSourceLandingUrl,
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  const extension = source.expectedType === "pdf" ? ".pdf" : ".xlsx";
  const privateFile = join(outputDir, `${source.id}${extension}`);
  await writeFile(privateFile, body);

  const failures = [];
  if (!response.ok) failures.push(`HTTP ${response.status}`);
  if (body.length < 10_000) failures.push(`source too small: ${body.length}`);
  if (!typeMatches(body, contentType, source.expectedType)) {
    failures.push(
      `unexpected ${source.expectedType} signature/content type ${contentType || "unknown"}`,
    );
  }

  return {
    id: source.id,
    manufacturer: source.manufacturer,
    rowSourceAuthority: source.rowSourceAuthority,
    requestedUrl: source.rowSourceUrl,
    finalUrl: response.url,
    rowSourceLandingUrl: source.rowSourceLandingUrl,
    officialCorroborationUrl: source.officialCorroborationUrl,
    expectedType: source.expectedType,
    status: response.status,
    contentType,
    sizeBytes: body.length,
    sha256: sha256(body),
    privateFile,
    ok: failures.length === 0,
    failures,
  };
}

async function main() {
  await mkdir(PRIVATE, { recursive: true });
  const results = [];
  for (const source of releases) {
    console.log(`Acquiring ${source.id}`);
    try {
      results.push(await fetchSource(source));
    } catch (error) {
      results.push({
        id: source.id,
        manufacturer: source.manufacturer,
        rowSourceAuthority: source.rowSourceAuthority,
        requestedUrl: source.rowSourceUrl,
        rowSourceLandingUrl: source.rowSourceLandingUrl,
        officialCorroborationUrl: source.officialCorroborationUrl,
        expectedType: source.expectedType,
        ok: false,
        failures: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  const failures = results.flatMap((entry) =>
    entry.ok ? [] : entry.failures.map((failure) => `${entry.id}: ${failure}`),
  );
  const receipt = {
    schema: "tcos.checklist.sixReleaseSourceAcquisition.v3",
    generatedAt: new Date().toISOString(),
    status: results.every((entry) => entry.ok) ? "passed" : "failed",
    releaseCount: results.length,
    officialRowSourceCount: results.filter(
      (entry) => entry.rowSourceAuthority === "official_manufacturer",
    ).length,
    thirdPartyVerifiedRowSourceCount: results.filter(
      (entry) => entry.rowSourceAuthority === "third_party_verified",
    ).length,
    results,
    failures,
    safety: {
      productionDatabaseWrites: false,
      migrationsApplied: false,
      deploymentPerformed: false,
      rawSourcesStoredOnlyInPrivateActionsArtifact: true,
      thirdPartyRowsNeverMisrepresentedAsOfficial: true,
    },
  };
  await writeFile(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        releaseCount: receipt.releaseCount,
        officialRowSourceCount: receipt.officialRowSourceCount,
        thirdPartyVerifiedRowSourceCount: receipt.thirdPartyVerifiedRowSourceCount,
        results: results.map((entry) => ({
          id: entry.id,
          ok: entry.ok,
          authority: entry.rowSourceAuthority,
          sizeBytes: entry.sizeBytes || 0,
          sha256: entry.sha256 || null,
          failures: entry.failures,
        })),
      },
      null,
      2,
    ),
  );
  if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
