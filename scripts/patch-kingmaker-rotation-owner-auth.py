from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    if new in source:
        print(f"already patched: {label}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match in {path}, found {count}")
    target.write_text(source.replace(old, new, 1))
    print(f"patched: {label}")


route = "src/app/api/admin/card-listing-images/route.ts"
page = "src/app/kingmaker/instacomp-audit/page.tsx"

replace_once(
    route,
    '''import { randomUUID } from "node:crypto";\nimport sharp from "sharp";\nimport {''',
    '''import { randomUUID } from "node:crypto";\nimport sharp from "sharp";\nimport { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";\nimport {''',
    "owner account import",
)

replace_once(
    route,
    '''async function requireAdmin(request: Request) {\n  const actor = await requireInstaCompJobActor(request);\n  if (actor.type !== "admin") {\n    throw new InstaCompJobServerError(\n      "Card image editing is owner/admin only.",\n      403,\n      "INSTACOMP_ADMIN_REQUIRED",\n    );\n  }\n  return actor;\n}''',
    '''async function requireAdmin(request: Request) {\n  const actor = await requireInstaCompJobActor(request);\n  if (actor.type === "admin") return actor;\n\n  const account = await getAuthenticatedAccountFromRequest(request);\n  const email = String(account?.email || "").trim().toLowerCase();\n  const isOwner =\n    account?.id === actor.sellerAccountId &&\n    (email === "sales@truelycollectables.com" ||\n      email === "sales@trulycollectables.com");\n\n  if (isOwner) {\n    return {\n      type: "admin" as const,\n      storeId: actor.storeId,\n      sellerAccountId: null,\n    };\n  }\n\n  throw new InstaCompJobServerError(\n    "Card image editing is owner/admin only.",\n    403,\n    "INSTACOMP_ADMIN_REQUIRED",\n  );\n}''',
    "owner seller authorization",
)

replace_once(
    route,
    '''  const rotated = await sharp(bytes, { failOn: "error" })\n    .rotate(params.degrees, { background: "#ffffff" })''',
    '''  const rotated = await sharp(bytes, { failOn: "error" })\n    .autoOrient()\n    .rotate(params.degrees, { background: "#ffffff" })''',
    "EXIF-normalized pixel rotation",
)

replace_once(
    route,
    '''    if (metadataError) throw metadataError;\n\n    const warnings: string[] = [];''',
    '''    if (metadataError) throw metadataError;\n\n    const { data: storedRows, error: readBackError } = await supabase\n      .from("inventory_images")\n      .select("image_url,sort_order,is_primary")\n      .eq("inventory_item_id", inventoryItemId)\n      .order("sort_order", { ascending: true });\n    if (readBackError) throw readBackError;\n    const storedFront = text(\n      storedRows?.find((row) => row.is_primary === true)?.image_url ||\n        storedRows?.[0]?.image_url,\n    );\n    const storedBack = text(\n      storedRows?.find(\n        (row) => row.is_primary !== true && text(row.image_url) !== storedFront,\n      )?.image_url ||\n        storedRows?.find((row) => text(row.image_url) !== storedFront)?.image_url,\n    );\n    if (storedFront !== front || storedBack !== back) {\n      throw new Error(\n        "The rotated image was created but the permanent front/back assignment did not read back correctly.",\n      );\n    }\n\n    const warnings: string[] = [];''',
    "permanent image read-back verification",
)

replace_once(
    route,
    '''      instaCompStatus: "pending",\n      warnings,''',
    '''      instaCompStatus: "pending",\n      storedImageReadBack: true,\n      previousImageUrl: rotatedSourceUrl || null,\n      rotatedImageUrl:\n        action === "rotate" ? (side === "front" ? front : back) : null,\n      warnings,''',
    "rotation receipt",
)

replace_once(
    page,
    '''    try {\n      const response = await fetch("/api/admin/card-listing-images", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },''',
    '''    try {\n      const session = await getFreshAccountSession(5 * 60, false);\n      if (!session?.access_token) {\n        throw new Error("Seller login is required for image editing.");\n      }\n      const response = await fetch("/api/admin/card-listing-images", {\n        method: "POST",\n        headers: {\n          Authorization: `Bearer ${session.access_token}`,\n          "Content-Type": "application/json",\n        },''',
    "send seller bearer token",
)

replace_once(
    page,
    '''      setAction(item.inventoryItemId, {\n        busy: null,\n        notice: text(data.message) || "Image edit saved.",\n        error: "",\n      });\n      setForms((current) => {''',
    '''      const nextFront = text(data.frontImageUrl);\n      const nextBack = text(data.backImageUrl);\n      setPayload((current) =>\n        current\n          ? {\n              ...current,\n              items: current.items.map((candidate) =>\n                candidate.inventoryItemId === item.inventoryItemId\n                  ? {\n                      ...candidate,\n                      imageAudit: {\n                        ...candidate.imageAudit,\n                        frontImageUrl:\n                          nextFront || candidate.imageAudit.frontImageUrl,\n                        backImageUrl:\n                          nextBack || candidate.imageAudit.backImageUrl,\n                      },\n                    }\n                  : candidate,\n              ),\n            }\n          : current,\n      );\n      setAction(item.inventoryItemId, {\n        busy: null,\n        notice: text(data.message) || "Image edit saved.",\n        error: "",\n      });\n      setForms((current) => {''',
    "show rotated stored URL immediately",
)

print("Applied KINGMAKER owner authentication, EXIF-safe rotation, and storage read-back repair.")
