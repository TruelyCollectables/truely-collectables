# InstaComp universal inscription listing contract

Confirmed handwritten inscription evidence is independent from product-specific rules.

- Any card may be classified as inscribed when AI, OCR, or a manual seller review supplies inscription evidence.
- The exact inscription text is stored separately from the player/subject identity.
- Confirmed inscription text adds `Inscribed` to listing identity and adds `Hand inscription: <text>` to seller description facts.
- Suspected or low-confidence inscription text blocks automatic publication and never advertises `Inscribed`.
- A non-inscribed copy of the same card remains a separate, valid listing identity.
- Product overlays such as the SP Authentic Future Watch first-50 `/999` rule remain additive and fail closed.

The shared output builder is `src/lib/instacomp-listing-output.ts`.
