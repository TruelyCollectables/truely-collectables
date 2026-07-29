import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST as runLiveScan } from "../src/app/api/instacomp/live-scan/route";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionValue,
} from "../src/lib/admin-session";

type TestCase = {
  id: string;
  label: string;
  frontUrl: string;
  backUrl: string;
  sourcePage: string;
  expected: {
    player: string;
    playerAliases?: string[];
    year: string;
    brand: string;
    brandAliases?: string[];
    setName: string;
    setAliases?: string[];
    cardNumber: string;
    parallel: string;
    parallelAliases?: string[];
    isRookie: boolean;
    isAuto: boolean;
    isRelic: boolean;
    sport: string;
  };
};

const SOURCE_PAGE = "https://baseballcardpedia.com/index.php/2016_Topps_Chrome";
const imageUrl = (pathname: string, id: string, side: "front" | "back") =>
  `https://img.comc.com/i/Baseball/2016/${pathname}.jpg?.jpg=&id=${id}&side=${side}&size=original`;

const CASES: TestCase[] = [
  {
    id: "tc10-01-trout-base",
    label: "2016 Topps Chrome #1 Mike Trout Base (Leaping)",
    frontUrl: imageUrl("Topps-Chrome---Base/11/Mike-Trout-%28Leaping%29", "da910cfc-81a0-4eac-a4e7-0ca2d1d7850e", "front"),
    backUrl: imageUrl("Topps-Chrome---Base/11/Mike-Trout-%28Leaping%29", "da910cfc-81a0-4eac-a4e7-0ca2d1d7850e", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Mike Trout", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Base", setAliases: ["Topps Chrome Base", "Topps Chrome"], cardNumber: "1", parallel: "Base", parallelAliases: ["Standard", "Regular"], isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-02-severino-gimmick",
    label: "2016 Topps Chrome #33 Luis Severino Ball-in-Air Gimmick",
    frontUrl: imageUrl("Topps-Chrome---Base/332/Luis-Severino-%28Ball-in-Air%29", "18f84c36-6731-42c4-b89a-74a7b7fd4c3e", "front"),
    backUrl: imageUrl("Topps-Chrome---Base/332/Luis-Severino-%28Ball-in-Air%29", "18f84c36-6731-42c4-b89a-74a7b7fd4c3e", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Luis Severino", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Base Gimmick", setAliases: ["Base", "Photo Variation", "Image Variation", "Gimmick"], cardNumber: "33", parallel: "Photo Variation", parallelAliases: ["Gimmick", "Image Variation", "Ball in Air", "Ball-in-Air"], isRookie: true, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-03-zobrist-black",
    label: "2016 Topps Chrome #120 Ben Zobrist Black Refractor",
    frontUrl: imageUrl("Topps-Chrome---Base---Black-Refractor/120/Ben-Zobrist", "08cc0a78-1d4d-4144-a74c-3952e95f2416", "front"),
    backUrl: imageUrl("Topps-Chrome---Base---Black-Refractor/120/Ben-Zobrist", "08cc0a78-1d4d-4144-a74c-3952e95f2416", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Ben Zobrist", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Base", setAliases: ["Topps Chrome Base", "Topps Chrome"], cardNumber: "120", parallel: "Black Refractor", isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-04-trout-perspectives",
    label: "2016 Topps Chrome Perspectives #PC-16 Mike Trout",
    frontUrl: imageUrl("Topps-Chrome---Perspectives/PC-16/Mike-Trout", "3100455f-8154-4c22-8246-a622e47aa940", "front"),
    backUrl: imageUrl("Topps-Chrome---Perspectives/PC-16/Mike-Trout", "3100455f-8154-4c22-8246-a622e47aa940", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Mike Trout", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Perspectives", setAliases: ["Perspective"], cardNumber: "PC-16", parallel: "Refractor", parallelAliases: ["Base", "Standard"], isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-05-burton-first-pitch",
    label: "2016 Topps Chrome First Pitch #FPC-8 LeVar Burton",
    frontUrl: imageUrl("Topps-Chrome---First-Pitch/FPC-8/LeVar-Burton", "068424a3-d001-4578-bdfd-708cdc64b0d0", "front"),
    backUrl: imageUrl("Topps-Chrome---First-Pitch/FPC-8/LeVar-Burton", "068424a3-d001-4578-bdfd-708cdc64b0d0", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "LeVar Burton", playerAliases: ["Levar Burton"], year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "First Pitch", cardNumber: "FPC-8", parallel: "Refractor", parallelAliases: ["Base", "Standard"], isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-06-bryant-future-stars",
    label: "2016 Topps Chrome Future Stars #FS-1 Kris Bryant",
    frontUrl: imageUrl("Topps-Chrome---Future-Stars/FS-1/Kris-Bryant", "d2fcfe02-1614-4518-9bce-2d666aee828c", "front"),
    backUrl: imageUrl("Topps-Chrome---Future-Stars/FS-1/Kris-Bryant", "d2fcfe02-1614-4518-9bce-2d666aee828c", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Kris Bryant", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Future Stars", cardNumber: "FS-1", parallel: "Refractor", parallelAliases: ["Base", "Standard"], isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-07-severino-youth-impact",
    label: "2016 Topps Chrome Youth Impact #YI-3 Luis Severino",
    frontUrl: imageUrl("Topps-Chrome---Youth-Impact/YI-3/Luis-Severino", "18df1800-101d-4cca-8462-c21d2229c5a9", "front"),
    backUrl: imageUrl("Topps-Chrome---Youth-Impact/YI-3/Luis-Severino", "18df1800-101d-4cca-8462-c21d2229c5a9", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Luis Severino", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Youth Impact", cardNumber: "YI-3", parallel: "Refractor", parallelAliases: ["Base", "Standard"], isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-08-correa-roy",
    label: "2016 Topps Chrome R.O.Y. Chronicles #ROY-CC Carlos Correa",
    frontUrl: imageUrl("Topps-Chrome---ROY-Chronicles/ROY-CC/Carlos-Correa", "ca55c286-c617-48b5-9533-a8c54d60e7ec", "front"),
    backUrl: imageUrl("Topps-Chrome---ROY-Chronicles/ROY-CC/Carlos-Correa", "ca55c286-c617-48b5-9533-a8c54d60e7ec", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Carlos Correa", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "R.O.Y. Chronicles", setAliases: ["ROY Chronicles", "Rookie of the Year Chronicles"], cardNumber: "ROY-CC", parallel: "Refractor", parallelAliases: ["Base", "Standard"], isRookie: false, isAuto: false, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-09-turner-rookie-auto",
    label: "2016 Topps Chrome Rookie Autographs #RA-TTU Trea Turner",
    frontUrl: imageUrl("Topps-Chrome---Rookie-Autographs/RA-TTU/Trea-Turner", "91484461-a8cb-4eb0-9b3d-4f5347c2c219", "front"),
    backUrl: imageUrl("Topps-Chrome---Rookie-Autographs/RA-TTU/Trea-Turner", "91484461-a8cb-4eb0-9b3d-4f5347c2c219", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Trea Turner", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Rookie Autographs", setAliases: ["Rookie Auto", "Chrome Rookie Autographs"], cardNumber: "RA-TTU", parallel: "Base", parallelAliases: ["Standard", "Regular"], isRookie: true, isAuto: true, isRelic: false, sport: "Baseball" },
  },
  {
    id: "tc10-10-gray-logo-pin-auto",
    label: "2016 Topps Chrome Team Logo Pin Autographs #TLA-SG Sonny Gray",
    frontUrl: imageUrl("Topps-Chrome---Team-Logo-Pin-Autographs/TLA-SG/Sonny-Gray", "13662de0-7b98-49f9-b68f-3523da0fb732", "front"),
    backUrl: imageUrl("Topps-Chrome---Team-Logo-Pin-Autographs/TLA-SG/Sonny-Gray", "13662de0-7b98-49f9-b68f-3523da0fb732", "back"),
    sourcePage: SOURCE_PAGE,
    expected: { player: "Sonny Gray", year: "2016", brand: "Topps Chrome", brandAliases: ["Topps"], setName: "Team Logo Pin Autographs", setAliases: ["Team Logo Pin Auto", "Logo Pin Autographs"], cardNumber: "TLA-SG", parallel: "Base", parallelAliases: ["Standard", "Regular"], isRookie: false, isAuto: true, isRelic: true, sport: "Baseball" },
  },
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactCardNumber(value: unknown) {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function phraseMatch(actual: unknown, expected: string, aliases: string[] = []) {
  const text = normalized(actual);
  return [expected, ...aliases]
    .map(normalized)
    .filter(Boolean)
    .some((option) => text === option || text.includes(option) || option.includes(text));
}

function setMatch(ai: any, expected: TestCase["expected"]) {
  const text = normalized([ai?.setName, ai?.parallel, ai?.notes].filter(Boolean).join(" "));
  return [expected.setName, ...(expected.setAliases || [])]
    .map(normalized)
    .filter(Boolean)
    .some((option) => option.split(" ").filter(Boolean).every((token) => text.includes(token)));
}

function parallelMatch(ai: any, expected: TestCase["expected"]) {
  const actual = normalized(ai?.parallel);
  const options = [expected.parallel, ...(expected.parallelAliases || [])].map(normalized);
  if (options.some((option) => ["base", "standard", "regular"].includes(option))) {
    if (!actual || ["base", "base card", "standard", "regular"].includes(actual)) return true;
  }
  return options.some((option) => option && (actual === option || actual.includes(option) || option.includes(actual)));
}

function grade(testCase: TestCase, scan: any) {
  const ai = scan?.ai || {};
  const checks = [
    { field: "player", weight: 20, pass: phraseMatch(ai.player, testCase.expected.player, testCase.expected.playerAliases), expected: testCase.expected.player, actual: ai.player, critical: true },
    { field: "year", weight: 10, pass: normalized(ai.year).includes("2016"), expected: testCase.expected.year, actual: ai.year, critical: false },
    { field: "brand", weight: 10, pass: phraseMatch(ai.brand, testCase.expected.brand, testCase.expected.brandAliases), expected: testCase.expected.brand, actual: ai.brand, critical: false },
    { field: "set", weight: 15, pass: setMatch(ai, testCase.expected), expected: testCase.expected.setName, actual: ai.setName, critical: true },
    { field: "cardNumber", weight: 15, pass: compactCardNumber(ai.cardNumber) === compactCardNumber(testCase.expected.cardNumber), expected: testCase.expected.cardNumber, actual: ai.cardNumber, critical: true },
    { field: "parallel", weight: 15, pass: parallelMatch(ai, testCase.expected), expected: testCase.expected.parallel, actual: ai.parallel, critical: true },
    { field: "rookie", weight: 5, pass: Boolean(ai.isRookie) === testCase.expected.isRookie, expected: testCase.expected.isRookie, actual: Boolean(ai.isRookie), critical: false },
    { field: "autograph", weight: 5, pass: Boolean(ai.isAuto) === testCase.expected.isAuto, expected: testCase.expected.isAuto, actual: Boolean(ai.isAuto), critical: false },
    { field: "relic", weight: 5, pass: Boolean(ai.isRelic) === testCase.expected.isRelic, expected: testCase.expected.isRelic, actual: Boolean(ai.isRelic), critical: false },
  ];
  const score = checks.reduce((sum, check) => sum + (check.pass ? check.weight : 0), 0);
  const criticalFailures = checks.filter((check) => check.critical && !check.pass).map((check) => check.field);
  return {
    score,
    pass: score >= 90 && criticalFailures.length === 0,
    criticalFailures,
    checks,
  };
}

async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (TCOS InstaComp ten-card audit)",
      accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Image download failed (${response.status}) for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type =
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "image/jpeg"
      : bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        ? "image/png"
        : bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" && Buffer.from(bytes.slice(8, 12)).toString() === "WEBP"
          ? "image/webp"
          : null;
  if (!type || bytes.length < 5_000) throw new Error(`Downloaded bytes were not a usable card image for ${url}`);
  return new File([bytes], fileName, { type });
}

async function scanCase(testCase: TestCase, sessionValue: string) {
  const startedAt = Date.now();
  try {
    const [front, back] = await Promise.all([
      downloadImage(testCase.frontUrl, `${testCase.id}-front.jpg`),
      downloadImage(testCase.backUrl, `${testCase.id}-back.jpg`),
    ]);
    const formData = new FormData();
    formData.append("frontImage", front);
    formData.append("backImage", back);
    formData.append("aiCouncilTier", "adaptive");

    const request = new NextRequest("https://instacomp-ten-card.local/api/instacomp/live-scan", {
      method: "POST",
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
        "x-forwarded-for": "8.8.8.8",
        "user-agent": "TCOS-InstaComp-Ten-Card-Audit/1.0",
        "x-instacomp-benchmark-ephemeral": String(process.env.INSTACOMP_BENCHMARK_TOKEN || ""),
      },
      body: formData,
    });

    const response = await runLiveScan(request);
    const scan = await response.json().catch(() => ({}));
    const result = {
      id: testCase.id,
      label: testCase.label,
      expected: testCase.expected,
      sourcePage: testCase.sourcePage,
      frontUrl: testCase.frontUrl,
      backUrl: testCase.backUrl,
      httpStatus: response.status,
      ok: Boolean(response.ok && scan?.ok),
      scan,
      grade: response.ok && scan?.ok ? grade(testCase, scan) : null,
      durationMs: Date.now() - startedAt,
      error: response.ok && scan?.ok ? null : clean(scan?.error || scan?.details || `HTTP ${response.status}`),
    };
    console.log(`${testCase.id}: ${result.ok ? `${result.grade?.score}/100` : `FAILED ${result.error}`}`);
    return result;
  } catch (error) {
    const result = {
      id: testCase.id,
      label: testCase.label,
      expected: testCase.expected,
      sourcePage: testCase.sourcePage,
      frontUrl: testCase.frontUrl,
      backUrl: testCase.backUrl,
      httpStatus: null,
      ok: false,
      scan: null,
      grade: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    console.log(`${testCase.id}: FAILED ${result.error}`);
    return result;
  }
}

function renderMarkdown(report: any) {
  const lines = [
    "# InstaComp — 10-card front/back live test",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Completed scans: **${report.summary.completed}/10**`,
    `- Passed at 90+ with no critical identity mismatch: **${report.summary.passed}/${report.summary.completed}**`,
    `- Average identity score: **${report.summary.averageScore ?? "—"}**`,
    `- Trusted sold-backed prices returned: **${report.summary.trustedPriceCards}**`,
    `- Provider-error cards: **${report.summary.providerErrorCards}**`,
    "",
    "## Card-by-card",
    "",
    "| # | Card | Score | Result | InstaComp identity | Sold | Active | Trusted price | Errors |",
    "|---:|---|---:|---|---|---:|---:|---:|---|",
  ];
  report.results.forEach((row: any, index: number) => {
    const ai = row.scan?.ai || {};
    const identity = [ai.year, ai.brand, ai.setName, ai.player, ai.parallel, ai.cardNumber ? `#${ai.cardNumber}` : null, ai.serialNumber].filter(Boolean).join(" ");
    const failedFields = row.grade?.checks?.filter((check: any) => !check.pass).map((check: any) => check.field).join(", ") || row.error || "None";
    lines.push(`| ${index + 1} | ${row.label.replaceAll("|", "\\|")} | ${row.grade?.score ?? "—"} | ${row.grade?.pass ? "PASS" : "REVIEW"} | ${identity.replaceAll("|", "\\|") || "No identity"} | ${Number(row.scan?.exactMarket?.pricingEligibleSoldCount ?? row.scan?.exactMarket?.soldCount ?? 0)} | ${Number(row.scan?.exactMarket?.activeCount ?? 0)} | ${row.scan?.exactMarket?.trustedSuggestedPrice ?? "—"} | ${failedFields.replaceAll("|", "\\|")} |`);
  });
  lines.push("", "## Detailed checks", "");
  report.results.forEach((row: any, index: number) => {
    lines.push(`### ${index + 1}. ${row.label}`, "", `- Front: ${row.frontUrl}`, `- Back: ${row.backUrl}`, `- Source checklist: ${row.sourcePage}`, `- HTTP/result: ${row.httpStatus ?? "n/a"} / ${row.ok ? "completed" : "failed"}`, `- Duration: ${row.durationMs} ms`, `- Score: ${row.grade?.score ?? "—"}/100`, `- Trusted price: ${row.scan?.exactMarket?.trustedSuggestedPrice ?? "none"}`, `- Market note: ${clean(row.scan?.note) || "none"}`, "");
    if (row.error) lines.push(`- **Error:** ${row.error}`, "");
    for (const check of row.grade?.checks || []) {
      lines.push(`- ${check.pass ? "PASS" : "FAIL"} **${check.field}** — expected ${clean(check.expected) || "none"}; got ${clean(check.actual) || "none"}`);
    }
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is required");
  const sessionValue = await createAdminSessionValue();
  const results: any[] = new Array(CASES.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= CASES.length) return;
      results[index] = await scanCase(CASES[index], sessionValue);
    }
  }
  await Promise.all([worker(), worker()]);

  const completed = results.filter((row) => row.ok && row.grade);
  const passed = completed.filter((row) => row.grade.pass);
  const scores = completed.map((row) => Number(row.grade.score)).filter(Number.isFinite);
  const report = {
    schema: "tcos.instacompTenCardFrontBackLive.v1",
    generatedAt: new Date().toISOString(),
    testDesign: {
      source: "Public COMC front/back scans referenced by BaseballCardPedia's 2016 Topps Chrome checklist",
      scanner: "Production InstaComp live-scan route invoked directly in authenticated ephemeral mode",
      persistence: "disabled/ephemeral",
      cards: CASES.length,
    },
    summary: {
      attempted: CASES.length,
      completed: completed.length,
      failed: CASES.length - completed.length,
      passed: passed.length,
      averageScore: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10 : null,
      trustedPriceCards: completed.filter((row) => Number(row.scan?.exactMarket?.trustedSuggestedPrice || 0) > 0).length,
      providerErrorCards: completed.filter((row) => row.scan?.exactMarket?.status === "provider_error").length,
    },
    results,
  };

  const outputDir = path.resolve("reports/instacomp-ten-card");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "instacomp-ten-card-live-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "instacomp-ten-card-live-report.md"), renderMarkdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  if (completed.length !== CASES.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
