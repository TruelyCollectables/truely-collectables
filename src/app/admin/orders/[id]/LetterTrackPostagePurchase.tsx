"use client";

import { useRef, useState } from "react";

type PurchaseResult = {
  postageAmount?: number;
  labelPdfUrl?: string;
  letterTrackUrl?: string;
  reused?: boolean;
};

type QuoteResult = {
  postageAmount?: number;
  ounces?: number;
  serviceCode?: string;
  packageCode?: string;
  destination?: { city?: string; state?: string; postalCode?: string };
  message?: string;
};

export default function LetterTrackPostagePurchase({
  orderId,
  activeDryRunLabel,
}: {
  orderId: number;
  activeDryRunLabel: boolean;
}) {
  const runningRef = useRef(false);
  const [machinable, setMachinable] = useState(false);
  const [confirmCharge, setConfirmCharge] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);

  const blocked =
    purchasing || activeDryRunLabel || !machinable || !confirmCharge;

  async function quoteOneOunce() {
    if (quoting) return;
    setQuoting(true);
    setQuote(null);
    setMessage("Quoting 1 oz USPS First-Class Mail letter through ShipStation API — no purchase...");
    try {
      const response = await fetch(
        `/api/admin/orders/${orderId}/lettertrack-postage/quote`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ounces: 1 }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "Could not quote 1 oz letter postage.");
        return;
      }
      setQuote(data);
      setMessage(
        data.message ||
          "ShipStation API returned a 1 oz First-Class Mail letter rate. No postage was purchased.",
      );
    } catch (error: any) {
      setMessage(error?.message || "Could not quote 1 oz letter postage.");
    } finally {
      setQuoting(false);
    }
  }

  async function buyPostage() {
    if (runningRef.current || purchasing) return;

    if (activeDryRunLabel) {
      setMessage(
        "The active label is a dry-run simulation. Clean it up before buying real postage.",
      );
      return;
    }

    if (!machinable || !confirmCharge) {
      setMessage(
        "Confirm machinable packaging and the ShipStation API charge before buying postage.",
      );
      return;
    }

    runningRef.current = true;
    setPurchasing(true);
    setResult(null);
    setMessage("Buying USPS letter postage through ShipStation API...");

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
        `/api/admin/orders/${orderId}/lettertrack-postage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmPurchase: true,
            standardEnvelopeMachinableAttested: true,
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
        labelPdfUrl: data.labelPdfUrl,
        letterTrackUrl: data.letterTrackUrl,
        reused: data.reused === true,
      });
      setMessage(
        data.message ||
          "Paid USPS letter postage is ready. Print it here, then finalize it in LetterTrack for the IMb barcode.",
      );
    } catch (error: any) {
      setMessage(error?.message || "Could not buy USPS letter postage.");
    } finally {
      runningRef.current = false;
      setPurchasing(false);
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-emerald-300 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-emerald-800">
            Integrated Standard Envelope
          </p>
          <h3 className="mt-1 text-xl font-black">Quote + Buy + Print Letter Postage</h3>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
            TCOS talks directly to the standalone ShipStation API account. Quote the
            cheap 1 oz First-Class Mail letter first without purchasing anything;
            when authorized, TCOS buys the postage, stores the provider IDs, and
            returns the paid PDF inside TruelyCollectables. LetterTrack finalization
            remains the last IMb step.
          </p>
        </div>
        <span className="rounded-full border border-emerald-700 px-3 py-1 text-xs font-black uppercase">
          One-charge guard
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-sky-300 bg-sky-50 p-4 text-sky-950">
        <button
          type="button"
          onClick={quoteOneOunce}
          disabled={quoting}
          className="rounded-xl bg-sky-950 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
        >
          {quoting ? "Quoting 1 oz Letter..." : "Quote 1 oz First-Class Letter — No Purchase"}
        </button>
        {quote ? (
          <p className="mt-3 text-sm font-black">
            Quote: ${Number(quote.postageAmount || 0).toFixed(2)} · {quote.serviceCode || "USPS First-Class Mail"} · {quote.packageCode || "letter"}
            {quote.destination?.city
              ? ` · ${quote.destination.city}, ${quote.destination.state || ""} ${quote.destination.postalCode || ""}`
              : ""}
          </p>
        ) : null}
      </div>

      {activeDryRunLabel ? (
        <p className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-black text-red-950">
          Real purchase is blocked because this order has an active dry-run label.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-white p-4 text-sm font-bold">
          <input
            type="checkbox"
            checked={machinable}
            onChange={(event) => setMachinable(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            I verified the finished card letter is flexible, uniformly thick,
            machinable, and no more than 3.5 oz. It is not a rigid mailer or an
            unprotected top loader requiring parcel/nonmachinable postage.
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-white p-4 text-sm font-bold">
          <input
            type="checkbox"
            checked={confirmCharge}
            onChange={(event) => setConfirmCharge(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>
            I authorize this click to purchase real USPS letter postage from the
            connected ShipStation API balance/account. Repeating the same order will
            return the stored purchase instead of intentionally charging it twice.
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={buyPostage}
        disabled={blocked}
        aria-busy={purchasing}
        className="mt-4 rounded-2xl bg-emerald-950 px-5 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        {purchasing ? "Purchasing USPS Letter Postage..." : "Buy USPS Letter Postage"}
      </button>

      {message ? (
        <p className="mt-3 rounded-2xl border border-emerald-300 bg-white p-3 text-sm font-black">
          {message}
        </p>
      ) : null}

      {result?.labelPdfUrl ? (
        <div className="mt-4 flex flex-wrap gap-3 rounded-2xl border border-emerald-300 bg-white p-4">
          <a
            href={result.labelPdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-neutral-950 px-4 py-3 text-sm font-black text-white"
          >
            Print Paid Postage PDF
          </a>
          {result.letterTrackUrl ? (
            <a
              href={result.letterTrackUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-blue-800 bg-blue-50 px-4 py-3 text-sm font-black text-blue-950"
            >
              Open LetterTrack Finalize
            </a>
          ) : null}
          <p className="basis-full text-xs font-bold text-neutral-700">
            {result.reused ? "Existing purchase reused. " : "Postage purchase saved. "}
            ShipStation API charge: ${Number(result.postageAmount || 0).toFixed(2)}.
            Do not mail until the LetterTrack IMb has been added and recorded back
            in TCOS.
          </p>
        </div>
      ) : null}
    </section>
  );
}
