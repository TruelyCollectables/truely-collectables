#!/usr/bin/env python3
from __future__ import annotations

import argparse, hashlib, json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1]
if str(SERVICE) not in sys.path:
    sys.path.insert(0, str(SERVICE))

from app.config import Settings
from app.storage import MemoryStore
from app.training import latest_training_examples
from app.teacher_student import curriculum_readiness, load_frozen_ids
from app.teacher_vision_training import prepare_learning_images, _dataset_row

STATUS_SCHEMA = "tcos.instacomp-ai.teacher-student-employee.v1"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(path)


def build_exposure_index(settings: Settings, examples_by_id: dict) -> dict:
    used_ids, used_pairs = set(), set()
    for root in (Path('/Volumes/InstaCompAI/training/exports'), Path('/Volumes/InstaCompAI/training/teacher-student')):
        if not root.exists():
            continue
        for path in root.rglob('*.jsonl'):
            if 'benchmarks' in path.parts or 'graduation-frozen-v1' in path.parts:
                continue
            try:
                handle = path.open('r', encoding='utf-8', errors='ignore')
            except OSError:
                continue
            with handle:
                for raw in handle:
                    if not raw.strip():
                        continue
                    try:
                        row = json.loads(raw)
                    except Exception:
                        continue
                    for value in (row.get('id'), (row.get('metadata') or {}).get('training_example_id')):
                        if value:
                            used_ids.add(str(value).split(':hard:', 1)[0])
    for item_id in used_ids:
        example = examples_by_id.get(item_id)
        if example:
            used_pairs.add(example.image_pair_sha256)
    return {'ids': sorted(used_ids), 'pairs': sorted(used_pairs), 'built_at': now()}


