# Invariant Map

> OVRFLO | CS1 refresh 2026-09-02 on `ticket/08`. Lending tape IDs I-1..I-23 remain the v1-lite catalog from `f0661ab`. Vault wrap/flash guards below are retargeted: wrap lives on `OVRFLOReserve`; PT flash is **removed**. Cite IDs as `x-ray/invariants.md` plus commit, never as a timeless ID. Ticket 06 re-derives the suite; until then treat KD13 identities as pinned.

The old→new lending ID map lives in `AUDIT.md` ("ID map").

---

## 0. Suite disposition

Where each inferred invariant is *enforced*. This table is authoritative; `test/OVRFLOLendingInvariant.t.sol`
carries a mirror of it in its header comment. Guards `G-1..G-68` are per-call preconditions, not falsifiable
global properties — they are covered by the unit suites' error-path tests, and appear here only through the
`I-N` whose lifted form they become.

`ENCODED` = asserted by the stateful invariant suite. `COVERED` = pinned by a cited unit test (typically an
admin-only bound no fuzz sequence can reach). `PARTIAL` = one half enforced, the other named. `OUT-OF-SCOPE` =
belongs to another contract or another suite, with the owner cited.

| ID | Disposition | Where |
|---|---|---|
| I-1 | ENCODED | `invariant_IntervalPartition` — tiling of `[0, filled)` walked through each loan's stored `seq`, plus `filled` against the handler's fill ghost |
| I-2 | ENCODED | `invariant_FrozenHistory` — per-position frozen sub-interval ghosts snapshotted before every action |
| I-3 | ENCODED | `invariant_EscrowSolvency` |
| I-4 | ENCODED | `invariant_PotConservation` — the payout term is the handler's balance-delta ghost, not the contract's `received` |
| I-5 | ENCODED | `invariant_TokenCustody` |
| I-6 | ENCODED | `invariant_ClaimCaps` (per-pair cap) + `invariant_ClaimEntitlementCeiling` (ghost-side ceiling recomputed per claim) + handlers reach over-vested open loans |
| I-7 | ENCODED | `invariant_ClaimCaps` (`drawn + repaid <= obligation`) |
| I-8 | ENCODED | `invariant_LoanIntervalAtom` |
| I-9 | OUT-OF-SCOPE | Deliberately-contradicted lift; its correct consequence is I-2, which is encoded |
| I-10 | ENCODED | `invariant_UnitAlignment` |
| I-11 | COVERED | `test_SetAprBounds_RejectsInvertedRangeAndAboveCeiling` (`test/OVRFLOLending.t.sol`) |
| I-12 | COVERED | `test_SetFee_RejectsAboveMaxFeeBps` (`test/OVRFLOLending.t.sol`) |
| I-13 | ENCODED | `invariant_TreeIntegrity`'s per-level Σchildren == parent walk, plus `test/TickTree.t.sol` NodeOverflow tests and its reference-model differential fuzz |
| I-14 | ENCODED | `invariant_ClosedIsTerminal` |
| I-15 | COVERED | `test_SetTickSpacing_SetsOnceAndEmits` (`test/OVRFLOLending.t.sol`); spacing is set once in the suite's `setUp` and no handler action mutates it |
| I-16 | ENCODED | `invariant_CursorSoundness` — ordering **and** both monotonicity halves, against pre-action ghosts |
| I-17 | ENCODED | `invariant_CursorSoundness` (every epoch below the cursor is under the atom) |
| I-18 | ENCODED | `invariant_TreeIntegrity` — per-epoch height monotone against a pre-action ghost, plus `covGrowth` (a real 4→5 growth event every run) |
| I-19 | ENCODED | `invariant_ViewTruth` — reported claimable equals the payout, and a reported-nonzero claimable never reverts |
| I-20 | ENCODED | `invariant_ClaimCaps`, `invariant_ObligationPricing` (obligation recomputed independently per tick), `test_GrossPriceNotUnitAligned_ObligationStrictlyBelowRemaining`, `test_Borrow_ObligationTracksTheTickRate` |
| I-21 | ENCODED | `afterInvariant`'s dust bound — a closed, fully drained loan's residual `proceeds` is at most one wei per contributing position |
| I-22 | OUT-OF-SCOPE | Per-function routing fact, not a state identity. Covered by `test_Supply_RevertsAtAndAfterMaturity`, `test_Withdraw_RemainsAvailableAfterMaturity`, `test_Repay_WorksAfterMaturity`, `test_Close_WorksAfterMaturity`. The wind-down half is additionally exercised by the suite's `_maturityExcursion` (`covMaturityReached`) |
| I-23 | OUT-OF-SCOPE | Ordering inside one call; unreachable as a cross-call identity. Covered by `test_Borrow_SucceedsOneSecondBeforeMaturityRevertsAtMaturity` |
| I-24 | OUT-OF-SCOPE | Vault+reserve solvency (KD13). Covered by `test/OVRFLOInvariant.t.sol` and `test/OVRFLOWrapUnwrap.invariant.t.sol`; ticket 06 re-derives. The lending suite deploys no vault |
| X-1 | OUT-OF-SCOPE | Series-config immutability lives in `OVRFLO.setSeriesApproved`. Covered by `test_SetSeriesApproved_RevertsForDuplicateMarketConfiguration` and `test_SetSeriesApproved_RevertsForDuplicatePtRegistration` (`test/OVRFLO.t.sol`) |
| X-2 | ENCODED | `invariant_EscrowSolvency` + `invariant_TreeIntegrity` read `root() − filled` on every epoch every call; an underflow reverts the invariant, which is the failure |
| X-3 | OUT-OF-SCOPE | Constructor wiring against a write-once factory mapping; no runtime transition to fuzz. Covered by `test_Constructor_WiresRegistryAndInitialAdminState` |
| X-4 | COVERED | `test_SetTreasury_RejectsZeroAddress` (`test/OVRFLOLending.t.sol`) pins the enforceable half; "stays a live sink" is an off-chain multisig assumption |
| X-5 | OUT-OF-SCOPE | Two named token minters (`vault()`, `reserve()`). Covered by `test/OVRFLOToken.t.sol` |
| E-1 | ENCODED | `afterInvariant`'s lazy-attribution coverage — Σ overlap over the epoch's positions equals the loan's interval length, forever |
| E-2 | ENCODED | `invariant_ClaimCaps` + `invariant_ClaimEntitlementCeiling` + `invariant_PotConservation` |
| E-3 | ENCODED | `invariant_EscrowSolvency` + `invariant_TokenCustody` (both exit paths funded) |
| E-4 | ENCODED | `invariant_ClaimCaps` (obligation ≤ remaining at origination) |
| E-5 | PARTIAL | Structural half encoded (`invariant_LoanIntervalAtom`, `invariant_CursorSoundness`, `covGrowth`/`covRollover` prove growth and rollover are survivable non-events). The **economic** half — griefing costs gas proportional to the damage — is a cost claim, not a state identity: it is owned by U7's Multicall supply+withdraw gas measurement and the borrow gas-flatness pair |

