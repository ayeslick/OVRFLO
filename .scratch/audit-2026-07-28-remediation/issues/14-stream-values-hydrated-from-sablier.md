# 14 — Stream values hydrated from Sablier, not the indexer

**Category:** bug (correctness, indexer trust)

**Covers:** R37 (Tranche 5 — Indexer trust and races). Findings: M-9.

**What to build:** Every stream value a user owns or acts on — recipient, sender, asset, end time, deposited, withdrawn, claimable — is read from Sablier on-chain, never taken as-is from the indexer. Any stream whose on-chain fields disagree with what the indexer reported is dropped from the render rather than shown.

**Details:**
- The indexer (Ponder) is useful for *discovering which stream ids exist* for a user, but the values displayed and acted on must come from Sablier directly — the indexer is a discovery hint, not a source of truth for stream state.
- For each stream the indexer surfaces, hydrate its actual values via an on-chain read against Sablier. If the on-chain recipient doesn't match the connected address, or any hydrated field materially disagrees with what the indexer reported, drop that entry from the rendered list rather than showing stale or wrong data.
- This is the correctness baseline that ticket 15 (degraded-indexer UX) builds on — R43 explicitly requires "keeps hydrating it from Sablier," which is this ticket's mechanism.

**Acceptance criteria:**
- [x] AE6: given an indexer returning a stream the connected address does not own, when the positions view renders, that stream does not appear
- [x] All displayed/actionable stream fields (recipient, sender, asset, end time, deposited, withdrawn, claimable) sourced from an on-chain Sablier read, not passed through from the indexer unchecked
- [x] A test simulates an indexer/chain mismatch and asserts the mismatched entry is dropped, not rendered
- [x] `npm --prefix web run test` green

**Out of scope:**
- Degraded-indexer UX (staleness indicator, cache behavior) — that's ticket 15, which depends on this
- Hardening the indexer's read surface itself — that's ticket 16

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 5).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Ticket 15 is blocked by this one — its degraded-indexer behavior assumes this hydration mechanism already exists.

**2026-07-29 (implemented):** Landed as U14 on branch `fix/audit-2026-07-28-tranche-1`.

The audit's diagnosis was exact and the gap was wider than "values may be stale". Only `withdrawable` was hydrated — recipient, sender, asset, end time, canceled, depleted, deposited and withdrawn all came straight from the indexer, and `isSeriesMatchedStream` gates eligibility on four of them (sender, asset, endTime, canceled/depleted). So a stale or wrong indexer could present an ineligible stream as eligible, or show one the connected address no longer owns, and the app would let the user act on it.

The indexer now answers exactly one question — *which stream ids might be mine* — and the chain answers everything else. Three reads per id, batched into the existing multicall: `getStream` for the full record, `withdrawableAmountOf` for the live claimable figure the record does not carry, and `ownerOf`, which is the only authority on who holds the stream right now. `getStream` was added to the ABI mirroring the deployed `LockupLinear.Stream` field order, so this is one read rather than seven getters.

Dropping is the safe direction throughout. A stream whose on-chain owner is not the connected address is dropped rather than rendered — the indexer naming an id is a hint, not a claim of ownership. An unresolved record or owner read also drops, because falling back to the indexer's copy is precisely the behaviour being removed. A failed `withdrawableAmountOf` is the one case that keeps the stream: ownership and eligibility are already known from the other two reads, and reporting zero claimable understates rather than overstates.

The test fixtures now give the indexer deliberately *wrong* values for every field, so any test that passes by reading them has caught the regression rather than hidden it.

Verification: 423 unit tests (up from 417), 32 E2E scenarios, lint and `tsc --noEmit` clean.
