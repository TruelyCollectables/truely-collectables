from pathlib import Path

path = Path('services/instacomp-ai/app/deal_hunter.py')
text = path.read_text()

needle = '''                evaluation = payload.get("evaluation") or {}
                return {
                    **base,
'''
replacement = '''                market_history = await self._persist_market_history(
                    client=client,
                    candidate=candidate,
                    payload=payload,
                )
                evaluation = payload.get("evaluation") or {}
                return {
                    **base,
                    "market_history": market_history,
'''
if needle not in text:
    raise SystemExit('evaluation insertion point not found')
text = text.replace(needle, replacement, 1)

needle2 = '''    async def _publish_run_summary(
        self,
        run_id: str,
'''
method = '''    async def _persist_market_history(
        self,
        *,
        client: httpx.AsyncClient,
        candidate: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        scan = payload.get("scan") or {}
        registry = scan.get("checklistRegistry") or {}
        identity_id = str(registry.get("identityId") or "").strip()
        fingerprint = str(registry.get("fingerprintSha256") or "").strip()
        if registry.get("matched") is not True or not identity_id or not fingerprint:
            return {
                "status": "blocked",
                "reason": "Canonical Checklist Registry identity ID and fingerprint were not proven.",
            }

        exact_market = scan.get("exactMarket") or {}
        sold = scan.get("soldComps") or exact_market.get("sold") or []
        active = scan.get("activeComps") or exact_market.get("active") or []
        item_price = candidate.get("item_price")
        shipping = candidate.get("inbound_shipping")
        buyer_fees = candidate.get("buyer_fees")
        tax = candidate.get("tax")
        known_total = sum(
            float(value or 0)
            for value in (item_price, shipping, buyer_fees, tax)
        )
        request_body = {
            "registry": registry,
            "ai": scan.get("ai") or {},
            "sold": sold,
            "active": active,
            "scanId": scan.get("scanId"),
            "targetListing": {
                "title": candidate.get("title"),
                "itemPrice": item_price,
                "shippingPrice": shipping,
                "deliveredPrice": round(known_total, 2),
                "currency": "USD",
                "url": candidate.get("listing_url"),
                "marketplace": candidate.get("marketplace") or "eBay",
                "observedAt": utc_now().isoformat(),
            },
        }
        response = await client.post(
            str(self.settings.deal_hunter_site_url).rstrip("/")
            + "/api/instacomp/market-history",
            headers={
                "X-InstaComp-AI-Key": str(self.settings.api_key),
                "Accept": "application/json",
            },
            json=request_body,
        )
        body = response.json()
        if not response.is_success or body.get("ok") is not True:
            raise RuntimeError(
                "Exact-card market history persistence failed: "
                + str(body.get("error") or body.get("reason") or f"HTTP {response.status_code}")
            )
        return body

    async def _publish_run_summary(
        self,
        run_id: str,
'''
if needle2 not in text:
    raise SystemExit('method insertion point not found')
text = text.replace(needle2, method, 1)
path.write_text(text)
print('Patched Deal Hunter to persist exact-card market history.')
