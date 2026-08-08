from pathlib import Path

source = Path('services/instacomp-ai/app/deal_hunter.py')
tests = Path('services/instacomp-ai/tests/test_deal_hunter_scheduler.py')

text = source.read_text(encoding='utf-8')
old = '''                self.store.mark_scheduler_finished(\n                    status=status,\n                    next_run_at=self.next_run(),\n                    error_message=error_message,\n                )\n'''
new = '''                # Preserve the cadence calculated when this run started. If a\n                # slow batch overruns that timestamp, the scheduler loop will see\n                # it as due and immediately start the next non-overlapping batch\n                # instead of idling for another full interval.\n                self.store.mark_scheduler_finished(\n                    status=status,\n                    next_run_at=next_run_at,\n                    error_message=error_message,\n                )\n'''
if old not in text:
    raise SystemExit('Expected scheduler finish block not found; refusing fuzzy patch.')
source.write_text(text.replace(old, new, 1), encoding='utf-8')

test_text = tests.read_text(encoding='utf-8')
addition = r'''

@pytest.mark.asyncio
async def test_run_preserves_start_based_next_run_for_overdue_catchup(tmp_path: Path):
    settings = SimpleNamespace(
        deal_hunter_enabled=True,
        deal_hunter_interval_minutes=60,
        deal_hunter_candidate_cooldown_hours=6,
        deal_hunter_max_candidates_per_run=20,
    )
    store = DealHunterStore(tmp_path / "instacomp.sqlite3")
    scheduler = DealHunterScheduler(settings, store)
    scheduled_next = utc_now() + timedelta(minutes=60)
    next_run_calls = 0

    def fixed_next_run(_from_time=None):
        nonlocal next_run_calls
        next_run_calls += 1
        return scheduled_next

    async def no_candidates():
        return [], []

    async def no_publish(_run_id, _status, _counts, _summary):
        return None

    scheduler.next_run = fixed_next_run  # type: ignore[method-assign]
    scheduler._discover = no_candidates  # type: ignore[method-assign]
    scheduler._publish_run_summary = no_publish  # type: ignore[method-assign]

    result = await scheduler.run_now(trigger="manual")
    state = store.scheduler_state()

    assert result["status"] == "completed"
    assert next_run_calls == 1
    assert state["next_run_at"] == scheduled_next.isoformat()
'''
if 'test_run_preserves_start_based_next_run_for_overdue_catchup' in test_text:
    raise SystemExit('Catch-up test already present; refusing duplicate patch.')
tests.write_text(test_text.rstrip() + addition + '\n', encoding='utf-8')

print('Deal Hunter overdue catch-up patch applied.')
