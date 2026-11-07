"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Provider = "facebook" | "instagram" | "threads" | "pinterest" | "tiktok" | "x";
type CampaignOption = {
  id: string; name: string; percentOff: number; status: string; startsAt: string; endsAt: string | null;
  scopeType: "all" | "filter" | "products";
  scope: { sections?: string[]; productIds?: number[]; players?: string[]; search?: string; minPrice?: number | null; maxPrice?: number | null };
};
type Connection = { provider: Provider; label: string; configured: boolean; connected: boolean; status: string; accountLabel: string | null; lastError: string | null };
type Draft = { id: string; provider: Provider; status: string; title: string | null; text_content: string; hashtags: string[]; image_url: string | null; scheduled_for: string | null; provider_post_url: string | null; last_error: string | null; generator: string };
type Attempt = { id: string; provider: Provider; outcome: string; provider_post_url: string | null; error_message: string | null; attempted_at: string };

const PLATFORM_HINTS: Record<Provider, string> = {
  facebook: "Strong hook + clear CTA • conversational • up to 3 useful hashtags",
  instagram: "Visual caption • readable line breaks • 3-5 relevant hashtags • <=2,200 chars",
  threads: "Natural conversation • concise CTA • 0-2 hashtags • <=500 chars",
  pinterest: "Searchable title <=100 • accurate description <=500 • keyword-focused",
  tiktok: "Punchy title <=90 • energetic photo caption • 3-5 relevant hashtags",
  x: "Manual X composer • text prefilled • sale graphic copied to clipboard • <=280 chars • no posting API charge",
};

function generatorLabel(value: string) {
  if (value === "cloudflare-workers-ai") return "Cloudflare Workers AI (free-first)";
  if (value === "template-fallback" || value === "template") return "built-in template";
  if (value === "openai") return "OpenAI";
  return value || "built-in template";
}

