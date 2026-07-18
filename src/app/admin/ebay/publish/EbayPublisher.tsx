"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";

type Policy = { id: string; name: string; description: string | null };
type Location = {
  merchantLocationKey: string;
  name: string;
  city: string | null;
  stateOrProvince: string | null;
  postalCode: string | null;
  country: string | null;
};
type Setup = {
  connected: true;
  environment: string;
  marketplaceId: string;
  policies: { fulfillment: Policy[]; payment: Policy[]; return: Policy[] };
  locations: Location[];
  suggestions: {
    fulfillmentPolicyId: string | null;
    auctionPaymentPolicyId: string | null;
    fixedPaymentPolicyId: string | null;
    returnPolicyId: string | null;
    merchantLocationKey: string | null;
  };
};
type Preset = {
  id: string;
  sku: string;
  title: string;
  description: string;
  format: "AUCTION" | "FIXED_PRICE";
  listingDuration: "DAYS_3" | "GTC";
  price: number;
  expectedFiles: { front: string; back: string };
  aspects: Record<string, string[]>;
};
type CardState = Preset & {
  status: "idle" | "saving" | "drafted" | "published" | "error";
  uploadStatus: "idle" | "loading" | "uploading" | "ready" | "error";
  message: string | null;
  uploadMessage: string | null;
  listingUrl: string | null;
  imageUrls: { front: string | null; back: string | null };
};
type ListingSide = "front" | "back";

const CATEGORY_ID = "183454";
const BASE_ASPECTS = {
  Game: ["Pokemon TCG"],
  Language: ["English"],
  Manufacturer: ["The Pokemon Company"],
  "Year Manufactured": ["2026"],
  Autographed: ["No"],
};

function description(name: string, number: string, detail: string) {
  return `${name} ${number} from the 2026 Pokemon Trading Card Game release.\n\n${detail}\n\nUngraded card in Near Mint or Better condition.\n\nYou will receive the exact card pictured. Please review both front and back scans for centering, corners, edges, and surface condition.\n\nCard ships protected in a penny sleeve and rigid card holder.`;
}

