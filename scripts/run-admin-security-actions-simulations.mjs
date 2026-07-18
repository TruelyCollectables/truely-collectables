import { readFile } from "node:fs/promises";

const ipDetailSource = await readFile(
  new URL("../src/app/admin/security/ip/[ip]/page.tsx", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("security IP investigation form uses pending-aware submit", () => {
  assert(
    ipDetailSource.includes('import AdminSubmitButton from "../../../AdminSubmitButton";'),
    "Expected security IP page to import AdminSubmitButton.",
  );
  assert(
    ipDetailSource.includes("<AdminSubmitButton") &&
      ipDetailSource.includes('pendingChildren="Saving investigation..."'),
    "Expected security IP save form to show pending save feedback.",
  );
});

scenario("security IP save redirects render inline case notices", () => {
  for (const fragment of [
    "investigationCaseNotice",
    "Investigation saved",
    "Investigation was not saved",
    "resolvedSearchParams.case",
    "caseNotice.title",
    "caseNotice.body",
  ]) {
    assert(
      ipDetailSource.includes(fragment),
      `Expected security IP case-notice fragment ${fragment}.`,
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
  `Admin security action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
