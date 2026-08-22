# Entry Point Map

> OVRFLO | 40 entry points | 10 permissionless | 2 role-gated | 28 admin-only

Regenerated 2026-08-10 at `f0661ab` (`codex/lending-v1-lite`) over the v1-lite lending rewrite; stream-admin
rows (`setOvrfloStream`, `setStreamNFTDescriptor`) added 2026-08-15 with the OVRFLO Streams rebind. Counts exclude
inherited OZ surfaces enumerated at the end (ERC20 transfer family, `Ownable2Step`, `Multicall`).

---

## Protocol Flow Paths

### Setup (Multisig → Factory)

`new OVRFLOFactory(...)` → deploy OVRFLO Streams lockup+comptroller+descriptor → `setOvrfloStream()` →
`new OVRFLO(..., stream)` → `registerOvrflo()` → `new OVRFLOLending(..., stream, launchAprBps)` → `registerLending()` →
`prepareOracle()` → `addMarket()` → `setLendingTickSpacing()`
                                                                                                     └─→ `setLendingAprBounds()` / `setLendingFee()` / `setLendingTreasury()`
                                                                                                     └─→ `setStreamNFTDescriptor()` (art swap; only lockup admin forwarder)

### Vault user flow (depositor)

`[setup above]` → `OVRFLO.deposit()` ◄── market approved, oracle fresh, pre-maturity
                       ├─→ receives ovrfloToken + OVRFLO Stream NFT (`ISablierV2LockupLinear.createWithDurations`)
                       ├─→ `OVRFLO.claim()` ◄── post-maturity only
                       └─→ [stream becomes lending collateral, below]

`OVRFLO.wrap()` ⇄ `OVRFLO.unwrap()` ◄── bounded by the separately tracked wrap reserve, no maturity gate

`OVRFLO.flashLoan()` ◄── not paused, pre-maturity, amount ≤ marketTotalDeposited

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
| Value flow | in — underlying: lender → lending |
| Reentrancy guard | yes |

### `OVRFLOLending.borrow()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Borrower |
| Parameters | `market` (user-controlled), `aprBps` (user-controlled), `targetBorrow` (user-controlled), `streamId` (user-controlled), `minAcceptable` (user-controlled) |
| Call chain | `→ OVRFLOLending._fillTick() → StreamPricing.requireEligible() → ISablierV2LockupLinear.getStream()` then `→ StreamPricing.grossPrice() → StreamPricing.obligationForFill() → TickTree.root() → ISablierV2LockupLinear.transferFrom() → IERC20.safeTransfer()` |
| State modified | `ticks[...].epochs[e].filled`, `.loanCount`, `tick.oldestLiveEpoch`, `loans`, `loanAt`, `borrowerLoanCount`, `borrowerLoanAt`, `nextLoanId` |
| Value flow | in — OVRFLO Stream NFT: borrower → lending; out — underlying: lending → borrower + treasury |
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

### `OVRFLO.wrap()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Anyone |
| Parameters | `amount` (user-controlled) |
| Call chain | `→ IERC20.safeTransferFrom() → OVRFLOToken.mint()` |
| State modified | `wrappedUnderlying` |
| Value flow | in — underlying: user → vault; out — ovrfloToken mint |
| Reentrancy guard | no |

### `OVRFLO.unwrap()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | ovrfloToken holder |
| Parameters | `amount` (user-controlled) |
| Call chain | `→ OVRFLOToken.burn() → IERC20.safeTransfer()` |
| State modified | `wrappedUnderlying` |
| Value flow | out — underlying: vault → user (1:1 against burned ovrfloToken) |
| Reentrancy guard | no |

