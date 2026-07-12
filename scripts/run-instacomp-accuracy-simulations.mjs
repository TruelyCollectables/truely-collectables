import {
  extractInstaCompSerialNumber,
  serialRunDisplayLabel,
} from "../src/lib/instacomp-serial.ts";

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

for (const testCase of cases) {
  const serial = extractInstaCompSerialNumber(testCase.input);
  const exact = serial?.exact || null;
  const run = serialRunDisplayLabel(testCase.input);
  const passed = exact === testCase.exact && run === testCase.run;

  if (!passed) failed += 1;
  console.log(
    `${passed ? "PASS" : "FAIL"} ${JSON.stringify(testCase.input)} -> exact=${exact}, run=${run}`
  );
}

console.log(`InstaComp accuracy simulations: ${cases.length - failed}/${cases.length} passed.`);

if (failed > 0) process.exitCode = 1;
