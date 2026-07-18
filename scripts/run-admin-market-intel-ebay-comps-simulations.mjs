import { readFile } from "node:fs/promises";

const ebayPageSource = await readFile(
  new URL("../src/app/admin/market-intel/ebay/page.tsx", import.meta.url),
  "utf8",
);
const compsPageSource = await readFile(
  new URL("../src/app/admin/market-intel/comps/page.tsx", import.meta.url),
  "utf8",
);
const compDetailPageSource = await readFile(
  new URL("../src/app/admin/market-intel/comps/[id]/page.tsx", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countAdminSubmitButtons(source) {
  return (source.match(/<AdminSubmitButton/g) || []).length;
}

scenario("eBay scanner labels the active scan submit", () => {
  assert(
    ebayPageSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected eBay scanner page to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(ebayPageSource) >= 1,
    "Expected eBay scan form to use a pending-aware submit.",
  );
  assert(
    ebayPageSource.includes("Scanning and scoring..."),
    "Expected eBay scan pending label to be present.",
  );
});

scenario("comps overview labels exact identity creation", () => {
  assert(
    compsPageSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected comps page to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(compsPageSource) >= 1,
    "Expected exact identity creation to use a pending-aware submit.",
  );
  assert(
    compsPageSource.includes("Creating identity..."),
    "Expected exact identity pending label to be present.",
  );
});

scenario("comp detail labels recalculation and sale-save actions", () => {
  assert(
    compDetailPageSource.includes('import AdminSubmitButton from "../../../AdminSubmitButton";'),
    "Expected comp detail page to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(compDetailPageSource) >= 2,
    "Expected recalculate and save comp forms to use pending-aware submits.",
  );

  for (const label of ["Recalculating...", "Saving comp..."]) {
    assert(
      compDetailPageSource.includes(label),
      `Expected comp detail pending label ${label} to be present.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin Market Intel eBay/comps simulations: ${
    scenarios.length - failed.length
  }/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
