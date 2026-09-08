from pathlib import Path

SERVICE = Path(__file__).resolve().parents[1]

ACTIVE_LEARNING = [
    SERVICE / "app" / "sentinel.py",
    SERVICE / "app" / "sentinel_store.py",
]

LEGACY_SUPABASE_TRAINING = [
    "sync_all_inventory_training_truth.py",
    "sync_all_inventory_training_truth_v2.py",
    "sync_all_inventory_training_truth_v3.py",
    "sync_all_inventory_training_truth_snapshot_only.py",
    "sync_all_inventory_training_truth_guarded.py",
    "sync_all_inventory_training_truth_resilient.py",
    "import_inventory_training_truth.py",
    "export_inventory_training_snapshot.py",
    "export_inventory_training_snapshot_reliable.py",
    "train_lora_all_inventory.py",
    "train_lora_full_inventory.py",
]


def test_active_learning_chain_has_no_supabase_dependency():
    for path in ACTIVE_LEARNING:
        source = path.read_text(encoding="utf-8").lower()
        assert "supabase" not in source, f"Supabase leaked into active learning path: {path}"


def test_legacy_supabase_training_entrypoints_are_retired():
    scripts = SERVICE / "scripts"
    retirement = "RETIRED: Supabase-backed inventory training is disabled. InstaComp learning authority is Mac-local."
    for name in LEGACY_SUPABASE_TRAINING:
        source = (scripts / name).read_text(encoding="utf-8")
        assert retirement in source, f"Legacy Supabase training entrypoint is not retired: {name}"
        tail = source[source.rfind('if __name__ == "__main__":'):]
        assert retirement in tail, f"Direct execution guard missing from {name}"
