# Entry Point Map

> OVRFLO | CS1 column | refreshed 2026-09-02 on `ticket/08`

PT flash (`OVRFLO.flashLoan`) is **removed**. Wrap and unwrap live on `OVRFLOReserve`. Lending value flow is ovrfloToken. Counts exclude inherited OZ surfaces enumerated at the end (ERC20 transfer family, `Ownable2Step`, `Multicall`, `ERC20Permit`).

---

## Protocol Flow Paths

### Setup (Multisig → Factory)

`new OVRFLOFactory(...)` → deploy OVRFLO Streams lockup+comptroller+descriptor → `setOvrfloStream()` →
`new OVRFLO(..., stream)` (nested: vault → reserve → token) → `registerOvrflo()` (writes `ovrfloToReserve`) →
`new OVRFLOLending(..., stream, launchAprBps)` → `registerLending()` →
`prepareOracle()` → `addMarket()` → `setLendingTickSpacing()`
                                                                                                     └─→ `setLendingAprBounds()` / `setLendingFee()` / `setLendingTreasury()` / `setLendingRouter()`
                                                                                                     └─→ `setStreamNFTDescriptor()` (art swap; only lockup admin forwarder)

### Vault user flow (depositor)

`[setup above]` → `OVRFLO.deposit()` ◄── market approved, oracle fresh, pre-maturity
                       ├─→ receives ovrfloToken + OVRFLO Stream NFT (`ISablierV2LockupLinear.createWithDurations`)
                       ├─→ `OVRFLO.claim()` ◄── post-maturity only
                       └─→ [stream becomes lending collateral, below]

### Reserve user flow (wrapper)

`OVRFLOReserve.wrap()` ⇄ `OVRFLOReserve.unwrap()` ◄── bounded by `wrappedUnderlying`, no maturity gate. PT flash is removed.

### Lender flow (book)

`[setLendingTickSpacing above]` → `OVRFLOLending.supply()` ◄── pre-maturity, UNIT-aligned, ≥ atom
                                            ├─→ `withdraw()` ◄── unfilled remainder only; never maturity-gated
                                            └─→ `claim(loanId, positionId)` ◄── requires a borrow to have crossed
                                                                                 this position's interval

### Borrower flow (book)

`[supply above]` → `OVRFLOLending.borrow()` ◄── depth exists at the tick, stream eligible, net ≥ minAcceptable
                              ├─→ `repay()` ◄── permissionless; at face; full repay returns the stream
                              └─→ `close()` ◄── permissionless; stream withdrawable must cover outstanding

### Maintenance (anyone / keeper)

`[borrow above]` → [epochs drain below the atom] → `advanceEpochCursor()` ◄── recovery valve past `CURSOR_CAP`

---

## Permissionless

### `OVRFLOLending.supply()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Lender |
| Parameters | `market` (user-controlled), `aprBps` (user-controlled), `amount` (user-controlled) |
| Call chain | `→ OVRFLOLending._validateTick() → OVRFLOLending._requireMarketActive() → StreamPricing.marketActive() → OVRFLO.series()` then `→ TickTree.append() → IERC20.safeTransferFrom()` |
| State modified | `ticks[market][aprBps].currentEpoch`, epoch tree nodes/leaves, `positions`, `lenderPositionCount`, `lenderPositionAt`, `nextPositionId` |
| Value flow | in — ovrfloToken: lender → lending |
| Reentrancy guard | yes |

### `OVRFLOLending.borrow()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Borrower |
| Parameters | `market` (user-controlled), `aprBps` (user-controlled), `targetBorrow` (user-controlled), `streamId` (user-controlled), `minAcceptable` (user-controlled), `onBehalfOf` (ignored unless `msg.sender` is the router) |
| Call chain | `→ OVRFLOLending._fillTick() → StreamPricing.requireEligible() → ISablierV2LockupLinear.getStream()` then `→ StreamPricing.grossPrice() → StreamPricing.obligationForFill() → TickTree.root() → ISablierV2LockupLinear.transferFrom() → IERC20.safeTransfer()` |
| State modified | `ticks[...].epochs[e].filled`, `.loanCount`, `tick.oldestLiveEpoch`, `loans`, `loanAt`, `borrowerLoanCount`, `borrowerLoanAt`, `nextLoanId` |
| Value flow | in — OVRFLO Stream NFT: borrower → lending; out — ovrfloToken: lending → borrower + treasury |
| Reentrancy guard | yes |

### `OVRFLOLending.repay()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone (third-party repay is a strict donation; the stream always returns to `loan.borrower`) |
| Parameters | `loanId` (user-controlled), `amount` (user-controlled) |
| Call chain | `→ OVRFLOLending._liveLoan() → OVRFLOLending._outstanding() → IERC20.safeTransferFrom() → ISablierV2LockupLinear.transferFrom()` |
| State modified | `loans[loanId].repaid`, `.closed`, `proceeds[loanId]` |
| Value flow | in — ovrfloToken: caller → lending; out — OVRFLO Stream NFT: lending → borrower (on full repay) |
| Reentrancy guard | yes |

