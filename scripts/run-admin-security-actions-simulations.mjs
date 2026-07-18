import { readFile } from "node:fs/promises";

const ipDetailSource = await readFile(
  new URL("../src/app/admin/security/ip/[ip]/page.tsx", import.meta.url),
  "utf8",
);
const securityIndexSource = await readFile(
  new URL("../src/app/admin/security/page.tsx", import.meta.url),
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
    "Security case was not saved",
    "save-error",
    "notes-too-long",
    "resolvedSearchParams.case",
    "caseNotice.title",
    "caseNotice.body",
    'role={caseNotice.tone === "error" ? "alert" : "status"}',
    'aria-live={caseNotice.tone === "error" ? "assertive" : "polite"}',
  ]) {
    assert(
      ipDetailSource.includes(fragment),
      `Expected security IP case-notice fragment ${fragment}.`,
    );
  }
});

scenario("security IP save does not report success after database failure", () => {
  for (const fragment of [
    "const { error: investigationSaveError } = await supabase",
    "investigationSaveError.message",
    "?case=save-error",
  ]) {
    assert(
      ipDetailSource.includes(fragment),
      `Expected security IP save failure fragment ${fragment}.`,
    );
  }

  assert(
    ipDetailSource.indexOf("investigationSaveError") <
      ipDetailSource.indexOf("?case=saved"),
    "Expected security IP save to inspect the database error before redirecting as saved.",
  );
});

scenario("security IP save validates server-side note length", () => {
  for (const fragment of [
    "MAX_INVESTIGATION_NOTES_LENGTH = 5000",
    "rawNotes.length > MAX_INVESTIGATION_NOTES_LENGTH",
    "?case=notes-too-long",
    "maxLength={MAX_INVESTIGATION_NOTES_LENGTH}",
    'aria-describedby="investigation-notes-help"',
    'id="investigation-notes-help"',
    "Internal-only audit note. Maximum",
  ]) {
    assert(
      ipDetailSource.includes(fragment),
      `Expected security IP notes length fragment ${fragment}.`,
    );
  }
});

scenario("security IP dossier explains save scope and partial load failures", () => {
  for (const fragment of [
    "Some Evidence Could Not Load",
    'role="alert"',
    'aria-live="assertive"',
    "Saving marks this IP reviewed now, updates status/severity, and",
    "records internal-only notes for future admin decisions.",
    "Save this IP investigation, update last-reviewed time, and preserve internal-only audit notes.",
  ]) {
    assert(
      ipDetailSource.includes(fragment),
      `Expected security IP save/load feedback fragment ${fragment}.`,
    );
  }
});

scenario("security center renders missing-IP action feedback", () => {
  for (const fragment of [
    "securityCaseNotice",
    "missing-ip",
    "Security case was not saved",
    "resolvedSearchParams.case",
    'aria-live="assertive"',
    'role="alert"',
  ]) {
    assert(
      securityIndexSource.includes(fragment),
      `Expected security center missing-IP notice fragment ${fragment}.`,
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
