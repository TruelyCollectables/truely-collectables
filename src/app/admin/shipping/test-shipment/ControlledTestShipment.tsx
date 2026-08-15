"use client";

import { useEffect, useMemo, useState } from "react";

type Address = {
  name: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
};

type Status = {
  purchaseEnabled?: boolean;
  maxPostage?: number;
  serviceCode?: string;
  packageCode?: string;
  ounces?: number;
};

type Quote = {
  postageAmount?: number;
  serviceCode?: string;
  packageCode?: string;
  ounces?: number;
  purchaseEnabled?: boolean;
  maxPostage?: number;
  destination?: { city?: string; state?: string; postalCode?: string };
  message?: string;
};

type Purchase = {
  reused?: boolean;
  postageAmount?: number;
  externalShipmentId?: string;
  labelId?: string;
  labelPdfUrl?: string;
  letterTrackUrl?: string;
  message?: string;
};

const EMPTY: Address = {
  name: "",
  company: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  countryCode: "US",
};

export default function ControlledTestShipment() {
  const [address, setAddress] = useState<Address>(EMPTY);
  const [status, setStatus] = useState<Status>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteFingerprint, setQuoteFingerprint] = useState("");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [message, setMessage] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [machinable, setMachinable] = useState(false);
  const [confirmCharge, setConfirmCharge] = useState(false);

  useEffect(() => {
    void loadStatus();
  }, []);

  const fingerprint = useMemo(() => JSON.stringify(address), [address]);
  const quoteStillMatches = Boolean(quote && quoteFingerprint === fingerprint);

  async function loadStatus() {
    const response = await fetch(`/api/admin/shipping/controlled-test-shipment/quote?status=${Date.now()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    setStatus(data);
  }

  function change<K extends keyof Address>(key: K, value: Address[K]) {
    setAddress((old) => ({ ...old, [key]: value }));
    setPurchase(null);
  }

  async function runQuote() {
    if (quoting) return;
    setQuoting(true);
    setQuote(null);
    setPurchase(null);
    setMessage("Quoting the controlled 1.00 oz First-Class Letter — no purchase...");
    try {
      const response = await fetch("/api/admin/shipping/controlled-test-shipment/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(address),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not quote the test letter.");
      setQuote(data);
      setQuoteFingerprint(fingerprint);
      setStatus((old) => ({ ...old, purchaseEnabled: data.purchaseEnabled, maxPostage: data.maxPostage }));
      setMessage(data.message || "Quote returned. No postage was purchased.");
    } catch (error: any) {
      setMessage(error?.message || "Could not quote the test letter.");
    } finally {
      setQuoting(false);
    }
  }

  async function buyTestLabel() {
    if (buying) return;
    if (!quoteStillMatches) {
      setMessage("Destination changed after the quote. Run the no-purchase quote again before buying.");
      return;
    }
    if (!machinable || !confirmCharge) {
      setMessage("Confirm machinable 1 oz packaging and the real-postage charge before buying.");
      return;
    }

    setBuying(true);
    setPurchase(null);
    setMessage("Submitting one controlled real-postage purchase to ShipStation API...");
    try {
      const response = await fetch("/api/admin/shipping/controlled-test-shipment/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...address,
          confirmPurchase: true,
          machinableAttested: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const requiredFlag = data?.requiredFlag ? ` Required: ${data.requiredFlag}.` : "";
        throw new Error(`${data?.error || "Could not buy the test postage."}${requiredFlag}`);
      }
      setPurchase(data);
      setMessage(data.message || "Controlled test postage purchased.");
    } catch (error: any) {
      setMessage(error?.message || "Could not buy the test postage.");
    } finally {
      setBuying(false);
      await loadStatus();
    }
  }

  const capped = quote && Number(quote.postageAmount || 0) <= Number(quote.maxPostage || status.maxPostage || 0);
  const buyReady = quoteStillMatches && capped && machinable && confirmCharge && !buying;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5 text-sky-950">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest">Controlled live test</p>
            <h2 className="mt-1 text-2xl font-black">1 oz USPS First-Class Letter</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
              This is not tied to an order. Enter your test recipient when you have the address. TCOS will quote exactly 1.00 oz, USPS First-Class Mail, package type letter. The quote moves no money. The real purchase is separately locked and hard-capped.
            </p>
          </div>
          <div className="text-right text-xs font-black uppercase">
            <p>{status.purchaseEnabled ? "Real test purchase armed" : "Real test purchase locked"}</p>
            <p className="mt-1">Cap: ${Number(status.maxPostage || 2).toFixed(2)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5">
        <h3 className="text-lg font-black">Test recipient</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <Field label="Name" value={address.name} onChange={(value) => change("name", value)} />
          <Field label="Company (optional)" value={address.company} onChange={(value) => change("company", value)} />
          <Field label="Address line 1" value={address.addressLine1} onChange={(value) => change("addressLine1", value)} />
          <Field label="Address line 2 (optional)" value={address.addressLine2} onChange={(value) => change("addressLine2", value)} />
          <Field label="City" value={address.city} onChange={(value) => change("city", value)} />
          <Field label="State" value={address.state} onChange={(value) => change("state", value.toUpperCase())} />
          <Field label="ZIP" value={address.postalCode} onChange={(value) => change("postalCode", value)} />
          <Field label="Country" value={address.countryCode} onChange={(value) => change("countryCode", value.toUpperCase())} />
        </div>

        <button
          type="button"
          onClick={runQuote}
          disabled={quoting}
          className="mt-4 rounded-2xl bg-sky-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
        >
          {quoting ? "Quoting..." : "Quote 1 oz First-Class Letter — No Purchase"}
        </button>

        {quote ? (
          <div className={`mt-4 rounded-2xl border p-4 ${quoteStillMatches ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
            <p className="text-xl font-black">${Number(quote.postageAmount || 0).toFixed(2)}</p>
            <p className="mt-1 text-sm font-bold">
              {quote.serviceCode} · {quote.packageCode} · {Number(quote.ounces || 1).toFixed(2)} oz
            </p>
            <p className="mt-1 text-sm font-semibold">
              {quote.destination?.city}, {quote.destination?.state} {quote.destination?.postalCode}
            </p>
            {!quoteStillMatches ? (
              <p className="mt-2 text-sm font-black">Address changed — run the quote again before purchase.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <h3 className="text-lg font-black">Real test purchase</h3>
        <p className="mt-2 text-sm font-semibold leading-6">
          This button can buy one real label only when the controlled test flag is armed. The server re-quotes before purchase, refuses anything over the safety cap, and uses a deterministic ShipStation external shipment ID so the same test destination/date is reused instead of intentionally charged twice.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="flex gap-3 rounded-2xl border border-emerald-300 bg-white p-4 text-sm font-bold">
            <input type="checkbox" checked={machinable} onChange={(event) => setMachinable(event.target.checked)} className="mt-1 h-5 w-5" />
            <span>I verified the finished test mailpiece is 1 oz or less, flexible, uniformly thick, and machinable as a USPS letter.</span>
          </label>
          <label className="flex gap-3 rounded-2xl border border-emerald-300 bg-white p-4 text-sm font-bold">
            <input type="checkbox" checked={confirmCharge} onChange={(event) => setConfirmCharge(event.target.checked)} className="mt-1 h-5 w-5" />
            <span>I authorize this controlled test to spend the quoted postage, subject to the ${Number(quote?.maxPostage || status.maxPostage || 2).toFixed(2)} server-side cap.</span>
          </label>
        </div>

        <button
          type="button"
          onClick={buyTestLabel}
          disabled={!buyReady}
          className="mt-4 rounded-2xl bg-emerald-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {buying ? "Buying One Test Label..." : "Buy One Controlled Test Label"}
        </button>

        {message ? <p className="mt-3 rounded-2xl border border-current/20 bg-white p-3 text-sm font-black">{message}</p> : null}

        {purchase?.labelPdfUrl ? (
          <div className="mt-4 flex flex-wrap gap-3 rounded-2xl border border-emerald-300 bg-white p-4">
            <a href={purchase.labelPdfUrl} target="_blank" rel="noreferrer" className="rounded-xl bg-neutral-950 px-4 py-3 text-sm font-black text-white">
              Print Paid Test Postage PDF
            </a>
            {purchase.letterTrackUrl ? (
              <a href={purchase.letterTrackUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-blue-800 bg-blue-50 px-4 py-3 text-sm font-black text-blue-950">
                Open LetterTrack Finalize
              </a>
            ) : null}
            <p className="basis-full text-xs font-bold text-neutral-700">
              {purchase.reused ? "Existing provider label reused — no second intentional charge. " : "New controlled test label purchased. "}
              ShipStation postage: ${Number(purchase.postageAmount || 0).toFixed(2)}.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-black text-neutral-800">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 font-semibold outline-none focus:border-sky-700"
      />
    </label>
  );
}
