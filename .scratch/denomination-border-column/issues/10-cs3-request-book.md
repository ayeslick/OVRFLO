# 10 — CS3: borrow request book

**What to build:** `OVRFLORequestBook` is a thin router. The borrower posts stream plus terms, including the exact `aprBps` they chose, with plain `transferFrom`. If core `borrow` at that tick clears `minAcceptable` at post time, the book fills immediately. Later `execute` is permissionless and fills at the stored tick only. The book never searches ticks and never picks a tick for the borrower. Every core `borrow` leg sets `onBehalfOf` to the human and runs only while `lending.router() == address(this)`. `cancel` returns the stream and never consults the router slot. Events are `RequestPosted`, `RequestFilled`, and `RequestCancelled` as pinned in KD14.

**Blocked by:** 08

**Status:** resolved
**Labels:** ready-for-agent

## Intent (ticket/10, 2026-09-02) — before code

Assumptions: CS1 is live. `OVRFLOLending.borrow` takes `onBehalfOf`. Factory `setLendingRouter` writes `lending.router`. CS2 flash mint is live and stays untouched. Ticket 08 is resolved. Ticket 19 owns request UI and waiting copy. Ticket 06 owns fuzz and invariant re-derivation.

Crown rules (KD14): the book stores the borrower's `aprBps` and fills at that tick only. No tick ceiling, no tick search, no `tickDepths` read. `post` never wraps core `borrow` in `try/catch`. Fill-or-rest order is router gate, `StreamPricing.requireEligible` plus `MIN_STREAM_AMOUNT`, `previewBorrow` in `try/catch` that rests only on `EmptyTick` / `BelowMinimum`, then core `borrow` with `minAcceptable`. `cancel` never reads the router slot. Every core `borrow` leg sets `onBehalfOf` to the human and requires `lending.router() == address(this)`. No `loanId -> borrower` table. No `settle`. No book fee. Escrow uses plain `transferFrom`. Constructor calls `setApprovalForAll(lending, true)` on the lockup.

Unit boundary: this ticket owns `OVRFLORequestBook`, its Foundry suite, DeploySize, the storage golden, seed `setLendingRouter`, the wagmi ABI union, and the CONCEPTS live paragraph. Ticket 19 owns request UI, waiting copy, and naming the book as the ERC-721 spender. Ticket 06 owns property re-derivation. Seam: CS4 consumes canonical post/execute/wait/cancel and must not duplicate book logic. CS4-U4's no-liquidity gate depends on this contract.

Predicted blast radius: `src/OVRFLORequestBook.sol`, `test/OVRFLORequestBook.t.sol`, `test/DeploySize.t.sol`, `test/StorageLayout.t.sol`, `tools/scripts/check-storage-layout.sh`, `artifacts/tests/storage-layout/OVRFLORequestBook.json`, `test/mocks/LendingMocks.sol` (`lendingToOvrflo` plus withdraw ACL so scenario 11 can fail a third-party draw), `script/seed-local.sh`, `script/lib/OVRFLOTestFixtures.sol`, `script/lib/OVRFLOSeedRunner.sol`, `web/wagmi.config.ts`, `web/lib/abis.ts`, `web/lib/generated.ts`, `web/lib/errors.ts`, `CONCEPTS.md`, this ticket. Fuzz and invariant files only if plain `forge test` fails to compile or go green.

Verification that fails if this ticket is wrong: Foundry tests in `test/OVRFLORequestBook.t.sol` for the CS3-U1 scenarios (immediate fill, rest then execute, retired-router execute/cancel/post, cheaper-tick non-fill, non-borrower cancel, live remaining/target at fill, ineligible and invalid-tick reverts, below-`minAcceptable` rest, matured execute, approval target); `test/DeploySize.t.sol`; `test/StorageLayout.t.sol` after golden regen; seed calls `setLendingRouter`; `forge build` then `forge test`; `forge fmt --check`. No `FOUNDRY_PROFILE=invariant`. No fizz harness.

Reuse: lending `borrow` / `previewBorrow` / `EmptyTick` / `BelowMinimum` / `MIN_STREAM_AMOUNT`, `StreamPricing.requireEligible`, factory `lendingToOvrflo` and `setLendingRouter`, lockup plain `transferFrom`, OZ `ReentrancyGuard` and `IERC721.setApprovalForAll`, existing mock stream factory. No new tick index. No settle table.

