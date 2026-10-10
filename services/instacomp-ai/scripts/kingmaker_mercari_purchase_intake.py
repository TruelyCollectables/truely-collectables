#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Any

PURCHASE_ROOTS = (
    "https://www.mercari.com/mypage/purchase/in_progress/?page={page}",
    "https://www.mercari.com/mypage/purchase/complete/?page={page}",
)
MAX_PAGES_PER_BUCKET = 5


def _osascript(source: str, timeout: int = 30) -> str:
    completed = subprocess.run(
        ["osascript", "-"], input=source, text=True, capture_output=True, timeout=timeout, check=False
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "Mercari AppleScript failed").strip())
    return (completed.stdout or "").strip()


class ChromeTab:
    def __init__(self) -> None:
        self.window_id: int | None = None
        self.tab_id: int | None = None
        self.return_index: int = 1

    def open(self, url: str) -> None:
        source = (
            'tell application "Google Chrome"\n'
            'activate\n'
            'if (count of windows) = 0 then make new window\n'
            'set w to front window\n'
            'set oldIndex to active tab index of w\n'
            f'set t to make new tab at end of tabs of w with properties {{URL:{json.dumps(url)}}}\n'
            'set active tab index of w to (count of tabs of w)\n'
            'return (id of w as text) & ":" & (id of t as text) & ":" & (oldIndex as text)\n'
            'end tell'
        )
        raw = _osascript(source)
        window_id, tab_id, return_index = raw.split(":", 2)
        self.window_id = int(window_id)
        self.tab_id = int(tab_id)
        self.return_index = max(1, int(return_index))
        self.wait_ready()

    def _prefix(self) -> str:
        if self.window_id is None or self.tab_id is None:
            raise RuntimeError("Mercari intake tab is not open")
        return (
            'tell application "Google Chrome"\n'
            f'set w to first window whose id is {self.window_id}\n'
            f'set t to first tab of w whose id is {self.tab_id}\n'
        )

    def js(self, javascript: str) -> str:
        return _osascript(self._prefix() + f'return execute t javascript {json.dumps(javascript)}\nend tell')

    def navigate(self, url: str) -> None:
        _osascript(
            self._prefix()
            + f'set URL of t to {json.dumps(url)}\n'
            + 'set active tab index of w to (count of tabs of w)\nactivate\nend tell'
        )
        self.wait_ready()

    def wait_ready(self, timeout: float = 20.0) -> None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                state = self.js("document.readyState")
                if state in {"interactive", "complete"}:
                    time.sleep(0.8)
                    return
            except Exception:
                pass
            time.sleep(0.4)
        raise RuntimeError("Mercari page did not become ready")

    def close(self) -> None:
        if self.window_id is None or self.tab_id is None:
            return
        try:
            _osascript(
                self._prefix()
                + 'close t\n'
                + f'if (count of tabs of w) >= {self.return_index} then set active tab index of w to {self.return_index}\n'
                + 'set index of w to 1\nend tell'
            )
        finally:
            self.window_id = None
            self.tab_id = None


def _money(label: str, body: str) -> float:
    match = re.search(rf"(?:^|\n){re.escape(label)}\s*\n+\$([0-9,]+(?:\.\d{{2}})?)", body, re.I)
    return round(float(match.group(1).replace(",", "")), 2) if match else 0.0


def _purchase_date(body: str) -> str | None:
    match = re.search(r"Purchased on\s+(\d{2}/\d{2}/\d{2})", body, re.I)
    if not match:
        return None
    parsed = datetime.strptime(match.group(1), "%m/%d/%y")
    return parsed.strftime("%Y-%m-%dT12:00:00-06:00")


def _seller(body: str) -> str | None:
    match = re.search(r"Seller information\s*\n+([^\n]+)", body, re.I)
    return match.group(1).strip() if match else None


def _item_id_from_url(value: str) -> str | None:
    match = re.search(r"/m(\d+)(?:/|$)", value)
    return f"m{match.group(1)}" if match else None


def _basic_identity(title: str, brand: str | None) -> dict[str, Any]:
    year = (re.search(r"\b((?:19|20)\d{2})\b", title) or [None, None])[1]
    number_match = re.search(r"(?:#\s*|No\.?\s*)([A-Z0-9-]+)\b", title, re.I)
    serial_match = re.search(r"/\s*(\d{1,6})\b", re.sub(r"\b(?:19|20)\d{2}/\d{2,4}\b", " ", title))
    lower = title.lower()
    parallel = None
    for phrase in (
        "White Seismic", "Blue Velocity", "Cracked Ice", "Silver Ice", "Red Power", "Green Prizm",
        "Ice Prizm", "Silver Prizm", "Purple Ice", "Pink Flash", "Black Wave", "Red Ice", "Blue Prizm",
    ):
        if phrase.lower() in lower:
            parallel = phrase
            break
    if parallel is None and re.search(r"\bbase\b", title, re.I):
        parallel = "Base"
    set_name = None
    for phrase in (
        "Bowman Chrome U", "Bowman Chrome", "Topps Chrome", "Panini Prizm WNBA", "Panini Select WNBA",
        "Prizm WNBA", "Select WNBA", "Panini Prizm", "Panini Select", "Upper Deck",
    ):
        if phrase.lower() in lower:
            set_name = phrase
            break
    grader_match = re.search(r"\b(PSA|BGS|SGC|CGC|TAG|CSG)\s*(\d+(?:\.\d+)?)\b", title, re.I)
    return {
        "player": None,
        "year": year,
        "brand": brand,
        "setName": set_name,
        "cardNumber": number_match.group(1).upper() if number_match else None,
        "parallel": parallel,
        "variation": "variation" if re.search(r"\bvariation\b", title, re.I) else None,
        "serialRun": int(serial_match.group(1)) if serial_match else None,
        "isAuto": bool(re.search(r"\b(?:auto|autograph|autographed|signed|signature)\b", title, re.I)),
        "isRelic": bool(re.search(r"\b(?:relic|patch|jersey|memorabilia|game used)\b", title, re.I)),
        "conditionType": "graded" if grader_match else "raw",
        "gradingCompany": grader_match.group(1).upper() if grader_match else None,
        "grade": grader_match.group(2) if grader_match else None,
    }


