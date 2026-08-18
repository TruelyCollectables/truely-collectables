from pathlib import Path
import re


# Final six Hockey Production repair. This targets the CURRENT compact
# management writer already committed on the Hockey recovery branch.

# ---------------------------------------------------------------------------
# 1) Registry writer: preserve the source's proven set sourceKeys, collapse
# duplicate set aliases onto the first physical set row, then collapse cards
# that the Registry treats as the same natural card (set + card number).
#
# IMPORTANT: do NOT synthesize new set sourceKeys here. The certified The Cup
# plan previously persisted every set chunk with its original keys and only
# failed later on duplicate cards. Rewriting those keys caused the regression
# where the first set chunk left 25/25 keys unmapped.
# ---------------------------------------------------------------------------
writer = Path("scripts/instacomp-target-checklists/management-staged-registry-writer.mjs")
wtext = writer.read_text()

new_canonicalizers = r'''function canonicalizeSetAliases(plan){
  const norm=v=>String(v??"").normalize("NFKC").toLowerCase().replaceAll("&"," and ").replace(/[^\p{L}\p{N}]+/gu,"").trim();
  const kept=new Map(),alias=new Map(),sets=[];
  for(const s of plan.sets||[]){
    const k=norm(s.normalizedName||s.name||s.sourceKey),p=kept.get(k);
    if(!p){
      kept.set(k,s);
      alias.set(String(s.sourceKey),String(s.sourceKey));
      sets.push(s);
    }else{
      alias.set(String(s.sourceKey),String(p.sourceKey));
    }
  }
  const remap=r=>({...r,setSourceKey:alias.get(String(r.setSourceKey))||r.setSourceKey});
  const cards=(plan.cards||[]).map(remap),parallels=(plan.parallels||[]).map(remap);
  return{...plan,sets,cards,parallels,validation:{...plan.validation,counts:{...plan.validation.counts,sets:sets.length}}};
}
function canonicalizeCardAliases(plan){
  const norm=v=>String(v??"").normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
  const kept=new Map(),alias=new Map(),cards=[];
  for(const c of plan.cards||[]){
    const setKey=String(c.setSourceKey??"");
    const number=norm(c.cardNumber??c.number??"");
    const natural=`${setKey}\u0000${number}`;
    const p=kept.get(natural);
    if(!p){
      kept.set(natural,c);
      alias.set(String(c.sourceKey),String(c.sourceKey));
      cards.push(c);
    }else{
      alias.set(String(c.sourceKey),String(p.sourceKey));
    }
  }
  const remapCardKey=r=>r&&r.cardSourceKey?({...r,cardSourceKey:alias.get(String(r.cardSourceKey))||r.cardSourceKey}):r;
  const identities=(plan.identities||[]).map(remapCardKey);
  const parallels=(plan.parallels||[]).map(remapCardKey);
  return{...plan,cards,parallels,identities,validation:{...plan.validation,counts:{...plan.validation.counts,cards:cards.length}}};
}'''

pattern = re.compile(
    r'function canonicalizeSetAliases\(plan\)\{.*?\}\nexport async function persistPlanManagement',
    re.S,
)
replacement = new_canonicalizers + "\nexport async function persistPlanManagement"
wtext, count = pattern.subn(lambda _match: replacement, wtext, count=1)
if count != 1:
    raise SystemExit(f"Registry canonical alias repair missed current writer (replaced {count})")

old_entry = '  plan = canonicalizeSetAliases(plan);'
new_entry = '  plan = canonicalizeCardAliases(canonicalizeSetAliases(plan));'
if old_entry not in wtext:
    raise SystemExit("Registry persistence entrypoint repair missed current writer")
wtext = wtext.replace(old_entry, new_entry, 1)
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