### `OVRFLOLending.close()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone / keeper |
| Parameters | `loanId` (user-controlled) |
| Call chain | `→ OVRFLOLending._liveLoan() → ISablierV2LockupLinear.withdrawableAmountOf() → ISablierV2LockupLinear.withdraw() → ISablierV2LockupLinear.transferFrom()` |
| State modified | `loans[loanId].closed`, `.drawn`, `proceeds[loanId]` |
| Value flow | in — ovrfloToken: lockup → lending; out — OVRFLO Stream NFT: lending → borrower |
| Reentrancy guard | yes |

### `OVRFLOLending.advanceEpochCursor()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone / keeper |
| Parameters | `market` (user-controlled), `aprBps` (user-controlled), `maxSteps` (user-controlled) |
| Call chain | `→ TickTree.root()` |
| State modified | `ticks[market][aprBps].oldestLiveEpoch` |
| Value flow | none |
| Reentrancy guard | yes |

### `OVRFLO.deposit()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Depositor |
| Parameters | `market` (user-controlled), `ptAmount` (user-controlled), `minToUser` (user-controlled) |
| Call chain | `→ OVRFLO._approvedRate() → IPendleOracle.getOracleState() → IPendleOracle.getPtToSyRate()` then `→ IERC20.safeTransferFrom() → OVRFLOToken.mint() → ISablierV2LockupLinear.createWithDurations()` |
| State modified | `marketTotalDeposited[market]` |
| Value flow | in — PT + underlying fee; out — ovrfloToken mint + OVRFLO Stream to depositor |
| Reentrancy guard | no |

