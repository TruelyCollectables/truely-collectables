import asyncio,json
from datetime import datetime,timezone,timedelta
from unittest.mock import patch
from app import research_sources as s

def test_archive_rejects_wrong_variant_aggregate_and_duplicates(tmp_path):
    today=datetime.now(timezone.utc)
    date=(today-timedelta(days=2)).strftime("%b %d, %Y")
    row={"title":"Exact raw card","url":"https://www.ebay.com/itm/123456789012","price":"$12.00\nFixed price","shipping":"$0.00\n100% Free shipping","lastSold":date,"totalSold":"1","match_label":"EXACT_CANDIDATE_VALIDATED_TITLE","source_page_url":"https://www.ebay.com/sh/research?tabName=SOLD"}
    raw={"id":"a","status":"EXACT_SALE_FOUND","price_changes":False,"read_at":today.isoformat(),"exact":[row,row,{**row,"url":"https://www.ebay.com/itm/123456789013","totalSold":"2"},{**row,"url":"https://www.ebay.com/itm/123456789014","title":"Wrong variant"},{**row,"url":"https://www.ebay.com/itm/123456789015","shipping":""},{**row,"url":"https://www.ebay.com/itm/123456789016","source_page_url":"https://www.ebay.com/sh/research?tabName=ACTIVE"}]}
    f=tmp_path/"audit.jsonl";f.write_text(json.dumps(raw)+"\n")
    rows,cov=s.archive_sales({"ids":["a"],"identity":{}},30,lambda t,i:(t=="Exact raw card",[]),f)
    assert len(rows)==1 and rows[0]["item_price"]==12 and rows[0]["source"]=="seller_hub_archive"
    assert cov["status"]=="archived_history"

def test_no_unlicensed_requests():
    with patch.dict("os.environ",{"THECARDAPI_KEY":"test","THECARDAPI_COMMERCIAL_LICENSE":"0"}):
        rows,cov=asyncio.run(s.licensed_sales({},30,lambda t,i:(True,[])))
        assert rows==[] and cov["status"]=="not_configured"
def test_licensed_adapter_drops_unknown_offer_and_shipping():
    today=datetime.now(timezone.utc).date().isoformat()
    row={"platform":"eBay","currency":"USD","price_confirmed":True,"listing_url":"https://www.ebay.com/itm/123456789012","title":"Exact raw card","listing_type":"best_offer","price":12,"shipping_price":2,"sale_date":today}
    class Reply:
        status_code=200
        def json(self):return {"data":[row,{**row,"price_confirmed":False},{**row,"shipping_price":None},{**row,"currency":"CAD"},{**row,"title":"Wrong variant"}],"meta":{},"pagination":{}}
    class Client:
        def __init__(self,**kw):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,*args,**kwargs):return Reply()
    with patch.dict("os.environ",{"THECARDAPI_KEY":"test","THECARDAPI_COMMERCIAL_LICENSE":"1"}),patch.object(s.httpx,"AsyncClient",Client):
        rows,cov=asyncio.run(s.licensed_sales({},30,lambda t,i:(t=="Exact raw card",[])))
        assert len(rows)==1 and rows[0]["source"]=="thecardapi" and rows[0]["item_price"]==12 and cov["status"]=="live"
