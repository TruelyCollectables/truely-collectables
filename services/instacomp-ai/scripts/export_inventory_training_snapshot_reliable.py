#!/usr/bin/env python3
from __future__ import annotations

import export_inventory_training_snapshot as target

# Supabase Management database/query can return 544 when its database connection
# times out before SQL execution. That is transient and must reconnect/retry just
# like the already-covered 52x origin/transport failures.
target.TRANSIENT_HTTP.add(544)


if __name__ == "__main__":
    raise SystemExit(target.main())
