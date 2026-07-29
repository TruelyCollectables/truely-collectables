import fs from "node:fs";

const contracts = [
  {
    name: "cart",
    file: "src/app/cart/page.tsx",
    canonical: "/cart",
    robotsPath: "/cart",
  },
  {
    name: "buyer signup",
    file: "src/app/account/signup/layout.tsx",
    canonical: "/account/signup",
    robotsPath: "/account/",
  },
];

const robotsSource = fs.readFileSync("src/app/robots.ts", "utf8");
const failures = [];

for (const contract of contracts) {
  const source = fs.readFileSync(contract.file, "utf8");
  const canonicalPattern = new RegExp(
    `canonical\\s*:\\s*["']${contract.canonical.replaceAll("/", "\\/")}["']`,
  );

  if (!canonicalPattern.test(source)) {
    failures.push(`${contract.name}: missing canonical ${contract.canonical}`);
  }
  if (!/index\s*:\s*false/.test(source)) {
    failures.push(`${contract.name}: metadata must remain noindex`);
  }
  if (!/follow\s*:\s*false/.test(source)) {
    failures.push(`${contract.name}: metadata must remain nofollow`);
  }
  if (!robotsSource.includes(`"${contract.robotsPath}"`)) {
    failures.push(
      `${contract.name}: robots policy must continue to disallow ${contract.robotsPath}`,
    );
  }
}

if (failures.length) {
  console.error("Transactional metadata contracts failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Transactional metadata contracts passed: canonical URLs are explicit while cart and account signup remain intentionally non-indexable.",
);
