import json
import sqlite3
import tempfile
from pathlib import Path
import pytest
from app.kingmaker_accounting import KingmakerAccounting

def make_ledger(root: Path):
    scan_db=root/'scans.sqlite3'; accounting_db=root/'accounting.sqlite3'
    with sqlite3.connect(scan_db) as db:
        db.execute('CREATE TABLE scans (scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT, front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT, checklist_json TEXT)')
        checklist=json.dumps({"outcome":"exact_match","identity_id":"registry-card-1","identity":{"player":"Test Player","year":"2025","brand":"Test Brand","set_name":"Test Set","card_number":"1","parallel":"Red","serial_run":10,"autograph":False,"memorabilia":False},"source_receipts":["registry_fingerprint:test"]})
        db.execute('INSERT INTO scans VALUES (?,?,?,?,?,?,?,?)',('scan-1','card-1','2026-09-18T00:00:00Z','front','back','pair','trusted_memory_match',checklist))
    ledger=KingmakerAccounting(accounting_db,scan_db); ledger.initialize()
    ident={'player':'Test Player','year':'2025','brand':'Test Brand','setName':'Test Set','cardNumber':'1','parallel':'Red','serialNumber':'1/10','isAuto':False,'isRelic':False}
    ledger.record_acquisition_item({'purchase_id':'P1','source_key':'ebay:P1','source':'eBay','purchased_at':'2026-09-18','title':'Test','card_uuid':'card-1','registry_identity_id':'registry-card-1','identity_status':'source_exact','allocated_cost':10,'identity':ident})
    match=ledger.match_or_reserve_purchase(ident,'card-1','inv-1','scan-1')
    return ledger, int(match['match']['acquisitionItemId'])

def test_receive_is_idempotent_and_cannot_flip_to_link_existing():
    with tempfile.TemporaryDirectory() as td:
        ledger,aid=make_ledger(Path(td))
        first=ledger.receive_into_inventory('card-1','inv-1',aid,'scan-1','resale')
        second=ledger.receive_into_inventory('card-1','inv-1',aid,'scan-1','resale')
        assert second['receivedAt']==first['receivedAt']
        with pytest.raises(ValueError, match='already received|cannot be relinked'):
            ledger.link_purchase_to_existing_inventory('card-1','inv-1',aid,'scan-1','resale')
        with pytest.raises(ValueError, match='use inventory disposition'):
            ledger.receive_into_inventory('card-1','inv-1',aid,'scan-1','investment_stash')

def test_auto_received_scan_cannot_flip_to_link_existing():
    with tempfile.TemporaryDirectory() as td:
        ledger,aid=make_ledger(Path(td))
        with pytest.raises(ValueError, match='already received|cannot be relinked'):
            ledger.link_purchase_to_existing_inventory('card-1','inv-1',aid,'scan-1','resale')
        with pytest.raises(ValueError, match='use inventory disposition'):
            ledger.receive_into_inventory('card-1','inv-1',aid,'scan-1','investment_stash')

def test_disposition_controls_listing_readiness_after_finalization():
    with tempfile.TemporaryDirectory() as td:
        ledger,aid=make_ledger(Path(td))
        ledger.receive_into_inventory('card-1','inv-1',aid,'scan-1','resale')
        assert ledger.listing_readiness(['inv-1'])['ready'] is True
        ledger.set_inventory_disposition('inv-1','investment_stash')
        blocked=ledger.listing_readiness(['inv-1'])
        assert blocked['ready'] is False
        assert blocked['blocked'][0]['reason']=='investment_stash_not_for_sale'
        ledger.set_inventory_disposition('inv-1','resale')
        assert ledger.listing_readiness(['inv-1'])['ready'] is True

def test_wrong_card_scan_cannot_reserve_purchase():
    with tempfile.TemporaryDirectory() as td:
        root=Path(td); scan_db=root/'scans.sqlite3'; accounting_db=root/'accounting.sqlite3'
        with sqlite3.connect(scan_db) as db:
            db.execute('CREATE TABLE scans (scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT, front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT, checklist_json TEXT)')
            checklist=json.dumps({"outcome":"exact_match","identity_id":"registry-other","identity":{"player":"Test Player","card_number":"1"},"source_receipts":["registry_fingerprint:test"]})
            db.execute('INSERT INTO scans VALUES (?,?,?,?,?,?,?,?)',('scan-wrong','other-card','2026-09-18T00:00:00Z','f','b','pair','trusted_memory_match',checklist))
        ledger=KingmakerAccounting(accounting_db,scan_db); ledger.initialize()
        ident={'player':'Test Player','year':'2025','brand':'Test Brand','setName':'Test Set','cardNumber':'1','parallel':'Red','serialNumber':'1/10','isAuto':False,'isRelic':False}
        ledger.record_acquisition_item({'purchase_id':'P1','source_key':'ebay:P1','source':'eBay','purchased_at':'2026-09-18','title':'Test','card_uuid':'card-1','registry_identity_id':'registry-card-1','identity_status':'source_exact','allocated_cost':10,'identity':ident})
        result=ledger.match_or_reserve_purchase(ident,'card-1','inv-1','scan-wrong')
        assert result['status']=='scan_required'
        assert 'different card UUID' in result['reason']

def test_same_image_cannot_satisfy_front_back_scan_requirement():
    with tempfile.TemporaryDirectory() as td:
        root=Path(td); scan_db=root/'scans.sqlite3'; accounting_db=root/'accounting.sqlite3'
        with sqlite3.connect(scan_db) as db:
            db.execute('CREATE TABLE scans (scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT, front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT, checklist_json TEXT)')
            checklist=json.dumps({"outcome":"exact_match","identity_id":"registry-card-1","identity":{"player":"Test Player","card_number":"1"},"source_receipts":["registry_fingerprint:test"]})
            db.execute('INSERT INTO scans VALUES (?,?,?,?,?,?,?,?)',('scan-bad','card-1','2026-09-18T00:00:00Z','same','same','pair','trusted_memory_match',checklist))
        ledger=KingmakerAccounting(accounting_db,scan_db); ledger.initialize()
        ident={'player':'Test Player','year':'2025','setName':'Test Set','cardNumber':'1'}
        result=ledger.match_or_reserve_purchase(ident,'card-1','inv-1','scan-bad')
        assert result['status']=='scan_required'
        assert 'distinct card images' in result['reason']
