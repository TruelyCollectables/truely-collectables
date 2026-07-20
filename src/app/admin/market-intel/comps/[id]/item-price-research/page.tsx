import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../../lib/admin-handoff";
import { captureMarketIntelObservation } from "../../../../../../lib/market-intel-observations";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

type JsonRecord = Record<string, unknown>;

const fieldClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-black";

function numberField(formData: FormData, name: string, fallback = 0) {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function metadataOf(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown) {
  const parsed = nullableNumber(value);
  return parsed === null ? "—" : `$${parsed.toFixed(2)}`;
}

function percentage(value: number | null) {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

async function saveItemPriceResearch(formData: FormData) {
  "use server";

  const identityId = String(formData.get("identityId") || "").trim();
  const observedOn = String(formData.get("observedOn") || "").trim();
  const sourceUrl = String(formData.get("sourceUrl") || "").trim();

  try {
    const guidePrice = numberField(formData, "guidePrice");
    const historicSaleCount = Math.round(
      numberField(formData, "historicSaleCount"),
    );
    const notes = String(formData.get("notes") || "").trim();
    const acknowledged =
      formData.get("acknowledgeShippingExcluded") === "on";

    if (!identityId || !observedOn || !sourceUrl) {
      throw new Error("Identity, observed date, and source URL are required.");
    }
    if (guidePrice <= 0) {
      throw new Error("Item-only guide price must be greater than zero.");
    }
    if (!Number.isInteger(historicSaleCount) || historicSaleCount < 0) {
      throw new Error("Historic sale count must be a non-negative whole number.");
    }
    if (!acknowledged) {
      throw new Error(
        "Confirm that the source excludes shipping and is not a delivered-price sold comp.",
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      throw new Error("Source URL must be a valid http(s) URL.");
    }
    if (!/^https?:$/.test(parsedUrl.protocol)) {
      throw new Error("Source URL must use http or https.");
    }
    if (!/(^|\.)sportscardspro\.com$/i.test(parsedUrl.hostname)) {
      throw new Error(
        "This research lane currently accepts SportsCardsPro source pages only.",
      );
    }

    const observedAt = new Date(`${observedOn}T12:00:00Z`);
    if (Number.isNaN(observedAt.getTime())) {
      throw new Error("Observed date is invalid.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: identity, error: identityError } = await supabase
      .from("tcos_mi_collectible_identities")
      .select("id,subject_id,display_name,active")
      .eq("id", identityId)
      .eq("active", true)
      .single();
    if (identityError || !identity) {
      throw new Error(identityError?.message || "Exact identity was not found.");
    }

    await captureMarketIntelObservation({
      sourceType: "market_snapshot",
      sourceId: `sportscardspro:item-only-guide:${identityId}`,
      subjectId: identity.subject_id || null,
      collectibleIdentityId: identity.id,
      sourceUrl: parsedUrl.toString(),
      title: `${identity.display_name} — SportsCardsPro ungraded guide`,
      quantity: 1,
      askingPrice: guidePrice,
      shippingPrice: 0,
      buyerFee: 0,
      deliveredPrice: guidePrice,
      marketValue: guidePrice,
      marketSampleSize: historicSaleCount,
      observedAt: observedAt.toISOString(),
      metadata: {
        research_evidence_class: "external_item_price_guide",
        source_slug: "sportscardspro",
        source_display_name: "SportsCardsPro",
        source_attribution: "SportsCardsPro",
        price_basis: "item_only",
        shipping_included: false,
        shipping_status: "excluded_by_source_methodology",
        delivered_price_usable: false,
        sold_comp_valuation_allowed: false,
        actionable: false,
        source_attribution_required: true,
        source_notes: notes || null,
      },
    });

    revalidatePath(
      `/admin/market-intel/comps/${identityId}/item-price-research`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to save item-only price research.";
    redirect(
      `/admin/market-intel/comps/${identityId}/item-price-research?error=${encodeURIComponent(message)}`,
    );
  }

  redirect(
    `/admin/market-intel/comps/${identityId}/item-price-research?saved=1`,
  );
}

export default async function ItemPriceResearchPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const supabase = createSupabaseServerClient({ admin: true });

  const [identityResult, observationsResult, listingsResult, compCountResult] =
    await Promise.all([
      supabase
        .from("tcos_mi_collectible_identities")
        .select(
          "id,subject_id,display_name,identity_key,condition_type,card_number,parallel_name,variation_name,active",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("tcos_mi_market_observations")
        .select(
          "id,observed_at,observed_on,source_url,title,market_value,market_sample_size,metadata",
        )
        .eq("collectible_identity_id", id)
        .order("observed_at", { ascending: false })
        .limit(100),
      supabase
        .from("tcos_mi_listings")
        .select(
          "id,external_listing_id,direct_url,original_title,asking_price,shipping_price,buyer_fee,delivered_price,listing_status,seller_name",
        )
        .eq("collectible_identity_id", id)
        .eq("listing_status", "active")
        .order("delivered_price", { ascending: true }),
      supabase
        .from("tcos_mi_sold_comps")
        .select("id", { count: "exact", head: true })
        .eq("collectible_identity_id", id)
        .eq("verified", true)
        .eq("excluded", false)
        .eq("outlier_flag", false),
    ]);

  for (const result of [
    identityResult,
    observationsResult,
    listingsResult,
    compCountResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!identityResult.data) notFound();

  const identity = identityResult.data;
  const subjectResult = identity.subject_id
    ? await supabase
        .from("tcos_mi_subjects")
        .select("id,name")
        .eq("id", identity.subject_id)
        .maybeSingle()
    : { data: null, error: null };
  if (subjectResult.error) throw new Error(subjectResult.error.message);

  const observations = (observationsResult.data || []).filter((row) => {
    const metadata = metadataOf(row.metadata);
    return (
      metadata.research_evidence_class === "external_item_price_guide" &&
      metadata.source_slug === "sportscardspro"
    );
  });
  const latest = observations[0] || null;
  const latestGuide = nullableNumber(latest?.market_value);
  const listings = listingsResult.data || [];

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff(`/admin/market-intel/comps/${id}`, handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Exact-Card Market
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            {subjectResult.data?.name || "Exact card"} · Research-only evidence
          </p>
          <h1 className="mt-2 max-w-5xl text-3xl font-black md:text-5xl">
            Item-Only Price Guide Research
          </h1>
          <p className="mt-3 max-w-5xl font-semibold leading-7 text-neutral-300">
            {identity.display_name}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "1" ? (
          <Notice>Item-only price research saved without changing sold comps or deal scoring.</Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-900">
            Shipping-excluded evidence
          </p>
          <h2 className="mt-2 text-2xl font-black text-amber-950">
            Never treat this as a delivered-price sold comp.
          </h2>
          <p className="mt-3 max-w-5xl font-semibold leading-7 text-amber-950">
            SportsCardsPro says its historic prices exclude shipping and transaction costs.
            TCOS stores this lane only as attributed item-price research. It cannot create
            a verified sold comp, market-value snapshot, actionable deal, purchase, or
            automatic pricing decision.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Latest Item-Only Guide" value={money(latestGuide)} />
          <Metric
            label="Guide Sales Referenced"
            value={String(latest?.market_sample_size ?? 0)}
          />
          <Metric label="Active Listings" value={String(listings.length)} />
          <Metric
            label="Verified Delivered Comps"
            value={String(compCountResult.count || 0)}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Save Price Guide Evidence</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              Manually transcribe the public ungraded guide and sale-count summary. TCOS
              preserves the link and attribution but blocks this row from sold-comp valuation.
            </p>

            <form action={saveItemPriceResearch} className="mt-5 space-y-4">
              <input type="hidden" name="identityId" value={identity.id} />
              <Input
                name="sourceUrl"
                label="SportsCardsPro card page"
                type="url"
                required
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input
                  name="guidePrice"
                  label="Ungraded item-only guide"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                />
                <Input
                  name="historicSaleCount"
                  label="Historic sales shown"
                  type="number"
                  min="0"
                  step="1"
                  required
                />
                <Input
                  name="observedOn"
                  label="Observed date"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                />
              </div>
              <label className="block text-sm font-black">
                Research notes
                <textarea
                  name="notes"
                  rows={4}
                  className={fieldClass}
                  placeholder="Example: 24 ungraded sales shown; sealed packs and pre-grade listings require separate review."
                />
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-black text-amber-950">
                <input
                  name="acknowledgeShippingExcluded"
                  type="checkbox"
                  required
                  className="mt-1"
                />
                I confirm this source excludes shipping. Save it as item-only research,
                not as a verified delivered-price sold comp.
              </label>
              <button
                type="submit"
                className="w-full rounded-md bg-neutral-950 px-5 py-3 font-black text-white hover:bg-black"
              >
                SAVE RESEARCH-ONLY EVIDENCE
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Live Listing Comparison</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              Asking price can be compared with an item-only guide. Delivered price is shown
              separately because the guide excludes shipping.
            </p>

            {listings.length === 0 ? (
              <p className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 font-semibold text-neutral-600">
                No active listings are attached to this exact identity.
              </p>
            ) : (
              <div className="mt-5 space-y-4">
                {listings.map((listing) => {
                  const asking = Number(listing.asking_price || 0);
                  const delivered = Number(listing.delivered_price || 0);
                  const askDifference =
                    latestGuide && latestGuide > 0
                      ? ((asking - latestGuide) / latestGuide) * 100
                      : null;
                  const deliveredDifference =
                    latestGuide && latestGuide > 0
                      ? ((delivered - latestGuide) / latestGuide) * 100
                      : null;

                  return (
                    <article
                      key={listing.id}
                      className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"
                    >
                      <a
                        href={listing.direct_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-black hover:underline"
                      >
                        {listing.original_title}
                      </a>
                      <p className="mt-1 text-sm font-semibold text-neutral-600">
                        {listing.seller_name || "Unknown seller"} · item {money(asking)} ·
                        shipping {money(listing.shipping_price)} · delivered {money(delivered)}
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Stat
                          label="Item vs Guide"
                          value={percentage(askDifference)}
                        />
                        <Stat
                          label="Delivered vs Item Guide"
                          value={percentage(deliveredDifference)}
                          warning
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>

        <section className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Research Evidence History</h2>
          {observations.length === 0 ? (
            <p className="mt-4 font-semibold text-neutral-600">
              No item-only price guide observations have been saved yet.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {observations.map((observation) => {
                const metadata = metadataOf(observation.metadata);
                return (
                  <article
                    key={observation.id}
                    className="rounded-xl border border-cyan-200 bg-cyan-50 p-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-900">
                          ITEM ONLY · SHIPPING EXCLUDED · NON-ACTIONABLE
                        </p>
                        <p className="mt-2 text-2xl font-black text-cyan-950">
                          {money(observation.market_value)}
                        </p>
                      </div>
                      <p className="text-sm font-black text-cyan-950">
                        {new Date(observation.observed_at).toLocaleDateString()}
                      </p>
                    </div>
                    <p className="mt-3 font-semibold text-cyan-950">
                      {observation.market_sample_size || 0} historic sales referenced
                    </p>
                    {metadata.source_notes ? (
                      <p className="mt-2 text-sm font-semibold leading-6 text-cyan-950">
                        {String(metadata.source_notes)}
                      </p>
                    ) : null}
                    {observation.source_url ? (
                      <a
                        href={observation.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex rounded-md bg-cyan-950 px-4 py-2 text-sm font-black text-white hover:bg-black"
                      >
                        OPEN ATTRIBUTED SOURCE →
                      </a>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  min?: string;
  step?: string;
  required?: boolean;
}) {
  const { label, ...inputProps } = props;
  return (
    <label className="block text-sm font-black">
      {label}
      <input {...inputProps} className={fieldClass} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div
      className={
        warning
          ? "rounded-lg border border-amber-200 bg-amber-50 p-3"
          : "rounded-lg border border-neutral-200 bg-white p-3"
      }
    >
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={
        error
          ? "rounded-xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900"
          : "rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"
      }
    >
      {children}
    </div>
  );
}