### `OVRFLO.claim()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | ovrfloToken holder |
| Parameters | `ptToken` (user-controlled), `amount` (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20.safeTransfer()` |
| State modified | `marketTotalDeposited[market]` |
| Value flow | out — PT: vault → claimer (1:1 against burned ovrfloToken) |
| Reentrancy guard | no |

### `OVRFLOReserve.wrap()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Anyone |
| Parameters | `amount` (user-controlled) |
| Call chain | `→ IERC20.safeTransferFrom() → OVRFLOToken.mint() → _requirePeg()` |
| State modified | `wrappedUnderlying` |
| Value flow | in — underlying: user → reserve; out — ovrfloToken mint |
| Reentrancy guard | no (peg check at end) |

### `OVRFLOReserve.unwrap()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | ovrfloToken holder |
| Parameters | `amount` (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20.safeTransfer() → _requirePeg()` |
| State modified | `wrappedUnderlying` |
| Value flow | out — underlying: reserve → user (1:1 against burned ovrfloToken) |
| Reentrancy guard | no (peg check at end) |

PT flash (`OVRFLO.flashLoan`) is **removed**. Do not list it as a live vault entry point.

---

## Role-Gated

### `position.lender`

#### `OVRFLOLending.withdraw()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, `if (position.lender != msg.sender) revert NotLender()` |
| Caller | The position's lender |
| Parameters | `positionId` (user-controlled) |
| Call chain | `→ TickTree.prefix() → TickTree.leaf() → TickTree.setLeaf() → IERC20.safeTransfer()` |
| State modified | epoch tree leaf + ancestor nodes |
| Value flow | out — underlying: lending → lender (unfilled remainder only) |
| Reentrancy guard | yes |

#### `OVRFLOLending.claim()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant, `if (position.lender != msg.sender) revert NotLender()` |
| Caller | The position's lender |
| Parameters | `loanId` (user-controlled), `positionId` (user-controlled), `amount` (user-controlled; `type(uint128).max` claims everything) |
| Call chain | `→ OVRFLOLending._overlapUnits() → TickTree.prefix() → ISablierV2LockupLinear.withdrawableAmountOf() → ISablierV2LockupLinear.withdraw() → IERC20.safeTransfer()` |
| State modified | `received[loanId][positionId]`, `proceeds[loanId]`, `loans[loanId].drawn` |
| Value flow | in — ovrfloToken harvested from the stream; out — ovrfloToken: lending → lender |
| Reentrancy guard | yes |

---

## Admin-Only

All rows below are `onlyOwner` (factory, itself owned by a timelocked multisig) or `onlyAdmin` (the factory, for
vault functions). No operational timelock exists on the contracts themselves — the delay lives in the multisig.

| Contract | Function | Parameters | State Modified |
|----------|----------|------------|----------------|
| OVRFLOFactory | `registerOvrflo()` | ovrflo (externally deployed) | `ovrflos`, `ovrfloCount`, `ovrfloInfo`, `underlyingToOvrflo`, `ovrfloToReserve`; verifies factory/oracle/stream, token minters, reserve wiring |
| OVRFLOFactory | `registerLending()` | lending (externally deployed) | `ovrfloToLending`, `lendingToOvrflo`, `lendings`, `lendingCount`; verifies `factory()`/`owner()`/`sablier()==ovrfloStream` (and vault match) and 1:1 vault mapping before registering |
| OVRFLOFactory | `replaceLending()` | newLending | `ovrfloToLending` points at the new market; old market stays in `lendings` / `lendingToOvrflo` |
| OVRFLOFactory | `setLendingRouter()` | lending, router | forwards `setRouter`; records outgoing nonzero router in `priorRouterCount` / `priorRouterAt` / `isPriorRouter`; zero disables |
| OVRFLOFactory | `setOvrfloStream()` | stream (once) | `ovrfloStream`; checks lockup `factory()`/`admin()` and comptroller `admin()`; reverts on second call |
| OVRFLOFactory | `setStreamNFTDescriptor()` | descriptor | forwards `setNFTDescriptor` to `ovrfloStream`; **only** lockup admin forwarder |
| OVRFLOFactory | `addMarket()` | ovrflo, market, twapDuration, feeBps | `isMarketApproved`, `approvedMarketAt`, `approvedMarketCount`; forwards to `OVRFLO.setSeriesApproved` |
| OVRFLOFactory | `setMarketDepositLimit()` | ovrflo, market, limit | forwards to vault |
| OVRFLOFactory | `sweepExcessPt()` | ovrflo, ptToken, to | forwards to vault |
| OVRFLOFactory | `sweepExcessUnderlying()` | ovrflo, to | forwards to `OVRFLOReserve` via `ovrfloToReserve` |
| OVRFLOFactory | `prepareOracle()` | market, twapDuration | calls `IPendleMarket.increaseObservationsCardinalityNext` |
| OVRFLOFactory | `setLendingAprBounds()` | lending, aprMinBps, aprMaxBps | forwards to lending |
| OVRFLOFactory | `setLendingFee()` | lending, feeBps | forwards to lending |
| OVRFLOFactory | `setLendingTreasury()` | lending, treasury | forwards to lending |
| OVRFLOFactory | `setLendingTickSpacing()` | lending, market, spacing | forwards to lending (set-once per market) |
| OVRFLO | `setSeriesApproved()` | market, pt, twapDuration, expiry, feeBps | `_series[market]`, `ptToMarket[pt]` (write-once) |
| OVRFLO | `setMarketDepositLimit()` | market, limit | `marketDepositLimits[market]` |
| OVRFLO | `sweepExcessPt()` | ptToken, to | transfers surplus PT above `marketTotalDeposited` |
| OVRFLOReserve | `sweepExcessUnderlying()` | to | transfers surplus underlying above `wrappedUnderlying` |
| OVRFLOLending | `setAprBounds()` | aprMinBps, aprMaxBps | `aprMinBps`, `aprMaxBps` |
| OVRFLOLending | `setTickSpacing()` | market, spacing | `tickSpacing[market]` (set-once) |
| OVRFLOLending | `setFee()` | feeBps | `feeBps` |
| OVRFLOLending | `setTreasury()` | treasury | `treasury` |
| OVRFLOLending | `setRouter()` | router | `router` |
| OVRFLOToken | `mint()` | to, amount | balances, totalSupply (vault or reserve) |
| OVRFLOToken | `burn()` | from, amount | balances, totalSupply (vault or reserve) |

### Unreachable lockup / comptroller admin (intentional)

The factory is `initialAdmin` on the lockup and comptroller. `Adminable` is one-step. The factory has **no**
`transferAdmin` forwarder. Protocol fees are immutable at zero by construction (SC13). These `onlyAdmin` calls
on the fork therefore cannot succeed for anyone through the factory, and cannot succeed for the Safe directly:

- `setProtocolFee` / `setFlashFee` / `toggleFlashAsset` / `setComptroller` / `claimProtocolRevenues`
- `transferAdmin` on the lockup or the comptroller (Safe is not admin; factory never forwards it)

The live factory forwarder for stream admin is `setStreamNFTDescriptor` only.

---

## Inherited Surfaces (not counted above)

- `OVRFLOToken`: standard OZ `ERC20` — `transfer`, `transferFrom`, `approve` (permissionless, unmodified).
- `OVRFLOFactory`, `OVRFLOLending`: OZ `Ownable2Step` — `transferOwnership` / `renounceOwnership` (onlyOwner),
  `acceptOwnership` (gated to `pendingOwner` by an internal `msg.sender` check, not a modifier).
- `OVRFLOLending`: OZ `Multicall.multicall()` — a permissionless self-`delegatecall` dispatcher. It grants no
  authority of its own; every batched call re-enters a guarded entry point above. This is the deliberate
  claim-batching answer (no bespoke batch functions).
