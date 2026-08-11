# OVRFLO Style Guide

> The softer conventions that remove micro-decisions when writing OVRFLO
> Solidity and tests. Where the coding standard says *must*, this guide says
> *this is how we write it here*. Every convention carries one concrete example
> from the shipped code. Deduplicated against `ovrflo-critical-patterns.md`
> (`CP#N`) and `ovrflo-coding-standard.md` — references only.
>
> Compiled 2026-08-10 (ticket 09).

## 1. Naming

- **Project and token names:** `OVRFLO`, never `OVFL`; token symbols carry an
  `OVRFLO`/`overflo` prefix. (Learned preference, AGENTS.md.)
- **Contracts/structs/events:** CapWords — `TickTree`, `Position`, `Loan`,
  `Epoch`, `Supplied`, `Borrowed`. **Functions/variables:** mixedCase.
  **Constants:** `UPPER_CASE_WITH_UNDERSCORES` — `LAUNCH_APR_BPS`,
  `MIN_LIQUIDITY_AMOUNT`. **Internal functions:** `_` prefix — `_liveLoan`,
  `_outstanding`, `_fillTick`. (Matches the Solidity style guide; already
  house practice. Known deviation: the internal mapping `ticks` lacks the
  prefix — pending decision #3 in the coding standard.)
- **No `l`, `O`, or `I` adjacent to digits in identifiers** — they read as
  digits. (Solidity style guide; house-adopted.)
- **Test names:** `test_Fn_Behavior` — e.g.
  `test_StateViews_DeriveFieldsAndRevertOnMissing`,
  `test_Gas_BorrowFlatness_AcrossTreeHeightGrowth`. The name states the
  function under test and the asserted behavior; a reader greps `test_Borrow`
  and gets the borrow contract's behavioral surface.
- **Fizz/invariant properties:** `property_<subject>_<claim>` with the Spec ID
  as the first NatSpec line (`/// @notice GL-04: ...`) so `/fizz-convert` and
  reviewers can map code ↔ spec mechanically.

## 2. File and section layout

- **Section banners** use the box style already throughout `OVRFLOLending.sol`:
  `/*////////// ADMIN FUNCTIONS //////////*/`. House order: CONSTANTS →
  ERRORS → IMMUTABLES → STORAGE → EVENTS → functions (pending decision #1 in
  the coding standard records the divergence from the official guide's order —
  until decided, match the file you are editing).
- **External functions precede internal; views trail state-changers** in a
  dedicated VIEW FUNCTIONS section before INTERNALS. Inside INTERNALS, group
  topically (e.g. `_fillTick` with its helpers) — do not mechanically sort by
  mutability. (Deliberate REJECT-in-part of the official ordering; recorded in
  the standard.)
- **One contract per file; tests mirror the contract name**
  (`OVRFLOLending.t.sol`, `OVRFLOLendingInvariant.t.sol`,
  `OVRFLOLendingGas.t.sol` — the Gas suite's name deliberately matches the
  snapshot gate's `--match-contract OVRFLOLending` filter).
- **SPDX:** MIT for project-authored files in `src/` and `test/`;
  third-party-derived files keep their upstream identifier (the four
  Crytic-derived fizz utils carry `Unlicense`). (2026-08-10 sweep.)

## 3. NatSpec voice

- **Every external/public member gets `@notice`; `@dev` carries the
  rationale, not a restatement.** The house voice states *why the code is
  shaped this way and what invariant it protects*, at whatever length that
  takes — `borrow`'s 15-line `@dev` block explaining blind-fill mechanics is
  the model, not an outlier.
- **Named security invariants are called out as such** — claim's
  `min(withdrawable, outstanding)` clamp is documented as "a security
  invariant, not arithmetic detail" precisely so a refactor treats it with
  fear. If a line's deletion would be a vulnerability rather than a bug, its
  comment says so.
- **Internal helpers keep rich `///` comments knowing solc won't emit them**
  — they are for readers and agents, not devdoc. Do not "fix" this by
  promoting internals to public. (NatSpec format spec; awareness note.)
- **Pronouns and hedging:** none. State the contract's behavior declaratively
  ("Reverts NotCovered until the stream's withdrawable covers the
  obligation"), never speculatively ("should revert").

## 4. Comment discipline

- **Comments state constraints the code cannot show — never narration, never
  provenance.** The canonical positive example is the sentinel-conversion
  comment at `borrow`'s inline `/ UNIT` (names the exception and the trap);
  the canonical banned examples are "// call the helper" and "// per review
  feedback". If the comment explains *what the next line does*, delete it; if
  it explains *what breaks if you change it*, keep it.
- **Deliberate exceptions get a comment at the site plus a dated plan/writeup
  record** — one without the other rots. (`forge-lint` disable markers follow
  the same rule: the disable line plus the reason.)

## 5. Fixture and test-writing conventions

- **Exact-arithmetic fixtures.** Choose fixture numbers so expected values are
  exact integers, not approximations — the house pattern is the 73-day /
  1.02-factor family from `StreamPricing.math.t.sol`, picked so
  `grossPrice`/`obligation` come out to hand-derivable literals. A fixture
  needing `assertApproxEq` is usually a fixture chosen badly.
- **Hand-derived literals in asserts** — the expected value is computed in the
  test's comment or a review note, never by calling the code under test
  (CP#22 governs).
- **Boundary tests at the discriminating distance** — `UNIT-1`, net-of-fee,
  non-aligned rounding cases (see the uncheatable-test writeup; CP#22).
- **Every money-movement test asserts all-party balances** (CP#6).
- **`Covers AE<N>.` prefixes** tie acceptance-example tests to the plan —
  every AE1–AE9 has exactly one enforcing test carrying its prefix; keep the
  prefix when refactoring or the DoD sweep loses the mapping.
- **Mocks live in `test/mocks/` (unit) or `test/fizz/mocks/` (fuzz) and
  implement the interface** (CP#19; the one duck-typed exception is recorded
  there).

## 6. Shell/script conventions (touched by Solidity work)

- **Local seeding follows the `forge create` + `cast send` driver pattern** —
  never `forge script --broadcast` against local Anvil (CP#2). The Anvil
  invocation for local work no longer needs `--disable-code-size-limit`
  (retired 2026-08-11 by the factory-size fix — the register-don't-construct
  model, `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md`
  — brought the factory under the EIP-170 runtime cap, so local seeding now
  proves real mainnet deployability instead of masking it).
- **Well-known Anvil dev keys are pasted whole and verified** —
  `cast wallet address --private-key` must derive the expected account before
  a script ships (the truncated-key lesson, ticket 08).
