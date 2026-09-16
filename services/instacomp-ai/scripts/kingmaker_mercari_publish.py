#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import uuid


def _osascript(source: str) -> str:
    completed = subprocess.run(
        ["osascript", "-"],
        input=source,
        text=True,
        capture_output=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "AppleScript failed").strip())
    return (completed.stdout or "").strip()


_JOB_WINDOW_ID: int | None = None
_JOB_TAB_ID: int | None = None


def _open_job_window(url: str) -> None:
    global _JOB_WINDOW_ID, _JOB_TAB_ID
    source = (
        'tell application "Google Chrome"\n'
        '  activate\n'
        '  if (count of windows) = 0 then make new window\n'
        '  set w to front window\n'
        f'  set t to make new tab at end of tabs of w with properties {{URL:{json.dumps(url)}}}\n'
        '  set active tab index of w to (count of tabs of w)\n'
        '  return (id of w as text) & ":" & (id of t as text)\n'
        'end tell'
    )
    raw = _osascript(source)
    try:
        win, tab = raw.strip().split(":", 1)
        _JOB_WINDOW_ID = int(win)
        _JOB_TAB_ID = int(tab)
    except (ValueError, AttributeError) as exc:
        raise RuntimeError(f"Mercari automation tab could not be created: {raw}") from exc


def _job_window_prefix() -> str:
    if _JOB_WINDOW_ID is None or _JOB_TAB_ID is None:
        raise RuntimeError("Mercari automation tab is not initialized.")
    return (
        'tell application "Google Chrome"\n'
        f'  set w to first window whose id is {_JOB_WINDOW_ID}\n'
        f'  set t to first tab of w whose id is {_JOB_TAB_ID}\n'
    )


def _chrome_js(js: str) -> str:
    source = (
        _job_window_prefix()
        + f'  return execute t javascript {json.dumps(js)}\n'
        + 'end tell'
    )
    return _osascript(source)


def _navigate(url: str) -> None:
    if _JOB_WINDOW_ID is None:
        _open_job_window(url)
        return
    source = (
        _job_window_prefix()
        + f'  set URL of t to {json.dumps(url)}\n'
        + '  set index of w to 1\n'
        + '  activate\n'
        + 'end tell'
    )
    _osascript(source)

def _wait_js(js: str, timeout: float = 25.0, interval: float = 0.5) -> str:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            last = _chrome_js(js)
            if last not in {"", "false", "0", "null", "undefined"}:
                return last
        except Exception:
            pass
        time.sleep(interval)
    raise RuntimeError(f"Mercari browser step timed out. Last state: {last or 'none'}")


def _profile_name() -> str:
    # The Mercari sell page can hide profile-menu text even while authenticated.
    # Verify the login from /mypage/ instead of inferring it from a menu click.
    url = _chrome_js("location.href")
    if "/login" in url.lower() or "/signup" in url.lower():
        return ""
    body = _chrome_js("document.body.innerText.slice(0,5000)")
    match = re.search(r"My profile\s+([^\n]+)", body, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    handle = re.search(r"\n@([^\n]+)", body)
    return handle.group(1).strip() if handle else ""

def _mercari_category(item: dict) -> str:
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("sport", "category", "title", "description")
    ).lower()
    if any(token in haystack for token in ("basketball", "wnba", "nba")):
        return "Basketball Trading Cards"
    if any(token in haystack for token in ("baseball", "mlb")):
        return "Baseball Trading Cards"
    if any(token in haystack for token in ("soccer", "football club", "mls")):
        return "Soccer Trading Cards"
    if any(token in haystack for token in ("wrestling", "wwe", "aew")):
        return "Wrestling Trading Cards"
    if any(token in haystack for token in ("golf", "pga")):
        return "Golf Trading Cards"
    if any(token in haystack for token in ("tennis", "atp", "wta")):
        return "Tennis Trading Cards"
    if any(token in haystack for token in ("boxing", "ufc", "mma")):
        return "Boxing Trading Cards"
    return "Sports Trading Cards"


