# OVRFLO Coding Standard

> The enforceable rules a model (or human) must follow when writing OVRFLO
> Solidity. Every rule cites its source — an internal writeup/review finding or
> an external standard passed through the adoption filter (industry practice is
> welcome iff it does not hurt this codebase's readability, maintainability, or
> simplicity; "just because it's good doesn't mean it's good for this
> protocol"). Rules never restate `ovrflo-critical-patterns.md` — they
> reference pattern numbers (`CP#N`). Each rule carries its remediation tier
> per the 2026-08-10 hierarchy: (1) unrepresentable, (2) unmissable,
> (3) detected, (4) reviewable.
>
> Compiled 2026-08-10 (ticket 09) from the v1-lite buildout trail plus external
> research: ETHSKILLS, the official Solidity style guide, OpenZeppelin
> conventions, Trail of Bits secure-contracts, ConsenSys Diligence.

## 1. Errors and events

- **E1. Closed catalog.** Errors/events are amended only by dated user
  decision; one selector, one semantic class; log-completeness for
  owner-mutable parameters; uniform terminal signals. This is CP#21 and CP#25
  — follow them. Tier 2. [error-event-catalog-governance-20260808]
- **E2. New errors carry contextual parameters where a caller would need
  them.** The existing 39 zero-argument errors stay as-is (retrofitting
  audited code is churn); the OpenZeppelin parameterized shape
  (`ERC20InsufficientBalance(sender, balance, needed)`) applies to *new*
  errors when the context is not recoverable from the call itself. Tier 4.
  [OZ 5.x conventions; external-research ADAPT]
- **E3. Revert, never boolean-return, on failure paths.** Already universal in
  `src/`; keep it that way. Tier 2 (type system makes mixed styles obvious).
  [OZ conventions; no-op ADOPT]
- **E4. Exact-selector `expectRevert` in tests.** String-matching or bare
  `expectRevert()` accepts the wrong failure. Tier 3.
  [uncheatable-test-discipline-20260810]

## 2. Types, units, narrowing

- **T1. All narrowing routes through SafeCast** (CP#15); `uint128` parameters
  double as ABI-decoder bounds (CP#14). Tier 2.
- **T2. Sentinel values are resolved before checked conversion.** A max-value
  sentinel meaning "as much as possible" must be clamped/floored/branched
  before any SafeCast path; the site carries a comment naming the exception.
  The one sanctioned instance is `borrow`'s inline `uint256(targetBorrow) /
  UNIT`. Tier 3 (SP-06 is the tripwire); tier-1 rejection recorded in the
  writeup. [checked-narrowing-vs-partial-fill-sentinel-20260808]
- **T3. Multiply before divide; `Math.mulDiv` for anything that could
  overflow an intermediate.** Already universal in `StreamPricing`. Tier 4.
  [ETHSKILLS security; no-op ADOPT]
- **T4. Rounding direction is a stated, per-quantity decision** — user-favors
  vs protocol-favors — and every boundary gets a concrete non-aligned fixture
  test (the strict-inequality safe-direction case). Tier 3.
  [uncheatable-test-discipline-20260810; U6 dated note]
- **T5. No generic decimals handling.** PT is 18-decimal by protocol
  invariant; do not add `decimals()` plumbing (R-01 declined by design).
  Tier 4. [ETHSKILLS rule REJECTED via adoption filter]

## 3. Storage and state shape

- **S1. Packing claims are proven, not asserted** — `forge inspect
  storageLayout` + a `vm.load` packed-slot test for any "one SSTORE" or
  shared-slot claim. Tier 3. [packed-slot-vm-load-verification-20260808]
- **S2. Derive, don't mirror.** Prefer immutable coordinates + lazy derivation
  (frozen history, monotone counters — CP#23) over mutable per-entity mirrors;
  a derived quantity from public constants is a derivation, not a "second
  source" (2026-08-08 carve-out). Tier 1 where achievable.
  [frozen-history-monotone-counter-safety-argument-20260810]
- **S3. State-machine completeness.** Legal-but-surprising states (e.g.
  `outstanding == 0 && !closed`) are documented at the struct and covered by a
  test, not "fixed". Tier 3. [U4 dated note, 2026-08-08]

## 4. Ordering, reentrancy, modifiers

- **O1. FREI-PI ordering + `nonReentrant` on every external-calling
  state-changer**, with the ordering rule stated in a comment at the function
  (see `claim`). Governed by `solidity-implementation-discipline.md`; this
  standard adds nothing new — follow it. Tier 2/3.
- **O2. Modifiers check; they never mutate or call out.** Currently vacuous
  (zero custom modifiers in `OVRFLOLending`) — binding on the first custom
  modifier. Tier 4. [ConsenSys Diligence; ADOPT]

## 5. External integrations

- **X1. Sablier NFTs move by plain `transferFrom`, never `safeTransferFrom`**
  — no `onERC721Received` callback surface (plan risk #6; documented at the
  call sites). The Trail of Bits generic preference for `safeTransferFrom` is
  REJECTED here with cause; do not re-raise. Tier 2 (grep-able banned call).
- **X2. External-contract semantics may serve as guards** when the mechanical
  argument is recorded and a test pins the external revert
  (`StreamAlreadyPledged` deletion). Tier 1 by removal.
  [erc721-ownership-as-guard-stream-already-pledged-20260808]
- **X3. Exact-amount pulls verify realized balance deltas** (`_pullExact`,
  `TransferMismatch`) — the fee-on-transfer checklist item, already
  implemented. Tier 3. [Trail of Bits token checklist; no-op ADOPT]
- **X4. External struct ABIs are verified empirically** (CP#18); mocks
  implement the interface (CP#19, with the recorded `MockLendingSablier`
  exception). `StreamPricing` is never re-derived. Tier 3.
- **X5. Every state transition has an incentive-compatible caller**, and
  permissionless functions state why permissionless is safe at the function
  (e.g. `repay`: third-party repay is a donation). Tier 4.
  [ETHSKILLS concepts; U4 dated note]
- **X6. Any new pausable/owner surface states its timelock mitigation in
  NatSpec.** Tier 4. [ETHSKILLS CROPS; ADAPT]

## 6. Views

- **V1. Raw auto-getters return zeros; hand-rolled named views revert** —
  CP#7/CP#17 (as refreshed 2026-08-10) and R-07 coexistence. Tier 2.
- **V2. Unbounded views over set-once parameters are a discovery-DoS class.**
  Any view whose cost scales with an admin-set, immutable-after-set parameter
  documents the operational bound at the setter's forwarder (the
  `(aprMax − aprMin)/spacing ≲ 400` rung rule). Tier 4, with the onboarding
  checklist as the enforcement surface. [U5 security note, 2026-08-08]

## 7. Testing (summary — the discipline doc governs)

- **TS1. Uncheatable-test discipline is mandatory**: plan-derived literals,
  discriminating boundaries, liveness gates, mutation review for test-only
  changes, citation-forcing. CP#6 and CP#22 are the pattern-level anchors.
  Tier 3. [uncheatable-test-discipline-20260810]
- **TS2. Suite shape follows CLAUDE.md's Testing Strategy** (fuzz ≥1000 runs,
  invariant 500×40 gate profile, fork suites self-skip without
  `MAINNET_RPC_URL`). Tier 3. [ETHSKILLS testing; no-op ADOPT]
- **TS3. Deployability is part of verification.** At least one gate runs under
  real network rules; contract-size review (`forge build --sizes`) accompanies
  any change to a deployed artifact's code size. Tier 3 — the concrete CI gate
  lands with the factory-size fix plan.
  [environment-fidelity-mainnet-rules-gates-20260810]

## Considered and rejected (do not re-raise without new context)

- ERC-4626 inflation-attack mitigations — no shares exist; positions are raw
  UNIT-denominated tape leaves. [external-research N/A]
- Generic `decimals()` handling — see T5 / R-01.
- `safeTransferFrom` for Sablier NFTs — see X1.
- Infinite-approval hygiene rules — the contract grants no third-party
  approvals; nothing to bound. [external-research N/A]
- Retrofitting parameterized errors onto the existing 39-error catalog — churn
  on audited code with no caller need. [external-research ADAPT, narrowed]
- Strict style-guide mutability ordering inside `INTERNALS` — topical grouping
  reads better in a 1,180-line contract; external functions already precede
  internal ones and views trail state-changers. [Solidity style guide;
  REJECT-in-part]

## Pending user decisions (surfaced, not decided — 2026-08-10)

1. **Section order vs the official style guide.** OVRFLO's established layout
   (CONSTANTS → ERRORS → IMMUTABLES → STORAGE → EVENTS) differs from the
   Solidity guide's (state vars → events → errors). Keeping the house order is
   defensible; switching is churn. Decide once, record here.
2. **Require-strings in factory/vault vs custom errors in lending/libraries.**
   `OVRFLOFactory`/`OVRFLO`/`OVRFLOToken` are 100% require-string (55 sites);
   `OVRFLOLending`/`TickTree`/`StreamPricing` are 100% custom-error. A
   migration is a deliberate, separately-planned change — not a style edit.
3. **`ticks` → `_ticks`** (the one internal storage var missing the `_`
   prefix): opportunistic rename, low blast radius, waiting on (2)'s outcome
   to batch with.
4. **CI static analysis**: confirm whether Slither (or equivalent) runs in CI;
   `forge lint` markers exist but CI coverage was not verified during the
   ticket-09 research pass. [Trail of Bits; ADOPT pending confirmation]

## Sources

Internal: the writeups cited inline (`docs/solutions/**/*20260808*.md`,
`*20260810*.md`), the plan's dated decision notes
(`docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`), ticket review
batches (`.scratch/lending-v1-lite/issues/`).
External: https://docs.soliditylang.org/en/latest/style-guide.html ·
https://docs.soliditylang.org/en/latest/natspec-format.html ·
https://docs.openzeppelin.com/contracts/5.x/ ·
https://secure-contracts.com/development-guidelines/ ·
https://consensys.io/blog/solidity-best-practices-for-smart-contract-security ·
https://ethskills.com (security/testing/concepts skills).
