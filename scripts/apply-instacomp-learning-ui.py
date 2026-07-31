from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} insertion point not found")
    return text.replace(old, new, 1)


root = Path("src/app")
endpoint_replacements = 0
for path in root.rglob("*"):
    if path.suffix not in {".ts", ".tsx"} or "api" in path.parts:
        continue
    text = path.read_text()
    changed = text.replace(
        '"/api/instacomp/scan"', '"/api/instacomp/scan-fast"'
    ).replace("'/api/instacomp/scan'", "'/api/instacomp/scan-fast'")
    if changed != text:
        endpoint_replacements += text.count("/api/instacomp/scan")
        path.write_text(changed)

mobile = Path("src/app/admin/instacomp/mobile/MobileInstaCompScanner.tsx")
text = mobile.read_text()

old = '''type ScanResult = Omit<InstaCompV2ScanInput, "ai" | "sourceCoverage"> & {
  ok?: boolean;
  error?: string;
  ai?: ScanAi;'''
new = '''type ScanResult = Omit<InstaCompV2ScanInput, "ai" | "sourceCoverage"> & {
  ok?: boolean;
  error?: string;
  scanId?: string | null;
  knowledge?: {
    mode?: string | null;
    cacheHit?: boolean;
    cacheId?: string | null;
    knowledgeEntryId?: string | null;
    confirmationStatus?: string | null;
    identityConfidence?: number | null;
    trustedForPricing?: boolean;
    marketExpiresAt?: string | null;
    registryMatch?: {
      identityId?: string | null;
      score?: number | null;
      sourceLabel?: string | null;
    } | null;
  } | null;
  ai?: ScanAi;'''
text = replace_once(text, old, new, "ScanResult")

old = '''  const [dealInputs, setDealInputs] = useState<DealInputs>(DEFAULT_DEAL_INPUTS);
'''
new = '''  const [dealInputs, setDealInputs] = useState<DealInputs>(DEFAULT_DEAL_INPUTS);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [knowledgeMessage, setKnowledgeMessage] = useState<string | null>(null);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
'''
text = replace_once(text, old, new, "learning state")

old = '''    setLoading(true);
    setError(null);
    setResult(null);
'''
new = '''    setLoading(true);
    setError(null);
    setResult(null);
    setKnowledgeMessage(null);
    setKnowledgeError(null);
'''
text = replace_once(text, old, new, "scan reset")

confirm_function = '''  async function confirmKnowledge(
    status: "operator_confirmed" | "operator_rejected" | "needs_more_info",
  ) {
    if (!result?.scanId) {
      setKnowledgeError(
        "This result does not have a saved scan ID yet. Run InstaComp again before teaching it.",
      );
      return;
    }

    setKnowledgeSaving(true);
    setKnowledgeMessage(null);
    setKnowledgeError(null);

    try {
      const response = await fetch("/api/instacomp/knowledge/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId: result.scanId,
          status,
          corrections: {
            player: fields.player,
            year: fields.year,
            brand: fields.brand,
            setName: fields.setName,
            cardNumber: fields.cardNumber,
            parallel: fields.parallel,
            serialNumber: fields.serialNumber,
            team: fields.team,
            sport: fields.sport,
            conditionGuess: fields.condition,
            isRookie: result.ai?.isRookie === true,
            isAuto: result.ai?.isAuto === true,
            isRelic: result.ai?.isRelic === true,
          },
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        entry?: {
          trustStatus?: string;
          observationCount?: number;
          confirmedCount?: number;
        };
      };

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Could not save this InstaComp correction.");
      }

      const label =
        status === "operator_confirmed"
          ? "Identity confirmed"
          : status === "operator_rejected"
            ? "Scan marked wrong"
            : "Scan marked for more information";
      const totals = data.entry
        ? ` · ${data.entry.observationCount ?? 0} observations · ${
            data.entry.confirmedCount ?? 0
          } confirmed`
        : "";
      setKnowledgeMessage(`${label}${totals}. InstaComp will use this correction.`);
    } catch (saveError) {
      setKnowledgeError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this InstaComp correction.",
      );
    } finally {
      setKnowledgeSaving(false);
    }
  }

'''
marker = '''  const listParams = new URLSearchParams({
'''
if "async function confirmKnowledge(" not in text:
    if marker not in text:
        raise SystemExit("confirm function insertion point not found")
    text = text.replace(marker, confirm_function + marker, 1)

panel = '''            <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-800">
                    InstaComp learning
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-5 text-cyan-950">
                    Every successful scan is saved as an observation whether you own
                    the card or not. Confirm the edited identity to make the knowledge
                    stronger; incorrect scans never become trusted automatically.
                  </p>
                  <p className="mt-2 text-xs font-bold text-cyan-800">
                    {result.knowledge?.cacheHit
                      ? "Exact-image knowledge reused"
                      : result.knowledge?.mode === "checklist_registry_confirmed"
                        ? "Official Checklist Registry identity confirmed"
                        : "New learning observation saved"}
                    {result.knowledge?.confirmationStatus
                      ? ` · ${result.knowledge.confirmationStatus.replaceAll("_", " ")}`
                      : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-cyan-900 px-3 py-1 text-xs font-black text-white">
                  {result.scanId
                    ? `Scan ${result.scanId.slice(0, 8)}`
                    : "Saved scan pending"}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  disabled={knowledgeSaving || !result.scanId}
                  onClick={() => confirmKnowledge("operator_confirmed")}
                  className="min-h-11 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                >
                  {knowledgeSaving ? "Saving…" : "Confirm & Teach InstaComp"}
                </button>
                <button
                  type="button"
                  disabled={knowledgeSaving || !result.scanId}
                  onClick={() => confirmKnowledge("needs_more_info")}
                  className="min-h-11 rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-black text-amber-950 disabled:opacity-50"
                >
                  Needs More Info
                </button>
                <button
                  type="button"
                  disabled={knowledgeSaving || !result.scanId}
                  onClick={() => confirmKnowledge("operator_rejected")}
                  className="min-h-11 rounded-xl border border-rose-300 bg-rose-100 px-3 py-2 text-sm font-black text-rose-950 disabled:opacity-50"
                >
                  Mark Scan Wrong
                </button>
              </div>

              {knowledgeMessage ? (
                <p className="mt-3 rounded-xl border border-emerald-200 bg-white p-3 text-sm font-black text-emerald-800">
                  {knowledgeMessage}
                </p>
              ) : null}
              {knowledgeError ? (
                <p className="mt-3 rounded-xl border border-rose-200 bg-white p-3 text-sm font-black text-rose-800">
                  {knowledgeError}
                </p>
              ) : null}
            </div>

'''
link_marker = '''            <Link
              href={`/list?${listParams.toString()}`}
'''
if "Confirm & Teach InstaComp" not in text:
    if link_marker not in text:
        raise SystemExit("learning panel insertion point not found")
    text = text.replace(link_marker, panel + link_marker, 1)

mobile.write_text(text)

v2 = Path("src/app/admin/instacomp/v2/page.tsx")
text = v2.read_text()
old = '''            <Link
              href="/list"
              className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-amber-200"
            >
              List Cards
            </Link>
'''
new = '''            <Link
              href="/admin/instacomp/checklists"
              className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-300/15"
            >
              Checklist Registry
            </Link>
            <Link
              href="/list"
              className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-amber-200"
            >
              List Cards
            </Link>
'''
text = replace_once(text, old, new, "Checklist Registry navigation")
v2.write_text(text)

print(
    f"Patched InstaComp learning UI; replaced {endpoint_replacements} direct scan endpoint references."
)
