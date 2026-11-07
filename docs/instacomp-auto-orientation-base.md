# InstaComp automatic orientation and WNBA Base repair

This repair closes three linked failures in the listing intake and KINGMAKER correction flow.

1. Front and back orientation is detected before the Mac identity scan, the corrected bytes are used for the scan, and those exact normalized files are permanently stored in `inventory_images`.
2. The back-side orientation referee also returns a narrow designation receipt. Product/legal text such as `Panini - WNBA Prizm Basketball` does not count as a standalone PRIZM parallel mark. A WNBA card claiming a colored/foil Prizm parallel is forced to Base only when the back-side receipt confidently says the separate designation is absent.
3. Rotating or swapping an existing draft is allowed even when its old identity is locked. The image edit automatically clears the lock and trusted flags and requires a fresh front/back Registry scan.

The patch does not publish cards, price unresolved cards, or treat the orientation referee as an identity provider.
