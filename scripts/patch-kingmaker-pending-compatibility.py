#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text("utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


pending = ROOT / "src/app/kingmaker/pending/page.tsx"
rotate_route = ROOT / "src/app/api/account/seller/inventory/instacomp-image-rotate/route.ts"

replace_once(
    pending,
    '''type PendingCard = {\n''',
    '''type CompEvidence = {\n  title?: string | null;\n  price?: number | null;\n  url?: string | null;\n  sourceLabel?: string | null;\n  soldAt?: string | null;\n  listedAt?: string | null;\n};\n\ntype PendingCard = {\n''',
    "market evidence type",
)

replace_once(
    pending,
    '''    reliableSoldCompCount?: number;\n    identity?: CardIdentity | null;\n''',
    '''    reliableSoldCompCount?: number;\n    soldCompEvidence?: CompEvidence[];\n    activeCompetition?: CompEvidence[];\n    identity?: CardIdentity | null;\n''',
    "separate sold and active evidence",
)

replace_once(
    pending,
    '''async function rotateClockwise(file: File, name: string) {\n''',
    '''async function rotatedImageFile(file: File, name: string) {\n''',
    "audited byte-changing rotation helper",
)

replace_once(
    pending,
    '''      const [front, back] = await Promise.all([\n        side === "front" ? rotateClockwise(frontOriginal, "front") : Promise.resolve(frontOriginal),\n        side === "back" ? rotateClockwise(backOriginal, "back") : Promise.resolve(backOriginal),\n      ]);\n      const session = await getFreshAccountSession(5 * 60, false);\n      if (!session?.access_token) throw new Error("Seller login is required.");\n      const form = new FormData();\n      form.append("inventoryItemId", card.inventoryItemId);\n      form.append("rotatedSide", side);\n      form.append("front", front, front.name);\n      form.append("back", back, back.name);\n      const response = await fetch("/api/account/seller/inventory/instacomp-image-rotate", {\n        method: "POST",\n        headers: { Authorization: `Bearer ${session.access_token}` },\n        body: form,\n      });\n''',
    '''      const [frontImage, backImage] = await Promise.all([\n        side === "front"\n          ? rotatedImageFile(frontOriginal, "front")\n          : Promise.resolve(frontOriginal),\n        side === "back"\n          ? rotatedImageFile(backOriginal, "back")\n          : Promise.resolve(backOriginal),\n      ]);\n      const session = await getFreshAccountSession(5 * 60, false);\n      if (!session?.access_token) throw new Error("Seller login is required.");\n      const formData = new FormData();\n      formData.set("inventoryItemId", card.inventoryItemId);\n      formData.set("rotatedSide", side);\n      formData.set("frontImage", frontImage);\n      formData.set("backImage", backImage);\n      const response = await fetch("/api/account/seller/inventory/instacomp-image-rotate", {\n        method: "POST",\n        headers: { Authorization: `Bearer ${session.access_token}` },\n        body: formData,\n      });\n''',
    "resubmit changed front/back bytes",
)

replace_once(
    pending,
    '''            const suggested = Number(card.instaComp.suggestedPrice || 0);\n            const priceChoices = suggested > 0\n''',
    '''            const soldCompEvidence = card.instaComp.soldCompEvidence || [];\n            const activeCompetition = card.instaComp.activeCompetition || [];\n            const suggested = Number(card.instaComp.suggestedPrice || 0);\n            const priceChoices = suggested > 0\n''',
    "per-card market evidence collections",
)

replace_once(
    pending,
    '''                <div className="grid gap-4 p-4 md:grid-cols-2">\n''',
    '''                {(soldCompEvidence.length || activeCompetition.length) ? (\n                  <div className="grid gap-4 border-b-2 border-neutral-900 bg-neutral-50 p-4 lg:grid-cols-2">\n                    <MarketEvidencePanel\n                      title="Exact sold evidence"\n                      subtitle="Sold transactions used to establish market value"\n                      rows={soldCompEvidence}\n                      dateKey="soldAt"\n                    />\n                    <MarketEvidencePanel\n                      title="Active competition"\n                      subtitle="Current asking prices shown separately from sold value"\n                      rows={activeCompetition}\n                      dateKey="listedAt"\n                    />\n                  </div>\n                ) : null}\n\n                <div className="grid gap-4 p-4 md:grid-cols-2">\n''',
    "sold-vs-active market evidence display",
)

