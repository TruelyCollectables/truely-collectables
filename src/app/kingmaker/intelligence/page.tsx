import {
  INSTACOMP_CAPABILITIES,
  INSTACOMP_CAPABILITY_KEYS,
} from "../../../lib/instacomp-capabilities";

export default function KingmakerIntelligencePage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-blue-300">
          Shared intelligence architecture
        </p>
        <h1 className="mt-2 text-4xl font-black">InstaComp AI capabilities</h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">
          KINGMAKER requests these capabilities through one typed registry. InstaComp analyzes and recommends; the central Checklist Registry owns canonical identity; KINGMAKER owns seller approval and execution.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {INSTACOMP_CAPABILITY_KEYS.map((key) => {
            const capability = INSTACOMP_CAPABILITIES[key];
            return (
              <article
                key={key}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
              >
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {key}
                </p>
                <h2 className="mt-2 text-lg font-black">{capability.label}</h2>
                <p className="mt-2 leading-6 text-slate-400">
                  {capability.description}
                </p>
                <dl className="mt-4 grid gap-2 text-xs">
                  <div className="flex justify-between gap-3 rounded-lg bg-slate-950 px-3 py-2">
                    <dt className="text-slate-500">Registry identity</dt>
                    <dd className="font-bold text-slate-200">
                      {capability.identityRequired ? "Required" : "When applicable"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 rounded-lg bg-slate-950 px-3 py-2">
                    <dt className="text-slate-500">Worker</dt>
                    <dd className="font-bold text-slate-200">
                      {capability.workerPreference.replaceAll("_", " ")}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 rounded-lg bg-slate-950 px-3 py-2">
                    <dt className="text-slate-500">Seller mutation</dt>
                    <dd className="font-bold text-red-300">Forbidden</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
