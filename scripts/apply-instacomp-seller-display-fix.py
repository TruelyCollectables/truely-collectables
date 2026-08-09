from pathlib import Path

route_path = Path("src/app/api/instacomp/scan/route.ts")
route = route_path.read_text()
old = '''        imageUrl: item?.image?.imageUrl ? String(item.image.imageUrl) : null,
        source: "ebay_active" as const,
        sourceLabel: "eBay Active",
'''
new = '''        imageUrl: item?.image?.imageUrl ? String(item.image.imageUrl) : null,
        itemId: item?.itemId ? String(item.itemId) : null,
        seller: item?.seller?.username ? String(item.seller.username) : null,
        sellerName: item?.seller?.username ? String(item.seller.username) : null,
        sellerFeedbackPercent:
          item?.seller?.feedbackPercentage !== undefined &&
          item?.seller?.feedbackPercentage !== null
            ? Number(item.seller.feedbackPercentage)
            : null,
        sellerFeedbackScore:
          item?.seller?.feedbackScore !== undefined && item?.seller?.feedbackScore !== null
            ? Number(item.seller.feedbackScore)
            : null,
        source: "ebay_active" as const,
        sourceLabel: "eBay Active",
'''
if new not in route:
    if old not in route:
        raise SystemExit("eBay seller mapper anchor missing")
    route = route.replace(old, new, 1)
route_path.write_text(route)

workbench_path = Path("src/app/admin/instacomp/fast/InstaCompFastWorkbench.tsx")
workbench = workbench_path.read_text()
old_type = '''  soldAt?: string | null;
  seller?: string | null;
'''
new_type = '''  soldAt?: string | null;
  itemId?: string | null;
  seller?: string | null;
'''
if new_type not in workbench:
    if old_type not in workbench:
        raise SystemExit("workbench comp type anchor missing")
    workbench = workbench.replace(old_type, new_type, 1)

old_block = '''                  <p className="mt-1 text-xs font-semibold text-neutral-500">
                    {row.sourceLabel || row.source || "Market source"}
                    {seller ? ` · Seller: ${seller}` : ""}
                    {row.sellerFeedbackPercent !== null && row.sellerFeedbackPercent !== undefined ? ` · ${row.sellerFeedbackPercent}% feedback` : ""}
                    {row.soldAt ? ` · Sold ${new Date(row.soldAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black">{money(delivered)}</p>
                  {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 underline">Open</a> : null}
                </div>
'''
new_block = '''                  <p className="mt-1 text-xs font-semibold text-neutral-500">
                    {row.sourceLabel || row.source || "Market source"}
                    {seller ? ` · Seller: ${seller}` : ""}
                    {row.sellerFeedbackPercent !== null && row.sellerFeedbackPercent !== undefined ? ` · ${row.sellerFeedbackPercent}% feedback` : ""}
                    {row.itemId ? ` · Item #${row.itemId}` : ""}
                    {row.soldAt ? ` · Sold ${new Date(row.soldAt).toLocaleDateString()}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">
                    Item {money(row.itemPrice ?? row.price)} · Shipping {row.shippingPrice === null || row.shippingPrice === undefined ? "UNKNOWN" : money(row.shippingPrice)} · Delivered {money(delivered)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black">{money(delivered)}</p>
                  {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 underline">Open listing</a> : null}
                </div>
'''
if new_block not in workbench:
    if old_block not in workbench:
        raise SystemExit("comp display anchor missing")
    workbench = workbench.replace(old_block, new_block, 1)
workbench_path.write_text(workbench)

cert_path = Path("scripts/instacomp-fast-workbench-certify.mjs")
cert = cert_path.read_text()
old_check = "  ['workbench shows seller metadata', scanner.includes('Seller:') && scanner.includes('sellerFeedbackPercent')],\n"
new_check = "  ['workbench shows complete seller audit packet', scanner.includes('Seller:') && scanner.includes('sellerFeedbackPercent') && scanner.includes('Item #') && scanner.includes('Shipping') && scanner.includes('Open listing')],\n  ['eBay adapter maps seller and item metadata', scanRoute.includes('item?.seller?.username') && scanRoute.includes('sellerFeedbackPercent') && scanRoute.includes('itemId: item?.itemId')],\n"
if new_check not in cert:
    if old_check not in cert:
        raise SystemExit("cert seller anchor missing")
    cert = cert.replace(old_check, new_check, 1)
cert_path.write_text(cert)
