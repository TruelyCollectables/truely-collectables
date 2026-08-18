from pathlib import Path
import re


# Final six Hockey Production repair. This targets the CURRENT compact
# management writer already committed on the Hockey recovery branch.

# ---------------------------------------------------------------------------
# 1) Registry writer: canonicalize the physical set sourceKey itself. The
# management RPC may normalize/dedupe set rows; every card/parallel must use
# the identical deterministic parent key or the chunk is correctly rejected.
# ---------------------------------------------------------------------------
writer = Path("scripts/instacomp-target-checklists/management-staged-registry-writer.mjs")
wtext = writer.read_text()

new_canonicalizer = r'''function canonicalizeSetAliases(plan){
  const norm=v=>String(v??"").normalize("NFKC").toLowerCase().replaceAll("&"," and ").replace(/[^\p{L}\p{N}]+/gu,"").trim();
  const keyFor=v=>`set-${String(v||"base").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"base"}`;
  const kept=new Map(),alias=new Map(),sets=[];
  for(const s of plan.sets||[]){
    const identity=norm(s.normalizedName||s.name||s.sourceKey),canonicalKey=keyFor(identity);
    alias.set(String(s.sourceKey),canonicalKey);
    if(!kept.has(identity)){
      const row={...s,sourceKey:canonicalKey};
      kept.set(identity,row);
      sets.push(row);
    }
  }
  const remap=r=>({...r,setSourceKey:alias.get(String(r.setSourceKey))||keyFor(r.setSourceKey)}),cards=(plan.cards||[]).map(remap),parallels=(plan.parallels||[]).map(remap);
  return{...plan,sets,cards,parallels,validation:{...plan.validation,counts:{...plan.validation.counts,sets:sets.length}}};
}'''

pattern = re.compile(
    r'function canonicalizeSetAliases\(plan\)\{.*?\}\nexport async function persistPlanManagement',
    re.S,
)
wtext, count = pattern.subn(new_canonicalizer + "\nexport async function persistPlanManagement", wtext, count=1)
if count != 1:
    raise SystemExit(f"Registry canonical set-source-key repair missed current writer (replaced {count})")
writer.write_text(wtext)


# ---------------------------------------------------------------------------
# 2) Chicago Blackhawks Centennial: force exact known season + Hockey into the
# parser-view H1 while leaving the archived official source untouched.
# ---------------------------------------------------------------------------
chicago = Path("src/lib/checklist-registry/upper-deck-2025-26-chicago-html.ts")
ctext = chicago.read_text()

old_chicago = '''    return upperDeck2025_26NormalizedHtmlChecklistAdapter.parse({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeChicagoChecklist(original),
    });'''
new_chicago = '''    const normalizedTitle = original.replace(
      /<h1\\b([^>]*)>([\\s\\S]*?)<\\/h1>/i,
      (full, attrs: string, inner: string) => {
        const rawTitle = text(inner);
        const withPeriod = /\\b20\\d{2}\\s*-\\s*\\d{2,4}\\b/.test(rawTitle)
          ? rawTitle
          : `2025-26 ${rawTitle}`;
        const hockeyTitle = /\\bhockey\\b/i.test(withPeriod)
          ? withPeriod
          : `${withPeriod} Hockey`;
        return `<h1${attrs}>${hockeyTitle}</h1>`;
      },
    );
    return upperDeck2025_26NormalizedHtmlChecklistAdapter.parse({
      ...artifact,
      archiveContent: artifact.archiveContent ?? artifact.content,
      content: normalizeChicagoChecklist(normalizedTitle),
    });'''
if old_chicago not in ctext:
    raise SystemExit("Chicago Hockey classification repair missed current parser")
chicago.write_text(ctext.replace(old_chicago, new_chicago, 1))

print("Patched final six Hockey Production mapping/classification blockers")
