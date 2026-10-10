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
_RETURN_TAB_INDEX: int | None = None


def _open_job_window(url: str) -> None:
    global _JOB_WINDOW_ID, _JOB_TAB_ID, _RETURN_TAB_INDEX
    source = (
        'tell application "Google Chrome"\n'
        '  activate\n'
        '  if (count of windows) = 0 then make new window\n'
        '  set w to front window\n'
        '  set returnIndex to active tab index of w\n'
        f'  set t to make new tab at end of tabs of w with properties {{URL:{json.dumps(url)}}}\n'
        '  set active tab index of w to (count of tabs of w)\n'
        '  return (id of w as text) & ":" & (id of t as text) & ":" & (returnIndex as text)\n'
        'end tell'
    )
    raw = _osascript(source)
    try:
        win, tab, return_index = raw.strip().split(":", 2)
        _JOB_WINDOW_ID = int(win)
        _JOB_TAB_ID = int(tab)
        _RETURN_TAB_INDEX = int(return_index)
    except (ValueError, AttributeError) as exc:
        raise RuntimeError(f"Mercari automation tab could not be created: {raw}") from exc


def _close_job_tab() -> None:
    global _JOB_WINDOW_ID, _JOB_TAB_ID, _RETURN_TAB_INDEX
    if _JOB_WINDOW_ID is None or _JOB_TAB_ID is None:
        return
    return_index = max(1, int(_RETURN_TAB_INDEX or 1))
    source = (
        'tell application "Google Chrome"\n'
        '  try\n'
        f'    set w to first window whose id is {_JOB_WINDOW_ID}\n'
        f'    set t to first tab of w whose id is {_JOB_TAB_ID}\n'
        '    close t\n'
        f'    if (count of tabs of w) >= {return_index} then set active tab index of w to {return_index}\n'
        '    set index of w to 1\n'
        '  end try\n'
        'end tell'
    )
    try:
        _osascript(source)
    except Exception as exc:
        print(f"MERCARI_CLEANUP_WARNING {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
    finally:
        _JOB_WINDOW_ID = None
        _JOB_TAB_ID = None
        _RETURN_TAB_INDEX = None


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
    last_error = ""
    while time.time() < deadline:
        try:
            last = _chrome_js(js)
            if last not in {"", "false", "0", "null", "undefined"}:
                return last
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"[:300]
        time.sleep(interval)
    detail = f" Last error: {last_error}" if last_error else ""
    raise RuntimeError(f"Mercari browser step timed out. Last state: {last or 'none'}.{detail}")


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
    explicit_sport = str(item.get("sport") or "").strip().lower()
    haystack = " ".join(
        str(item.get(key) or "")
        for key in ("sport", "league", "category", "title", "description")
    ).lower()

    def classify(source: str) -> str | None:
        if any(token in source for token in ("basketball", "wnba", "nba")):
            return "Basketball Trading Cards"
        if any(token in source for token in ("baseball", "mlb")):
            return "Baseball Trading Cards"
        if any(token in source for token in ("hockey", "nhl")):
            return "Hockey Trading Cards"
        if any(token in source for token in ("soccer", "mls", "fifa", "uefa", "association football", "football club")):
            return "Soccer Trading Cards"
        if any(token in source for token in ("football", "nfl")):
            return "Football Trading Cards"
        if any(token in source for token in ("wrestling", "wwe", "aew", "wwf")):
            return "Wrestling Trading Cards"
        if any(token in source for token in ("golf", "pga")):
            return "Golf Trading Cards"
        if any(token in source for token in ("tennis", "atp", "wta")):
            return "Tennis Trading Cards"
        if any(token in source for token in ("boxing", "ufc", "mma")):
            return "Boxing Trading Cards"
        return None

    return classify(explicit_sport) or classify(haystack) or "Other Sports Trading Cards"


def _select_category(item: dict) -> str:
    primary = _mercari_category(item)
    candidates = [primary]
    if primary != "Other Sports Trading Cards":
        candidates.append("Other Sports Trading Cards")

    opened = _chrome_js(
        "(()=>{const b=document.querySelector('[data-testid=SellCategoryFieldButton]');"
        "if(!b)return 'missing';b.click();return 'opened'})()"
    )
    if opened != "opened":
        raise RuntimeError("Mercari category control is unavailable.")
    _wait_js("document.querySelector('[data-testid=CategorySearchInput]') ? 'search' : ''", timeout=10)

    for category in candidates:
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
        try:
            _wait_js(
                f"(()=>{{const q={category_json};return Array.from(document.querySelectorAll('[data-testid=CategoryRow]')).some(x=>(x.innerText||'').includes(q))?'found':''}})()",
                timeout=6,
            )
        except RuntimeError:
            continue
        clicked = _chrome_js(
            f"(()=>{{const q={category_json};const rows=Array.from(document.querySelectorAll('[data-testid=CategoryRow]'));"
            "const exact=rows.find(x=>(x.innerText||'').trim().endsWith('> '+q));"
            "const b=exact||rows.find(x=>(x.innerText||'').includes(q));if(!b)return 'missing';b.click();return 'clicked'})()"
        )
        if clicked != "clicked":
            continue
        _wait_js(
            f"(()=>{{const t=document.querySelector('[data-testid=SellCategoryFieldButton]')?.innerText||'';return t.includes({category_json})?'selected':''}})()",
            timeout=10,
        )
        return category

    raise RuntimeError(f"Mercari category {primary} could not be selected, and the Other Sports fallback was unavailable.")



def _ensure_buyer_paid_shipping() -> dict:
    """Force buyer-paid shipping across Mercari's current and legacy payer controls."""
    state_js = r'''(()=>{
      const root=document.querySelector('#sellShippingPayerId');
      if(!root) return JSON.stringify({ok:false,reason:'shipping_payer_control_missing'});
      const input=root.querySelector('input');
      const checked=root.querySelector('input[type=radio]:checked');
      return JSON.stringify({
        ok:true,
        inputType:input?.type||'',
        inputValue:String(input?.value||''),
        checkedValue:String(checked?.value||''),
        rootText:String(root.innerText||'').replace(/\s+/g,' ').trim(),
      });
    })()'''

    def read_state() -> dict:
        raw = _chrome_js(state_js)
        try:
            return json.loads(raw or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError("Mercari shipping payer state could not be read.") from exc

    def buyer_paid(state: dict) -> bool:
        value = str(state.get("inputValue") or state.get("checkedValue") or "").strip().lower()
        text = str(state.get("rootText") or "").strip().lower()
        return (
            value == "no"
            or value.startswith("no ")
            or value in {"buyer", "buyer_paid", "buyer-pays", "buyer_pays"}
            or "buyer pays" in value
            or "buyer pays" in text
            or "buyer-paid" in text
        ) and "yes (recommended)" not in value

    state = read_state()
    if not state.get("ok"):
        raise RuntimeError("Mercari shipping payer control is unavailable; listing blocked before publish.")
    if buyer_paid(state):
        return state

    # Legacy radio implementation: No means buyer pays; Yes means seller-paid/free shipping.
    legacy = _chrome_js(
        "(()=>{const root=document.querySelector('#sellShippingPayerId');"
        "const radios=Array.from(root?.querySelectorAll('input[type=radio]')||[]);"
        "const target=radios.find(r=>String(r.value||'').trim().toLowerCase()==='no')||"
        "radios.find(r=>/buyer\\s*(pays|pay)/i.test((r.closest('label')?.innerText||r.getAttribute('aria-label')||'')));"
        "if(!target)return 'absent';if(!target.checked)target.click();return target.checked?'selected':'failed'})()"
    )
    if legacy == "selected":
        time.sleep(0.25)
        state = read_state()
        if buyer_paid(state):
            return state

    # Current Mercari UI (Sep 2026): readonly text selector shows "Yes (Recommended)".
    # Open the selector, choose the visible No option, then verify the control itself says No.
    opened = _chrome_js(
        "(()=>{const b=document.querySelector('div[data-testid=ShippingPayerOption]');"
        "if(!b)return 'missing';b.click();return 'opened'})()"
    )
    if opened != "opened":
        raise RuntimeError("Mercari free-shipping selector could not be opened; listing blocked before publish.")
    time.sleep(0.5)

    _wait_js("document.querySelector('[data-testid=FreeShippingNoButton]') ? 'ready' : ''", timeout=5)
    chosen = _chrome_js(
        "(()=>{const b=document.querySelector('[data-testid=FreeShippingNoButton]');"
        "if(!b)return 'no-option-missing';b.click();return 'clicked:No'})()"
    )
    if not chosen.startswith("clicked:"):
        raise RuntimeError(f"Mercari buyer-paid shipping option could not be selected ({chosen}); listing blocked before publish.")
    time.sleep(0.5)

    state = read_state()
    if not buyer_paid(state):
        raise RuntimeError(
            f"Mercari still shows seller-paid/free shipping after selecting No ({chosen}); listing blocked before publish. "
            + json.dumps(state, separators=(",", ":"))[:500]
        )
    return state


def _configure_shipping(price: float) -> str:
    service = "USPS First-Class Envelope" if price < 20 else "USPS Ground Advantage"
    # Force Mercari prepaid shipping; TCOS cards use a 3 oz package profile.
    selected = _chrome_js("(()=>{const r=document.querySelector('input[name=deliveryOptions][value=MERCARI]');if(!r)return 'missing';if(!r.checked)r.click();return r.checked?'selected':'failed'})()")
    if selected != "selected":
        raise RuntimeError("Mercari prepaid shipping could not be selected.")

    opened = _chrome_js("(()=>{const e=document.querySelector('[data-testid=SelectShipping]');if(!e)return 'missing';e.click();return 'opened'})()")
    if opened != "opened":
        raise RuntimeError("Mercari shipping-class control is unavailable.")
    _wait_js("document.querySelector('[data-testid=ItemWeightInPounds]') && document.querySelector('[data-testid=ItemWeightInOunces]') ? 'weight' : ''", timeout=10)

    weight_js = """(()=>{const set=(s,v)=>{const e=document.querySelector(s);if(!e)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true};return set('[data-testid=ItemWeightInPounds]','0')&&set('[data-testid=ItemWeightInOunces]','3')?'weighted':'missing'})()"""
    if _chrome_js(weight_js) != "weighted":
        raise RuntimeError("Mercari package weight could not be set to 3 oz.")

    next_result = _chrome_js("(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Next');if(!b||b.disabled)return 'blocked';b.click();return 'clicked'})()")
    if next_result != "clicked":
        raise RuntimeError("Mercari shipping weight could not advance to carrier selection.")

    service_json = json.dumps(service)
    _wait_js(
        f"(()=>{{const q={service_json};return document.querySelector(`[data-testid=AvailableShippingOption][data-display-name=\"${{q}}\"]`)?'found':''}})()",
        timeout=10,
    )
    choose_js = f"""(()=>{{const q={service_json};const card=Array.from(document.querySelectorAll('[data-testid=AvailableShippingOption]')).find(x=>x.getAttribute('data-display-name')===q);if(!card)return 'missing';const r=card.querySelector('input[type=radio]');if(!r)return 'missing-radio';r.click();return r.checked?'selected':'failed';}})()"""
    if _chrome_js(choose_js) != "selected":
        raise RuntimeError(f"Mercari shipping service {service} could not be selected.")

    save_result = _chrome_js("(()=>{const b=document.querySelector('[data-testid=SelectCarrierSaveButton]');if(!b||b.disabled)return 'blocked';b.click();return 'clicked'})()")
    if save_result != "clicked":
        raise RuntimeError("Mercari shipping service could not be saved.")
    _wait_js(f"(()=>{{const e=document.querySelector('[data-testid=SelectShipping]');return e&&String(e.value||'').includes({service_json})?'saved':''}})()", timeout=10)
    return service

def _mercari_description(value: object) -> str:
    return str(value or "").strip()[:1000] or "Exact card shown in photos."


def _fill_item(item: dict) -> tuple[str, str]:
    title = str(item.get("title") or "").strip()
    if len(title) > 80:
        raise RuntimeError("Mercari title exceeds the 80-character limit. Shorten the exact KINGMAKER title before publishing; TCOS will not rewrite it.")
    description = _mercari_description(item.get("description"))
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

    category = _select_category(item)
    _configure_shipping(price)
    _ensure_buyer_paid_shipping()
    _chrome_js("(()=>{const l=document.querySelector('[data-testid=ConditionLikeNew]');if(!l)throw new Error('Like new condition missing');l.click();return 'condition'})()")
    _wait_js("document.querySelector('input#2[name=sellCondition]')?.checked ? 'condition' : ''")

    # Smart Pricing is not rendered for every Mercari listing/price tier.
    # When present, force it OFF. When absent, continue: there is nothing to disable.
    smart_state = _chrome_js("(()=>{const b=document.querySelector('[data-testid=SmartPricingButton], [data-testid=SmartSellingButton]');if(!b)return 'absent';const pressed=b.getAttribute('aria-pressed');const text=(b.innerText||'').trim().toLowerCase();if(pressed==='true'||text==='on'){b.click();return 'clicked-off'}return 'off'})()")
    if smart_state == "clicked-off":
        # Mercari sometimes asks for a second confirmation before Smart Selling/Pricing is disabled.
        deadline = time.time() + 10
        while time.time() < deadline:
            _confirm_smart_selling_prompt()
            state = _chrome_js("(()=>{const b=document.querySelector('[data-testid=SmartPricingButton], [data-testid=SmartSellingButton]');if(!b)return 'off';const pressed=b.getAttribute('aria-pressed');const text=(b.innerText||'').trim().toLowerCase();return (pressed!=='true'&&text!=='on')?'off':'on'})()")
            if state == "off":
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Mercari Smart Selling/Pricing could not be turned off.")

    _ensure_buyer_paid_shipping()
    return account, category


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
    draft_url = _chrome_js(f"(()=>{{const title={title_json};const links=Array.from(document.querySelectorAll('a[href*=\\\"/sell/draft/\\\"]'));const exact=links.find(x=>(x.innerText||'').includes(title));return exact?.href||links[0]?.href||''}})()")
    if not draft_url:
        raise RuntimeError("Mercari saved the draft but TCOS could not resolve its draft URL.")
    match = re.search(r"/sell/draft/([^/]+)/", draft_url)
    return {"draftId": match.group(1) if match else None, "draftUrl": draft_url}


def _confirm_smart_selling_prompt() -> bool:
    result = _chrome_js(
        "(()=>{const dialogs=Array.from(document.querySelectorAll('[role=dialog], [data-testid*=Modal], [data-testid*=Dialog]'));"
        "const d=dialogs.find(x=>{const t=(x.innerText||'').toLowerCase();return t.includes('smart')&&(t.includes('selling')||t.includes('pricing'));});"
        "if(!d)return 'none';const dt=(d.innerText||'').toLowerCase();const buttons=Array.from(d.querySelectorAll('button'));"
        "const label=x=>(x.innerText||x.getAttribute('aria-label')||'').trim().toLowerCase();"
        "let b=buttons.find(x=>label(x).includes('turn off')||label(x).includes('disable'));"
        "if(!b&&(dt.includes('turn off')||dt.includes('disable')))b=buttons.find(x=>label(x)==='yes'||label(x).startsWith('yes,')||label(x)==='confirm');"
        "if(!b)return 'prompt-no-turn-off-button';b.click();return 'clicked';})()"
    )
    return result == "clicked"


def _force_exact_title(title: str) -> None:
    title_json = json.dumps(title)
    result = _chrome_js(
        f"(()=>{{const e=document.querySelector('[name=sellName]');if(!e)return 'missing';const v={title_json};"
        "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);"
        "e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));"
        "return e.value===v?'exact':'mismatch';})()"
    )
    if result != "exact":
        raise RuntimeError("Mercari exact title could not be preserved before publishing.")


def _publish_draft(draft_url: str, exact_title: str) -> str:
    _navigate(draft_url)
    _wait_js("((document.querySelector('[data-testid=ListButton]')||Array.from(document.querySelectorAll('button')).find(b=>(b.innerText||'').trim()==='List')) && document.querySelector('[name=sellName]')) ? 'ready' : ''", timeout=20)
    if _chrome_js("document.body.innerText.includes('requires an update') ? 'missing' : ''"):
        raise RuntimeError("Mercari draft is not ready to publish.")
    _ensure_buyer_paid_shipping()
    _force_exact_title(exact_title)

    deadline = time.time() + 40
    last_state = ""
    while time.time() < deadline:
        url = _chrome_js("location.href")
        match = re.search(r"/sell/confirmation/(m\d+)/", url)
        if match:
            return match.group(1)

        if _confirm_smart_selling_prompt():
            last_state = "smart-selling-confirmed-off"
            time.sleep(0.8)
            continue

        _force_exact_title(exact_title)
        last_state = _chrome_js(
            "(()=>{const b=document.querySelector('[data-testid=ListButton]')||Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='List');"
            "if(!b)return 'list-missing';if(b.disabled)return 'list-disabled';b.click();return 'list-clicked';})()"
        )
        if last_state == "list-clicked":
            # Give Mercari time to either navigate or show the Smart Selling confirmation.
            settle_deadline = time.time() + 6
            while time.time() < settle_deadline:
                url = _chrome_js("location.href")
                match = re.search(r"/sell/confirmation/(m\d+)/", url)
                if match:
                    return match.group(1)
                if _confirm_smart_selling_prompt():
                    last_state = "smart-selling-confirmed-off-after-list"
                    time.sleep(1.0)
                    break
                time.sleep(0.4)
            continue
        time.sleep(0.5)

    body = _chrome_js("document.body.innerText.slice(0,3000)")
    raise RuntimeError(f"Mercari did not complete the final List step. Last state: {last_state}. Page: {body[:500]}")


def _verify_existing_item(item: dict) -> dict:
    item_id = str(item.get("itemId") or "").strip()
    if not re.fullmatch(r"m\d+", item_id):
        raise RuntimeError("Mercari verification requires an exact item ID.")
    item_url = str(item.get("itemUrl") or "").strip() or f"https://www.mercari.com/us/item/{item_id}/"
    expected_title = str(item.get("title") or "").strip()
    _open_job_window(item_url)
    try:
        _wait_js("document.body && document.body.innerText.length>100 ? 'ready' : ''", timeout=20)
        final_url = _chrome_js("location.href")
        body = _chrome_js("document.body.innerText.slice(0,10000)")
        edit_href = _chrome_js("(()=>{const n=Array.from(document.querySelectorAll('a,button')).find(x=>(x.innerText||'').trim()==='Edit item');return n?.closest('a')?.href||n?.href||''})()")
        lower = body.lower()
        sold = any(token in lower for token in ("this item has been sold", "sold out", "\nsold\n"))
        inactive = any(token in lower for token in ("no longer available", "listing is inactive", "reactivate"))
        active = (
            not sold
            and not inactive
            and item_id.lower() in final_url.lower()
            and (
                "deactivate" in lower
                or "promote" in lower
                or "buy now" in lower
                or "make offer" in lower
                or "add to cart" in lower
            )
        )
        status = "sold" if sold else "inactive" if inactive else "active" if active else "unknown"
        return {
            "status": status,
            "itemId": item_id,
            "itemUrl": final_url,
            "editHref": edit_href or None,
            "titlePresent": (not expected_title) or expected_title.lower() in lower,
            "markers": {
                "deactivate": "deactivate" in lower,
                "reactivate": "reactivate" in lower,
                "sold": sold,
                "buyNow": "buy now" in lower,
                "makeOffer": "make offer" in lower,
            },
            "pageText": body[:2000],
        }
    finally:
        _close_job_tab()


def _deactivate_existing_item(item: dict) -> dict:
    item_id = str(item.get("itemId") or "").strip()
    if not re.fullmatch(r"m\d+", item_id):
        raise RuntimeError("Mercari deactivation requires an exact item ID.")
    edit_url = f"https://www.mercari.com/sell/edit/{item_id}/"
    _open_job_window(edit_url)
    try:
        _wait_js("document.body && document.body.innerText.includes('Deactivate') ? 'ready' : ''", timeout=20)
        current_url = _chrome_js("location.href")
        if item_id.lower() not in current_url.lower():
            raise RuntimeError("Mercari edit page does not match the requested item ID.")
        edit_title = _chrome_js("document.querySelector('[name=sellName]')?.value||''")
        clicked = _chrome_js(
            "(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Deactivate');"
            "if(!b)return 'missing';if(b.disabled)return 'disabled';b.click();return 'clicked'})()"
        )
        if clicked != "clicked":
            raise RuntimeError(f"Mercari Deactivate control could not be used ({clicked}).")
        time.sleep(0.75)
        confirmed = _chrome_js(
            "(()=>{const d=document.querySelector('[role=dialog]');if(!d)return 'none';"
            "const b=Array.from(d.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='Deactivate');"
            "if(!b)return 'dialog-no-deactivate';b.click();return 'confirmed'})()"
        )
        if confirmed == "confirmed":
            time.sleep(0.75)
        state = _wait_js(
            "(()=>{const labels=Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').trim());"
            "if(labels.includes('Reactivate')||labels.includes('Activate'))return 'inactive';"
            "if(labels.includes('Deactivate'))return '';"
            "return location.href.includes('/us/item/')?'item-page':''})()",
            timeout=15,
        )
        if state == "item-page":
            _navigate(f"https://www.mercari.com/sell/edit/{item_id}/")
            _wait_js("document.body && document.body.innerText.length>100 ? 'ready' : ''", timeout=15)
            labels_raw = _chrome_js("JSON.stringify(Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').trim()).filter(Boolean))")
            labels = json.loads(labels_raw or "[]")
            if "Reactivate" not in labels and "Activate" not in labels:
                raise RuntimeError("Mercari did not prove the listing inactive after deactivation.")
        else:
            labels_raw = _chrome_js("JSON.stringify(Array.from(document.querySelectorAll('button')).map(x=>(x.innerText||'').trim()).filter(Boolean))")
            labels = json.loads(labels_raw or "[]")
        return {
            "status": "inactive",
            "itemId": item_id,
            "itemUrl": f"https://www.mercari.com/us/item/{item_id}/",
            "editTitle": edit_title or None,
            "confirmationState": confirmed,
            "controls": labels,
        }
    finally:
        _close_job_tab()


def main() -> None:
    payload = json.load(sys.stdin)
    mode = str(payload.get("mode") or "status").strip().lower()
    if mode == "status":
        _open_job_window("https://www.mercari.com/mypage/")
        _wait_js("(()=>{const u=location.href.toLowerCase();const b=document.body?.innerText||'';return (u.includes('/login')||u.includes('/signup')||b.includes('My profile'))?'session-ready':''})()", timeout=25)
        account = _profile_name()
        if not account:
            raise RuntimeError("Mercari is not logged in in the dedicated Chrome automation tab.")
        _close_job_tab()
        print(json.dumps({"ok": True, "mode": mode, "connected": True, "account": account}))
        return
    if mode == "verify":
        item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
        result = _verify_existing_item(item)
        print(json.dumps({"ok": True, "mode": mode, **result}))
        return
    if mode == "deactivate":
        if str(payload.get("confirmation") or "").strip() != "DEACTIVATE_LIVE":
            raise RuntimeError("Explicit DEACTIVATE_LIVE confirmation is required for Mercari deactivation.")
        item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
        current = _verify_existing_item(item)
        if current.get("status") in {"inactive", "sold"}:
            print(json.dumps({"ok": True, "mode": mode, "alreadyContained": True, **current}))
            return
        if current.get("status") != "active":
            raise RuntimeError(f"Mercari listing is not proven active ({current.get('status')}).")
        result = _deactivate_existing_item(item)
        print(json.dumps({"ok": True, "mode": mode, **result}))
        return
    if mode not in {"draft", "publish"}:
        raise RuntimeError("Unsupported Mercari bridge mode.")

    item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
    title = str(item.get("title") or "").strip()
    if len(title) > 80:
        raise RuntimeError("Mercari title exceeds the 80-character limit. Shorten the exact KINGMAKER title before publishing; TCOS will not rewrite it.")
    account, category = _fill_item(item)
    draft = _save_ready_draft(title)
    if mode == "draft":
        _close_job_tab()
        print(json.dumps({"ok": True, "mode": mode, "account": account, "category": category, "status": "ready_to_list", **draft}))
        return

    item_id = _publish_draft(str(draft["draftUrl"]), title)
    _close_job_tab()
    print(json.dumps({
        "ok": True,
        "mode": mode,
        "account": account,
        "category": category,
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