Rejected: try/catch around core `borrow`; cheapest-tick search; `maxAprBps` ceiling; `safeTransferFrom`; factory registration of the book.

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS3-U1 (= this ticket). Stop when this ticket's acceptance
criteria are met.
Ticket: .scratch/denomination-border-column/issues/10-cs3-request-book.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start CS4 request UI (19). Do not add settle
or a loanId-to-borrower table. Do not add a tick ceiling, a tick search, or a
tickDepths scan: the borrower's stored aprBps is the only fill tick.
Never wrap core borrow in try/catch; follow the KD14 fill-or-rest order.
Before any writes, write the Solidity intent record (Sequence 6).
Read Required reading below and the plan sections: KD10, KD14 CS3 bullets
(including the fill-or-rest algorithm), CS3-U1, CS4-U4 no-liquidity gate,
Verification Contract successors *Request book attribution* and
*Request book fill-or-rest*.
Seed must call setLendingRouter after deploy. DeploySize gates the book.
Fuzz and invariant files: minimum edit to keep plain forge test green, nothing
more. Do not run FOUNDRY_PROFILE=invariant or the fizz harness. 06 owns the
re-derivation later; log each minimum edit on this ticket.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/10 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Plan KD10, KD14 CS3 bullets, CS3-U1
- CS4-U4 no-liquidity gate, CS4-U5 CS3 dependency
- `docs/solutions/patterns/solidity-implementation-discipline.md`
- https://ethskills.com/SKILL.md
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Scratch/Solidity intent record exists before the first code write
- [x] Borrower posts stream + `market` / `aprBps` / `targetBorrow` / `minAcceptable` via plain `transferFrom` (never `safeTransferFrom`); the constructor calls `setApprovalForAll(lending, true)` on the lockup
- [x] Escrowed streams are never drawn from
- [x] `cancel` is borrower-only while the request rests and returns the stream intact without reading the router slot
- [x] Post-time fill runs when core `borrow` at the stored `aprBps` clears `minAcceptable`; later `execute` is permissionless and fills at the stored `aprBps` only
- [x] `post` follows the KD14 fill-or-rest order: router gate (`lending.router() == address(this)`, else revert), `StreamPricing.requireEligible` plus `remaining >= lending.MIN_STREAM_AMOUNT()` (failure reverts `post`), `previewBorrow` in `try/catch` that rests only on `EmptyTick` or `BelowMinimum` and re-reverts every other error with the same data, then core `borrow` with `minAcceptable`; core `borrow` is never inside `try/catch`
- [x] Depth exists but net proceeds are below `minAcceptable`: `post` rests without calling core `borrow`
- [x] `execute` has no `try/catch`; a resting request past series maturity makes `execute` revert `SeriesMatured` and `cancel` still returns the stream
- [x] The human approves the book on the lockup; a human who approved only the lending market cannot post
- [x] Depth at a cheaper tick does not fill: `execute` reverts and the request keeps resting; no tick search or `tickDepths` read exists in the book
- [x] Every core `borrow` leg uses `onBehalfOf = human` and requires `lending.router() == address(this)`
- [x] Proceeds go to the human; the stream returns to the human at close; the book holds nothing after a successful execute except still-resting requests
- [x] Remaining face is read live at fill time; the book takes no fee
- [x] No `loanId -> borrower` table and no `settle` exist
- [x] Events match KD14 (`RequestPosted`, `RequestFilled`, `RequestCancelled`)
- [x] Seed calls `setLendingRouter` after deploy; `DeploySize` gates `OVRFLORequestBook`

## Plan unit

CS3-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session log

Intent recorded 2026-09-02 before the first Solidity write.

Verification: `forge build` (default and `FOUNDRY_PROFILE=legacy`); `forge test` 424 passed, 0 failed, 5 skipped (fork tests without `MAINNET_RPC_URL`); `forge test --match-contract OVRFLORequestBookTest` 21 passed; `forge fmt --check` on touched Solidity; `check-storage-layout.sh --write`; `npm --prefix web run typegen`; `web` vitest `tests/lib/errors.test.ts` 17 passed. No `FOUNDRY_PROFILE=invariant`. No fizz.

Fuzz and invariant files: no minimum edits. Plain `forge test` stayed green without them.

Mock note (not a fuzz/invariant edit): `MockLendingSablier.withdraw` now requires the owner, the stream sender, or an approved operator. Scenario 11 needs that ACL so a third-party draw fails while the stream rests. Ticket 06 owns any later re-derivation.

Blast radius matches the intent list. No extra files.

Review (gpt-5.6-sol-medium, report only): contract matches KD14 pins. Two test gaps: escrow-not-drawn with nonzero `withdrawable`, and `RequestFilled.actualBorrow` on a capped fill where `targetBorrow` differs. This chat applied both. No protocol change.
