import fs from "node:fs";

function replaceExact(file, before, after, expectedCount = 1) {
  const source = fs.readFileSync(file, "utf8");
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${file}: expected ${expectedCount} exact match(es), found ${count}`);
  }
  fs.writeFileSync(file, source.replaceAll(before, after));
  console.log(`PATCH ${file}: ${count} replacement(s)`);
}

const packageFile = "package.json";
replaceExact(
  packageFile,
  `  "overrides": {\n    "postcss": "8.5.23",`,
  `  "overrides": {\n    "@hono/node-server": "2.0.5",\n    "postcss": "8.5.23",`,
);

const shippingFile = "src/lib/shipping.ts";
replaceExact(
  shippingFile,
  `export const STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER =\n  "LetterTrack / USPS IMb";`,
  `export const STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER =\n  "LetterTrack / USPS IMb";\nexport const STANDARD_ENVELOPE_POSTAGE_BASIS =\n  "USPS retail stamped single-piece letter";`,
);
replaceExact(
  shippingFile,
  `const STANDARD_ENVELOPE_RATE_CHANGE_UTC = Date.UTC(2026, 6, 12, 7, 0, 0);\nconst STANDARD_ENVELOPE_RATES_BEFORE_JULY_12_2026 = [0.74, 1.03, 1.32];\nconst STANDARD_ENVELOPE_RATES_FROM_JULY_12_2026 = [0.78, 1.07, 1.36];`,
  `const STANDARD_ENVELOPE_RATE_CHANGE_UTC = Date.UTC(2026, 6, 12, 0, 0, 0);\nconst STANDARD_ENVELOPE_RATES_BEFORE_JULY_12_2026 = [0.78, 1.07, 1.36];\nconst STANDARD_ENVELOPE_RATES_FROM_JULY_12_2026 = [0.82, 1.11, 1.4];`,
);

const simulationFile = "src/lib/shipping-simulations.ts";
replaceExact(
  simulationFile,
  `export const SHIPPING_SIMULATION_SUITE_VERSION = "2026-07-14.6";`,
  `export const SHIPPING_SIMULATION_SUITE_VERSION = "2026-07-31.1";`,
);
replaceExact(
  simulationFile,
  `      standardEnvelope.method === "STANDARD_ENVELOPE" &&\n        money(standardEnvelopeRate) === 1.32,`,
  `      standardEnvelope.method === "STANDARD_ENVELOPE" &&\n        money(standardEnvelopeRate) === 1.36 &&\n        money(currentStandardEnvelopeRate) === 1.4,`,
);
replaceExact(
  simulationFile,
  `      "A raw-card order at $19.99 and 3 estimated oz stays on Standard Envelope at the expected $1.32 pre-July-12 rate.",`,
  `      "A raw-card order at $19.99 and 3 estimated oz uses the conservative USPS stamped-letter reserve: $1.36 before July 12 and $1.40 after the July 12, 2026 change.",`,
);

const labelActionsFile =
  "src/app/admin/orders/[id]/ShippingLabelActions.tsx";
replaceExact(
  labelActionsFile,
  `export default function ShippingLabelActions({\n  orderId,\n  activeDryRunLabel = false,\n  initialAction = "",\n}: {\n  orderId: number;\n  activeDryRunLabel?: boolean;\n  initialAction?: string;\n}) {`,
  `export default function ShippingLabelActions({\n  orderId,\n  activeDryRunLabel = false,\n  initialAction = "",\n  shippingMethod,\n}: {\n  orderId: number;\n  activeDryRunLabel?: boolean;\n  initialAction?: string;\n  shippingMethod?: string | null;\n}) {`,
);
replaceExact(
  labelActionsFile,
  `  const [showVoidForm, setShowVoidForm] = useState(\n    initialAction === "recordVoid",\n  );\n  const shippingActionRunningRef = useRef(false);`,
  `  const [showVoidForm, setShowVoidForm] = useState(\n    initialAction === "recordVoid",\n  );\n  const standardEnvelopeSelected = shippingMethod === "STANDARD_ENVELOPE";\n  const [standardEnvelopeMachinableAttested, setStandardEnvelopeMachinableAttested] =\n    useState(false);\n  const shippingActionRunningRef = useRef(false);`,
);
replaceExact(
  labelActionsFile,
  `    !manualForm.postageAmount.trim() ? "postage amount" : null,\n    manualForm.note.trim().length < 8 ? "audit note" : null,`,
  `    !manualForm.postageAmount.trim() ? "postage amount" : null,\n    standardEnvelopeSelected && !standardEnvelopeMachinableAttested\n      ? "machinable packaging attestation"\n      : null,\n    manualForm.note.trim().length < 8 ? "audit note" : null,`,
);
replaceExact(
  labelActionsFile,
  `            action: "record_manual_purchase",\n            ...trimRecord(manualForm),`,
  `            action: "record_manual_purchase",\n            standardEnvelopeMachinableAttested,\n            ...trimRecord(manualForm),`,
);
replaceExact(
  labelActionsFile,
  `          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">`,
  `          {standardEnvelopeSelected ? (\n            <label className="mb-4 flex items-start gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">\n              <input\n                type="checkbox"\n                checked={standardEnvelopeMachinableAttested}\n                onChange={(event) =>\n                  setStandardEnvelopeMachinableAttested(event.target.checked)\n                }\n                className="mt-1 h-5 w-5 shrink-0"\n              />\n              <span>\n                I verified this card letter uses approved flexible, uniformly thick,\n                machinable packaging. It is not in a rigid mailer or top loader that\n                requires a nonmachinable surcharge or parcel service.\n              </span>\n            </label>\n          ) : null}\n\n          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">`,
  1,
);
replaceExact(
  labelActionsFile,
  `              placeholder="1.32"`,
  `              placeholder={standardEnvelopeSelected ? "1.40" : "Carrier receipt amount"}`,
);

const orderPageFile = "src/app/admin/orders/[id]/page.tsx";
replaceExact(
  orderPageFile,
  `          <ShippingLabelActions\n            orderId={typedOrder.id}\n            activeDryRunLabel={activeDryRunShippingLabel}\n            initialAction={shippingAction}\n          />`,
  `          <ShippingLabelActions\n            orderId={typedOrder.id}\n            activeDryRunLabel={activeDryRunShippingLabel}\n            initialAction={shippingAction}\n            shippingMethod={typedOrder.shipping_method}\n          />`,
);

const labelRouteFile =
  "src/app/api/admin/orders/[id]/shipping-labels/route.ts";
replaceExact(
  labelRouteFile,
  `      const note = cleanText(body.note);\n      const requiredMissing = [`,
  `      const note = cleanText(body.note);\n      const standardEnvelopeMachinableAttested =\n        body.standardEnvelopeMachinableAttested === true;\n      const requiredMissing = [`,
);
replaceExact(
  labelRouteFile,
  `        postageAmount === null ? "valid postage amount" : null,\n        !note || note.length < 8 ? "audit note" : null,`,
  `        postageAmount === null ? "valid postage amount" : null,\n        label.resolved_shipping_method === "STANDARD_ENVELOPE" &&\n        !standardEnvelopeMachinableAttested\n          ? "machinable packaging attestation"\n          : null,\n        !note || note.length < 8 ? "audit note" : null,`,
);
replaceExact(
  labelRouteFile,
  `              coverage_status: coverageStatus,\n            },`,
  `              coverage_status: coverageStatus,\n              standard_envelope_machinable_attested:\n                standardEnvelopeMachinableAttested,\n            },`,
  1,
);
replaceExact(
  labelRouteFile,
  `          note,\n        },`,
  `          note,\n          standard_envelope_machinable_attested:\n            standardEnvelopeMachinableAttested,\n        },`,
  1,
);

const studioFile =
  "src/app/admin/products/new/AuditedDualMarketplaceListingStudio.tsx";
replaceExact(
  studioFile,
  `<p aria-live="polite" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">`,
  `<p role="status" aria-live="polite" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">`,
);

const adminDashboardFile = "src/app/admin/page.tsx";
replaceExact(
  adminDashboardFile,
  `                    {launchGateDrill.shipping\n                      .standardEnvelopeEvidenceContractReady`,
  `                    {launchGateDrill.shipping.standardEnvelopeEvidenceContractReady`,
);

console.log("Complete FBI/CIA audit fix set applied.");
