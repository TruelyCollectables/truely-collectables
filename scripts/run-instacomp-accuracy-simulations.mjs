import {
  extractInstaCompSerialNumber,
  serialRunDisplayLabel,
} from "../src/lib/instacomp-serial.ts";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const instacompSourceUrl = new URL("../src/lib/instacomp.ts", import.meta.url);
const serialSourceUrl = new URL("../src/lib/instacomp-serial.ts", import.meta.url);
const instacompSource = (await readFile(instacompSourceUrl, "utf8")).replace(
  '"./instacomp-serial"',
  JSON.stringify(serialSourceUrl.href)
);
const transpiledInstaCompSource = ts.transpileModule(instacompSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const instacompModuleUrl = `data:text/javascript;base64,${Buffer.from(
  transpiledInstaCompSource
).toString("base64")}`;
const {
  buildInstaCompQueries,
  filterAndRankExactMatches,
  filterAndRankGuidanceMatches,
} = await import(instacompModuleUrl);

const cases = [
  { input: "Serial 07/50", exact: "07/50", run: "/50" },
  { input: "087 of 250", exact: "087/250", run: "/250" },
  { input: "ONE OF ONE", exact: "1/1", run: "1/1" },
  { input: "O7/5O", exact: "07/50", run: "/50" },
  { input: "stamp 12｜99", exact: "12/99", run: "/99" },
  { input: "copyright 2024/25; stamped 07/50", exact: "07/50", run: "/50" },
  { input: "copyright 2024/25", exact: null, run: null },
  { input: "bad OCR 99/25", exact: null, run: null },
  { input: "bad OCR 0/25", exact: null, run: null },
  { input: "not numbered", exact: null, run: null },
];

let failed = 0;
let total = 0;

function check(name, condition, detail = "") {
  total += 1;
  if (!condition) failed += 1;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

for (const testCase of cases) {
  const serial = extractInstaCompSerialNumber(testCase.input);
  const exact = serial?.exact || null;
  const run = serialRunDisplayLabel(testCase.input);
  const passed = exact === testCase.exact && run === testCase.run;

  check(
    `serial ${JSON.stringify(testCase.input)}`,
    passed,
    `exact=${exact}, run=${run}`
  );
}

const target = {
  player: "Shohei Ohtani",
  year: "2023",
  brand: "Topps Chrome",
  setName: "Update",
  cardNumber: "USC17",
  parallel: "Gold Refractor",
  serialNumber: "07/50",
  team: "Los Angeles Angels",
  sport: "Baseball",
  isRookie: false,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Raw",
  confidence: 0.96,
  notes: null,
};

const comp = (title, price) => ({
  title,
  price,
  currency: "USD",
  url: `https://example.com/${encodeURIComponent(title)}`,
  imageUrl: null,
  source: "fixture",
  sourceLabel: "Fixture",
  sourceCategory: "sold",
});

const query = buildInstaCompQueries(target);
check("query uses print run instead of exact serial", query.primary.includes("/50") && !query.primary.includes("07/50"), query.primary);

const invalidSerialQuery = buildInstaCompQueries({ ...target, serialNumber: "99/25" });
check("invalid serial cannot constrain comp search", !invalidSerialQuery.primary.includes("/25"), invalidSerialQuery.primary);

const exactMatches = filterAndRankExactMatches(
  [
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 07/50", 120),
    comp("2022 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 11/50", 110),
    comp("2023 Bowman Chrome Update Shohei Ohtani Gold Refractor #USC17 13/50", 105),
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC18 19/50", 95),
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 12/99", 70),
    comp("2023 Topps Chrome Update Shohei Ohtani Blue Refractor #USC17 22/50", 90),
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 PSA 10 22/50", 250),
    comp("Lot of 3 2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 18/50", 180),
  ],
  target,
  10
);
check(
  "exact ranking keeps only the valid year/brand/player/card/run/parallel comp",
  exactMatches.length === 1 && exactMatches[0].price === 120,
  `${exactMatches.length} match(es)`
);

const autographMatches = filterAndRankExactMatches(
  [
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor Auto #USC17 07/50", 400),
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 07/50", 120),
  ],
  { ...target, isAuto: true },
  10
);
check(
  "autograph targets require autograph evidence",
  autographMatches.length === 1 && autographMatches[0].price === 400,
  `${autographMatches.length} match(es)`
);

const relicMatches = filterAndRankExactMatches(
  [
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor Patch #USC17 07/50", 300),
    comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 07/50", 120),
  ],
  { ...target, isRelic: true },
  10
);
check(
  "relic targets require relic evidence",
  relicMatches.length === 1 && relicMatches[0].price === 300,
  `${relicMatches.length} match(es)`
);

const guidanceMatches = filterAndRankGuidanceMatches(
  [comp("2023 Topps Chrome Update Shohei Ohtani Gold Refractor #USC17 12/100", 40)],
  target,
  10
);
check(
  "guidance pricing adjusts a /100 comp to the /50 target",
  guidanceMatches.length === 1 &&
    guidanceMatches[0].price === 56.57 &&
    guidanceMatches[0].flags.includes("serial adjusted from /100 to /50"),
  guidanceMatches[0] ? `$${guidanceMatches[0].price}` : "no match"
);

console.log(`InstaComp accuracy simulations: ${total - failed}/${total} passed.`);

if (failed > 0) process.exitCode = 1;