export default function SocialPublisherClient({ campaigns }: { campaigns: CampaignOption[] }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const effectiveCampaignId = campaigns.some((campaign) => campaign.id === campaignId)
    ? campaignId
    : campaigns[0]?.id || "";

  const load = useCallback(async () => {
    const socialUrl = new URL("/api/admin/social", window.location.origin);
    if (effectiveCampaignId) socialUrl.searchParams.set("campaignId", effectiveCampaignId);
    const response = await fetch(socialUrl.toString(), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Social publisher could not be loaded.");
    setConnections(data.connections || []);
    setDrafts(data.drafts || []);
    setAttempts(data.attempts || []);
    const connected = new Set((data.connections || []).filter((item: Connection) => item.connected && item.provider !== "x").map((item: Connection) => item.provider));
    setSelected((current) => current.filter((id) => (data.drafts || []).some((draft: Draft) => draft.id === id && draft.provider !== "x" && connected.has(draft.provider))));
  }, [effectiveCampaignId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((error) => setMessage(error.message)), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("social");
    const status = params.get("status");
    const detail = params.get("message");
    if (!provider || !status) return;
    const timer = window.setTimeout(() => setMessage(detail || `${provider}: ${status.replaceAll("-", " ")}`), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const connectionMap = useMemo(() => new Map(connections.map((connection) => [connection.provider, connection])), [connections]);
  const currentCampaign = campaigns.find((campaign) => campaign.id === effectiveCampaignId) || null;

  async function generate() {
    if (!effectiveCampaignId) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/social/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: effectiveCampaignId }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Social posts could not be generated.");
      setMessage(`Starter drafts are ready${data.generator === "openai" ? " from OpenAI" : " from the no-cost built-in templates"}. Use each AI Generate button to polish copy with free-first Cloudflare Workers AI, then review and post.`);
      await load();
      const connected = new Set(connections.filter((item) => item.connected && item.provider !== "x").map((item) => item.provider));
      setSelected((data.drafts || []).filter((draft: Draft) => draft.provider !== "x" && connected.has(draft.provider) && draft.status !== "published").map((draft: Draft) => draft.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function aiGenerateDraft(draft: Draft) {
    if (!currentCampaign) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/social/ai-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: draft.provider,
          currentText: draft.text_content,
          campaign: {
            name: currentCampaign.name,
            percentOff: currentCampaign.percentOff,
            startsAt: currentCampaign.startsAt,
            endsAt: currentCampaign.endsAt,
            scopeType: currentCampaign.scopeType,
            scope: currentCampaign.scope,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "AI copy could not be generated.");
      setDrafts((current) => current.map((item) => item.id === draft.id ? {
        ...item,
        title: data.title == null ? null : String(data.title),
        text_content: String(data.text || item.text_content),
        hashtags: Array.isArray(data.hashtags) ? data.hashtags.map(String) : item.hashtags,
        generator: String(data.generator || item.generator),
      } : item));
      const label = connectionMap.get(draft.provider)?.label || draft.provider;
      setMessage(data.generator === "cloudflare-workers-ai"
        ? `${label} copy generated with free-first Cloudflare Workers AI. Review it, then Save edits.`
        : `${label}: free AI was unavailable, so a safe built-in draft was generated instead. Review it, then Save edits.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function openXComposer(draft: Draft) {
    const popup = window.open("", "truely-x-compose", "popup=yes,width=720,height=760,scrollbars=yes,resizable=yes");
    if (!popup) { setMessage("Your browser blocked the X composer popup. Allow popups for Truely Collectables and try again."); return; }
    try {
      popup.document.title = "Preparing X post…";
      popup.document.body.innerHTML = '<p style="font-family:system-ui;padding:24px">Preparing your X post…</p>';
    } catch { /* popup still exists; navigation below can continue */ }
    setBusy(true); setMessage("");
    try {
      const saveResponse = await fetch("/api/admin/social/post", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: draft.id, title: draft.title, text: draft.text_content, hashtags: draft.hashtags, generator: draft.generator }),
      });
      const saveData = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok) throw new Error(saveData.error || "X draft could not be saved.");

      let imageCopied = false;
      if (draft.image_url && navigator.clipboard?.write) {
        const ClipboardItemCtor = (window as any).ClipboardItem;
        if (ClipboardItemCtor) {
          try {
            const imageResponse = await fetch(draft.image_url, { cache: "no-store" });
            if (imageResponse.ok) {
              const blob = await imageResponse.blob();
              const type = blob.type || "image/png";
              await navigator.clipboard.write([new ClipboardItemCtor({ [type]: blob })]);
              imageCopied = true;
            }
          } catch { /* text compose still works when clipboard image permission is unavailable */ }
        }
      }

      const intent = new URL("https://x.com/intent/tweet");
      intent.searchParams.set("text", draft.text_content.slice(0, 280));
      popup.location.href = intent.toString();
      setMessage(imageCopied
        ? "X composer opened with your post text. The sale graphic is copied — press ⌘V in X, review it, then click Post. No X posting API charge."
        : "X composer opened with your post text. Add the sale graphic manually if you want it, review, then click Post. No X posting API charge.");
      await load();
    } catch (error) {
      try { popup.close(); } catch { /* no-op */ }
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  async function saveDraft(draft: Draft) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/social/post", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: draft.id, title: draft.title, text: draft.text_content, hashtags: draft.hashtags, generator: draft.generator }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Draft could not be saved.");
      setMessage(`${connectionMap.get(draft.provider)?.label || draft.provider} draft saved.`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function publish(schedule: boolean) {
    if (!selected.length) { setMessage("Select at least one connected social network."); return; }
    setBusy(true); setMessage("");
    try {
      const when = schedule && scheduledFor ? new Date(scheduledFor).toISOString() : null;
      if (schedule && !when) throw new Error("Choose a date and time to schedule the posts.");
      const response = await fetch("/api/admin/social/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postIds: selected, scheduledFor: when }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Social publishing failed.");
      if (data.scheduled) setMessage(`${data.results?.length || 0} social post(s) scheduled.`);
      else {
        const results = data.results || [];
        const ok = results.filter((item: any) => item.ok).length;
        const failed = results.filter((item: any) => item.ok === false).length;
        setMessage(`Social publish finished: ${ok} posted${failed ? `, ${failed} failed` : ""}.`);
      }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function disconnect(provider: Provider) {
    if (!window.confirm(`Disconnect ${connectionMap.get(provider)?.label || provider}?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/social/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Disconnect failed.");
      setMessage(`${provider} disconnected.`); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-8 rounded-2xl border border-neutral-300 bg-neutral-950 p-5 text-white shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-red-300">Social campaign publisher</p>
      <h2 className="mt-1 text-3xl font-black">Turn a sale into posts everywhere</h2>
      <p className="mt-2 max-w-4xl text-sm text-neutral-300">Generate platform-specific copy and a branded sale graphic, edit it, then post to every connected account with one button. Each draft has a free-first AI generator tuned to that platform’s limits and posting style; it falls back safely instead of silently spending OpenAI credits.</p>

      {message ? <div className="mt-4 rounded border border-amber-400/50 bg-amber-300/10 p-3 font-bold text-amber-100">{message}</div> : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {connections.map((connection) => (
          <div key={connection.provider} className="rounded-xl border border-neutral-700 bg-neutral-900 p-4">
            <div className="flex items-center justify-between gap-3"><strong>{connection.label}</strong><span className={`rounded-full px-2 py-1 text-xs font-black ${connection.connected ? "bg-emerald-900 text-emerald-200" : "bg-neutral-800 text-neutral-300"}`}>{connection.connected ? "CONNECTED" : "NOT CONNECTED"}</span></div>
            <p className="mt-2 min-h-5 text-sm text-neutral-400">{connection.accountLabel || (connection.configured ? "Ready for account authorization." : "Developer app credentials can be added later.")}</p>
            {connection.lastError ? <p className="mt-2 text-xs font-bold text-red-300">{connection.lastError}</p> : null}
            <div className="mt-3 flex gap-2">
              {connection.connected ? <button type="button" disabled={busy} onClick={() => void disconnect(connection.provider)} className="rounded border border-neutral-600 px-3 py-2 text-sm font-bold">Disconnect</button> : connection.configured ? <a href={`/api/admin/social/connect/${connection.provider}`} className="rounded bg-white px-3 py-2 text-sm font-black text-neutral-950">Connect</a> : <span className="rounded border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-500">Setup available when ready</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-neutral-700 bg-white p-5 text-neutral-950">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="w-full max-w-xl font-bold">Sale to promote<select value={effectiveCampaignId} onChange={(event) => setCampaignId(event.target.value)} className="mt-2 min-h-11 w-full rounded border px-3"><option value="">Choose a sale</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} — {campaign.percentOff}% off ({campaign.status})</option>)}</select></label>
          <button type="button" disabled={busy || !effectiveCampaignId} onClick={() => void generate()} className="min-h-11 rounded bg-red-700 px-5 font-black text-white disabled:opacity-50">{drafts.length ? "Regenerate posts" : "Generate social campaign"}</button>
        </div>
        {currentCampaign && drafts.length === 0 ? <p className="mt-4 rounded border bg-neutral-50 p-3 text-sm font-semibold text-neutral-600">No social drafts yet for {currentCampaign.name}. Generate them once, then edit/post whenever you want.</p> : null}

        {drafts.length ? <div className="mt-5 space-y-4">
          {drafts.map((draft, index) => {
            const connection = connectionMap.get(draft.provider);
            const manualX = draft.provider === "x";
            const canPublish = !manualX && Boolean(connection?.connected);
            return <article key={draft.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><label className="flex items-center gap-3 text-lg font-black"><input type="checkbox" className="h-5 w-5" disabled={manualX || !canPublish || draft.status === "published"} checked={selected.includes(draft.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, draft.id] : current.filter((id) => id !== draft.id))} />{connection?.label || draft.provider}</label><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black uppercase">{draft.status}</span></div>
              {manualX ? <p className="mt-2 rounded border border-sky-200 bg-sky-50 p-2 text-sm font-bold text-sky-800">X is manual-only: this site never calls X’s paid create-post API. Open the X composer below, review, and you click Post yourself.</p> : !canPublish ? <p className="mt-2 text-sm font-bold text-amber-700">Draft is ready; connect this account whenever you have it.</p> : null}
              {draft.image_url ? <a className="mt-2 inline-block text-sm font-bold text-red-700 underline" href={draft.image_url} target="_blank" rel="noreferrer">Open generated sale graphic</a> : null}
              <div className="mt-3 grid gap-3">
                {(draft.provider === "pinterest" || draft.provider === "tiktok") ? <label className="text-sm font-bold">Title<input value={draft.title || ""} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} className="mt-1 min-h-10 w-full rounded border px-3" /></label> : null}
                <label className="text-sm font-bold">Post copy<textarea value={draft.text_content} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text_content: event.target.value } : item))} rows={5} className="mt-1 w-full rounded border p-3 font-normal" /></label>
                <label className="text-sm font-bold">Hashtags<input value={(draft.hashtags || []).join(", ")} onChange={(event) => setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, hashtags: event.target.value.split(",").map((value) => value.trim().replace(/^#/, "")).filter(Boolean) } : item))} className="mt-1 min-h-10 w-full rounded border px-3" /></label>
              </div>
              <p className="mt-3 rounded bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-600"><strong>Platform guide:</strong> {PLATFORM_HINTS[draft.provider]}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={busy || draft.status === "published" || draft.status === "publishing"} onClick={() => void aiGenerateDraft(draft)} className="rounded bg-violet-700 px-3 py-2 text-sm font-black text-white disabled:opacity-50">✨ AI Generate</button>{manualX ? <button type="button" disabled={busy || draft.status === "publishing"} onClick={() => void openXComposer(draft)} className="rounded bg-neutral-950 px-3 py-2 text-sm font-black text-white disabled:opacity-50">Open X composer — FREE</button> : null}<button type="button" disabled={busy || draft.status === "published" || draft.status === "publishing"} onClick={() => void saveDraft(draft)} className="rounded border px-3 py-2 text-sm font-black disabled:opacity-50">Save edits</button><span className="text-xs font-semibold text-neutral-500">Generated by {generatorLabel(draft.generator)}</span>{draft.provider_post_url ? <a href={draft.provider_post_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-red-700 underline">View published post</a> : null}</div>
              {draft.last_error ? <p className="mt-2 text-sm font-bold text-red-700">{draft.last_error}</p> : null}
            </article>;
          })}

          <div className="rounded-xl border-2 border-neutral-900 bg-neutral-50 p-4">
            <p className="font-black">{selected.length} API-posting network{selected.length === 1 ? "" : "s"} selected</p><p className="mt-1 text-xs font-semibold text-neutral-600">X is intentionally excluded from bulk posting/scheduling; use its free manual composer button above.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3"><button type="button" disabled={busy || !selected.length} onClick={() => void publish(false)} className="min-h-11 rounded bg-neutral-950 px-5 font-black text-white disabled:opacity-50">Post selected now</button><label className="font-bold">Schedule for<input type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} className="ml-2 min-h-11 rounded border bg-white px-3" /></label><button type="button" disabled={busy || !selected.length || !scheduledFor} onClick={() => void publish(true)} className="min-h-11 rounded border-2 border-neutral-950 px-5 font-black disabled:opacity-50">Schedule selected</button></div>
          </div>
        </div> : null}

        {attempts.length ? <details className="mt-5 rounded border bg-neutral-50 p-4"><summary className="cursor-pointer font-black">Publishing history ({attempts.length})</summary><div className="mt-3 space-y-2">{attempts.map((attempt) => <div key={attempt.id} className="text-sm"><strong>{attempt.provider}</strong> · {attempt.outcome} · {new Date(attempt.attempted_at).toLocaleString()}{attempt.provider_post_url ? <> · <a className="font-bold text-red-700 underline" href={attempt.provider_post_url} target="_blank" rel="noreferrer">open</a></> : null}{attempt.error_message ? <span className="text-red-700"> · {attempt.error_message}</span> : null}</div>)}</div></details> : null}
      </div>
    </section>
  );
}