const PRESETS: Preset[] = [
  {
    id: "armarouge",
    sku: "PBL-2026-ARMAROUGE-086-AUC",
    title: "Armarouge 086/084 Illustration Rare IR Pokemon Pitch Black 2026 NM",
    description: description(
      "Armarouge",
      "086/084",
      "Illustration Rare secret-set card from Pokemon Mega Evolution—Pitch Black.",
    ),
    format: "AUCTION",
    listingDuration: "DAYS_3",
    price: 0.99,
    expectedFiles: {
      front: "armarouge-086-084-front.jpg",
      back: "armarouge-086-084-back.jpg",
    },
    aspects: {
      ...BASE_ASPECTS,
      "Card Name": ["Armarouge"],
      Set: ["Pitch Black"],
      "Card Number": ["086/084"],
      Character: ["Armarouge"],
      Rarity: ["Illustration Rare"],
      Features: ["Full Art", "Secret Rare"],
      Finish: ["Holo"],
    },
  },
  {
    id: "zarude",
    sku: "MEP-2026-ZARUDE-088-AUC",
    title: "Zarude MEP EN 088 Black Star Promo Pokemon Mega Evolution 2026 NM",
    description: description(
      "Zarude",
      "MEP EN 088",
      "English Black Star promotional card with full-card artwork.",
    ),
    format: "AUCTION",
    listingDuration: "DAYS_3",
    price: 0.99,
    expectedFiles: {
      front: "zarude-mep-088-front.jpg",
      back: "zarude-mep-088-back.jpg",
    },
    aspects: {
      ...BASE_ASPECTS,
      "Card Name": ["Zarude"],
      Set: ["Pokemon Black Star Promos"],
      "Card Number": ["MEP EN 088"],
      Character: ["Zarude"],
      Rarity: ["Promo"],
      Features: ["Promo", "Full Art"],
      Finish: ["Holo"],
    },
  },
  {
    id: "rampardos",
    sku: "PBL-2026-RAMPARDOS-100-AUC",
    title: "Rampardos ex 100/084 Ultra Rare Full Art Pokemon Pitch Black 2026 NM",
    description: description(
      "Rampardos ex",
      "100/084",
      "Ultra Rare full-art secret-set card from Pokemon Mega Evolution—Pitch Black.",
    ),
    format: "AUCTION",
    listingDuration: "DAYS_3",
    price: 0.99,
    expectedFiles: {
      front: "rampardos-ex-100-084-front.jpg",
      back: "rampardos-ex-100-084-back.jpg",
    },
    aspects: {
      ...BASE_ASPECTS,
      "Card Name": ["Rampardos ex"],
      Set: ["Pitch Black"],
      "Card Number": ["100/084"],
      Character: ["Rampardos"],
      Rarity: ["Ultra Rare"],
      Features: ["Full Art", "Secret Rare", "Pokemon ex"],
      Finish: ["Holo"],
    },
  },
  {
    id: "zeraora",
    sku: "PBL-2026-ZERAORA-027-AUC",
    title: "Mega Zeraora ex 027/084 Double Rare Pokemon Pitch Black 2026 NM",
    description: description(
      "Mega Zeraora ex",
      "027/084",
      "Double Rare card from Pokemon Mega Evolution—Pitch Black.",
    ),
    format: "AUCTION",
    listingDuration: "DAYS_3",
    price: 0.99,
    expectedFiles: {
      front: "mega-zeraora-ex-027-084-front.jpg",
      back: "mega-zeraora-ex-027-084-back.jpg",
    },
    aspects: {
      ...BASE_ASPECTS,
      "Card Name": ["Mega Zeraora ex"],
      Set: ["Pitch Black"],
      "Card Number": ["027/084"],
      Character: ["Zeraora"],
      Rarity: ["Double Rare"],
      Features: ["Pokemon ex", "Mega Evolution"],
      Finish: ["Holo"],
    },
  },
  {
    id: "wailord",
    sku: "PBL-2026-WAILORD-016-BIN",
    title: "Wailord ex 016/084 Double Rare Pokemon Pitch Black 2026 NM",
    description: description(
      "Wailord ex",
      "016/084",
      "Double Rare card from Pokemon Mega Evolution—Pitch Black.",
    ),
    format: "FIXED_PRICE",
    listingDuration: "GTC",
    price: 2.49,
    expectedFiles: {
      front: "wailord-ex-016-084-front.jpg",
      back: "wailord-ex-016-084-back.jpg",
    },
    aspects: {
      ...BASE_ASPECTS,
      "Card Name": ["Wailord ex"],
      Set: ["Pitch Black"],
      "Card Number": ["016/084"],
      Character: ["Wailord"],
      Rarity: ["Double Rare"],
      Features: ["Pokemon ex"],
      Finish: ["Holo"],
    },
  },
];

function optionLabel(item: Policy) {
  return item.description ? `${item.name} — ${item.description}` : item.name;
}