def grow_graduation(settings: Settings, examples: list, exposure: dict) -> dict:
    ids_path = settings.resolve_local_path(settings.teacher_student_graduation_ids_path)
    frozen_ids = load_frozen_ids(ids_path)
    target = settings.teacher_student_graduation_target
    root = Path('/Volumes/InstaCompAI/training/teacher-student/graduation-frozen-v1')
    validation = root / 'validation.jsonl'
    existing_rows = []
    if validation.is_file():
        raw_rows = [json.loads(x) for x in validation.read_text('utf-8').splitlines() if x.strip()]
        seen_existing: set[str] = set()
        for row in raw_rows:
            row_id = str(row.get('id') or (row.get('metadata') or {}).get('training_example_id') or '').strip()
            if not row_id or row_id in seen_existing:
                continue
            seen_existing.add(row_id)
            existing_rows.append(row)
        # The shared validation set is itself durable evidence of which examples
        # are frozen. Never duplicate rows merely because an ID receipt was stale
        # or a different checkout started the employee.
        frozen_ids.update(seen_existing)
    used_pairs = set(exposure.get('pairs') or [])
    frozen_pairs = {e.image_pair_sha256 for e in examples if e.training_example_id in frozen_ids}
    candidates = [
        e for e in examples
        if e.training_example_id not in set(exposure.get('ids') or [])
        and e.training_example_id not in frozen_ids
        and e.image_pair_sha256 not in used_pairs
        and e.image_pair_sha256 not in frozen_pairs
    ]
    candidates.sort(key=lambda e: hashlib.sha256((e.training_example_id + 'graduation-v1').encode()).hexdigest())
    added = []
    for example in candidates[:max(0, target - len(frozen_ids))]:
        images = prepare_learning_images(
            example,
            image_store_path=settings.resolve_local_path(settings.training_image_store_path),
            destination_root=root / 'learning-images',
            max_edge=512,
        )
        existing_rows.append(_dataset_row(example, images=images, teacher_lesson=None, row_id=example.training_example_id))
        frozen_ids.add(example.training_example_id)
        frozen_pairs.add(example.image_pair_sha256)
        added.append(example.training_example_id)
    root.mkdir(parents=True, exist_ok=True)
    validation.write_text('\n'.join(json.dumps(row, ensure_ascii=False) for row in existing_rows) + ('\n' if existing_rows else ''), 'utf-8')
    write_json(root / 'manifest.json', {
        'schema_version': 'tcos.instacomp-ai.graduation-holdout.v1',
        'validation_examples': len(frozen_ids), 'target_examples': target,
        'needs_more_examples': max(0, target - len(frozen_ids)), 'frozen': True,
        'training_use_prohibited': True, 'updated_at': now(),
    })
    write_json(ids_path, {
        'schema_version': 'tcos.instacomp-ai.graduation-frozen-ids.v1',
        'ids': sorted(frozen_ids), 'target_examples': target,
        'training_use_prohibited': True, 'holdout_path': str(root), 'updated_at': now(),
    })
    return {'count': len(frozen_ids), 'target': target, 'added': added, 'ready': len(frozen_ids) >= target}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch-if-ready', action='store_true')
    args = parser.parse_args()
    settings = Settings()
    status_path = SERVICE / 'data/training/teacher-student/employee-status.json'
    exposure_path = SERVICE / 'data/training/teacher-student/exposure-index.json'
    store = MemoryStore(settings.resolve_local_path(settings.training_database_path)); store.initialize()
    examples = [e for e in latest_training_examples(store.list_training_examples(trusted_only=True, limit=100000)) if e.trusted]
    by_id = {e.training_example_id: e for e in examples}
    if exposure_path.is_file():
        exposure = json.loads(exposure_path.read_text('utf-8'))
    else:
        exposure = build_exposure_index(settings, by_id)
        write_json(exposure_path, exposure)
    graduation = grow_graduation(settings, examples, exposure)
    frozen = load_frozen_ids(settings.resolve_local_path(settings.teacher_student_graduation_ids_path))
    train_examples = [e for e in examples if e.training_example_id not in frozen]
    readiness = curriculum_readiness(
        train_examples=len(train_examples),
        hard_examples=sum(bool(e.correction_fields) for e in train_examples),
        min_train=settings.teacher_student_min_train_examples,
        min_hard=settings.teacher_student_min_hard_examples,
    )
    ready = readiness['ready'] and graduation['ready']
    status = {
        'schema_version': STATUS_SCHEMA, 'checked_at': now(), 'trusted_examples': len(examples),
        'training_database': str(settings.resolve_local_path(settings.training_database_path)),
        'graduation': graduation, 'curriculum': readiness, 'ready_to_launch_candidate': ready,
        'automatic_promotion': False, 'teacher_visual_lesson_in_student_target': False,
    }
    if not ready or not args.launch_if_ready:
        status['action'] = 'blocked_waiting_for_readiness' if not ready else 'ready_not_launched'
        write_json(status_path, status); print(json.dumps(status, indent=2)); return 0
    digest = hashlib.sha256('\n'.join(sorted(e.training_example_id for e in train_examples)).encode()).hexdigest()
    receipt = SERVICE / 'data/training/teacher-student/last-launched.json'
    if receipt.is_file() and json.loads(receipt.read_text('utf-8')).get('corpus_digest') == digest:
        status['action'] = 'already_launched_for_corpus_digest'; status['corpus_digest'] = digest
        write_json(status_path, status); print(json.dumps(status, indent=2)); return 0
    command = [
        str(SERVICE / '.venv/bin/python'), str(SERVICE / 'scripts/run_teacher_vision_lora_training.py'),
        '--resume-adapter', str(settings.resolve_local_path(settings.teacher_student_incumbent_adapter_path)),
        '--epochs', '1', '--learning-rate', '5e-6', '--lora-rank', '16', '--lora-alpha', '32',
    ]
    status['action'] = 'launching_candidate_training'; status['corpus_digest'] = digest; status['command'] = command
    write_json(status_path, status)
    completed = subprocess.run(command, cwd=SERVICE, check=False)
    status['training_returncode'] = completed.returncode
    status['action'] = 'candidate_trained_pending_graduation_benchmark' if completed.returncode == 0 else 'candidate_training_failed'
    write_json(status_path, status)
    if completed.returncode == 0:
        write_json(receipt, {'corpus_digest': digest, 'launched_at': now(), 'automatic_promotion': False})
    print(json.dumps(status, indent=2)); return completed.returncode

if __name__ == '__main__':
    raise SystemExit(main())
