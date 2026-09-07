from __future__ import annotations

import asyncio
import json
import re
import statistics
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .teacher_comp_learning import record_exact_market_history

_BROWSER_LOCK = asyncio.Lock()
_CHROME_TIMEOUT_SECONDS = 35
_FANATICS_API = "https://sales-history-api.services.fanaticscollect.com/api/v1/pub/sales"
_CHALLENGE_RE = re.compile(r"captcha|verify you are human|access denied|challenge required|unusual traffic", re.I)
_MONEY_RE = re.compile(r"\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
_EBAY_ITEM_RE = re.compile(r"/itm/(?:[^/]+/)?(\d{9,15})(?:[/?#]|$)", re.I)
_MERCARI_ITEM_RE = re.compile(r"/item/(m\d+)(?:[/?#]|$)", re.I)
_LOT_RE = re.compile(r"\b(?:lot of|pick your|pick choose|choose your|u pick|you pick|complete your set|2 card minimum|multi[- ]?card|bundle)\b", re.I)
_GRADER_RE = re.compile(r"\b(?:PSA|BGS|SGC|CGC|CSG|HGA|TAG)\b(?:\s*(?:AUTH|AUTHENTIC|[0-9](?:\.5)?))?", re.I)
_AUTO_RE = re.compile(r"\b(?:auto(?:graph)?|autographed|signature|signed)\b", re.I)
_RELIC_RE = re.compile(r"\b(?:relic|patch|memorabilia|game[- ]used|jersey)\b", re.I)
_SERIAL_RE = re.compile(r"(?<!\d)(?:(\d{1,6})\s*)?/\s*(\d{1,6})(?!\d)")
_PARALLEL_WORDS = {
    "silver", "green", "red", "blue", "purple", "pink", "orange", "gold", "black", "white",
    "ice", "velocity", "seismic", "wave", "shimmer", "flash", "mojo", "pandora", "refractor",
    "holo", "hyper", "scope", "disco", "choice", "sparkle", "cracked", "prizm", "prizms",
}


class MarketCompRequest(BaseModel):
    exact_title: str = Field(default="", max_length=300)
    identity: dict[str, Any] = Field(default_factory=dict)
    scan_id: str | None = Field(default=None, max_length=160)
    registry_identity_id: str | None = Field(default=None, max_length=200)
    registry_fingerprint_sha256: str | None = Field(default=None, max_length=160)
    research_id: str | None = Field(default=None, max_length=200)
    operator_certified_identity: bool = False
    include_130point: bool = True
    include_active: bool = True
    include_fanatics: bool = True
    max_sold: int = Field(default=50, ge=1, le=100)
    max_active: int = Field(default=30, ge=1, le=60)


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", _text(value).lower()).strip()


def _identity_value(identity: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in identity and identity[name] not in (None, ""):
            return identity[name]
    return None


def _canonical_identity(identity: dict[str, Any]) -> dict[str, Any]:
    return {
        "year": _text(_identity_value(identity, "year")),
        "manufacturer": _text(_identity_value(identity, "manufacturer")),
        "brand": _text(_identity_value(identity, "brand")),
        "product": _text(_identity_value(identity, "product", "setName", "set_name")),
        "set_name": _text(_identity_value(identity, "setName", "set_name", "product")),
        "player": _text(_identity_value(identity, "player", "playerName", "player_name")),
        "card_number": _text(_identity_value(identity, "cardNumber", "card_number")).lstrip("#"),
        "parallel": _text(_identity_value(identity, "parallel", "variation")),
        "serial_number": _text(_identity_value(identity, "serialNumber", "serial_number", "serialRun", "serial_run")),
        "grading_company": _text(_identity_value(identity, "gradingCompany", "grading_company")),
        "grade_value": _text(_identity_value(identity, "gradeValue", "grade_value", "grade")),
        "is_auto": _identity_value(identity, "isAuto", "is_auto") is True,
        "is_relic": _identity_value(identity, "isRelic", "is_relic") is True,
    }


def _query(identity: dict[str, Any], fallback: str) -> str:
    parts = [identity["year"], identity["manufacturer"], identity["brand"], identity["product"], identity["player"]]
    if identity["card_number"]:
        parts.append(f"#{identity['card_number']}")
    if identity["parallel"] and _norm(identity["parallel"]) not in {"base", "base set"}:
        parts.append(identity["parallel"])
    if identity["serial_number"]:
        denominator = _denominator(identity["serial_number"])
        parts.append(f"/{denominator}" if denominator else identity["serial_number"])
    value = " ".join(dict.fromkeys(p for p in map(_text, parts) if p))
    return value or _text(fallback) or "sports card"


def _parallel_patterns(parallel: str) -> list[re.Pattern[str]]:
    value = _norm(parallel)
    if value in {"", "base", "base set"}:
        return []
    aliases = {value.replace(" prizm", "").replace(" prism", "").strip()}
    if value in {"orange ice", "orange ice prizm", "orange cracked ice", "orange cracked ice prizm"}:
        aliases.update({"orange ice", "orange cracked ice", "ice orange"})
    if value in {"pink ice", "pink ice prizm", "pink cracked ice"}:
        aliases.update({"pink ice", "pink cracked ice"})
    if value in {"ice", "ice prizm", "ice prizms"}:
        aliases.update({"ice", "cracked ice"})
    patterns = []
    for alias in aliases:
        words = [re.escape(word) for word in alias.split() if word not in {"prizm", "prizms", "prism"}]
        if words:
            patterns.append(re.compile(r"\b" + r"\s+".join(words) + r"\b", re.I))
    return patterns


def _serial_denominators(value: str) -> list[str]:
    # Avoid treating season notation such as 2025/26 as a print run. Both
    # seller shorthand (/25) and full serials (07/25) are valid evidence.
    without_seasons = re.sub(r"\b(?:19|20)\d{2}\s*[-/]\s*\d{2,4}\b", " ", value or "")
    return [match.group(2) for match in _SERIAL_RE.finditer(without_seasons)]


def _denominator(value: str) -> str | None:
    denominators = _serial_denominators(value)
    return denominators[-1] if denominators else None


def _strong_exact_title(title: str, identity: dict[str, Any]) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    normalized = _norm(title)
    if not title or _LOT_RE.search(title):
        return False, ["multi_card_or_variant_listing"]
    for token in _norm(identity["player"]).split():
        if token and token not in normalized.split():
            reasons.append(f"missing_player_token:{token}")
    if identity["year"] and identity["year"] not in title:
        reasons.append("year_mismatch")
    number = re.escape(identity["card_number"])
    if number and not re.search(rf"(?:#\s*|card\s*#?\s*){number}\b", title, re.I):
        reasons.append("card_number_mismatch")
    product_tokens = [t for t in _norm(identity["product"] or identity["brand"]).split() if len(t) >= 4 and t not in {"wnba", "base", "card"}]
    if product_tokens and not any(t in normalized.split() for t in product_tokens):
        reasons.append("product_mismatch")
    target_parallel = _norm(identity["parallel"])
    if target_parallel in {"", "base", "base set"}:
        title_words = set(normalized.split())
        suspicious = title_words.intersection(_PARALLEL_WORDS - {"prizm", "prizms"})
        if suspicious:
            reasons.append("parallel_present_on_base")
    else:
        patterns = _parallel_patterns(identity["parallel"])
        if patterns and not any(pattern.search(title) for pattern in patterns):
            reasons.append("parallel_mismatch")
    target_denominator = _denominator(identity["serial_number"])
    title_denominators = set(_serial_denominators(title))
    if target_denominator:
        if target_denominator not in title_denominators:
            reasons.append("serial_run_mismatch")
    elif title_denominators:
        reasons.append("unexpected_serial_run")
    target_graded = bool(identity["grading_company"] or identity["grade_value"])
    title_graded = bool(_GRADER_RE.search(title))
    if target_graded != title_graded:
        reasons.append("raw_graded_mismatch")
    if target_graded:
        if identity["grading_company"] and _norm(identity["grading_company"]) not in normalized:
            reasons.append("grading_company_mismatch")
        if identity["grade_value"] and not re.search(rf"\b{re.escape(identity['grade_value'])}\b", title, re.I):
            reasons.append("grade_mismatch")
    if identity["is_auto"] != bool(_AUTO_RE.search(title)):
        reasons.append("autograph_state_mismatch")
    if identity["is_relic"] != bool(_RELIC_RE.search(title)):
        reasons.append("relic_state_mismatch")
    return not reasons, reasons


def _item_id(url: str) -> str | None:
    match = _EBAY_ITEM_RE.search(url)
    if match:
        return f"ebay:{match.group(1)}"
    match = _MERCARI_ITEM_RE.search(url)
    if match:
        return f"mercari:{match.group(1).lower()}"
    return None


def _money_values(text: str) -> list[float]:
    values = []
    for raw in _MONEY_RE.findall(text):
        try:
            values.append(float(raw.replace(",", "")))
        except ValueError:
            pass
    return values


def _date_iso(value: str) -> str | None:
    for fmt in ("%b %d, %Y", "%d %b %y %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return None


def _chrome_script(url: str, javascript: str, wait_seconds: int) -> str:
    return f'''tell application "Google Chrome"
  if (count windows) = 0 then make new window
  set w to window 1
  set oldIndex to active tab index of w
  set t to make new tab at end of tabs of w with properties {{URL:{json.dumps(url)}}}
  set active tab index of w to (count tabs of w)
  delay {wait_seconds}
  try
    set resultText to execute t javascript {json.dumps(javascript)}
  on error errMsg number errNum
    try
      close t
    end try
    if oldIndex ≤ (count tabs of w) then set active tab index of w to oldIndex
    error errMsg number errNum
  end try
  close t
  if oldIndex ≤ (count tabs of w) then set active tab index of w to oldIndex
  return resultText
end tell'''


def _run_osascript(script: str, timeout: int = _CHROME_TIMEOUT_SECONDS) -> str:
    completed = subprocess.run(
        ["/usr/bin/osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "Chrome automation failed").strip()[:500])
    return completed.stdout.strip()


async def _chrome_json(url: str, javascript: str, wait_seconds: int = 4) -> dict[str, Any]:
    script = _chrome_script(url, javascript, wait_seconds)
    raw = await asyncio.to_thread(_run_osascript, script)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Chrome returned unreadable marketplace data") from exc
    probe = f"{payload.get('title', '')} {payload.get('body', '')}"[:5000]
    if _CHALLENGE_RE.search(probe):
        raise RuntimeError("marketplace_challenge_detected")
    return payload


_EBAY_JS = r'''(()=>{const body=(document.body?.innerText||'');const seen=new Set();const rows=[];for(const a of document.querySelectorAll('a[href*="/itm/"]')){let title=(a.innerText||'').replace(/\s*Opens in a new window or tab\s*/gi,' ').trim();const m=a.href.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/i);if(!m||seen.has(m[1])||title.length<8||/^shop on ebay$/i.test(title)||m[1]==='123456')continue;let e=a;let text='';for(let i=0;i<7&&e;i++,e=e.parentElement){const v=(e.innerText||'').trim();if(/Sold\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/.test(v)&&/\$\s*\d/.test(v)){text=v;break}}if(!text)continue;seen.add(m[1]);const img=(a.closest('li,div')?.querySelector('img')?.src||null);rows.push({title,url:`https://www.ebay.com/itm/${m[1]}`,text,imageUrl:img});if(rows.length>=80)break}return JSON.stringify({title:document.title,url:location.href,body:body.slice(0,5000),rows})})()'''

_EBAY_ACTIVE_JS = r'''(()=>{const body=(document.body?.innerText||'');const seen=new Set();const rows=[];for(const a of document.querySelectorAll('a[href*="/itm/"]')){let title=(a.innerText||'').replace(/\s*Opens in a new window or tab\s*/gi,' ').trim();const m=a.href.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/i);if(!m||seen.has(m[1])||title.length<8||/^shop on ebay$/i.test(title)||m[1]==='123456')continue;let e=a;let text='';for(let i=0;i<7&&e;i++,e=e.parentElement){const v=(e.innerText||'').trim();if(/\$\s*\d/.test(v)&&!(/Sold\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}/.test(v))){text=v;break}}if(!text)continue;seen.add(m[1]);const img=(a.closest('li,div')?.querySelector('img')?.src||null);rows.push({title,url:`https://www.ebay.com/itm/${m[1]}`,text,imageUrl:img});if(rows.length>=80)break}return JSON.stringify({title:document.title,url:location.href,body:body.slice(0,5000),rows})})()'''


_MERCARI_JS = r'''(()=>{const body=(document.body?.innerText||'');const seen=new Set();const rows=[];for(const a of document.querySelectorAll('a[href*="/item/"]')){const m=a.href.match(/\/item\/(m\d+)/i);if(!m||seen.has(m[1]))continue;const text=(a.innerText||a.closest('li,article,div')?.innerText||'').trim();if(!text||!/\$\s*\d/.test(text))continue;seen.add(m[1]);const img=(a.querySelector('img')?.src||a.closest('li,article,div')?.querySelector('img')?.src||null);rows.push({url:`https://www.mercari.com/us/item/${m[1]}/`,text,imageUrl:img});if(rows.length>=60)break}return JSON.stringify({title:document.title,url:location.href,body:body.slice(0,5000),rows})})()'''

_130POINT_RESULT_JS = r'''(()=>{const body=(document.body?.innerText||'');const seen=new Set();const rows=[];for(const a of document.querySelectorAll('a[href]')){const m=a.href.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/i);const text=(a.innerText||'').trim();if(!m||seen.has(m[1])||!/USD/.test(text)||!/\b\d{2}\s+[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}:\d{2}\b/.test(text))continue;seen.add(m[1]);const img=(a.querySelector('img')?.src||a.closest('li,article,div')?.querySelector('img')?.src||null);rows.push({url:`https://www.ebay.com/itm/${m[1]}`,text,imageUrl:img});if(rows.length>=100)break}return JSON.stringify({title:document.title,url:location.href,body:body.slice(0,5000),rows})})()'''


def _chrome_130point_script(query: str) -> str:
    setter = f'''(()=>{{const input=[...document.querySelectorAll('input')].find(e=>e.placeholder==='Search by player, set, year, etc');if(!input)return 'NO_INPUT';const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,{json.dumps(query)});input.dispatchEvent(new Event('input',{{bubbles:true}}));input.dispatchEvent(new Event('change',{{bubbles:true}}));const button=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==='Search');if(!button)return 'NO_BUTTON';button.click();return 'CLICKED';}})()'''
    return f'''tell application "Google Chrome"
  if (count windows) = 0 then make new window
  set w to window 1
  set oldIndex to active tab index of w
  set t to make new tab at end of tabs of w with properties {{URL:"https://130point.com/search?new=sold"}}
  set active tab index of w to (count tabs of w)
  delay 3
  try
    set clickResult to execute t javascript {json.dumps(setter)}
    if clickResult is not "CLICKED" then error "130point search control unavailable"
    delay 5
    set resultText to execute t javascript {json.dumps(_130POINT_RESULT_JS)}
  on error errMsg number errNum
    try
      close t
    end try
    if oldIndex ≤ (count tabs of w) then set active tab index of w to oldIndex
    error errMsg number errNum
  end try
  close t
  if oldIndex ≤ (count tabs of w) then set active tab index of w to oldIndex
  return resultText
end tell'''


async def _search_ebay(query: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    url = f"https://www.ebay.com/sch/i.html?_nkw={quote(query)}&_sacat=0&LH_Sold=1&LH_Complete=1"
    try:
        payload = await _chrome_json(url, _EBAY_JS, 4)
        rows = []
        for raw in payload.get("rows") or []:
            title, text, link = _text(raw.get("title")), _text(raw.get("text")), _text(raw.get("url"))
            date_match = re.search(r"Sold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})", text)
            prices = _money_values(text)
            if not title or not link or not date_match or not prices:
                continue
            shipping = 0.0 if re.search(r"Free delivery|Free shipping", text, re.I) else None
            shipping_match = re.search(r"\+\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s+(?:delivery|shipping)", text, re.I)
            if shipping_match:
                shipping = float(shipping_match.group(1).replace(",", ""))
            rows.append({
                "title": title, "url": link, "item_price": prices[0], "shipping_price": shipping,
                "sold_at": _date_iso(date_match.group(1)), "image_url": raw.get("imageUrl"),
                "best_offer_unknown": bool(re.search(r"Best offer accepted", text, re.I)),
                "raw_text": text[:1500],
            })
        return rows, {"source": "mac_chrome_ebay_sold", "label": "eBay Sold · Mac Chrome", "status": "live" if rows else "no_matches", "resultCount": len(rows), "searchUrl": url, "message": f"{len(rows)} sold rows read directly from the public eBay sold-results page."}
    except Exception as exc:
        return [], {"source": "mac_chrome_ebay_sold", "label": "eBay Sold · Mac Chrome", "status": "challenge" if "challenge" in str(exc) else "error", "resultCount": 0, "searchUrl": url, "message": str(exc)[:300]}


async def _search_ebay_active(query: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    url = f"https://www.ebay.com/sch/i.html?_nkw={quote(query)}&_sacat=0&LH_BIN=1"
    try:
        payload = await _chrome_json(url, _EBAY_ACTIVE_JS, 4)
        rows = []
        for raw in payload.get("rows") or []:
            title, text, link = _text(raw.get("title")), _text(raw.get("text")), _text(raw.get("url"))
            prices = _money_values(text)
            if not title or not link or not prices:
                continue
            shipping = 0.0 if re.search(r"Free delivery|Free shipping", text, re.I) else None
            shipping_match = re.search(r"(?:\+|shipping[: ]*)\s*\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)", text, re.I)
            if shipping_match:
                shipping = float(shipping_match.group(1).replace(",", ""))
            rows.append({
                "title": title, "url": link, "item_price": prices[0], "shipping_price": shipping,
                "image_url": raw.get("imageUrl"), "raw_text": text[:1500],
            })
        return rows, {"source": "mac_chrome_ebay_active", "label": "eBay Active · Mac Chrome", "status": "live" if rows else "no_matches", "resultCount": len(rows), "searchUrl": url, "message": f"{len(rows)} active rows read directly from the public eBay current-listings page."}
    except Exception as exc:
        return [], {"source": "mac_chrome_ebay_active", "label": "eBay Active · Mac Chrome", "status": "challenge" if "challenge" in str(exc) else "error", "resultCount": 0, "searchUrl": url, "message": str(exc)[:300]}


async def _search_130point(query: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        raw = await asyncio.to_thread(_run_osascript, _chrome_130point_script(query), 35)
        payload = json.loads(raw)
        probe = f"{payload.get('title', '')} {payload.get('body', '')}"[:5000]
        if _CHALLENGE_RE.search(probe):
            raise RuntimeError("marketplace_challenge_detected")
        rows = []
        for entry in payload.get("rows") or []:
            text, link = _text(entry.get("text")), _text(entry.get("url"))
            lines = [line.strip() for line in str(entry.get("text") or "").splitlines() if line.strip()]
            title = next((line for line in lines if not line.startswith("$") and "USD" not in line and not re.search(r"\b(?:Auction|Fixed Price|Best Offer Accepted)\b", line, re.I) and not re.search(r"\d{2}\s+[A-Z][a-z]{2}\s+\d{2}", line)), "")
            prices = _money_values(text)
            date_match = re.search(r"(\d{2}\s+[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}:\d{2})", text)
            if not title or not prices or not date_match or not link:
                continue
            realized = prices[-1] if re.search(r"Best Offer Accepted", text, re.I) and len(prices) >= 2 else prices[0]
            rows.append({"title": title, "url": link, "item_price": realized, "shipping_price": None, "sold_at": _date_iso(date_match.group(1)), "image_url": entry.get("imageUrl"), "raw_text": text[:1200]})
        return rows, {"source": "mac_chrome_130point_sold", "label": "130point Sold · Mac Chrome", "status": "live" if rows else "no_matches", "resultCount": len(rows), "searchUrl": "https://130point.com/search?new=sold", "message": f"{len(rows)} sold rows read through 130point's public Compare sold items UI."}
    except Exception as exc:
        return [], {"source": "mac_chrome_130point_sold", "label": "130point Sold · Mac Chrome", "status": "challenge" if "challenge" in str(exc) else "error", "resultCount": 0, "searchUrl": "https://130point.com/search?new=sold", "message": str(exc)[:300]}


async def _search_mercari(query: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    url = f"https://www.mercari.com/search/?keyword={quote(query)}"
    try:
        payload = await _chrome_json(url, _MERCARI_JS, 5)
        rows = []
        for entry in payload.get("rows") or []:
            lines = [line.strip() for line in str(entry.get("text") or "").splitlines() if line.strip()]
            title = next((line for line in lines if not line.startswith("$")), "")
            prices = _money_values(str(entry.get("text") or ""))
            if title and prices and entry.get("url"):
                raw_text = str(entry.get("text") or "")
                shipping = 0.0 if re.search(r"Free shipping|shipping included", raw_text, re.I) else None
                shipping_match = re.search(r"(?:\+|shipping[: ]*)\s*\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)", raw_text, re.I)
                if shipping_match:
                    shipping = float(shipping_match.group(1).replace(",", ""))
                rows.append({"title": title, "url": entry["url"], "item_price": prices[0], "shipping_price": shipping, "image_url": entry.get("imageUrl"), "raw_text": raw_text[:1200]})
        return rows, {"source": "mac_chrome_mercari_active", "label": "Mercari Active · Mac Chrome", "status": "live" if rows else "no_matches", "resultCount": len(rows), "searchUrl": url, "message": f"{len(rows)} active rows read directly from Mercari public search."}
    except Exception as exc:
        return [], {"source": "mac_chrome_mercari_active", "label": "Mercari Active · Mac Chrome", "status": "challenge" if "challenge" in str(exc) else "error", "resultCount": 0, "searchUrl": url, "message": str(exc)[:300]}


async def _search_fanatics(query: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=15.0, headers={"Accept": "application/json", "User-Agent": "TCOS-InstaComp-Mac/1.0"}) as client:
            response = await client.get(_FANATICS_API, params={"title": query, "size": 50})
        response.raise_for_status()
        payload = response.json()
        for entry in ((payload.get("_embedded") or {}).get("SalesRecords") or []):
            if _text(entry.get("paymentStatus")).lower() != "paid":
                continue
            price = float(entry.get("purchasePrice") or 0)
            sold_at = _text(entry.get("soldDate"))
            date = None
            if sold_at:
                try:
                    date = datetime.fromisoformat(sold_at.replace(" PDT", "-07:00").replace(" PST", "-08:00")).isoformat()
                except ValueError:
                    date = sold_at[:10] if re.match(r"\d{4}-\d{2}-\d{2}", sold_at) else None
            sale_id = _text(entry.get("id"))
            if sale_id and price > 0 and date:
                rows.append({"title": _text(entry.get("title")), "url": f"{_FANATICS_API}/item/{quote(sale_id)}", "item_price": price, "shipping_price": 0.0, "sold_at": date, "image_url": entry.get("mediumImage1")})
        return rows, {"source": "fanatics_collect_sales_history", "label": "Fanatics Collect Sales History", "status": "live" if rows else "no_matches", "resultCount": len(rows), "searchUrl": f"{_FANATICS_API}?title={quote(query)}", "message": f"{len(rows)} paid realized sale rows returned by Fanatics' public sales API."}
    except Exception as exc:
        return [], {"source": "fanatics_collect_sales_history", "label": "Fanatics Collect Sales History", "status": "error", "resultCount": 0, "searchUrl": f"{_FANATICS_API}?title={quote(query)}", "message": str(exc)[:300]}


def _evidence(row: dict[str, Any], *, source: str, label: str, category: str, pricing_eligible: bool, exact_reasons: list[str] | None = None) -> dict[str, Any]:
    item_price = float(row.get("item_price") or 0)
    shipping = row.get("shipping_price")
    shipping_value = float(shipping) if shipping is not None else None
    total = item_price + shipping_value if shipping_value is not None else item_price
    return {
        "title": row.get("title"), "price": round(total, 2), "itemPrice": round(item_price, 2),
        "shippingPrice": round(shipping_value, 2) if shipping_value is not None else None,
        "priceIncludesShipping": shipping_value is not None, "currency": "USD", "url": row.get("url"),
        "imageUrl": row.get("image_url"), "source": source, "sourceLabel": label, "sourceCategory": category,
        "matchScore": 500 if pricing_eligible else 350, "flags": ["Mac local exact-card gate", "retained for market learning", *(exact_reasons or []), *( ["pricing eligible"] if pricing_eligible else ["reference only", "not used for pricing"] )],
        "soldAt": row.get("sold_at") if category == "sold" else None, "listedAt": None,
        "observedAt": datetime.now(timezone.utc).isoformat(),
    }


def _dedupe(values: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result = []
    for row in values:
        key = _item_id(_text(row.get("url"))) or _text(row.get("url")).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(row)
        if len(result) >= limit:
            break
    return result


def _market_summary(sold: list[dict[str, Any]], active: list[dict[str, Any]]) -> dict[str, Any]:
    prices = [float(row["price"]) for row in sold if "pricing eligible" in (row.get("flags") or []) and float(row.get("price") or 0) > 0]
    active_prices = [float(row["price"]) for row in active if float(row.get("price") or 0) > 0]
    return {
        "pricingEligibleSoldCount": len(prices),
        "soldLow": round(min(prices), 2) if prices else None,
        "soldMedian": round(statistics.median(prices), 2) if prices else None,
        "soldAverage": round(statistics.mean(prices), 2) if prices else None,
        "soldHigh": round(max(prices), 2) if prices else None,
        "activeCount": len(active_prices),
        "activeLow": round(min(active_prices), 2) if active_prices else None,
        "activeMedian": round(statistics.median(active_prices), 2) if active_prices else None,
    }


def build_market_comp_router(require_api_key: Callable[..., None], database_path: Path | None = None) -> APIRouter:
    router = APIRouter(prefix="/v1/market-comp", tags=["market-comp"], dependencies=[Depends(require_api_key)])

    @router.post("/search")
    async def search_market_comps(request: MarketCompRequest):
        identity = _canonical_identity(request.identity)
        missing = [field for field in ("year", "player", "card_number") if not identity[field]]
        if missing:
            raise HTTPException(status_code=400, detail=f"Exact market search requires: {', '.join(missing)}")
        query = _query(identity, request.exact_title)
        async with _BROWSER_LOCK:
            ebay_task = asyncio.create_task(_search_ebay(query))
            fanatics_task = (
                asyncio.create_task(_search_fanatics(query))
                if request.include_fanatics
                else None
            )
            ebay = await ebay_task
            fanatics = (
                await fanatics_task
                if fanatics_task is not None
                else ([], {
                    "source": "fanatics_collect_sales_history",
                    "label": "Fanatics Collect Sales History",
                    "status": "not_configured",
                    "resultCount": 0,
                    "message": "Skipped for this direct-market request.",
                })
            )
            point = (
                await _search_130point(query)
                if request.include_130point
                else ([], {
                    "source": "mac_chrome_130point_sold",
                    "label": "130point Sold · Mac Chrome",
                    "status": "not_configured",
                    "resultCount": 0,
                    "message": "Skipped for this direct-market request.",
                })
            )
            ebay_active = (
                await _search_ebay_active(query)
                if request.include_active
                else ([], {
                    "source": "mac_chrome_ebay_active",
                    "label": "eBay Active · Mac Chrome",
                    "status": "not_configured",
                    "resultCount": 0,
                    "message": "Skipped for this direct-market request.",
                })
            )

        ebay_rows, ebay_coverage = ebay
        point_rows, point_coverage = point
        ebay_active_rows, ebay_active_coverage = ebay_active
        fanatics_rows, fanatics_coverage = fanatics

        ebay_by_id = {_item_id(row["url"]): row for row in ebay_rows if _item_id(row["url"])}
        sold: list[dict[str, Any]] = []
        rejected: list[dict[str, Any]] = []
        point_ids: set[str] = set()
        for row in point_rows:
            ok, reasons = _strong_exact_title(row["title"], identity)
            key = _item_id(row["url"])
            if not ok:
                rejected.append({"source": "130point", "title": row["title"], "url": row["url"], "reasons": reasons})
                continue
            point_ids.add(key or row["url"])
            direct = ebay_by_id.get(key)
            if direct and direct.get("shipping_price") is not None:
                row = {**row, "shipping_price": direct["shipping_price"]}
            sold.append(_evidence(row, source="mac_130point_exact_sold", label="130point Exact Sold · Mac", category="sold", pricing_eligible=row.get("shipping_price") is not None, exact_reasons=["130point realized sold price"]))

        for row in ebay_rows:
            key = _item_id(row["url"])
            if key in point_ids:
                continue
            ok, reasons = _strong_exact_title(row["title"], identity)
            if not ok:
                rejected.append({"source": "eBay", "title": row["title"], "url": row["url"], "reasons": reasons})
                continue
            eligible = row.get("shipping_price") is not None and not row.get("best_offer_unknown")
            sold.append(_evidence(row, source="mac_ebay_exact_sold", label="eBay Exact Sold · Mac Chrome", category="sold", pricing_eligible=eligible, exact_reasons=["direct eBay sold page"]))

        for row in fanatics_rows:
            ok, reasons = _strong_exact_title(row["title"], identity)
            if not ok:
                rejected.append({"source": "Fanatics", "title": row["title"], "url": row["url"], "reasons": reasons})
                continue
            sold.append(_evidence(row, source="mac_fanatics_exact_sold", label="Fanatics Exact Sold · Mac", category="sold", pricing_eligible=True, exact_reasons=["paid Fanatics realized sale"]))

        active: list[dict[str, Any]] = []
        for row in ebay_active_rows:
            ok, reasons = _strong_exact_title(row["title"], identity)
            if not ok:
                rejected.append({"source": "eBay Active", "marketplace": "eBay", "title": row["title"], "url": row["url"], "rejectionReason": "; ".join(reasons), "reasons": reasons})
                continue
            eligible = row.get("shipping_price") is not None
            active.append(_evidence(row, source="mac_ebay_exact_active", label="eBay Exact Active · Mac Chrome", category="marketplace", pricing_eligible=eligible, exact_reasons=["direct eBay active listing", "competitive ask"] ))

        sold = _dedupe(sold, request.max_sold)
        active = _dedupe(active, request.max_active)
        summary = _market_summary(sold, active)
        learning = {"status": "not_configured", "market_observations_saved": 0, "student_training_eligible": False}
        if database_path is not None:
            try:
                accepted_sold = [row for row in sold if "pricing eligible" in (row.get("flags") or [])]
                receipt = {
                    "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
                    "source": "mac_local_market_search_raw",
                    "sourceAuthority": "mac_local_browser_and_direct_market_feeds",
                    "localDeterministicMarketTruth": False,
                    "operatorCertifiedIdentity": request.operator_certified_identity,
                    "scanId": request.scan_id,
                    "researchId": request.research_id or request.scan_id,
                    "registryIdentityId": request.registry_identity_id,
                    "registryFingerprintSha256": request.registry_fingerprint_sha256,
                    "canonicalIdentity": {
                        "player": identity["player"], "year": identity["year"], "brand": identity["brand"] or identity["manufacturer"],
                        "setName": identity["set_name"] or identity["product"], "cardNumber": identity["card_number"],
                        "parallel": identity["parallel"], "isAuto": identity["is_auto"], "isRelic": identity["is_relic"],
                    },
                    "teacherConsensus": {"configuredTeachers": [], "requiredVotes": 2, "trusted": False},
                    "acceptedSoldComps": accepted_sold,
                    "acceptedActiveComps": active,
                    "discoverySoldComps": sold,
                    "discoveryActiveComps": active,
                    "rejectedMarketCandidates": rejected[:100],
                    "pricingEligibleSoldCount": 0,
                    "trustedSuggestedPrice": None,
                    "competitiveActiveLow": summary.get("activeLow"),
                    "competitiveActiveMedian": summary.get("activeMedian"),
                }
                learning = record_exact_market_history(database_path, receipt)
            except Exception as exc:
                learning = {"status": "failed", "error": str(exc)[:300], "market_observations_saved": 0, "student_training_eligible": False}
        return {
            "schemaVersion": "tcos.instacomp-ai.market-comp.v1",
            "ok": True,
            "query": query,
            "identity": identity,
            "sold": sold,
            "active": active,
            "rejected": rejected[:100],
            "providerCoverage": [ebay_coverage, point_coverage, ebay_active_coverage, fanatics_coverage],
            "marketSummary": summary,
            "pricingEligibleSoldCount": summary["pricingEligibleSoldCount"],
            "learning": learning,
            "trainingAllowed": bool(learning.get("student_training_eligible")),
            "sourceAuthority": "mac_local_browser_and_direct_market_feeds",
        }

    return router
