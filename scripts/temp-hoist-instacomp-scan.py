from pathlib import Path

page = Path("src/app/seller/instacomp-pending/page.tsx")
text = page.read_text(encoding="utf-8")

inner = '''  async function scanItem(item: PendingItem, accessToken: string) {
    const response = await fetch("/api/account/seller/inventory/instacomp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        inventoryItemId: item.inventoryItemId,
        aiCouncilTier: "adaptive",
      }),
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "InstaComp pricing failed.");
    }
    return data as {
      suggestedPrice: number;
      pricingStatus: PricingStatus;
      pricingReason: string;
      reliableSoldCompCount: number;
    };
  }

'''
if inner not in text:
    raise SystemExit("inner scan function not found")
text = text.replace(inner, "", 1)

hoisted = '''async function scanPendingItem(item: PendingItem, accessToken: string) {
  const response = await fetch("/api/account/seller/inventory/instacomp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      inventoryItemId: item.inventoryItemId,
      aiCouncilTier: "adaptive",
    }),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || "InstaComp pricing failed.");
  }
  return data as {
    suggestedPrice: number;
    pricingStatus: PricingStatus;
    pricingReason: string;
    reliableSoldCompCount: number;
  };
}

'''
anchor = "export default function InstaCompPendingPage() {\n"
if anchor not in text:
    raise SystemExit("component anchor not found")
text = text.replace(anchor, hoisted + anchor, 1)
text = text.replace("scanItem(", "scanPendingItem(")
page.write_text(text, encoding="utf-8")

Path("scripts/temp-hoist-instacomp-scan.py").unlink(missing_ok=True)
Path(".github/workflows/temp-hoist-instacomp-scan.yml").unlink(missing_ok=True)
