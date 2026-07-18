import { readFile } from "node:fs/promises";

const deliveryPageSource = await readFile(
  new URL("../src/app/admin/market-intel/delivery/page.tsx", import.meta.url),
  "utf8",
);
const testEmailPageSource = await readFile(
  new URL("../src/app/admin/market-intel/delivery/test/page.tsx", import.meta.url),
  "utf8",
);
const reportsPageSource = await readFile(
  new URL("../src/app/admin/market-intel/reports/page.tsx", import.meta.url),
  "utf8",
);
const adminSubmitButtonSource = await readFile(
  new URL("../src/app/admin/AdminSubmitButton.tsx", import.meta.url),
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

scenario("delivery center uses pending-aware submits for alert and report sends", () => {
  assert(
    deliveryPageSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected delivery center to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(deliveryPageSource) >= 2,
    "Expected delivery center send forms to use pending-aware submit buttons.",
  );

  for (const label of [
    "Sending pending alerts...",
    "Sending latest report...",
    "No pending alerts are queued for delivery.",
    "No generated daily report is available to deliver.",
    "Latest daily report was already delivered.",
    "disabledReason={pendingAlertBlocker}",
    "disabledReason={latestReportBlocker}",
  ]) {
    assert(
      deliveryPageSource.includes(label),
      `Expected delivery pending label ${label} to be present.`,
    );
  }
});

scenario("shared admin submit buttons can explain disabled form actions", () => {
  for (const fragment of [
    "disabledReason?: React.ReactNode",
    "disabled && !pending && disabledReason",
    'role="status"',
    'aria-live="polite"',
  ]) {
    assert(
      adminSubmitButtonSource.includes(fragment),
      `Expected AdminSubmitButton disabled reason fragment ${fragment}.`,
    );
  }
});

scenario("test email page shows an in-flight state while sending", () => {
  assert(
    testEmailPageSource.includes('import AdminSubmitButton from "../../../AdminSubmitButton";'),
    "Expected test email page to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(testEmailPageSource) >= 1,
    "Expected test email form to use a pending-aware submit button.",
  );
  assert(
    testEmailPageSource.includes("Sending test email..."),
    "Expected test email pending label to be present.",
  );
  for (const fragment of [
    "disabledReason={disabledReason}",
    "Email delivery is missing:",
    "Email delivery is disabled in configuration.",
  ]) {
    assert(
      testEmailPageSource.includes(fragment),
      `Expected test email disabled reason ${fragment}.`,
    );
  }
});

scenario("reports page labels long-running outbox and report actions", () => {
  assert(
    reportsPageSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected reports page to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(reportsPageSource) >= 4,
    "Expected sync, generate, sent, and dismiss forms to use pending-aware submit buttons.",
  );

  for (const label of [
    "Syncing alerts...",
    "Generating report...",
    "Marking sent...",
    "Dismissing...",
  ]) {
    assert(
      reportsPageSource.includes(label),
      `Expected reports pending label ${label} to be present.`,
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
  `Admin Market Intel delivery/report simulations: ${
    scenarios.length - failed.length
  }/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
