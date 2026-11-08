"use client";

import { useRef, useState } from "react";

type PurchaseResult = {
  postageAmount?: number;
  trackingNumber?: string;
  labelPdfUrl?: string;
  reused?: boolean;
};

export default function ShipStationParcelPurchase({
  orderId,
  shippingMethod,
  activeDryRunLabel,
}: {
  orderId: number;
  shippingMethod: string;
  activeDryRunLabel: boolean;
}) {
  const runningRef = useRef(false);
  const [ounces, setOunces] = useState("4");
  const [lengthIn, setLengthIn] = useState("8");
  const [widthIn, setWidthIn] = useState("6");
  const [heightIn, setHeightIn] = useState("1");
  const [packageVerified, setPackageVerified] = useState(false);
  const [confirmCharge, setConfirmCharge] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<PurchaseResult | null>(null);

  const serviceName =
    shippingMethod === "PRIORITY_MAIL"
      ? "USPS Priority Mail"
      : "USPS Ground Advantage";
  const packageValues = [ounces, lengthIn, widthIn, heightIn].map(Number);
  const packageValid = packageValues.every(
    (value) => Number.isFinite(value) && value > 0,
  );
  const blocked =
    purchasing ||
    activeDryRunLabel ||
    !packageValid ||
    !packageVerified ||
    !confirmCharge;

  async function buyPostage() {
    if (runningRef.current || purchasing) return;
    if (blocked) {
      setMessage(
        "Enter the finished package measurements, verify them, and confirm the ShipStation charge before buying postage.",
      );
      return;
    }

    runningRef.current = true;
    setPurchasing(true);
    setResult(null);
    setMessage(`Buying ${serviceName} postage through ShipStation...`);

    try {
      const prepareResponse = await fetch(
        `/api/admin/orders/${orderId}/shipping-labels`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const prepareData = await prepareResponse.json().catch(() => ({}));
      if (!prepareResponse.ok) {
        setMessage(prepareData.error || "Could not prepare the shipping record.");
        return;
      }

      const response = await fetch(
        `/api/admin/orders/${orderId}/shipstation-parcel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmPurchase: true,
            ounces: Number(ounces),
            lengthIn: Number(lengthIn),
            widthIn: Number(widthIn),
            heightIn: Number(heightIn),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const missing = Array.isArray(data?.bridge?.missing)
          ? ` Missing: ${data.bridge.missing.join(", ")}.`
          : "";
        setMessage(`${data.error || "Postage purchase failed."}${missing}`);
        return;
      }

      setResult({
        postageAmount: Number(data.postageAmount || 0),
        trackingNumber: data.trackingNumber,
        labelPdfUrl: data.labelPdfUrl,
        reused: data.reused === true,
      });
      setMessage(
        data.message ||
          `${serviceName} postage is paid, tracking is saved, and the label is ready to print.`,
      );
    } catch (error: any) {
      setMessage(error?.message || `Could not buy ${serviceName} postage.`);
    } finally {
      runningRef.current = false;
      setPurchasing(false);
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-sky-300 bg-sky-50 p-5 text-sky-950 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-sky-800">
            Integrated ShipStation Parcel
          </p>
          <h3 className="mt-1 text-xl font-black">Buy + Print {serviceName}</h3>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
            TruelyCollectables sends the finished package details to ShipStation,
            charges the connected postage account, saves USPS tracking, and keeps
            the printable 4×6 PDF inside this order.
          </p>
        </div>
        <span className="rounded-full border border-sky-700 px-3 py-1 text-xs font-black uppercase">
          One-charge guard
        </span>
      </div>

      {activeDryRunLabel ? (
        <p className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-black text-red-950">
          Real purchase is blocked because this order has an active dry-run label.
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MeasureField label="Weight (oz)" value={ounces} onChange={setOunces} />
        <MeasureField label="Length (in)" value={lengthIn} onChange={setLengthIn} />
        <MeasureField label="Width (in)" value={widthIn} onChange={setWidthIn} />
        <MeasureField label="Height (in)" value={heightIn} onChange={setHeightIn} />
      </div>

      <p className="mt-2 text-xs font-bold text-sky-800">
        Defaults are only a starting point. Weigh and measure the finished mailer
        before purchase so USPS postage is based on the actual package.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-sky-300 bg-white p-4 text-sm font-bold">
          <input
            type="checkbox"
            checked={packageVerified}
            onChange={(event) => setPackageVerified(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>I verified the finished package weight and dimensions above.</span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-sky-300 bg-white p-4 text-sm font-bold">
          <input
            type="checkbox"
            checked={confirmCharge}
            onChange={(event) => setConfirmCharge(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            I authorize this one ShipStation postage purchase for order #{orderId}.
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={buyPostage}
        disabled={blocked}
        className={`mt-4 rounded-2xl bg-sky-900 px-5 py-3 text-sm font-black text-white shadow-sm ${blocked ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {purchasing ? `Buying ${serviceName}...` : `Buy ${serviceName} + Create Label`}
      </button>

      {message ? (
        <p className="mt-4 rounded-2xl border border-sky-300 bg-white p-3 text-sm font-black">
          {message}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
          <div className="mr-auto">
            <p className="font-black">
              {result.reused ? "Existing paid label reused" : "Postage purchased"}
            </p>
            <p className="text-sm font-semibold">
              {result.postageAmount !== undefined
                ? `$${result.postageAmount.toFixed(2)} postage`
                : "Paid postage"}
              {result.trackingNumber ? ` · USPS ${result.trackingNumber}` : ""}
            </p>
          </div>
          {result.labelPdfUrl ? (
            <a
              href={result.labelPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl bg-emerald-900 px-4 py-2 text-sm font-black text-white"
            >
              Print Paid 4×6 Label
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MeasureField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block rounded-2xl border border-sky-200 bg-white p-3">
      <span className="text-xs font-black uppercase tracking-wide text-sky-800">
        {label}
      </span>
      <input
        type="number"
        min="0.01"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-sky-200 px-3 py-2 text-sm font-black text-neutral-950 outline-none focus:border-sky-700"
      />
    </label>
  );
}
