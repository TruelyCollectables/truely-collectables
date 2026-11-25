"""Read-only historical evidence and optional licensed transaction feed.
Neither source is a direct live eBay page. Never substitute asking prices.
"""
from __future__ import annotations
import json, math, os, re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import httpx

ARCHIVE = Path("/Volumes/Fanxiang S101 2TB/Projects/AI-Learning/CodingAI-Training/lessons/kingmaker-redo-independent-reidentification-20261101/75_ebay_research_365d/seller_product_research_results.jsonl")
URL = "https://www.thecardapi.com/api/v1/market/sales"

def listing_id(value):
    try:
        u=urlparse(str(value))
        if u.scheme!="https" or u.hostname not in ("ebay.com","www.ebay.com"):return None
        m=re.fullmatch(r"/itm/(?:[^/]+/)?(\d{9,15})/?",u.path)
        return m.group(1) if m else None
    except ValueError:return None

def money(value):
    if isinstance(value,bool):return None
    if isinstance(value,(float,int)):n=float(value)
    else:
        m=re.match(r"^\s*\$([\d,]+(?:\.\d{2})?)(?:\s|$)",str(value or ""))
        if not m:return None
        n=float(m.group(1).replace(",",""))
    return n if math.isfinite(n) and 0<=n<1000000 else None

def archive_sales(payload,days,matcher,archive=ARCHIVE):
    if not archive.is_file():
        return [],{"status":"archive_unavailable","message":"Original Seller Hub audit file not found.","source":"seller_hub_archive"}
    now=datetime.now(timezone.utc);cutoff=now.date()-timedelta(days=days)
    seen={};conflicts=set();captures=[]
    try:
        with archive.open() as handle:
            for line in handle:
                try:record=json.loads(line)
                except ValueError:continue
                if record.get("id") not in payload.get("ids",[]) or record.get("status")!="EXACT_SALE_FOUND" or record.get("price_changes") is not False:continue
                try:
                    capture=datetime.fromisoformat(record["read_at"].replace("Z","+00:00"))
                    if capture.tzinfo is None or capture>now:continue
                except (ValueError,KeyError,TypeError):continue
                captures.append(capture)
                for r in record.get("exact",[]):
                    if r.get("totalSold")!="1" or r.get("match_label")!="EXACT_CANDIDATE_VALIDATED_TITLE":continue
                    title=str(r.get("title") or "");lid=listing_id(r.get("url"))
                    if not lid or not matcher(title,payload["identity"])[0]:continue
                    source=urlparse(str(r.get("source_page_url") or ""))
                    if source.scheme!="https" or source.hostname!="www.ebay.com" or source.path!="/sh/research" or parse_qs(source.query).get("tabName")!=["SOLD"]:continue
                    try:date=datetime.strptime(r["lastSold"],"%b %d, %Y").date()
                    except (ValueError,KeyError,TypeError):continue
                    if not cutoff<=date<=capture.date():continue
                    item=money(r.get("price"));shipping=money(r.get("shipping"))
                    if item is None or item<=0 or shipping is None:continue
                    if lid in seen and (seen[lid]["item_price"],seen[lid]["shipping_price"],seen[lid]["sold_at"])!=(item,shipping,str(date)):conflicts.add(lid)
                    seen[lid]={"title":title,"url":"https://www.ebay.com/itm/"+lid,"item_price":item,"shipping_price":shipping,"sold_at":str(date),"best_offer_unknown":False,"source":"seller_hub_archive","captured_at":capture.isoformat()}
    except (OSError,ValueError):return [],{"status":"archive_unavailable","source":"seller_hub_archive","message":"Historical audit could not be read."}
    rows=[r for k,r in seen.items() if k not in conflicts]
    return rows,{"status":"archived_history" if rows else "no_exact_archive","source":"seller_hub_archive","resultCount":len(rows),"lastCapture":max(captures).isoformat() if captures else None,"message":"Previously captured single-unit Seller Hub sold rows; not refreshed today and not eligible for automatic repricing."}

def licensed_configured():
    return bool(os.environ.get("THECARDAPI_KEY")) and os.environ.get("THECARDAPI_COMMERCIAL_LICENSE")=="1"

async def licensed_sales(identity,days,matcher):
    if not licensed_configured():
        return [],{"status":"not_configured","source":"thecardapi","message":"A commercial-use API key and license confirmation are required; no paid request made."}
    today=datetime.now(timezone.utc).date();cutoff=today-timedelta(days=days)
    query=" ".join(str(identity.get(k) or "") for k in ("year","player","product","card_number","parallel")).strip()
    params={"q":query,"platform":"ebay","date_from":str(cutoff),"date_to":str(today),"limit":100,"graded":str(bool(identity.get("grade_value") or identity.get("grading_company"))).lower()}
    try:
        async with httpx.AsyncClient(timeout=20,follow_redirects=False) as client:
            response=await client.get(URL,params=params,headers={"x-market-api-key":os.environ["THECARDAPI_KEY"]})
            if response.status_code!=200:return [],{"status":"rate_limited" if response.status_code==429 else "error","source":"thecardapi","message":f"Licensed provider HTTP {response.status_code}; paused without retry."}
            body=response.json()
    except (httpx.HTTPError,ValueError):return [],{"status":"error","source":"thecardapi","message":"Licensed provider connection or response failed."}
    if not isinstance(body,dict) or not isinstance(body.get("data"),list):return [],{"status":"error","source":"thecardapi","message":"Unexpected licensed provider schema."}
    rows=[]
    for r in body["data"]:
        if not isinstance(r,dict) or r.get("price_confirmed") is not True or str(r.get("platform","")).casefold()!="ebay" or r.get("currency")!="USD":continue
        lid=listing_id(r.get("listing_url"));title=str(r.get("title") or "")
        if not lid or not matcher(title,identity)[0]:continue
        if r.get("listing_type") not in ("auction","fixed_price","best_offer"):continue
        item=money(r.get("price"));shipping=money(r.get("shipping_price"))
        if item is None or item<=0 or shipping is None:continue
        try:date=datetime.fromisoformat(str(r["sale_date"])).date()
        except (ValueError,KeyError,TypeError):continue
        if not cutoff<=date<=today:continue
        rows.append({"title":title,"url":"https://www.ebay.com/itm/"+lid,"item_price":item,"shipping_price":shipping,"sold_at":str(date),"best_offer_unknown":False,"source":"thecardapi"})
    meta=body.get("meta") or {};pagination=body.get("pagination") or {}
    return rows,{"status":"live" if rows else "no_matches","source":"thecardapi","resultCount":len(rows),"coverageDateFrom":meta.get("coverage_date_from"),"coverageDateTo":meta.get("coverage_date_to"),"moreResults":bool(pagination.get("has_more") or pagination.get("next_cursor")),"message":"Licensed third-party reported confirmed eBay transactions; coverage may be shorter than requested and capped at 100 rows. Not a direct eBay capture."}
