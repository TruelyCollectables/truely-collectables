# Player name v7 production rollout

Triggered: 2026-07-31 America/Denver

This merge intentionally triggers the production deployment and full-catalog Player / Subject repair already committed to `main`.

Production requirements:

- Deploy `player-name-v7`.
- Resolve card/set values such as `Panini WNBA`, `Artifacts Hockey`, `Upper Deck`, `Reigning Nights`, `Blue Ref`, and `Platinum Prospects` to actual player names.
- Scan every product twice.
- Require the steady-state pass to report zero player updates, zero cleared players, zero invalid player values, and no unresolved named products.
- Preserve every athlete on dual-subject cards.