def _select_category(item: dict) -> str:
    category = _mercari_category(item)
    opened = _chrome_js(
        "(()=>{const b=document.querySelector('[data-testid=SellCategoryFieldButton]');"
        "if(!b)return 'missing';b.click();return 'opened'})()"
    )
    if opened != "opened":
        raise RuntimeError("Mercari category control is unavailable.")
    _wait_js("document.querySelector('[data-testid=CategorySearchInput]') ? 'search' : ''", timeout=10)
    search = json.dumps(category)
    typed = _chrome_js(
        f"(()=>{{const e=document.querySelector('[data-testid=CategorySearchInput]');"
        f"if(!e)return 'missing';const v={search};"
        "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);"
        "e.dispatchEvent(new Event('input',{bubbles:true}));"
        "e.dispatchEvent(new Event('change',{bubbles:true}));return 'typed'})()"
    )
    if typed != "typed":
        raise RuntimeError("Mercari category search could not be populated.")
    category_json = json.dumps(category)
    _wait_js(
        f"(()=>{{const q={category_json};return Array.from(document.querySelectorAll('[data-testid=CategoryRow]')).some(x=>(x.innerText||'').includes(q))?'found':''}})()",
        timeout=10,
    )
    clicked = _chrome_js(
        f"(()=>{{const q={category_json};const rows=Array.from(document.querySelectorAll('[data-testid=CategoryRow]'));"
        "const exact=rows.find(x=>(x.innerText||'').trim().endsWith('> '+q));"
        "const b=exact||rows.find(x=>(x.innerText||'').includes(q));if(!b)return 'missing';b.click();return 'clicked'})()"
    )
    if clicked != "clicked":
        raise RuntimeError(f"Mercari category {category} could not be selected.")
    _wait_js(
        f"(()=>{{const t=document.querySelector('[data-testid=SellCategoryFieldButton]')?.innerText||'';return t.includes({category_json})?'selected':''}})()",
        timeout=10,
    )
    return category


def _fill_item(item: dict) -> str:
    title = str(item.get("title") or "").strip()[:80]
    description = str(item.get("description") or "").strip()[:1000]
    price = round(float(item.get("price") or 0), 2)
    image_urls = [str(x).strip() for x in (item.get("imageUrls") or []) if str(x).strip()][:12]
    if not title or len(description.split()) < 5 or price < 1 or len(image_urls) < 2:
        raise RuntimeError("Mercari requires title, 5+ word description, price >= $1, and front/back images.")

    _open_job_window("https://www.mercari.com/mypage/")
    _wait_js("(()=>{const u=location.href.toLowerCase();const b=document.body?.innerText||'';return (u.includes('/login')||u.includes('/signup')||b.includes('My profile'))?'session-ready':''})()", timeout=25)
    account = _profile_name()
    if not account:
        raise RuntimeError("Mercari is not logged in in the dedicated Chrome automation tab.")

    _navigate("https://www.mercari.com/sell/")
    _wait_js("document.querySelector('[name=sellName]') && document.querySelector('[data-testid=SaveDraftButton]') ? 'ready' : ''")

    values = json.dumps({"title": title, "description": description, "price": f"{price:.2f}"})
    fill_js = f"""(()=>{{const v={values};const set=(name,val)=>{{const e=document.querySelector('[name=\\\"'+name+'\\\"]');if(!e)throw new Error('missing '+name);const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,val);e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));}};set('sellName',v.title);set('sellDescription',v.description);set('sellPrice',v.price);return 'filled'}})()"""
    if _chrome_js(fill_js) != "filled":
        raise RuntimeError("Mercari fields could not be populated.")

    token = f"__tcosMercariUpload_{uuid.uuid4().hex}"
    upload_js = f"""(()=>{{localStorage.setItem({json.dumps(token)},'starting');(async()=>{{try{{const urls={json.dumps(image_urls)};const dt=new DataTransfer();for(let i=0;i<urls.length;i++){{const r=await fetch(urls[i]);if(!r.ok)throw new Error('image fetch '+r.status);const b=await r.blob();dt.items.add(new File([b],(i===0?'front-':'image-'+i+'-')+'tcos.jpg',{{type:b.type||'image/jpeg'}}));}}const input=document.querySelector('[data-testid=SellPhotoInput]');input.files=dt.files;input.dispatchEvent(new Event('change',{{bubbles:true}}));localStorage.setItem({json.dumps(token)},'dispatched:'+dt.files.length);}}catch(e){{localStorage.setItem({json.dumps(token)},'error:'+e.message)}}}})();return 'started'}})()"""
    _chrome_js(upload_js)
    state = _wait_js(
        f"(()=>{{const v=localStorage.getItem({json.dumps(token)})||'';return v.startsWith('dispatched:')?v:(v.startsWith('error:')?v:'')}})()",
        timeout=25,
    )
    if state.startswith("error:"):
        raise RuntimeError(state)

    _select_category(item)
    _chrome_js("(()=>{const l=document.querySelector('[data-testid=ConditionLikeNew]');if(!l)throw new Error('Like new condition missing');l.click();return 'condition'})()")
    _wait_js("document.querySelector('input#2[name=sellCondition]')?.checked ? 'condition' : ''")

    _wait_js("document.querySelector('[data-testid=SmartPricingButton]') ? 'smart' : ''", timeout=15)
    _chrome_js("(()=>{const b=document.querySelector('[data-testid=SmartPricingButton]');if(b?.getAttribute('aria-pressed')==='true')b.click();return b?.getAttribute('aria-pressed')||''})()")
    _wait_js("document.querySelector('[data-testid=SmartPricingButton]')?.getAttribute('aria-pressed')==='false' ? 'off' : ''", timeout=10)

    free_shipping = _chrome_js("document.querySelector('#sellShippingPayerId input')?.value || ''")
    if free_shipping and free_shipping.lower().startswith("yes"):
        raise RuntimeError("Mercari free shipping is enabled; TCOS will not publish until shipping payer is reviewed.")
    return account