### `OVRFLO.flashLoan()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Contract implementing `IFlashBorrower` |
| Parameters | `ptToken` (user-controlled), `amount` (user-controlled), `data` (user-controlled) |
| Call chain | `→ OVRFLO._freshRate() → IPendleOracle.getOracleState() → IERC20.safeTransfer() → IFlashBorrower.onFlashLoan() → IERC20.safeTransferFrom()` |
| State modified | none directly (the callback may re-enter `deposit`/`wrap`/`unwrap`, which do write) |
| Value flow | out then in — PT lent and pulled back; underlying fee → treasury |
| Reentrancy guard | yes (nested flash loans only; `deposit`/`wrap`/`unwrap` remain callable inside the callback) |

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
| OVRFLOFactory | `registerOvrflo()` | ovrflo (externally deployed) | `ovrflos`, `ovrfloCount`, `ovrfloInfo`, `underlyingToOvrflo`; verifies `factory()`/`oracle()`/`sablierLL()==ovrfloStream` and duplicate-underlying before registering |
| OVRFLOFactory | `registerLending()` | lending (externally deployed) | `ovrfloToLending`, `lendingToOvrflo`, `lendings`, `lendingCount`; verifies `factory()`/`owner()`/`sablier()==ovrfloStream` (and vault match) and 1:1 vault mapping before registering |
| OVRFLOFactory | `setOvrfloStream()` | stream (once) | `ovrfloStream`; checks lockup `factory()`/`admin()` and comptroller `admin()`; reverts on second call |
| OVRFLOFactory | `setStreamNFTDescriptor()` | descriptor | forwards `setNFTDescriptor` to `ovrfloStream`; **only** lockup admin forwarder |
| OVRFLOFactory | `addMarket()` | ovrflo, market, twapDuration, feeBps | `isMarketApproved`, `approvedMarketAt`, `approvedMarketCount`; forwards to `OVRFLO.setSeriesApproved` |
| OVRFLOFactory | `setMarketDepositLimit()` | ovrflo, market, limit | forwards to vault |
| OVRFLOFactory | `sweepExcessPt()` | ovrflo, ptToken, to | forwards to vault |
| OVRFLOFactory | `sweepExcessUnderlying()` | ovrflo, to | forwards to vault |
| OVRFLOFactory | `setFlashFeeBps()` | ovrflo, feeBps | forwards to vault |
| OVRFLOFactory | `setFlashLoanPaused()` | ovrflo, paused | forwards to vault |
| OVRFLOFactory | `prepareOracle()` | market, twapDuration | calls `IPendleMarket.increaseObservationsCardinalityNext` |
| OVRFLOFactory | `setLendingAprBounds()` | lending, aprMinBps, aprMaxBps | forwards to lending |
| OVRFLOFactory | `setLendingFee()` | lending, feeBps | forwards to lending |
| OVRFLOFactory | `setLendingTreasury()` | lending, treasury | forwards to lending |
| OVRFLOFactory | `setLendingTickSpacing()` | lending, market, spacing | forwards to lending (set-once per market) |
| OVRFLO | `setSeriesApproved()` | market, pt, twapDuration, expiry, feeBps | `_series[market]`, `ptToMarket[pt]` (write-once) |
| OVRFLO | `setMarketDepositLimit()` | market, limit | `marketDepositLimits[market]` |
| OVRFLO | `sweepExcessPt()` | ptToken, to | transfers surplus PT above `marketTotalDeposited` |
| OVRFLO | `sweepExcessUnderlying()` | to | transfers surplus underlying above `wrappedUnderlying` |
| OVRFLO | `setFlashFeeBps()` | feeBps | `flashFeeBps` |
| OVRFLO | `setFlashLoanPaused()` | paused | `flashLoanPaused` |
| OVRFLOLending | `setAprBounds()` | aprMinBps, aprMaxBps | `aprMinBps`, `aprMaxBps` |
| OVRFLOLending | `setTickSpacing()` | market, spacing | `tickSpacing[market]` (set-once) |
| OVRFLOLending | `setFee()` | feeBps | `feeBps` |
| OVRFLOLending | `setTreasury()` | treasury | `treasury` |
| OVRFLOToken | `transferOwnership()` | newOwner | `owner` (owner is the vault after deploy) |
| OVRFLOToken | `mint()` | to, amount | balances, totalSupply |
| OVRFLOToken | `burn()` | from, amount | balances, totalSupply |

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
