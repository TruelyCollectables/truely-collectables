#!/usr/bin/env python3
"""Recurring price-only jobs for immutable Kingmaker CSV card drafts."""
import argparse, fcntl, json, sqlite3, sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.config import settings
DATA=settings.resolve_local_path(settings.data_database_path)
DB=DATA/'kingmaker_commercial_inventory.sqlite3'
URL='https://truelycollectables.com/api/account/seller/inventory/instacomp-fast-market'

def queue():
    with sqlite3.connect(DB,timeout=10) as c:
        return [x[0] for x in c.execute("SELECT inventory_item_id FROM commercial_inventory WHERE json_extract(raw_json,'$.verifiedCsv.authority')='seller_verified_csv_v1' AND json_extract(raw_json,'$.instacomp.pricingStatus')='identity_complete_pricing_pending' AND status='draft' AND price=0 ORDER BY created_at")]

def write(state):
    target=DATA/'verified_csv_pricing_worker_status.json'
    temp=target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(state,sort_keys=True,indent=2))
    temp.replace(target)

def execute(limit):
    if not settings.api_key: raise RuntimeError('Missing configured internal API key')
    DATA.mkdir(parents=True,exist_ok=True)
    with (DATA/'verified_csv_pricing_worker.lock').open('a+') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print('Other pricing worker already running');return
        rows=queue()
        state={'startedAt':datetime.now(timezone.utc).isoformat(),'finishedAt':None,'queued':len(rows),'completed':0,'priced':0,'sellerPriceRequired':0,'errors':[],'pending':len(rows),'mode':'pricing_only_no_publication'}
        write(state)
        for item in rows[:limit]:
            req=Request(URL,data=json.dumps({'inventoryItemId':item}).encode(),headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'curl/8.7.1','X-Kingmaker-Verified-Pricing-Key':settings.api_key},method='POST')
            try:
                with urlopen(req,timeout=100) as response:payload=json.load(response)
                if payload.get('success') is not True:raise ValueError(str(payload.get('error') or 'Pricing rejected')[:200])
                status=payload.get('pricingStatus')
                if status not in {'suggested_from_reliable_sold_comps','seller_price_required'}:raise ValueError('Unexpected pricing status')
                state['completed']+=1
                state['priced' if status=='suggested_from_reliable_sold_comps' else 'sellerPriceRequired']+=1
            except (HTTPError,URLError,ValueError,TimeoutError,OSError) as exc:
                status=f'HTTP {exc.code}' if isinstance(exc,HTTPError) else (type(exc).__name__+': '+str(exc)[:130])
                state['errors'].append({'item':item,'reason':status})
                if isinstance(exc,HTTPError) and exc.code in (401,403,502,503):
                    state['haltedForServiceError']=status;break
            finally:state['pending']=len(queue());write(state)
        state['finishedAt']=datetime.now(timezone.utc).isoformat();write(state)
        print(json.dumps({k:state[k] for k in ('queued','completed','priced','sellerPriceRequired','pending')}))

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--limit',type=int,default=12)
    execute(max(1,min(ap.parse_args().limit,100)))