def _save_ready_draft(title: str) -> dict:
    result = _chrome_js("(()=>{const b=document.querySelector('[data-testid=SaveDraftButton]');if(!b||b.disabled)return 'blocked';b.click();return 'clicked'})()")
    if result != "clicked":
        raise RuntimeError("Mercari Save draft is blocked.")
    _wait_js("location.href.includes('/mypage/listings/draft/') ? location.href : ''", timeout=25)
    url = _chrome_js("location.href")
    body = _chrome_js("document.body.innerText.slice(0,12000)")
    if "/action-required/" in url or "Action Required" in body:
        missing = [line.strip() for line in body.splitlines() if "requires an update" in line.lower()]
        raise RuntimeError("Mercari draft needs review: " + (", ".join(missing) or "Action Required"))
    title_json = json.dumps(title)
    draft_url = _chrome_js(f"(()=>{{const title={title_json};const a=Array.from(document.querySelectorAll('a[href*=\\\"/sell/draft/\\\"]')).find(x=>(x.innerText||'').includes(title));return a?.href||''}})()")
    if not draft_url:
        raise RuntimeError("Mercari saved the draft but TCOS could not resolve its draft URL.")
    match = re.search(r"/sell/draft/([^/]+)/", draft_url)
    return {"draftId": match.group(1) if match else None, "draftUrl": draft_url}


def _publish_draft(draft_url: str) -> str:
    _navigate(draft_url)
    _wait_js("document.querySelector('[data-testid=ListButton]') ? 'list' : ''", timeout=20)
    if _chrome_js("document.body.innerText.includes('requires an update') ? 'missing' : ''"):
        raise RuntimeError("Mercari draft is not ready to publish.")
    click = _chrome_js("(()=>{const b=document.querySelector('[data-testid=ListButton]');if(!b||b.disabled)return 'blocked';b.click();return 'clicked'})()")
    if click != "clicked":
        raise RuntimeError("Mercari List button is blocked.")
    confirmation = _wait_js("location.href.includes('/sell/confirmation/') ? location.href : ''", timeout=30)
    match = re.search(r"/sell/confirmation/(m\d+)/", confirmation)
    if not match:
        raise RuntimeError("Mercari did not return a live item ID after listing.")
    return match.group(1)


def main() -> None:
    payload = json.load(sys.stdin)
    mode = str(payload.get("mode") or "status").strip().lower()
    if mode == "status":
        _open_job_window("https://www.mercari.com/mypage/")
        _wait_js("(()=>{const u=location.href.toLowerCase();const b=document.body?.innerText||'';return (u.includes('/login')||u.includes('/signup')||b.includes('My profile'))?'session-ready':''})()", timeout=25)
        account = _profile_name()
        if not account:
            raise RuntimeError("Mercari is not logged in in the dedicated Chrome automation tab.")
        print(json.dumps({"ok": True, "mode": mode, "connected": True, "account": account}))
        return
    if mode not in {"draft", "publish"}:
        raise RuntimeError("Unsupported Mercari bridge mode.")

    item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
    title = str(item.get("title") or "").strip()[:80]
    account = _fill_item(item)
    draft = _save_ready_draft(title)
    if mode == "draft":
        print(json.dumps({"ok": True, "mode": mode, "account": account, "status": "ready_to_list", **draft}))
        return

    item_id = _publish_draft(str(draft["draftUrl"]))
    print(json.dumps({
        "ok": True,
        "mode": mode,
        "account": account,
        "status": "active",
        "itemId": item_id,
        "itemUrl": f"https://www.mercari.com/us/item/{item_id}/",
        **draft,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        raise SystemExit(1)
