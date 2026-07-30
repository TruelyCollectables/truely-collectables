import { readFile, writeFile } from "node:fs/promises";

const smokePath = "scripts/smoke-admin-runtime.mjs";
let smokeSource = await readFile(smokePath, "utf8");
const smokeAnchor = `  {
    path: "/admin/order-notifications",
    auth: true,
    expectedText: "Order Notification Delivery",
  },`;
const smokeReplacement = `${smokeAnchor}
  {
    path: "/admin/sales-history",
    auth: true,
    expectedText: "Sold Collectibles",
  },`;
if (!smokeSource.includes('path: "/admin/sales-history"')) {
  if (!smokeSource.includes(smokeAnchor)) {
    throw new Error("Sales-history smoke insertion anchor missing.");
  }
  smokeSource = smokeSource.replace(smokeAnchor, smokeReplacement);
}
if (
  !smokeSource.includes('path: "/admin/sales-history"') ||
  !smokeSource.includes('expectedText: "Sold Collectibles"')
) {
  throw new Error("Sales-history runtime smoke patch failed.");
}
await writeFile(smokePath, smokeSource, "utf8");

const dashboardPath = "src/app/admin/page.tsx";
let dashboardSource = await readFile(dashboardPath, "utf8");
const dashboardAnchor = `        { href: "/admin/order-notifications", label: "Order Notifications" },`;
const dashboardReplacement = `${dashboardAnchor}
        { href: "/admin/sales-history", label: "Sales History" },`;
if (!dashboardSource.includes('href: "/admin/sales-history"')) {
  if (!dashboardSource.includes(dashboardAnchor)) {
    throw new Error("Sales-history dashboard link insertion anchor missing.");
  }
  dashboardSource = dashboardSource.replace(
    dashboardAnchor,
    dashboardReplacement,
  );
}
if (!dashboardSource.includes('href: "/admin/sales-history"')) {
  throw new Error("Sales-history dashboard link patch failed.");
}
await writeFile(dashboardPath, dashboardSource, "utf8");

const duckPath = "src/app/admin/instacomp/DuckAiWitness.tsx";
let duckSource = await readFile(duckPath, "utf8");
const savingState = `  const [saving, setSaving] = useState(false);`;
if (!duckSource.includes("confirmingClear")) {
  if (!duckSource.includes(savingState)) {
    throw new Error("Duck.ai confirmation state anchor missing.");
  }
  duckSource = duckSource.replace(
    savingState,
    `${savingState}\n  const [confirmingClear, setConfirmingClear] = useState(false);`,
  );
}
const confirmBlock = `  function clearLedger() {
    if (
      !window.confirm(
        "Delete all locally saved Duck.ai witness records from this browser?",
      )
    ) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setSavedWitnesses([]);
    setMessage("Duck.ai witness history cleared from this browser.");
    setError("");
  }`;
const inlineClearBlock = `  function clearLedger() {
    localStorage.removeItem(STORAGE_KEY);
    setSavedWitnesses([]);
    setConfirmingClear(false);
    setMessage("Duck.ai witness history cleared from this browser.");
    setError("");
  }`;
if (duckSource.includes(confirmBlock)) {
  duckSource = duckSource.replace(confirmBlock, inlineClearBlock);
}
if (duckSource.includes("window.confirm(")) {
  throw new Error("Duck.ai native confirm was not removed.");
}
const clearButton = `              onClick={clearLedger}
              disabled={savedWitnesses.length === 0}`;
const clearButtonReplacement = `              onClick={() => {
                setConfirmingClear(true);
                setMessage("");
                setError("");
              }}
              disabled={savedWitnesses.length === 0 || confirmingClear}`;
if (duckSource.includes(clearButton)) {
  duckSource = duckSource.replace(clearButton, clearButtonReplacement);
}
const confirmationAnchor = `          </div>

          {error ? (`;
const confirmationPanel = `          </div>

          {confirmingClear ? (
            <div
              role="alertdialog"
              aria-labelledby="duck-ai-clear-title"
              className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-rose-950"
            >
              <p id="duck-ai-clear-title" className="font-black">
                Delete every locally saved Duck.ai witness record from this browser?
              </p>
              <p className="mt-1 text-sm font-semibold">
                This removes the local witness ledger only. Export it first when the evidence must be retained.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={clearLedger}
                  className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-black text-white"
                >
                  Delete All Local Witness Records
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-black"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {error ? (`;
if (!duckSource.includes('role="alertdialog"')) {
  if (!duckSource.includes(confirmationAnchor)) {
    throw new Error("Duck.ai inline confirmation insertion anchor missing.");
  }
  duckSource = duckSource.replace(confirmationAnchor, confirmationPanel);
}
if (
  !duckSource.includes("confirmingClear") ||
  !duckSource.includes('role="alertdialog"') ||
  duckSource.includes("window.confirm(")
) {
  throw new Error("Duck.ai inline confirmation patch failed.");
}
await writeFile(duckPath, duckSource, "utf8");

const resetPath = "src/app/admin/reset-password/page.tsx";
let resetSource = await readFile(resetPath, "utf8");
const resetButtonAnchor = `              <AdminSubmitButton
                className="w-full rounded-2xl bg-neutral-950 px-4 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800"
                pendingChildren="Saving permanent password..."`;
const resetButtonReplacement = `              <AdminSubmitButton
                className="w-full rounded-2xl bg-neutral-950 px-4 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800"
                title="Save the new permanent owner password, replace the temporary reset credential, and open the protected Admin Command Center."
                pendingChildren="Saving permanent password..."`;
if (!resetSource.includes("replace the temporary reset credential")) {
  if (!resetSource.includes(resetButtonAnchor)) {
    throw new Error("Owner reset submit title anchor missing.");
  }
  resetSource = resetSource.replace(resetButtonAnchor, resetButtonReplacement);
}
if (!resetSource.includes("replace the temporary reset credential")) {
  throw new Error("Owner reset submit title patch failed.");
}
await writeFile(resetPath, resetSource, "utf8");

console.log(
  "Admin sales-history navigation/smoke and newly discovered control blockers repaired.",
);
