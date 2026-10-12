"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { getFreshAccountSession } from "../../account/account-session";
type PreviewRow = { line: number; externalId: string; title?: string; status: string; errors: string[]; identity?: Record<string, string | number | boolean | null>; front?: { url: string }; back?: { url: string }; };
type Preview = { token: string; canImport: boolean; counts: { total: number; ready: number; duplicate: number; error: number }; rows: PreviewRow[] };
async function authHeaders() {
  const session = await getFreshAccountSession().catch(() => null);
  return { Authorization: "Bearer " + (session?.access_token || "kingmaker-local-admin-cookie") };
}
function SideImage({ url, label }: { url: string; label: string }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let live = true; let objectUrl = "";
    (async () => { const response = await fetch(url, { headers: await authHeaders() }); if (!response.ok) return; objectUrl = URL.createObjectURL(await response.blob()); if (live) setSource(objectUrl); else URL.revokeObjectURL(objectUrl); })().catch(() => {});
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return source ? <img src={source} alt={label} className="h-28 w-20 object-contain" /> : <span className="text-xs text-slate-400">{label}</span>;
}
export default function VerifiedCsvPage() {
  const [csv, setCsv] = useState<File | null>(null);
  const [images, setImages] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [imported, setImported] = useState(false);
  async function run(commit: boolean) {
    setBusy(true); setMessage("");
    try {
      const headers = new Headers(await authHeaders());
      let body: FormData | string;
      if (commit) { headers.set("Content-Type", "application/json"); body = JSON.stringify({ action: "commit", token: preview?.token }); }
      else { if (!csv) throw new Error("Select a CSV."); const form = new FormData(); form.set("csv_file", csv); images.forEach(image => form.append("images", image, image.name)); body = form; }
      const response = await fetch("/api/kingmaker/verified-csv", { method: "POST", headers, body });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || "Import failed.");
      if (commit) { setImported(true); setMessage(result.imported + " imported · " + result.duplicates + " duplicates · " + result.verificationRequired + " need AI verification. Cards are in Master Listings for pricing."); }
      else { setPreview(result); setConfirmed(false); setImported(false); setMessage("Preview ready. Check every card and its front/back photographs before certifying."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }
  function reset() { setPreview(null); setConfirmed(false); setImported(false); }
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <div><h1 className="text-3xl font-black">Verified CSV Intake</h1><p className="mt-2 text-slate-300">Fully verified cards go directly to pricing and listing. Verified identity and both photographs remain locked; InstaComp disagreements become separate learning lessons.</p></div>
    <section className="space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-5">
      <a href="/api/kingmaker/verified-csv?template=1" className="font-bold text-emerald-300">Download exact CSV template</a>
      <p className="text-sm text-slate-300">One row per physical card. Use schema_version=1 and a permanent external_id. Use Base for a base parallel and true/false for autograph, memorabilia, patch, and rookie. Keep card numbers and serials as text to preserve leading zeroes.</p>
      <p className="text-sm text-slate-300">front_image and back_image can be uploaded filenames (select all matching photos below), public HTTPS URLs, or paths inside the Mac’s verified-csv-inbox. Relative paths start at that inbox. The import snapshots the original bytes and checks their hashes. Maximum: 200 cards, 12 MiB per photo, 256 MiB of photos per batch.</p>
      <label className="block font-bold">Card CSV<input aria-label="Card CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { setCsv(event.target.files?.[0] || null); reset(); }} className="mt-2 block w-full rounded border border-slate-600 p-3" /></label>
      <label className="block font-bold">Matching front and back photos<input aria-label="Matching front and back photos" type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { setImages(Array.from(event.target.files || [])); reset(); }} className="mt-2 block w-full rounded border border-slate-600 p-3" /></label>
      <button disabled={busy || !csv} onClick={() => run(false)} className="rounded bg-emerald-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-40">{busy ? "Processing…" : "Preview and validate"}</button>
    </section>
    <p role="status" aria-live="polite" className="text-emerald-200">{message}</p>
    {preview && <section className="space-y-4">
      <div className="flex flex-wrap gap-4 rounded border border-slate-700 p-4"><span>{preview.counts.total} rows</span><span>{preview.counts.ready} ready for pricing</span><span>{preview.counts.duplicate} duplicates</span><span>{preview.counts.error} errors</span><span>Queue: Master Listings</span></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>CSV line / ID</th><th>Verified card</th><th>Front / back</th><th>Result</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.line} className="border-t border-slate-700"><td className="p-3">{row.line}<br />{row.externalId}</td><td className="p-3">{row.title || "Invalid row"}{row.identity && <details className="mt-2"><summary className="cursor-pointer text-emerald-300">All verified fields</summary><dl className="mt-2 grid grid-cols-2 gap-2">{Object.entries(row.identity).map(([field, value]) => <div key={field}><dt className="text-slate-400">{field.replaceAll("_", " ")}</dt><dd>{value === null || value === "" ? "—" : String(value)}</dd></div>)}</dl></details>}</td><td className="flex gap-2 p-3">{row.front && <SideImage url={row.front.url} label="Verified front" />}{row.back && <SideImage url={row.back.url} label="Verified back" />}</td><td className="p-3">{row.status}{row.errors.map(error => <p className="mt-2 text-red-300" key={error}>{error}</p>)}</td></tr>)}</tbody></table></div>
      {!imported && <><label className="flex gap-3"><input type="checkbox" checked={confirmed} disabled={busy || !preview.canImport} onChange={event => setConfirmed(event.target.checked)} /><span>I certify every card field and both photographs are 100% verified and ready for pricing and listing.</span></label>
      <button disabled={busy || !confirmed || !preview.canImport} onClick={() => run(true)} className="rounded bg-emerald-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-40">Import verified cards</button></>}
      <Link href="/kingmaker/listings" className="ml-4 font-bold text-emerald-300">Open Master Listings →</Link>
    </section>}
  </main>;
}