function normalizedFilename(value: string) {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

export default function EbayPublisher() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState("");
  const [auctionPayment, setAuctionPayment] = useState("");
  const [fixedPayment, setFixedPayment] = useState("");
  const [returns, setReturns] = useState("");
  const [location, setLocation] = useState("");
  const [bulkUploadMessage, setBulkUploadMessage] = useState<string | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [publishConfirmId, setPublishConfirmId] = useState<string | null>(null);
  const [cards, setCards] = useState<CardState[]>(
    PRESETS.map((card) => ({
      ...card,
      status: "idle",
      uploadStatus: "loading",
      message: null,
      uploadMessage: null,
      listingUrl: null,
      imageUrls: { front: null, back: null },
    })),
  );

  useEffect(() => {
    void fetch("/api/ebay/publish", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.connected) throw new Error(data.error);
        return data as Setup;
      })
      .then((data) => {
        setSetup(data);
        setFulfillment(data.suggestions.fulfillmentPolicyId || "");
        setAuctionPayment(data.suggestions.auctionPaymentPolicyId || "");
        setFixedPayment(data.suggestions.fixedPaymentPolicyId || "");
        setReturns(data.suggestions.returnPolicyId || "");
        setLocation(data.suggestions.merchantLocationKey || "");
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "Unable to load eBay."),
      );
  }, []);

  useEffect(() => {
    for (const preset of PRESETS) {
      void fetch(`/api/ebay/publish/images?sku=${encodeURIComponent(preset.sku)}`, {
        cache: "no-store",
      })
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Unable to load scans.");
          return data as { frontUrl: string | null; backUrl: string | null };
        })
        .then((data) => {
          patch(preset.id, {
            imageUrls: { front: data.frontUrl, back: data.backUrl },
            uploadStatus: data.frontUrl && data.backUrl ? "ready" : "idle",
          });
        })
        .catch((reason) => {
          patch(preset.id, {
            uploadStatus: "error",
            uploadMessage:
              reason instanceof Error ? reason.message : "Unable to load scans.",
          });
        });
    }
  }, []);

  const policiesReady = useMemo(
    () =>
      Boolean(
        setup &&
          fulfillment &&
          auctionPayment &&
          fixedPayment &&
          returns &&
          location,
      ),
    [setup, fulfillment, auctionPayment, fixedPayment, returns, location],
  );
  const allScansReady = cards.every(
    (card) => Boolean(card.imageUrls.front && card.imageUrls.back),
  );

  function patch(id: string, values: Partial<CardState>) {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, ...values } : card)),
    );
  }

  async function uploadFile(card: CardState, side: ListingSide, file: File) {
    patch(card.id, {
      uploadStatus: "uploading",
      uploadMessage: `Uploading ${side} scan…`,
      status: "idle",
      message: null,
    });

    const formData = new FormData();
    formData.set("sku", card.sku);
    formData.set("side", side);
    formData.set("file", file);
    const response = await fetch("/api/ebay/publish/images", {
      method: "POST",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok || !data.imageUrl) {
      const message = data.error || `Unable to upload ${side} scan.`;
      patch(card.id, { uploadStatus: "error", uploadMessage: message });
      throw new Error(message);
    }

    setCards((current) =>
      current.map((value) => {
        if (value.id !== card.id) return value;
        const imageUrls = { ...value.imageUrls, [side]: String(data.imageUrl) };
        const ready = Boolean(imageUrls.front && imageUrls.back);
        return {
          ...value,
          imageUrls,
          uploadStatus: ready ? "ready" : "idle",
          uploadMessage: ready
            ? "Front and back exact scans are uploaded."
            : `${side === "front" ? "Front" : "Back"} uploaded; add the other side.`,
        };
      }),
    );
  }

  async function uploadExactScanKit(files: FileList | null) {
    if (bulkUploading || !files || files.length === 0) return;
    const byName = new Map(
      Array.from(files).map((file) => [normalizedFilename(file.name), file]),
    );
    const jobs: Promise<void>[] = [];
    const missing: string[] = [];

    for (const card of cards) {
      for (const side of ["front", "back"] as const) {
        const expectedName = normalizedFilename(card.expectedFiles[side]);
        const file = byName.get(expectedName);
        if (!file) {
          missing.push(card.expectedFiles[side]);
          continue;
        }
        jobs.push(uploadFile(card, side, file));
      }
    }

    if (jobs.length === 0) {
      setBulkUploadMessage(
        "No filenames matched the exact scan kit. Unzip the kit first, then select all 10 JPG files.",
      );
      return;
    }

    setBulkUploading(true);
    setBulkUploadMessage(`Uploading ${jobs.length} exact scans…`);
    try {
      const results = await Promise.allSettled(jobs);
      const failed = results.filter((result) => result.status === "rejected").length;

      if (failed > 0) {
        setBulkUploadMessage(
          `${jobs.length - failed} scans uploaded; ${failed} failed. Review the red card messages below.`,
        );
      } else if (missing.length > 0) {
        setBulkUploadMessage(
          `${jobs.length} scans uploaded. Missing: ${missing.join(", ")}`,
        );
      } else {
        setBulkUploadMessage("All 10 exact front-and-back scans are uploaded and ready.");
      }
    } finally {
      setBulkUploading(false);
    }
  }

  async function submit(card: CardState, action: "draft" | "publish") {
    if (!policiesReady) {
      return patch(card.id, {
        status: "error",
        message: "Select all policies and a location first.",
      });
    }
    if (!card.imageUrls.front || !card.imageUrls.back) {
      return patch(card.id, {
        status: "error",
        message: "Upload both exact scans before creating the listing.",
      });
    }
    patch(card.id, {
      status: "saving",
      message: action === "draft" ? "Creating draft…" : "Publishing…",
      listingUrl: null,
    });

    try {
      const response = await fetch("/api/ebay/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          confirmation: action === "publish" ? "PUBLISH_LIVE" : undefined,
          listing: {
            sku: card.sku,
            title: card.title,
            description: card.description,
            format: card.format,
            listingDuration: card.listingDuration,
            price: card.price,
            categoryId: CATEGORY_ID,
            quantity: 1,
            imagePaths: [card.imageUrls.front, card.imageUrls.back],
            aspects: card.aspects,
            merchantLocationKey: location,
            policies: {
              fulfillmentPolicyId: fulfillment,
              paymentPolicyId:
                card.format === "AUCTION" ? auctionPayment : fixedPayment,
              returnPolicyId: returns,
            },
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "eBay rejected the listing.");
      }

      patch(card.id, {
        status: data.action === "publish" ? "published" : "drafted",
        message: data.alreadyPublished
          ? "Already live; no duplicate was created."
          : data.action === "publish"
            ? "Published live on eBay."
            : "eBay draft created.",
        listingUrl: data.listingUrl || null,
      });
      setPublishConfirmId(null);
    } catch (reason) {
      patch(card.id, {
        status: "error",
        message:
          reason instanceof Error ? reason.message : "Unable to save listing.",
      });
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-950">
        <h2 className="text-xl font-black">eBay publishing is not ready</h2>
        <p className="mt-2 text-sm font-bold">{error}</p>
        <a
          href="/api/ebay/auth"
          className="mt-4 inline-block rounded-lg bg-neutral-950 px-4 py-3 text-sm font-black text-white"
        >
          Reconnect eBay
        </a>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="rounded-2xl border bg-white p-6 font-bold">
        Loading your eBay policies and inventory locations…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
          Connected to {setup.marketplaceId} · {setup.environment}
        </p>
        <h2 className="mt-1 text-2xl font-black">Choose your eBay policies once</h2>
        <p className="mt-2 text-sm font-semibold text-neutral-600">
          The four auctions are locked to 3 days at $0.99. Wailord is locked to
          $2.49 Buy It Now.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <Select
            label="Fulfillment / shipping policy"
            value={fulfillment}
            setValue={setFulfillment}
            options={setup.policies.fulfillment.map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Return policy"
            value={returns}
            setValue={setReturns}
            options={setup.policies.return.map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Auction payment policy"
            value={auctionPayment}
            setValue={setAuctionPayment}
            options={setup.policies.payment.map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
            help="Use a policy that does not require immediate payment for a normal auction."
          />
          <Select
            label="Buy It Now payment policy"
            value={fixedPayment}
            setValue={setFixedPayment}
            options={setup.policies.payment.map((policy) => [
              policy.id,
              optionLabel(policy),
            ])}
          />
          <Select
            label="Inventory location"
            value={location}
            setValue={setLocation}
            className="lg:col-span-2"
            options={setup.locations.map((item) => [
              item.merchantLocationKey,
              `${item.name} — ${[
                item.city,
                item.stateOrProvince,
                item.postalCode,
                item.country,
              ]
                .filter(Boolean)
                .join(", ")}`,
            ])}
          />
        </div>
        {!policiesReady ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-950">
            All three business-policy types and an enabled inventory location are
            required.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-5 text-blue-950 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">
          Exact scan uploader
        </p>
        <h2 className="mt-1 text-2xl font-black">Upload all 10 scans in one shot</h2>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6">
          Download and unzip the exact scan kit, then select all 10 JPG files here.
          Filenames automatically match each front and back to the correct listing.
        </p>
        <label
          className={`mt-4 inline-flex rounded-lg px-5 py-3 text-sm font-black text-white ${
            bulkUploading
              ? "cursor-wait bg-blue-800 opacity-70"
              : "cursor-pointer bg-blue-950 hover:bg-blue-800"
          }`}
        >
          {bulkUploading ? "Uploading exact scans..." : "Select all 10 exact scans"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={bulkUploading}
            className="sr-only"
            onChange={(event) => void uploadExactScanKit(event.target.files)}
          />
        </label>
        {bulkUploadMessage ? (
          <p className="mt-4 rounded-lg border border-blue-200 bg-white px-4 py-3 text-sm font-black">
            {bulkUploadMessage}
          </p>
        ) : null}
        {allScansReady ? (
          <p className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-950">
            All five cards have exact front-and-back scans ready.
          </p>
        ) : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        {cards.map((card) => {
          const cardReady = Boolean(card.imageUrls.front && card.imageUrls.back);
          const cardUploadBusy = card.uploadStatus === "uploading";
          const cardSavingDraft =
            card.status === "saving" && card.message === "Creating draft…";
          const cardPublishing =
            card.status === "saving" && card.message === "Publishing…";
          return (
            <article key={card.id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="grid w-full grid-cols-2 gap-2 sm:w-[220px] sm:shrink-0">
                  <ScanSlot
                    label="Front"
                    url={card.imageUrls.front}
                    disabled={bulkUploading || cardUploadBusy || card.status === "saving"}
                    onFile={(file) => void uploadFile(card, "front", file)}
                  />
                  <ScanSlot
                    label="Back"
                    url={card.imageUrls.back}
                    disabled={bulkUploading || cardUploadBusy || card.status === "saving"}
                    onFile={(file) => void uploadFile(card, "back", file)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-black uppercase ${
                        card.format === "AUCTION"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-emerald-100 text-emerald-900"
                      }`}
                    >
                      {card.format === "AUCTION" ? "3-day auction" : "Buy It Now"}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-black">
                      ${card.price.toFixed(2)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-black ${
                        cardReady
                          ? "bg-blue-100 text-blue-900"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {cardReady ? "Scans ready" : "Needs scans"}
                    </span>
                  </div>
                  <label className="mt-3 block text-xs font-black uppercase text-neutral-500">
                    eBay title
                    <input
                      value={card.title}
                      maxLength={80}
                      onChange={(event) =>
                        patch(card.id, {
                          title: event.target.value,
                          status: "idle",
                          message: null,
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-bold normal-case text-neutral-950"
                    />
                  </label>
                  <p className="mt-1 text-right text-xs font-bold text-neutral-500">
                    {card.title.length}/80
                  </p>
                  <label className="mt-3 block text-xs font-black uppercase text-neutral-500">
                    Price
                    <input
                      value={card.price}
                      type="number"
                      min="0.01"
                      step="0.01"
                      onChange={(event) =>
                        patch(card.id, {
                          price: Number(event.target.value),
                          status: "idle",
                          message: null,
                        })
                      }
                      className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-bold normal-case text-neutral-950"
                    />
                  </label>
                </div>
              </div>

              {card.uploadMessage ? (
                <p
                  className={`mt-4 rounded-lg border px-4 py-3 text-sm font-bold ${
                    card.uploadStatus === "error"
                      ? "border-red-200 bg-red-50 text-red-950"
                      : "border-blue-200 bg-blue-50 text-blue-950"
                  }`}
                >
                  {card.uploadMessage}
                </p>
              ) : null}

              <details className="mt-4 rounded-lg border bg-neutral-50 p-3">
                <summary className="cursor-pointer text-sm font-black">
                  Review description
                </summary>
                <textarea
                  rows={8}
                  value={card.description}
                  onChange={(event) =>
                    patch(card.id, {
                      description: event.target.value,
                      status: "idle",
                      message: null,
                    })
                  }
                  className="mt-3 w-full rounded-lg border bg-white px-3 py-2 text-sm font-semibold leading-6"
                />
              </details>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    !policiesReady ||
                    !cardReady ||
                    bulkUploading ||
                    cardUploadBusy ||
                    card.status === "saving"
                  }
                  onClick={() => void submit(card, "draft")}
                  className="rounded-lg border bg-white px-4 py-2.5 text-sm font-black hover:bg-neutral-100 disabled:opacity-40"
                >
                  {cardSavingDraft ? "Creating draft..." : "Create eBay draft"}
                </button>
                <button
                  type="button"
                  disabled={
                    !policiesReady ||
                    !cardReady ||
                    bulkUploading ||
                    cardUploadBusy ||
                    card.status === "saving"
                  }
                  onClick={() => setPublishConfirmId(card.id)}
                  className="rounded-lg bg-neutral-950 px-4 py-2.5 text-sm font-black text-white hover:bg-neutral-800 disabled:opacity-40"
                >
                  {cardPublishing ? "Publishing..." : "Publish live on eBay"}
                </button>
              </div>

              {publishConfirmId === card.id ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                  <p className="text-sm font-black">
                    Confirm live eBay publish for {card.title} as a{" "}
                    {card.format === "AUCTION"
                      ? "$0.99 3-day auction"
                      : "$2.49 Buy It Now listing"}
                    .
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={card.status === "saving"}
                      onClick={() => void submit(card, "publish")}
                      className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                    >
                      {cardPublishing ? "Publishing..." : "Confirm live publish"}
                    </button>
                    <button
                      type="button"
                      disabled={card.status === "saving"}
                      onClick={() => setPublishConfirmId(null)}
                      className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-black disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {card.message ? (
                <div
                  className={`mt-4 rounded-lg border px-4 py-3 text-sm font-bold ${
                    card.status === "error"
                      ? "border-red-200 bg-red-50 text-red-950"
                      : card.status === "published"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                        : "border-blue-200 bg-blue-50 text-blue-950"
                  }`}
                >
                  <p>{card.message}</p>
                  {card.listingUrl ? (
                    <a
                      href={card.listingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block underline"
                    >
                      Open live eBay listing
                    </a>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}

function ScanSlot({
  label,
  url,
  disabled = false,
  onFile,
}: {
  label: string;
  url: string | null;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <div className="relative aspect-[5/7] overflow-hidden rounded-lg border bg-neutral-100">
      {url ? (
        <img src={url} alt={`${label} scan`} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center p-3 text-center text-xs font-black text-neutral-500">
          Add {label.toLowerCase()} scan
        </div>
      )}
      <label
        className={`absolute inset-x-1 bottom-1 rounded px-2 py-1.5 text-center text-[10px] font-black uppercase text-white ${
          disabled
            ? "cursor-wait bg-neutral-700/80"
            : "cursor-pointer bg-neutral-950/90"
        }`}
      >
        {disabled ? "Working..." : url ? `Replace ${label}` : `Upload ${label}`}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            if (disabled) return;
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
    </div>
  );
}

function Select({
  label,
  value,
  setValue,
  options,
  help,
  className = "",
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
  options: Array<[string, string]>;
  help?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm font-black ${className}`}>
      {label}
      <select
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="mt-1 w-full rounded-lg border bg-white px-3 py-3 text-sm font-bold"
      >
        <option value="">Select one…</option>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      {help ? (
        <span className="mt-1 block text-xs font-semibold text-neutral-500">
          {help}
        </span>
      ) : null}
    </label>
  );
}