def _order_links(tab: ChromeTab) -> list[str]:
    raw = tab.js(
        "JSON.stringify(Array.from(document.querySelectorAll('a[href*=\"/transaction/order_status/\"]')).map(a=>a.href))"
    )
    try:
        values = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return list(dict.fromkeys(str(value) for value in values if "/transaction/order_status/" in str(value)))


def _order_payload(tab: ChromeTab, order_url: str, cutoff_date: datetime) -> dict[str, Any] | None:
    tab.navigate(order_url)
    raw = tab.js(
        "JSON.stringify({body:document.body.innerText.slice(0,24000),"
        "itemLinks:Array.from(document.querySelectorAll('a[href*=\"/us/item/m\"]')).map(a=>a.href)})"
    )
    data = json.loads(raw or "{}")
    body = str(data.get("body") or "")
    purchased_at = _purchase_date(body)
    if not purchased_at:
        return None
    purchased_date = datetime.fromisoformat(purchased_at).date()
    if purchased_date < cutoff_date.date():
        return None
    item_links = list(dict.fromkeys(str(value) for value in data.get("itemLinks") or [] if "/us/item/m" in str(value)))
    if not item_links:
        return None
    item_url = item_links[0]
    item_id = _item_id_from_url(item_url)
    if not item_id:
        return None

    tab.navigate(item_url)
    item_raw = tab.js(
        "JSON.stringify({body:document.body.innerText.slice(0,18000),"
        "jsonld:Array.from(document.querySelectorAll('script[type=\"application/ld+json\"]')).map(s=>s.textContent)})"
    )
    item_data = json.loads(item_raw or "{}")
    product: dict[str, Any] = {}
    for value in item_data.get("jsonld") or []:
        try:
            parsed = json.loads(value)
        except Exception:
            continue
        if isinstance(parsed, dict) and parsed.get("@type") == "Product":
            product = parsed
            break
    title = str(product.get("name") or item_id).strip()
    brand_value = product.get("brand")
    brand = str(brand_value.get("name") or "").strip() if isinstance(brand_value, dict) else str(brand_value or "").strip()
    images = [str(value) for value in product.get("image") or [] if str(value).strip()] if isinstance(product.get("image"), list) else []
    seller = _seller(body)
    if not seller:
        offers = product.get("offers") if isinstance(product.get("offers"), dict) else {}
        seller_value = offers.get("seller") if isinstance(offers.get("seller"), dict) else {}
        seller = str(seller_value.get("name") or "").strip() or None
    total_paid = _money("You paid", body)
    if total_paid <= 0:
        return None
    return {
        "purchase_id": item_id,
        "source_key": f"mercari:{item_id}:unit:1",
        "source": "Mercari",
        "purchased_at": purchased_at,
        "title": title,
        "seller": seller,
        "order_number": item_id,
        "source_item_id": item_id,
        "listing_url": item_url,
        "image_urls": images,
        "allocated_cost": total_paid,
        "status": "awaiting_scan",
        "identity_status": "needs_scan_verification",
        "identity": _basic_identity(title, brand or None),
        "evidence": {
            "source": "mercari_logged_in_purchase_history",
            "item_price": _money("Item price", body),
            "inbound_shipping": _money("Delivery", body),
            "buyer_fees": _money("Buyer protection fee", body),
            "sales_tax": _money("Tax", body),
            "total_paid": total_paid,
            "currency": "USD",
        },
    }


def main() -> None:
    cutoff_raw = sys.argv[1] if len(sys.argv) > 1 else "2026-09-16T00:00:00-06:00"
    cutoff = datetime.fromisoformat(cutoff_raw.replace("Z", "+00:00"))
    tab = ChromeTab()
    records: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    seen_orders: set[str] = set()
    try:
        tab.open(PURCHASE_ROOTS[0].format(page=1))
        for root in PURCHASE_ROOTS:
            for page in range(1, MAX_PAGES_PER_BUCKET + 1):
                tab.navigate(root.format(page=page))
                links = _order_links(tab)
                links = [link for link in links if link not in seen_orders]
                if not links:
                    break
                found_recent = False
                for link in links:
                    seen_orders.add(link)
                    try:
                        record = _order_payload(tab, link, cutoff)
                        if record:
                            records.append(record)
                            found_recent = True
                    except Exception as exc:
                        errors.append({"orderUrl": link, "error": str(exc)[:500]})
                if root.endswith("complete/?page={page}") and page > 1 and not found_recent:
                    break
    finally:
        tab.close()

    unique = {str(row["source_key"]): row for row in records}
    print(json.dumps({
        "ok": True,
        "source": "Mercari",
        "cutoff": cutoff_raw,
        "recordCount": len(unique),
        "records": list(unique.values()),
        "errors": errors,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "source": "Mercari", "error": str(exc)}))
        raise
