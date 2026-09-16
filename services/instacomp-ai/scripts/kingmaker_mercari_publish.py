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


def _chrome_js(js: str) -> str:
    source = (
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then error "Chrome has no open window"\n'
        '  set t to active tab of front window\n'
        f'  return execute t javascript {json.dumps(js)}\n'
        'end tell'
    )
    return _osascript(source)


def _navigate(url: str) -> None:
    source = (
        'tell application "Google Chrome"\n'
        '  if (count of windows) = 0 then error "Chrome has no open window"\n'
        '  activate\n'
        f'  set URL of active tab of front window to {json.dumps(url)}\n'
        'end tell'
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
    _chrome_js("(()=>{document.querySelector('button[aria-label=profile]')?.click();return 'profile'})()")
    time.sleep(0.4)
    return _chrome_js("(()=>{const a=document.querySelector('a[href=\"/mypage/\"]');return (a?.innerText||'').replace(/View profile/i,'').trim()})()")


def _fill_item(item: dict) -> str:
    title = str(item.get("title") or "").strip()[:80]
    description = str(item.get("description") or "").strip()[:1000]
    price = round(float(item.get("price") or 0), 2)
    image_urls = [str(x).strip() for x in (item.get("imageUrls") or []) if str(x).strip()][:12]
    if not title or len(description.split()) < 5 or price < 1 or len(image_urls) < 2:
        raise RuntimeError("Mercari requires title, 5+ word description, price >= $1, and front/back images.")

    _navigate("https://www.mercari.com/sell/")
    _wait_js("document.querySelector('[name=sellName]') && document.querySelector('[data-testid=SaveDraftButton]') ? 'ready' : ''")
    account = _profile_name()
    if not account:
        raise RuntimeError("Mercari is not logged in in the active Chrome window.")

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

    _wait_js("document.body.innerText.includes('Sports Trading Cards') ? 'category' : ''", timeout=25)
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
        _navigate("https://www.mercari.com/")
        _wait_js("document.body ? 'ready' : ''")
        account = _profile_name()
        if not account:
            raise RuntimeError("Mercari is not logged in in the active Chrome window.")
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