replace_once(
    pending,
    '''                  <div className="flex flex-wrap gap-2">\n                    <button\n                      type="button"\n                      onClick={() => beginEdit(card)}\n                      disabled={Boolean(busyId)}\n                      className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400"\n                    >\n                      Edit All Fields\n                    </button>\n                    <button\n                      type="button"\n                      onClick={() => void runExactIdentity(card)}\n                      disabled={!pairReady || Boolean(busyId)}\n                      className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"\n                    >\n                      {isBusy ? "Working…" : job?.manualIdentityLocked ? "Re-scan & Replace Locked Identity" : "Run Exact Identity"}\n                    </button>\n                  </div>\n''',
    '''                  <div className="flex flex-wrap gap-2">\n                    <button\n                      type="button"\n                      onClick={() => beginEdit(card)}\n                      disabled={Boolean(busyId)}\n                      className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400"\n                    >\n                      Edit All Fields\n                    </button>\n                    {stage === "failed" ? (\n                      <button\n                        type="button"\n                        onClick={() => void runExactIdentity(card)}\n                        disabled={!pairReady || Boolean(busyId)}\n                        className="rounded-xl bg-red-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"\n                      >\n                        Retry This Card\n                      </button>\n                    ) : null}\n                    <button\n                      type="button"\n                      title={job?.manualIdentityLocked ? "Re-scan and Replace Locked Identity" : "Run Exact Identity"}\n                      onClick={() => void runExactIdentity(card)}\n                      disabled={!pairReady || Boolean(busyId)}\n                      className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"\n                    >\n                      {isBusy\n                        ? "Working…"\n                        : job?.manualIdentityLocked\n                          ? "Replace Manual Identity with AI"\n                          : "Run Exact Identity"}\n                    </button>\n                  </div>\n''',
    "retry and explicit locked-identity replacement actions",
)

panel = '''\n\nfunction MarketEvidencePanel({\n  title,\n  subtitle,\n  rows,\n  dateKey,\n}: {\n  title: string;\n  subtitle: string;\n  rows: CompEvidence[];\n  dateKey: "soldAt" | "listedAt";\n}) {\n  return (\n    <div className="rounded-xl border border-neutral-300 bg-white p-4">\n      <div className="flex items-start justify-between gap-3">\n        <div>\n          <h3 className="font-black">{title}</h3>\n          <p className="mt-1 text-xs font-semibold text-neutral-500">{subtitle}</p>\n        </div>\n        <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-xs font-black text-white">\n          {rows.length}\n        </span>\n      </div>\n      {rows.length ? (\n        <div className="mt-3 space-y-2">\n          {rows.slice(0, 5).map((row, index) => (\n            <div key={`${row.url || row.title || title}-${index}`} className="rounded-lg bg-neutral-100 p-3 text-sm">\n              {row.url ? (\n                <a\n                  href={row.url}\n                  target="_blank"\n                  rel="noreferrer"\n                  className="font-bold underline decoration-neutral-400 underline-offset-2"\n                >\n                  {row.title || "Market listing"}\n                </a>\n              ) : (\n                <p className="font-bold">{row.title || "Market listing"}</p>\n              )}\n              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-neutral-600">\n                <span>{money(row.price)}</span>\n                {row.sourceLabel ? <span>{row.sourceLabel}</span> : null}\n                {row[dateKey] ? <span>{row[dateKey]}</span> : null}\n              </div>\n            </div>\n          ))}\n        </div>\n      ) : (\n        <p className="mt-3 text-sm font-semibold text-neutral-500">None accepted yet.</p>\n      )}\n    </div>\n  );\n}\n'''
source = pending.read_text("utf-8")
if "function MarketEvidencePanel(" not in source:
    pending.write_text(source.rstrip() + panel, encoding="utf-8")
    print(f"patched market evidence panel component: {pending}")
else:
    print(f"already patched market evidence panel component: {pending}")

replace_once(
    rotate_route,
    '''    const front = form.get("front");\n    const back = form.get("back");\n''',
    '''    const front = form.get("frontImage") ?? form.get("front");\n    const back = form.get("backImage") ?? form.get("back");\n''',
    "rotation endpoint front/back field compatibility",
)

print("KINGMAKER Pending compatibility repair complete.")