Beyond the catalog, the suite also encodes: GL-70 re-pledge draw accounting; epoch isolation with the revert
selector decoded (`EpochMismatch`, not coincidental non-overlap); money recipients (borrower net, treasury
fee, withdraw refund); open-loan stream custody; and a per-run structural + liveness coverage gate.

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs below (`G-N`) are anchor targets from x-ray.md attack surfaces.

### OVRFLOReserve (wrap) and OVRFLO (vault)

G-2, G-3, G-4, and G-20 moved to `OVRFLOReserve` with CS1. G-15, G-16, G-17, and G-23 described PT flash and are **removed** with that facility.

#### G-1
`if (msg.sender != factory) revert NotAdmin()` · `OVRFLO.sol:257` · Collapses the vault's entire admin surface onto one address so authorization is the factory's problem, not a per-function role matrix (pattern #8).

#### G-2
`if (amount == 0) revert ZeroAmount()` · `OVRFLOReserve.sol` `wrap` · Keeps a no-op wrap from emitting a `Wrapped` event that indexers would treat as real flow.

#### G-3
`if (balanceAfter - balanceBefore != amount) revert TransferMismatch()` · `OVRFLOReserve.sol` `wrap` · Rejects fee-on-transfer underlying, whose short delivery would credit `wrappedUnderlying` above the reserve actually held.

#### G-4
`if (reserve < amount) revert InsufficientReserve()` · `OVRFLOReserve.sol` `unwrap` · Confines unwrap to the separately tracked wrap reserve so it cannot reach PT-backed deposits.

#### G-5
`if (info.ptToken == address(0)) revert MarketNotApproved()` · `OVRFLO.sol:624` · Single approval gate for every priced path; an unapproved market has no oracle or expiry to read.

#### G-6
`if (ptAmount < MIN_PT_AMOUNT) revert BelowMinPT()` · `OVRFLO.sol:425` · Floors deposits so the rate-split rounding cannot produce a zero-value stream.

#### G-7
`if (block.timestamp >= info.expiryCached) revert Matured()` · `OVRFLO.sol:426` · Deposits must create a stream with nonzero duration; at maturity there is nothing left to stream.

#### G-8
`if (currentDeposited + ptAmount > limit) revert DepositLimitExceeded()` · `OVRFLO.sol:433` · Per-market exposure cap; `0` is the unlimited sentinel by design.

#### G-9
`if (toUser < minToUser) revert SlippageExceeded()` · `OVRFLO.sol:442` · Caller-supplied floor against an adverse TWAP move between simulation and execution.

#### G-10
`if (toStream == 0) revert NothingToStream()` · `OVRFLO.sol:404` · The bound lockup rejects zero-amount streams; failing here gives an interpretable error instead of a foreign revert.

#### G-11
`if (!oldestObservationSatisfied) revert OracleNotReady()` · `OVRFLO.sol:395` · Runtime TWAP-freshness check; onboarding-time validation alone would let an oracle go stale post-approval.

#### G-12
`if (market == address(0)) revert UnknownPT()` · `OVRFLO.sol:480` · Reverse-lookup gate on `claim`; an unmapped PT has no series and no accounting to debit.

#### G-13
`if (block.timestamp < info.expiryCached) revert NotMatured()` · `OVRFLO.sol:483` · PT is only redeemable at maturity; claiming earlier would hand out collateral still backing live streams.

#### G-14
`if (currentDeposited < amount) revert InsufficientDeposited()` · `OVRFLO.sol` `claim` · Stops a claim from driving `marketTotalDeposited` below zero.

#### G-15

**Removed with PT flash (CS1).** Historical: `flashLoanPaused` circuit breaker.

#### G-16

**Removed with PT flash (CS1).** Historical: cap `amount <= marketTotalDeposited`.

#### G-17

**Removed with PT flash (CS1).** Historical: `FLASH_CALLBACK_SUCCESS` check.

#### G-18
`if (market == address(0)) revert UnknownPT()` · `OVRFLO.sol` `sweepExcessPt` · Input validation: a non-PT address would treat the entire balance of that token as excess (learned-fact, distinct from the rejected `to == 0` finding R-02). After CS1 this cannot drain wrap backing on the reserve.

#### G-19
`if (excess == 0) revert NoExcess()` · `OVRFLO.sol:335` · Sweep is strictly the surplus above tracked deposits; never principal.

#### G-20
`if (excess == 0) revert NoExcess()` · `OVRFLOReserve.sol` `sweepExcessUnderlying` · Same for underlying on the reserve — `wrappedUnderlying` is reserved and unsweepable.

#### G-21
`if (info.ptToken != address(0)) revert SeriesAlreadyConfigured()` · `OVRFLO.sol:301` · Series config is write-once; claims depend on `ptToken`/expiry staying fixed for the life of outstanding deposits.

#### G-22
`if (ptToMarket[pt] != address(0)) revert PtAlreadyMapped()` · `OVRFLO.sol:302` · Prevents two markets sharing one PT, which would double-count `marketTotalDeposited`.

#### G-23

**Removed with PT flash (CS1).** Historical: `FLASH_FEE_MAX_BPS` ceiling on the vault.

#### G-24
`if (ptToMarket[ptToken] == address(0)) revert UnknownPT()` · `OVRFLO.sol:578` · View-side approval gate (pattern #7: named views revert on nonexistent entities).

### OVRFLOLending (v1-lite book)

#### G-25
`if (amount == 0) revert ZeroAmount()` · `OVRFLOLending.sol:396` · Rejects the degenerate supply before it allocates a permanent tree leaf.

#### G-26
`if (amount % UNIT != 0) revert NotUnitAligned()` · `OVRFLOLending.sol:397` · The tape stores UNITs; a non-multiple would silently truncate escrowed value into the contract.

#### G-27
`if (amount < MIN_LIQUIDITY_AMOUNT) revert BelowMinimum()` · `OVRFLOLending.sol:398` · The single book atom — bounds tape-spam leaf allocation to a gas-cost problem, not a capital-free one (risk #4).

#### G-28
`if (spacing == 0) revert SpacingUnset()` · `OVRFLOLending.sol:1131` · Zero is the unset sentinel; supply and borrow stay closed until the multisig configures the ladder.

#### G-29
`if (aprBps < aprMinBps || aprBps > aprMaxBps || aprBps % spacing != 0) revert InvalidTick()` · `OVRFLOLending.sol:1132` · Confines liquidity to the owner-declared, spacing-aligned ladder so `tickDepths` enumerates every live tick.

#### G-30
`if (position.lender != msg.sender) revert NotLender()` · `OVRFLOLending.sol:435` · Withdraw authorization; also the response to a nonexistent id, whose lender is `address(0)`.

#### G-31
`if (unfilled == 0) revert NothingToWithdraw()` · `OVRFLOLending.sol:448` · Blocks the silent-no-op double withdraw (AE2) and keeps `Withdrawn` events meaningful.

#### G-32
`if (targetBorrow == 0) revert ZeroTarget()` · `OVRFLOLending.sol:487` · A zero target cannot produce a fill above the atom; failing early avoids pricing an unusable stream.

#### G-33
`if (availableUnits == 0) revert EmptyTick()` · `OVRFLOLending.sol:1104` · Distinguishes "nothing to borrow here" from a low-level tree failure (R10).

#### G-34
`if (outcome.actualBorrow < MIN_LIQUIDITY_AMOUNT) revert BelowMinimum()` · `OVRFLOLending.sol:1113` · The borrow-side atom: bounds claim-list fragmentation to `size / 0.001` loans (risk #9).

#### G-35
`if (outcome.actualBorrow - outcome.feeAmount < minAcceptable) revert BelowMinAcceptable()` · `OVRFLOLending.sol:491` · Net-proceeds floor — the borrower's only protection when a concurrent borrow takes the depth first (AE1).

#### G-36
`if (eligibility.remaining < MIN_STREAM_AMOUNT) revert BelowMinimum()` · `OVRFLOLending.sol:1149` · Keeps dust streams out of the book, where their obligations would round to nothing.

#### G-37
`if (steps == CURSOR_CAP) revert EpochBacklog()` · `OVRFLOLending.sol:961` · Bounds a single borrow's epoch scan so an inflated epoch count can never gas-starve a legitimate borrow (risk #4).

#### G-38
`if (maxSteps == 0) revert ZeroSteps()` · `OVRFLOLending.sol:552` · A zero iteration bound on the recovery valve is caller error, not a silent no-op.

#### G-39
`if (amount == 0) revert ZeroAmount()` · `OVRFLOLending.sol:596` · Zero repay would emit a `Repaid` checkpoint with no state change.

#### G-40
`if (amount > outstanding) revert RepayExceedsOutstanding()` · `OVRFLOLending.sol:599` · Caps repayment at face; overpayment would credit `proceeds` beyond what contributors are owed.

#### G-41
`if (loan.borrower == address(0)) revert LoanMissing()` · `OVRFLOLending.sol:910` · Existence gate shared by `repay`/`close`/`claim` — an empty loan struct must never read as a live one.

#### G-42
`if (loan.closed) revert LoanClosed()` · `OVRFLOLending.sol:911` · One-way terminal state; the stream has already gone back to the borrower.

#### G-43
`if (sablier.withdrawableAmountOf(streamId) < outstanding) revert NotCovered()` · `OVRFLOLending.sol:629` · Permissionless close only once the collateral genuinely covers the debt; the condition is temporal, hence its own selector.

#### G-44
`if (position.lender != msg.sender) revert NotLender()` · `OVRFLOLending.sol:667` · Claim authorization keyed to the position, not the address that happens to overlap.

#### G-45
`if (position.market != loan.market || position.aprBps != loan.aprBps || position.epoch != loan.epoch) revert EpochMismatch()` · `OVRFLOLending.sol:923-925` · The named security boundary of risk #3: leaf numbering restarts per epoch, so interval arithmetic alone cannot tell two tapes apart.

#### G-46
`if (overlap == 0) revert NoOverlap()` · `OVRFLOLending.sol:932` · A position posted entirely after a loan's fill window contributed nothing (AE9).

#### G-47
`if (payAmount == 0) revert NothingToClaim()` · `OVRFLOLending.sol:698` · Distinguishes "fully paid" from a successful zero-value transfer.

#### G-48
`if (aprMaxBps_ < aprMinBps_) revert BadAprBounds()` · `OVRFLOLending.sol:347` · Keeps the ladder non-empty and `tickDepths`' arithmetic well-formed. (Converted from a require-string in U8's KTD3 reconciliation; same condition, cheaper-equivalent revert.)

#### G-49
`if (aprMaxBps_ > APR_MAX_CEILING) revert AprTooHigh()` · `OVRFLOLending.sol:348` · 100% hard ceiling the multisig cannot exceed. (Converted from a require-string in U8's KTD3 reconciliation.)

#### G-50
`if (tickSpacing[market] != 0) revert SpacingAlreadySet()` · `OVRFLOLending.sol:362` · Set-once: re-spacing a live market would invalidate every resting position's tick.

#### G-51
`if (spacing == 0) revert ZeroSpacing()` · `OVRFLOLending.sol:361` · Zero is reserved as the unset sentinel, so it can never be a legitimate configured value.

#### G-52
`if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh()` · `OVRFLOLending.sol:371` · Bounds the only owner-mutable value that touches borrower proceeds. (Converted from a require-string in U8's KTD3 reconciliation.)

#### G-53
`if (treasury_ == address(0)) revert ZeroAddress()` · `OVRFLOLending.sol:379` · Fee transfers to the zero address would burn protocol revenue. (Converted from a require-string in U8's KTD3 reconciliation; shares the `ZeroAddress` selector with the constructor's address checks.)

#### G-54
`if (balanceAfter - balanceBefore != amount) revert TransferMismatch()` · `OVRFLOLending.sol:1185` · Rejects fee-on-transfer tokens on both the supply and repay pulls, where short delivery would over-credit the tape or the pot. (Converted from a require-string in U8's KTD3 reconciliation.)

#### G-55
`if (maxN == 0) revert ZeroSteps()` · `OVRFLOLending.sol:864` · Same zero-iteration-bound semantics as the cursor valve (reversed from `ZeroAmount` by the U5 review).

#### G-56
`if (position.lender == address(0)) revert PositionMissing()` · `OVRFLOLending.sol:866` · Position-side existence gate for the named views (mirrors `LoanMissing`).

#### G-57
`if (stored.lender == address(0)) revert PositionMissing()` · `OVRFLOLending.sol:813` · Same for `positionState` (KTD8: named views revert, auto-getters return zero).

#### G-58
`if (stored.borrower == address(0)) revert LoanMissing()` · `OVRFLOLending.sol:836` · Same for `loanState`.

#### G-59
`if (spacing == 0) revert SpacingUnset()` · `OVRFLOLending.sol:760` · Ladder view on an unconfigured market is a caller error, not an empty array.

#### G-60
`if (tickSpacing[market] == 0) revert SpacingUnset()` · `OVRFLOLending.sol:793` · `tickState` validates spacing **only** — deliberately not tick alignment or APR bounds, so positions outside the owner-mutable window stay readable.

#### G-61
`if (loan.borrower == address(0)) revert LoanMissing()` · `OVRFLOLending.sol:730` · `contributionOf` reverts rather than returning zero; the filtering scan uses the non-reverting core instead.

### TickTree

#### G-62
`if (self.height == MAX_HEIGHT) revert AtCapacity()` · `TickTree.sol:53` · Defense in depth — the contract pre-checks terminal capacity and rolls the epoch, because an internal library revert cannot be caught.

#### G-63
`if (leafIndex >= self.leaves) revert LeafMissing()` · `TickTree.sol:203` · Separates a never-appended coordinate from a legitimately zero-valued leaf.

#### G-64
`if (value > type(uint64).max) revert NodeOverflow()` · `TickTree.sol:208` · The single checked narrowing gate every stored sum routes through, including the growth root-copy (risk #1).

### StreamPricing

#### G-65
`if (ptToken_ == address(0)) revert MarketNotApproved()` · `StreamPricing.sol:179` · Shared market-approval source of truth for both vault and book.

#### G-66
`if (block.timestamp >= expiryCached_) revert SeriesMatured()` · `StreamPricing.sol:180` · The maturity gate; scoped per function by KTD7 (`supply`/`borrow` only).

#### G-67
`if (stream.sender != core) revert WrongSender()` · `StreamPricing.sol:205` · Only vault-minted streams are eligible collateral; a forged stream would price against an unbacked asset.

#### G-68
`if (stream.isCancelable) revert CancelableStream()` · `StreamPricing.sol:210` · A cancelable stream's sender could pull the collateral out from under a live loan.

*Companion stream-shape guards at `StreamPricing.sol:206` (`WrongAsset`), `:208` (`WrongEndTime`), `:209` (`CliffPresent`), `:211` (`RemainingZero`) enforce the same eligibility contract and are omitted individually for brevity.*

---

## 2. Inferred Invariants (Single-Contract)

Inferred invariants are derived from structural analysis of the source. Each block cites one of five extraction
methods in its `Derivation` field: Δ-pair analysis, guard lift, state-machine edge, temporal predicate, or a
NatSpec-stated global property.

Each block is classified by shape: `Conservation` · `Bound` · `Ratio` · `StateMachine` · `Temporal`.
Category definitions at the end of §2.

---

#### I-1

`Conservation` · On-chain: **No**

> Per tick epoch, the stored loan intervals are disjoint, contiguous, and exactly tile `[0, filled)`:
> `loanAt[k].fillEnd == loanAt[k+1].fillStart` for every `k`, `loanAt[0].fillStart == 0`, and
> `loanAt[loanCount-1].fillEnd == filled`.

**Derivation** — Δ-pair: `OVRFLOLending.sol:1103` (`outcome.fillStart = epochState.filled`) ↔ `:1120`
(`fillEnd = fillStart + fillUnits`) ↔ `:1124` (`epochState.filled = outcome.fillEnd`). `_fillTick` is the sole
write site of `filled` — confirmed by grep across `src/`. Each fill therefore begins exactly where the previous
one ended, and `loanCount` (`:1121`) indexes them in that order.

**If violated** — Lazy attribution loses its foundation: contributions computed by interval overlap would
double-count or drop lender capital, and the pro-rata claim cap would be measured against a fictitious denominator.

---

#### I-2

`Conservation` · On-chain: **No**

> Frozen history: no tape coordinate strictly below an epoch's `filled` counter ever changes value. A position's
> interval may only shrink from its right edge, and only above `filled`.

**Derivation** — Δ-pair: `OVRFLOLending.sol:442-444` computes `filledHistory = min(filled - leafStart, currentLeaf)`
↔ `:450` writes `setLeaf(leafIndex, filledHistory)`. `TickTree.setLeaf` is called from exactly one site in `src/`
(`withdraw:450`), and it can only lower a leaf to its already-consumed portion. NatSpec asserts the property
directly at `OVRFLOLending.sol:429-431` — *"The leaf is replaced with its filled history, so coordinates below
`filled` remain immutable while later unfilled coordinates compact left"*.

**If violated** — Every historical claim silently re-prices. A lender could shrink a leaf under a settled loan's
interval and re-target another lender's contribution, or `root()` could fall below `filled` and revert every
subsequent depth read (permanent tick DoS).

---

#### I-3

`Conservation` · On-chain: **No**

> Escrow solvency: `underlying.balanceOf(lending) == Σ_ticks Σ_epochs (tree.root() − filled) × UNIT`, absent
> direct donations.

**Derivation** — Δ-pair across three sites: `supply` pulls `amount` (`:402`) while appending `_toUnits(amount)`
(`:392`); `withdraw` transfers `_toWei(unfilled)` (`:433`) while shrinking the leaf by exactly `unfilled` (`:429`);
`borrow` pays out `actualBorrow` split borrower/treasury (`:493-494`) where `actualBorrow == _toWei(fillUnits)`
(`:1072`) and `filled` advances by the same `fillUnits` (`:1088`).

**If violated** — Some lender's unfilled principal is not actually held. Because withdraw is first-come, the
shortfall lands on whoever unwinds last.

---

#### I-4

`Conservation` · On-chain: **No**

> Pot conservation, per loan: `proceeds[loanId] + Σ_p received[loanId][p] == loan.drawn + loan.repaid`.

**Derivation** — Δ-pairs at every mutation site: `repay` (`:581` `loan.repaid += amount` ↔ `:583`
`proceeds += amount`), `close` (`:614` `loan.drawn = drawn` ↔ `:615` `proceeds += outstanding`), `claim` harvest
(`:682` `loan.drawn += harvestAmount` ↔ `:675` `pot += harvestAmount`), `claim` payout (`:680`
`received = receivedTotal` ↔ `:681` `proceeds = pot - payAmount`).

**If violated** — Either lenders are collectively owed more than the loan recovered (insolvency), or recovered
value strands unclaimable in the contract beyond the documented rounding dust.

---

#### I-5

`Conservation` · On-chain: **No**

> `ovrfloToken.balanceOf(lending) == Σ_loans proceeds[loanId]`, absent direct donations.

**Derivation** — Δ-pair: ovrfloToken enters only via `repay`'s pull (`:585`) and `claim`/`close`'s lockup
(`ISablierV2LockupLinear.withdraw`) harvest (`:684`, `:616`), each of which credits `proceeds` by the identical amount; it leaves only via `claim`'s
payout (`:685`), which debits `proceeds` by the identical amount (`:681`).

**If violated** — The pot accounting has desynced from real custody; claims would begin reverting on transfer
even though `proceeds` says funds are available.

---

#### I-6

`Bound` · On-chain: **Yes**

> Per (loan, position) pair, cumulative payout never exceeds the pro-rata entitlement:
> `received[loanId][positionId] ≤ contribution × recovered / (fillEnd − fillStart)`, where `recovered` is
> `drawn + repaid` plus, while open, `min(withdrawable, outstanding)`.

**Derivation** — guard-lift of `OVRFLOLending.sol:687`
(`requestAmount = min(amount, entitlement − received[loanId][positionId])`) plus `:697`
(`payAmount = pot < requestAmount ? pot : requestAmount`). Write sites of `received`: exactly one (`:701`), and it
adds `payAmount ≤ requestAmount`. The `min(withdrawable, outstanding)` clamp at `:681-682` is load-bearing, not
arithmetic detail — bare `withdrawable` on an over-vested open stream would inflate `entitlement` beyond the
loan's real recovery.

**If violated** — The first claimer on an over-vested open loan drains pot value belonging to co-lenders
(the U4-review mutation-proven theft boundary).

---

#### I-7

`Bound` · On-chain: **Yes**

> `loan.drawn + loan.repaid ≤ loan.obligation` at all times; equivalently `_outstanding` never underflows.

**Derivation** — guard-lift of `OVRFLOLending.sol:599` (`if (amount > outstanding) revert`). Write sites of
`drawn`: `close:634` (adds exactly `outstanding`, landing on equality) and `claim:703` (adds `harvestAmount`,
clamped at `:690` to `harvestCap`, itself clamped at `:681-682` to `_outstanding`). Write sites of `repaid`:
`repay:602` only, guarded. Every site is bounded by the current outstanding.

**If violated** — `_outstanding` (`:915`) reverts on underflow, bricking `repay`, `close`, and every open-loan
`claim` for that loan.

---

#### I-8

`Bound` · On-chain: **Yes**

> Every loan's fill interval is at least the book atom: `fillEnd − fillStart ≥ MIN_LIQUIDITY_AMOUNT / UNIT`.

**Derivation** — guard-lift of `OVRFLOLending.sol:1113`
(`if (outcome.actualBorrow < MIN_LIQUIDITY_AMOUNT) revert BelowMinimum()`). Write sites of `fillStart`/`fillEnd`:
`_fillTick` only (`:1103`, `:1120`), consumed by the single `loans[loanId] = Loan{...}` assignment at `:494-507`.

**If violated** — Dust borrows fragment a lender's filled capital across unboundedly many tiny loans, inflating
claim-discovery and claim gas (risk #9).

---

#### I-9

`Bound` · On-chain: **No**

> Every position's leaf is either zero or at least `MIN_LIQUIDITY_AMOUNT / UNIT` — **contradicted by design**.

**Derivation** — guard-lift of `OVRFLOLending.sol:398`
(`if (amount < MIN_LIQUIDITY_AMOUNT) revert BelowMinimum()`). Write sites of leaf values: `append` via
`supply:413` (guarded) and `setLeaf` via `withdraw:450` (**unguarded** — writes `filledHistory`, any value in
`[0, currentLeaf)`). The unguarded site is intentional: a partially consumed position must shrink to exactly its
filled history, which is not atom-aligned.

**If violated** — Nothing. Recorded because the guard-lift surfaces it: sub-atom leaves are a reachable, correct
state, so no invariant may assume leaves are atom-sized. Consumers must not treat "leaf < atom" as corruption.

---

#### I-10

`Bound` · On-chain: **Yes**

> All tape quantities are exact UNIT multiples: leaves, prefix sums, `filled`, and both loan fill coordinates are
> integral UNIT counts.

**Derivation** — guard-lift of `OVRFLOLending.sol:397` (`if (amount % UNIT != 0) revert NotUnitAligned()`).
Write sites: `append(_toUnits(amount))` (`:413`, exact because the guard forces divisibility);
`setLeaf(filledHistory)` (`:450`, already a UNIT count); `filled = fillStart + fillUnits` (`:1124`, UNIT counts).
Conversion is confined to `_toUnits` (`:1164`) and `_toWei` (`:1169`), with one recorded exception — the borrow
target floor is inlined at `:1106` so an oversized target partial-fills instead of reverting.

**If violated** — Wei-level residue would accumulate in the tape, and `_toWei(_toUnits(x)) == x` would stop
holding for escrowed amounts, breaking I-3.

---

#### I-11

`Bound` · On-chain: **Yes**

> `aprMinBps ≤ aprMaxBps ≤ APR_MAX_CEILING (10_000)`.

**Derivation** — guard-lift of `OVRFLOLending.sol:347-348`. Write sites of `aprMinBps`/`aprMaxBps`: the
constructor (`:334-335`, both `launchAprBps`, guarded by `BadLaunchApr`) and `setAprBounds`
(`:350-351`, guarded). No other writer.

**If violated** — `tickDepths`' rung count arithmetic (`:770`) would underflow, and the ladder view would revert.

---

#### I-12

`Bound` · On-chain: **Yes**

> `feeBps ≤ MAX_FEE_BPS (10_000)`, so `feeAmount ≤ actualBorrow` and the borrower's net proceeds never underflow.

**Derivation** — guard-lift of `OVRFLOLending.sol:371`. Write sites of `feeBps`: `setFee:372` only (the
constructor leaves it at the zero default). The bound is what makes the `actualBorrow - feeAmount` subtraction at
`:491` and `:514` safe.

**If violated** — `borrow` reverts on underflow for every caller — a total book DoS.

---

#### I-13

`Bound` · On-chain: **Yes**

> `TickTree` node sums never exceed `uint64`, at every level including the growth root-copy.

**Derivation** — guard-lift of `TickTree.sol:208` (`if (value > type(uint64).max) revert NodeOverflow()`).
Write sites of node words: `_writeNode` only (`:187`), which routes its value through `_toUint64` at `:188`;
`_grow`'s root-copy (`:129`) and `_replaceLeaf`'s per-level updates (`:149`) both go through that one gate, and
`_replaceLeaf` additionally pre-checks the prospective root at `:138`.

**If violated** — Packed-node aliasing: a sum wider than 64 bits would corrupt the three neighbouring nodes
sharing its storage word, silently falsifying every prefix query below it (risk #1).

---

#### I-14

`StateMachine` · On-chain: **Yes**

> `loan.closed` is a one-way latch: `false → true`, with no path back.

**Derivation** — edge: `closed:false@OVRFLOLending.sol:498` → `true@:603` (full repay) and `true@:631`
(permissionless close). `_liveLoan:911` rejects any subsequent servicing call. Grep confirms no site assigns
`closed = false` after construction.

**If violated** — A returned stream could be re-drawn against a loan that already released its collateral.

---

#### I-15

`StateMachine` · On-chain: **Yes**

> `tickSpacing[market]` is a one-shot latch: `0 → nonzero`, never mutated.

**Derivation** — edge: `if (tickSpacing[market] != 0) revert SpacingAlreadySet()` at `:362` → `tickSpacing[market] = spacing` at `:364`.
That assignment is the sole write site of the mapping across `src/`.

**If violated** — Re-spacing a live market would strand every resting position at a tick that `_validateTick`
(`:1132`) no longer accepts and `tickDepths` (`:770`) no longer enumerates.

---

#### I-16

`StateMachine` · On-chain: **Yes**

> `tick.oldestLiveEpoch ≤ tick.currentEpoch`, and both are monotonically non-decreasing.

**Derivation** — edge: `currentEpoch` advances only at `:409` (`epoch += 1`), `oldestLiveEpoch` only at
`:969` (`_selectEpoch`) and `:570` (`advanceEpochCursor`). Both advance loops carry the explicit bound
`epoch < currentEpoch` (`:960`) / `cursor < currentEpoch` (`:560`), so the cursor can never pass the writing epoch.

**If violated** — The cursor would point past `currentEpoch` at an epoch with no tree, making every borrow read
`root() == 0` and revert `EmptyTick` permanently.

---

#### I-17

`StateMachine` · On-chain: **Yes**

> Below the cursor, every epoch is exhausted: for all `e < oldestLiveEpoch`, available depth
> `root() − filled < MIN_LIQUIDITY_AMOUNT / UNIT`.

**Derivation** — edge: both advance loops break on `root() − filled >= MIN_LIQUIDITY_UNITS`
(`advanceEpochCursor:562`, `_selectEpoch:960`), so an epoch is stepped over only while it fails that predicate.
Frozen history (I-2) means a skipped epoch's depth can never grow again — `supply` always appends to
`currentEpoch` (`:404-413`), never to a passed one.

**If violated** — Borrowable liquidity would be silently skipped, and `tickDepths` (which sums from
`oldestLiveEpoch`, `:1042`) would under-report the ladder.

---

#### I-18

`StateMachine` · On-chain: **Yes**

> `tree.height` climbs monotonically `0 → 4 → 5 → 6 → 7` and never shrinks; `tree.leaves` only increases, so leaf
> indices are permanent.

**Derivation** — edge: `height` is written at `TickTree.sol:50` (`0 → MIN_HEIGHT`) and `:128`
(`oldHeight + 1`, inside `_grow`) — no decrementing site. `leaves` is written only at `:60`
(`leafIndex + 1`). Growth reads the old root at `:127` *before* the height write at `:128`, so the root-copy
observes the pre-growth tree (risk #2 ordering proof).

**If violated** — A position's `leafIndex` would address a different coordinate after growth, and every prior
prefix sum would change — the direct contradiction of AE6.

---

#### I-19

`Ratio` · On-chain: **Yes**

> `claim`'s payout and `loansOf`'s reported `claimable` are computed by the same formula against the same state,
> so the view mirror can never diverge from the money path.

**Derivation** — Ratio: `entitlement = mulDiv(overlap, recovered, fillEnd − fillStart)` appears at
`OVRFLOLending.sol:686` (money path) and identically at `:1033` (`_claimableOf`, view path), each subtracting
`received[loanId][positionId]` (`:687`, `:1035`). Both snapshot `recovered` before any write in their frame.
NatSpec pins the intent at `:1019-1023` — *"Kept arithmetic-identical to `claim`; the test suite pins the two
together by asserting a subsequent max-claim pays exactly this value."*

**If violated** — Claim discovery lies. A frontend would show claimable value that the money path refuses to pay,
or hide value a lender is owed.

---

#### I-20

`Ratio` · On-chain: **Yes**

> `obligation ≤ remaining` for every loan: a pledged stream always covers the debt it backs.

**Derivation** — Ratio: `grossPrice = mulDiv(remaining, WAD, factor)` floors (`StreamPricing.sol:111`) while
`obligation = mulDiv(borrowAmount, factor, WAD, Rounding.Up)` ceils (`:126`). `_fillTick` caps the fill at the
gross price (`OVRFLOLending.sol:1109-1112`), which is `obligationForFill`'s documented call-site precondition;
at exact equality the fast path returns `remaining` verbatim (`StreamPricing.sol:147-149`), sidestepping the
floor/ceil boundary entirely.

**If violated** — `close` could never gather enough from the stream to satisfy the outstanding, leaving loans
permanently open and lenders permanently short.

---

#### I-21

`Ratio` · On-chain: **No**

> Closed-loan dust bound: for a closed loan, the sum of all contributors' shortfalls versus exact pro-rata is at
> most one wei per contributing position.

**Derivation** — Ratio: `mulDiv` at `:686` floors, and floor division loses strictly less than one wei per
evaluated pair. NatSpec states the destination at `:234-235` — *"Rounding dust is lender-unfavorable and strands
here by design (plan risk #5)"*.

**If violated** — Dust is accumulating faster than floor division explains, which means the entitlement
denominator or the `received` cap has drifted.

---

#### I-22

`Temporal` · On-chain: **Yes**

> `supply` and `borrow` are gated on `block.timestamp < seriesMaturity`; `withdraw`, `repay`, `close`, and
> `claim` never are.

**Derivation** — temporal: `if (block.timestamp >= expiryCached_) revert SeriesMatured()`
(`StreamPricing.sol:180`), reached from `supply` via `_requireMarketActive` (`OVRFLOLending.sol:401`, function
defined at `:1136-1137`) and from `borrow` via `_requireEligible` → `requireEligible` → `marketActive` (`:1148`).
Grep confirms the four wind-down functions call neither helper. The asymmetry is KTD7, not an omission.

**If violated** — Either a matured series accepts new liquidity that can never be borrowed against, or a matured
series traps existing lenders and borrowers who need to unwind.

---

#### I-23

`Temporal` · On-chain: **Yes**

> `timeToMaturity` is computed only after maturity has been checked, so its subtraction cannot underflow.

**Derivation** — temporal: `_priceStream:1158` calls `_requireEligible` (which enforces
`block.timestamp < expiryCached` at `StreamPricing.sol:180`) *before* computing
`timeToMaturity = eligibility.seriesMaturity - block.timestamp` at `:1159`. Checked-then-computed ordering, not
computed-then-checked.

**If violated** — Every borrow at or past maturity would revert with an arithmetic panic instead of the
interpretable `SeriesMatured`.

---

#### I-24

`Conservation` · On-chain: **No**

> Column dual-backing solvency (KD13): `ovrfloToken.totalSupply() ≤ Σ_pt.balanceOf(vault) + underlying.balanceOf(reserve)`. Per-origin: `totalSupply == Σ marketTotalDeposited + reserve.wrappedUnderlying`.

**Derivation** — Δ-pair across the four mint/burn sites: `wrap` (`OVRFLOReserve` `wrappedUnderlying += amount` ↔ mint), `unwrap` (counter ↔ burn), `deposit` (`marketTotalDeposited` ↔ mint of net toUser + fee + toStream == ptAmount), `claim` (deposited ↔ burn). The *combined* form is the correct one — the individual legs are too strict post-maturity, where cross-exits are a design feature. Ticket 06 re-derives the suite; until then this identity is pinned, not re-derived.

**If violated** — Some ovrfloToken holder cannot exit through any path.

---

**Categories:**
- **Conservation**: Two or more storage variables change by equal-and-opposite amounts in the same function body.
- **Bound**: A guard on a storage variable, lifted to a global property and checked across every write site.
  On-chain=**No** if any write site lacks the equivalent guard.
- **Ratio**: A storage variable is defined as a formula of other storage variables.
- **StateMachine**: A storage variable transitions through discrete values with guards preventing reversal.
- **Temporal**: A condition depends on `block.timestamp`, `block.number`, or a duration/deadline variable.

---

## 3. Inferred Invariants (Cross-Contract)

Trust assumptions that span contract boundaries. Each block cites both caller-side and callee-side code inside
the scope files.

---

#### X-1

On-chain: **Yes**

> `OVRFLOLending` assumes a market's series configuration (`ptToken`, `expiryCached`, `ovrfloToken`) is immutable
> once set, so a loan's obligation and a stream's eligibility mean the same thing at claim time as at borrow time.

**Caller side** — `OVRFLOLending.sol:1137` (`_requireMarketActive` → `StreamPricing.marketActive`) and `:1148`
(`_requireEligible` → `StreamPricing.requireEligible`), both reading `IOVRFLOSeriesRegistry(core).series(market)`.

**Callee side** — `OVRFLO.sol:300-307` is the only writer of `_series[market]`, and `:301`
(`if (info.ptToken != address(0)) revert SeriesAlreadyConfigured()`) makes it write-once. No update path exists.

**If violated** — A re-pointed series would let the book price a stream against one maturity and settle it
against another.

---

#### X-2

On-chain: **Yes**

> `OVRFLOLending` assumes `tree.root() ≥ filled` for every epoch, so available depth
> (`root() − filled`) never underflows.

**Caller side** — `OVRFLOLending.sol:956` (`_selectEpoch`), `:562` (`advanceEpochCursor`), `:1044`
(`_liveDepthUnits`) all subtract without a guard.

**Callee side** — `TickTree` root only decreases through `setLeaf`, whose sole `src/` caller is `withdraw:450`,
and that call passes `filledHistory` computed at `:442-444` as `min(filled − leafStart, currentLeaf)` — never
below the position's consumed portion. `append:59` only increases the root.

**If violated** — Every depth read for that tick reverts on underflow: a permanent, unrecoverable tick DoS
affecting borrow, the cursor valve, and the ladder view alike.

---

#### X-3

On-chain: **Yes**

> `OVRFLOLending` assumes its cached `underlying` and `ovrfloToken` immutables match the vault the factory
> registered.

**Caller side** — `OVRFLOLending.sol:317-333` reads `factory.ovrfloInfo(core_)` once in the constructor and
stores the results as immutables; every fund flow (`:423`, `:454`, `:606`, `:706`) uses them without re-validation.

**Callee side** — `OVRFLOFactory.sol:155` (`ovrfloInfo[ovrflo] = OvrfloInfo({...})`) is the only writer of that
mapping, executed once inside `registerOvrflo()` after checks confirm the candidate's `factory()`/`oracle()`
immutables match this factory. No setter exists, so the read cannot go stale.

**If violated** — Lending would escrow one token and pay out another. Note this is the **strengthened** successor
to the pre-rewrite `X-2` (then On-chain=No): the write-once property of `ovrfloInfo` is what upgrades it.

---

#### X-4

On-chain: **No**

> `OVRFLOLending.treasury` is assumed to remain a live fee sink, but unlike `underlying`/`ovrfloToken` it is
> mutable after construction.

**Caller side** — `OVRFLOLending.sol:515` (`_payUnderlying(treasury, outcome.feeAmount)`) reads current storage
on every borrow.

**Callee side** — `OVRFLOLending.sol:380` (`treasury = treasury_`), reachable through
`OVRFLOFactory.setLendingTreasury:303`. Guarded against the zero address (`:379`) but nothing else; the
constructor's factory-derived value (`:331`) is not re-checked afterward.

**If violated** — Fees route to a stale or wrong address. Bounded by the multisig trust model, which is why the
guard stops at the zero-address check.

---

#### X-5

On-chain: **Yes**

> `OVRFLO` assumes exclusive mint/burn authority over its `OVRFLOToken`.

**Caller side** — `OVRFLO.sol:371`, `:385`, `:452-453`, `:490` call `mint`/`burn` unconditionally.

**Callee side** — `OVRFLOToken.sol:30`/`:34` gate `mint`/`burn` on `onlyOwner`; `owner` (`:19`) is `immutable`,
assigned to `msg.sender` in the constructor (`:27`) — the OVRFLO vault that constructs the token
(`OVRFLO.sol:290`, `ovrfloToken = address(new OVRFLOToken(name_, symbol_))`). No `transferOwnership` or
`renounceOwnership` exists (deleted under Decision 8, 2026-08-11), so authority cannot move after construction.
`OVRFLOFactory.registerOvrflo` performs no token-ownership check: under Decision 7(a) the vault constructs its
own token, so `token.owner() == vault` holds by construction for canonical bytecode — registration verifies the
vault's other bindings (`factory()`, `oracle()`, duplicate-underlying) instead.

**If violated** — ovrfloToken supply could be inflated outside the vault's accounting, breaking I-24.

---

## 4. Economic Invariants

Higher-order properties derived from combinations of §2 and §3. Every block traces back to concrete IDs.

---

#### E-1

On-chain: **No**

> Lazy attribution is exact forever: a lender's contribution to a loan, computed at any future time from interval
> overlap, equals the capital that loan actually consumed from that position at fill time.

**Follows from** — `I-1` (intervals tile `[0, filled)`) + `I-2` (frozen history) + `X-2` (root never falls below
filled).

**If violated** — Every claim in the protocol is computed against a fabricated contribution. This is the
load-bearing property of the whole v1-lite design and the one the Definition of Done marks for formal
verification.

---

#### E-2

On-chain: **No**

> No lender can extract more than their pro-rata share of what a loan actually recovered, in any claim ordering.

**Follows from** — `I-6` (per-pair cap) + `I-4` (pot conservation) + `I-19` (view/money-path identity).

**If violated** — Claim becomes a race: the first caller on an over-vested open loan takes co-lenders' value
(pattern #12's failure mode, previously shipped as audit finding M-01).

---

#### E-3

On-chain: **No**

> Every lender can always exit: filled capital returns through `claim`, unfilled capital through `withdraw`, and
> the contract holds enough of each token to honour both.

**Follows from** — `I-3` (escrow solvency) + `I-5` (pot custody) + `I-22` (wind-down functions are never
maturity-gated).

**If violated** — A matured or fully drained market traps lender principal with no recovery path.

---

#### E-4

On-chain: **Yes**

> Collateral always covers debt: no loan can be originated whose obligation exceeds the pledged stream's
> remaining face value.

**Follows from** — `I-20` (obligation ≤ remaining) + `I-7` (drawn + repaid ≤ obligation) + `G-43` (close only
once withdrawable covers outstanding).

**If violated** — Self-repaying loans stop being self-repaying, and the protocol acquires the bad-debt and
liquidation machinery it was designed to structurally avoid.

---

#### E-5

On-chain: **No**

> Book griefing is gas-bounded, never capital-bounded: forcing tape growth, epoch rollover, or claim-list
> fragmentation costs the attacker gas proportional to the damage and returns them no value.

**Follows from** — `I-8` (borrow atom) + `I-9` (supply atom, and its documented withdraw-side exception) +
`I-16`/`I-17` (cursor soundness) + `G-37` (`CURSOR_CAP` bounds any single borrow's scan).

**If violated** — One MIN-sized amount cycled through supply/withdraw could inflate the tape or the epoch count
without proportional cost, degrading the book for everyone at near-zero attacker expense (risk #4).
