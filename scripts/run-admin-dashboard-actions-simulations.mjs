import { readFile } from "node:fs/promises";

const adminPageSource = await readFile(
  new URL("../src/app/admin/page.tsx", import.meta.url),
  "utf8",
);
const adminErrorSource = await readFile(
  new URL("../src/app/admin/error.tsx", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("admin command center price radar forms use pending-aware submits", () => {
  assert(
    adminPageSource.includes('import AdminSubmitButton from "./AdminSubmitButton";'),
    "Expected admin command center to import the shared admin submit button.",
  );
  assert(
    (adminPageSource.match(/<AdminSubmitButton/g) || []).length >= 2,
    "Expected price adjustment and ignore forms to use pending-aware submits.",
  );

  for (const label of ["Applying...", "Ignoring..."]) {
    assert(
      adminPageSource.includes(label),
      `Expected admin command center pending label ${label}.`,
    );
  }
});

scenario("admin error recovery keeps a retry action and safe navigation", () => {
  for (const fragment of [
    "unstable_retry()",
    "Retry This Panel",
    "Admin Command Center",
    "Production Smoke",
  ]) {
    assert(
      adminErrorSource.includes(fragment),
      `Expected admin error recovery fragment ${fragment}.`,
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
  `Admin dashboard action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
