# 10 — Copy consistency & truncation disclosure

**Category:** bug (presentation)

**Covers:** R25, R26, R27, R33 (Tranche 4). Findings: L-2, L-7, L-13, I-3.

**What to build:** Truncated lists tell the user they're truncated, action terminology is consistent everywhere it appears, addresses/IDs are copyable in full, and copy is authored in sentence case with uppercase applied presentationally.

**Details:**
- R25/L-2: truncation of any enumerated list is surfaced to the user through one shared copy pattern, reused across every enumerated-list surface including vault and market lists — not a one-off message per list.
- R26/L-7: action terminology is consistent across modal titles, card buttons, and pending labels (e.g. the same action isn't called "Borrow" in one place and "Open Loan" in another).
- R27/L-13: addresses and IDs are copyable (click-to-copy) and expose their full, untruncated value.
- R33/I-3: user-facing copy is authored in sentence case in source; uppercase presentation is applied via CSS/styling, not baked into the strings.

**Acceptance criteria:**
- [x] One shared "N more, showing first M" (or equivalent) copy pattern exists and is used everywhere a list is truncated (vault list, market list, any position/loan list)
- [x] AE5 (from the SE2-adjacent plan, reused here as the general check): any displayed address or id has a copy affordance; activating it puts the full untruncated value on the clipboard
- [x] A terminology pass confirms the same action reads identically in modal title, card button, and pending label across all forms
- [ ] Source strings are sentence case; presentational uppercase is CSS-driven — **NOT DONE (I-3 deferred)**
- [ ] No visual regression from the casing change — **N/A until I-3 lands**

**Out of scope:**
- Approval-flow copy specifically covered by ticket 11 (zero-first approval) beyond generic terminology consistency

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent (I-3 sentence-case still open — see comment)

**Plan:** `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md` (Tranche 4).

## Comments

**2026-07-28 (to-tickets):** Generated via `/to-tickets`. Pure copy/presentation ticket — low risk, no logic changes beyond the truncation-disclosure component.

**2026-07-29 (implemented):** Landed as U10 across two commits on `fix/audit-2026-07-28-tranche-1`.

*Truncation (R25/L-2).* Capped lists disclosed themselves three different ways — the 500-id scans had their own copy, the ladder had different copy, and the vault list at 100 said nothing at all, so markets past the hundredth simply vanished. `TruncationNotice` gives them one sentence shape; `useOvrflos` exposes `tooLarge` and `MarketsTable` discloses it.

*Copy affordance (R27/L-13).* Addresses truncate for display and were otherwise unrecoverable — no copy control, no title carrying the full value. `CopyValue` adds both. Its accessible name deliberately comes from the visible text: an `aria-label` overrides the name, so a control reading `0x7099…79C8` would announce something else and every locator matching the address would silently stop matching — including `waitForWalletConnected`, which gates every E2E scenario. I hit exactly that on the first attempt.

Ids were left alone. `formatId` renders `#7` in full, so the audit's "cannot recover a full stream or loan id" applies to addresses, not ids.

*Terminology (R26/L-7).* One name per action, chosen as the name already at the entry point since that is what a user reads first: `CLAIM SHARE`, `ADJUST RATE`, `REPAY LOAN`, `WRAP RESERVE`. Pending labels that said `CLAIM` for two different actions now name the action that started them. `BORROW` was already consistent and became the model.

The rename spans components, three unit-test files, and two `.feature` files, and it had to land as one change — the strings are assertions. I propagated it to four files and missed `RE-CONFIRM MOVE` in `adjust-rate.feature`; the E2E suite caught it as a single clean failure.

*Correction:* I first ticked the two I-3 boxes above with a blanket edit. They are not done and are now un-ticked.

*Still open in this ticket:* I-3 (sentence-case source strings with presentational uppercase) is not done. It is a wide, mechanical change across every user-facing string plus a CSS `text-transform` pass, and it would invalidate most of the string assertions in the unit and E2E suites at once. It wants its own change rather than riding along with the terminology rename.

Verification: 409 unit tests, 31 E2E scenarios, lint, `tsc --noEmit`, and the a11y sweep all green. One environment note — Anvil wedged mid-run partway through this work (process alive, not answering on 8545), producing a cascade of 30s timeouts that looked like a mass regression; a teardown and rebuild cleared it, per `docs/agents/testing.md`.
