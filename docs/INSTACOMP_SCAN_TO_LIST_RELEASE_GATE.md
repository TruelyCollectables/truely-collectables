# InstaComp Scan-to-List Release Gate

## Status

**Code-side gate:** in progress on `feature/scan-to-list-release-gate`  
**Physical Mac and live-card gate:** NOT PASSED  
**InstaComp AI 1.0 Beta:** NOT PASSED

This gate proves that the actual scanner intake uses the same listing-output, evidence, pricing, Pending Listings, and publish-firewall contracts that were previously tested in isolation.

## Required authority chain

```text
Phone front/back capture
  -> Mac-local visible evidence
  -> authenticated central Checklist Registry identity lock
  -> duplicate image-pair check
  -> canonical listing output
  -> website/eBay channel draft parity
  -> private inventory draft
  -> Registry-verified marketplace pricing
  -> Pending Listings seller review
  -> publish firewall
  -> explicit seller publication
```

The Mac service cannot publish, activate inventory, accept offers, or change orders. Marketplace titles and local model output are evidence, not canonical identity.

## Scanner-created draft requirements

The real intake route must persist:

- Registry identity ID and fingerprint;
- scan ID and immutable front/back image hashes;
- exact serial copy and denominator;
- rookie, autograph, and memorabilia configuration;
- local visible evidence and uncertainty;
- confirmed inscription text or an unreadable-inscription blocker;
- grading company, grade, and certification evidence when observed;
- grader verification status;
- shared listing output;
- one canonical channel draft used for both website and eBay content;
- seller-review-required state;
- no direct execution authority.

Local evidence never overrides Registry-locked year, manufacturer, set, player, card number, parallel, variation, serial run, or configuration.

## Representative code-side matrix

The release workflow covers:

1. Normal base card.
2. Serial-numbered parallel preserving `049/999` exactly.
3. Autograph card.
4. Relic or memorabilia card.
5. Rookie card.
6. Confirmed inscription with exact text in listing content.
7. Unreadable inscription that is not advertised and blocks publication.
8. Graded card that remains blocked until grader verification.
9. Multi-subject card preserving all subjects.
10. Intentionally unclear identity that fails closed.
11. Registry-confirmed manufacturer autograph provenance.
12. Generic signed item that still requires authenticity disclosure.
13. Verified completed sales separated from active asks.
14. Website and eBay content parity.
15. Registry gate before duplicate check and draft creation.
16. Duplicate check before draft insertion.
17. Verified pricing only after the Registry-locked draft exists.
18. Seller confirmation, Registry receipt, readiness blockers, and activation firewall at publish time.

## Publication safeguards

- Exact copy numbers are preserved.
- A copy number never implies a different print run; `049/999` must never become `/50`.
- Unreadable inscription text is never advertised.
- Low-confidence or ambiguous listing evidence remains `review_required`.
- A `review_required` scan creates an editable private draft but cannot activate.
- Graded items require official or accepted manual grader verification.
- Registry-confirmed manufacturer autograph configuration is distinct from generic signed memorabilia.
- Sold evidence and active competition remain separate.
- Website and eBay payloads originate from the same canonical content.
- No listing publishes without explicit seller confirmation.
- No trusted pricing runs without Registry identity ID and fingerprint.

## What CI can prove

CI can prove contract order, data preservation, fail-closed behavior, channel parity, representative transformations, source boundaries, TypeScript, lint, and Production build.

CI cannot prove that the actual Mac camera, lighting, Ollama model, Google Drive mount, local network, approved icon, LaunchAgent, offsite disk, or real marketplace account behaves correctly.

## Physical and live acceptance still required

Issue #696 remains open until the actual M4 Pro Mac mini and Production seller workflow prove:

- front/back phone capture;
- normal, serial, autograph, relic, inscription, graded, multi-subject, duplicate, and unclear real-card cases;
- exact Registry identity receipts;
- real verified sold evidence;
- editable website and eBay-ready draft parity;
- explicit seller review;
- live publish-firewall behavior;
- desktop launch and automatic recovery;
- reboot survival;
- offsite backup and no-overwrite restore drill.

Only after those receipts exist may the project state:

> **InstaComp AI 1.0 Beta has passed.**
