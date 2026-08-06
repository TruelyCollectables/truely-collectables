# KINGMAKER / InstaComp Forensic Audit — 2026-08-06

## Scope

This audit traced the workflow in both directions:

1. Browser page load and account-session refresh.
2. KINGMAKER draft and image retrieval.
3. Front/back assignment.
4. Printed-text orientation.
5. Permanent normalized-image storage.
6. Primary identity scan.
7. Live checklist candidate retrieval.
8. Checklist-constrained visual parallel selection.
9. Manual correction and identity locking.
10. Reusable InstaComp learning promotion.
11. Build and deployment gates.

## Confirmed failures

### 1. Recursive browser mutation loop

The prior page injected a `MutationObserver` that rewrote the same paragraph it observed. The rewrite generated another mutation and could repeat indefinitely, preventing the page from becoming usable.

**Repair:** the observer and its nested layout were deleted. The actual React page now contains the automatic workflow directly.

### 2. Normal page load performed scan-grade work

The prior loader iterated through as many as 200 cards and could call the Mac scan archive plus multiple checklist lookups for each card before returning any page data.

**Repair:** normal page load now uses `instacomp-kingmaker`, a bounded loader with one inventory query, one image query, and non-blocking registry coverage counts. Mac/archive and per-card checklist calls are reserved for explicit diagnostics or scans.

### 3. Manual image controls were only hidden, not removed

Rotate and swap code remained active and was removed from the DOM after rendering.

**Repair:** all rotate/swap buttons and the client image-edit function were removed from the page source. Existing cards use one explicit automatic orientation/checklist action. New-card intake already normalizes the pair before saving the draft.

### 4. Image replacement could erase the card

The prior normalized-storage helper deleted all `inventory_images` rows before inserting replacements. An error between those steps left no displayed card images and removed extra/detail images.

**Repair:** normalized files are uploaded first. Existing front/back rows are updated in place, additional images are preserved, and the assigned pair is read back and verified before success is returned.

### 5. Scanner guesses could bypass visual parallel review

The prior checklist-parallel helper accepted a scanner parallel string when it matched one valid checklist candidate. This allowed an incorrect Base or Green label to become the selected identity without new image proof.

**Repair:** scanner labels cannot resolve a multi-candidate card. High-detail front/back vision must choose one exact live checklist identity. Non-Base requires at least 0.82 confidence. Base requires at least 0.90 confidence and positive evidence that listed non-Base treatments are absent.

### 6. Broad checklist retrieval trusted type guesses

Serial number, autograph/relic flags, and variation were used while gathering candidate identities. A bad scanner guess could remove the correct candidate before visual review.

**Repair:** broad candidate retrieval uses only year, manufacturer, card number, and player. Serial, auto/relic, variation, and parallel are resolved after the complete candidate set is returned.

### 7. Title cleanup removed color words globally

The prior title helper removed broad color/foil phrases anywhere in the title.

**Repair:** title replacement is suffix-scoped to known checklist parallel names. It cannot remove unrelated words from the player, set, or variation name.

### 8. Blank parallel silently meant Base

The manual route treated an empty parallel and explicit Base identically.

**Repair:** manual save requires the operator to enter `Base` or the exact parallel. Blank is rejected.

### 9. Corrections did not teach InstaComp

Save & Lock only changed inventory metadata. It did not call the existing operator-confirmation learning path.

**Repair:** when a scan ID exists, Save, Lock & Teach calls `confirmInstaCompKnowledge` with the complete corrected identity and records the promotion receipt or warning under `instacomp.learningPromotion`.

### 10. Unresolved scanner guesses remained visible

The prior page could prefill the manual parallel field from unresolved scanner output.

**Repair:** the workbench loader returns a parallel only when identity is resolved or manually locked. An unresolved card opens with a blank parallel field.

## Safety boundaries

- No automatic scan publishes a listing.
- An ambiguous checklist result keeps `identityComplete=false`.
- Pricing is blocked while identity remains ambiguous.
- Base is never selected merely because the back lacks the word `PRIZM`.
- Locked manual identity cannot be overwritten until explicitly unlocked.
- Failed scans preserve the normalized image pair and store a failure receipt.

## Build gate

The normal `prebuild` now runs `scripts/check-instacomp-text-orientation-checklist.mjs`. The build fails if any of these regressions return:

- recursive DOM observer;
- rotate/swap controls;
- heavy per-card work in the normal loader;
- destructive image-row deletion;
- scanner-label shortcut;
- weak Base proof;
- blank-to-Base manual coercion;
- missing learning promotion;
- missing automatic-route rewrite.

## Runtime verification still required

A successful Vercel build proves source contracts and TypeScript/build compatibility. The one-hour browser test must still prove the authenticated production workflow against real Supabase rows, stored images, checklist data, and the Mac scanner service.
