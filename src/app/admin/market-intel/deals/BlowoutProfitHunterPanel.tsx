"use client";

import { useMemo, useState } from "react";
import {
  BLOWOUT_RESEARCH_POLICY,
  buildBlowoutResearchLinks,
} from "../../../../lib/blowout-research";

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold outline-none focus:border-black";

type ResearchFields = {
  player: string;
  sport: string;
  year: string;
  setName: string;
  cardNumber: string;
  parallel: string;
};

const emptyFields: ResearchFields = {
  player: "",
  sport: "",
  year: "",
  setName: "",
  cardNumber: "",
  parallel: "",
};

export default function BlowoutProfitHunterPanel() {
  const [fields, setFields] = useState<ResearchFields>(emptyFields);
  const hasInput = Object.values(fields).some((value) => value.trim().length > 0);
  const links = useMemo(
    () => (hasInput ? buildBlowoutResearchLinks(fields) : []),
    [fields, hasInput],
  );

  function updateField(name: keyof ResearchFields, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  return (
    <section
      id="blowout-research"
      className="border-t border-neutral-300 bg-[#f4f1ea] px-6 pb-10 pt-2 text-neutral-950"
    >
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-2xl border border-amber-300 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-black text-amber-950">
                  BLOWOUT: INDEXED RESEARCH
                </span>
                <span className="rounded-full border border-violet-300 bg-violet-100 px-3 py-1 text-xs font-black text-violet-950">
                  BARGAIN DISCOVERY ONLY
                </span>
              </div>
              <h2 className="mt-3 text-3xl font-black">
                Blowout bargain search inside Profit Hunter
              </h2>
              <p className="mt-2 max-w-4xl font-semibold leading-7 text-neutral-700">
                Build public search-index links for priced forum threads, lots, collection
                liquidations, price drops, and possible mislists. Open and verify the thread,
                then enter the live opportunity through Profit Hunter&apos;s Add Live Listing form.
              </p>
            </div>
            <a
              href="#top"
              className="w-fit rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white"
            >
              BACK TO BUYING DESK ↑
            </a>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-5">
              <h3 className="text-xl font-black">Search one Profit Hunter target</h3>
              <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">
                Enter the same player and exact-card details used by the rest of Profit Hunter.
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Player or subject"
                  value={fields.player}
                  onChange={(value) => updateField("player", value)}
                  wide
                />
                <Field
                  label="Sport or category"
                  value={fields.sport}
                  onChange={(value) => updateField("sport", value)}
                />
                <Field
                  label="Year"
                  value={fields.year}
                  onChange={(value) => updateField("year", value)}
                />
                <Field
                  label="Set or product"
                  value={fields.setName}
                  onChange={(value) => updateField("setName", value)}
                  wide
                />
                <Field
                  label="Card number"
                  value={fields.cardNumber}
                  onChange={(value) => updateField("cardNumber", value)}
                />
                <Field
                  label="Parallel or variation"
                  value={fields.parallel}
                  onChange={(value) => updateField("parallel", value)}
                />
              </div>

              <button
                type="button"
                onClick={() => setFields(emptyFields)}
                className="mt-4 rounded-md border border-neutral-400 bg-white px-4 py-2 text-sm font-black"
              >
                Clear Search
              </button>

              <div className="mt-5 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-950">
                TCOS opens no forum pages itself. You choose a Google or Bing result, verify the
                seller and cards manually, then save only a real available thread into Profit Hunter.
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
                Profit Hunter source searches
              </p>
              <h3 className="mt-1 text-2xl font-black">
                {links.length
                  ? `${links.length} controlled Blowout search families`
                  : "Enter a player, set, or exact card"}
              </h3>

              {links.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {links.map((link) => (
                    <article
                      key={link.id}
                      className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"
                    >
                      <h4 className="font-black">{link.label}</h4>
                      <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">
                        {link.reason}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={link.googleUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md bg-neutral-950 px-3 py-2 text-xs font-black text-white"
                        >
                          GOOGLE
                        </a>
                        <a
                          href={link.bingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-neutral-400 bg-white px-3 py-2 text-xs font-black"
                        >
                          BING
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-lg border border-dashed border-neutral-300 p-5 font-semibold text-neutral-600">
                  Search links stay empty until you enter a real Profit Hunter target.
                </p>
              )}
            </div>
          </div>

          <details className="mt-5 rounded-xl border border-neutral-300 bg-neutral-50 p-4">
            <summary className="cursor-pointer font-black">
              Blowout safety and review rules
            </summary>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <PolicyList
                title="Never automate"
                items={BLOWOUT_RESEARCH_POLICY.prohibitedActions}
              />
              <PolicyList
                title="Verify before saving"
                items={BLOWOUT_RESEARCH_POLICY.operatorChecks}
              />
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={`text-sm font-black ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function PolicyList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div>
      <h4 className="font-black">{title}</h4>
      <ul className="mt-2 space-y-2 text-sm font-semibold leading-6 text-neutral-700">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}
