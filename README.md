# OVRFLO

**OVRFLO enables Self-Repaying Loans.**

A lending platform where lenders supply liquidity and borrowers borrow against deterministic collateral streams. No liquidations — the collateral repays the loan. OVRFLO's collateral streams are deterministic, non-cancelable OVRFLO Streams (a GPL fork of Sablier v2-core v1.1.2; Solidity identifiers stay Sablier-named) created from Pendle PT deposits, which is why no liquidations are needed.

## How It Works

OVRFLO operates in two layers:

**Layer 1 — The Market (OVRFLOLending):** A loan-only, fixed-rate tick order book. Lenders rest liquidity at a chosen APR tick; borrowers pledge a collateral stream and draw from tick liquidity with a single blind fill — no position IDs, no collisions. The collateral repays the loan at maturity — no liquidations, no health factors, because the collateral cannot underperform.

**Layer 2 — The Collateral (Core Vault):** OVRFLO's collateral is a deterministic, non-cancelable OVRFLO Stream. It is created by depositing a Pendle PT — depositors receive ovrfloTokens (their principal at current market value) plus a stream vesting the remaining discount until PT maturity. The stream pays exactly what it promises, on schedule. That determinism is why no liquidations are needed. Source identifiers in this repo stay Sablier-shaped (`sablierLL`, `ISablierV2LockupLinear`); the bound deployment is the OVRFLO Streams fork, not canonical Sablier at `0xAFb979…`.

### Example

1. A borrower **borrows 4 ovrfloETH** at 10% APR against deterministic collateral streams
2. The collateral — an OVRFLO stream vesting **5 ovrfloETH** until PT maturity — was created by depositing **100 PT-stETH** into OVRFLO (the depositor also received **95 ovrfloETH** immediately)
3. At maturity, the collateral has vested **5 ovrfloETH**; the lender draws the owed **4.4 ovrfloETH** obligation, and the **0.6 ovrfloETH** residual returns to the borrower

```
┌──────────────────────────────────────────────────────────────────────┐
│                          FULL FLOW                                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   User deposits 100 PT (worth 95% of face value)                     │
│                          │                                           │
│                          ▼                                           │
│   ┌──────────────────────────────────────┐                           │
│   │         OVRFLO Core Vault            │                           │
│   │  1. Query Pendle Oracle for TWAP     │                           │
│   │  2. Split: 95 immediate / 5 stream   │                           │
│   │  3. Mint ovrfloTokens                │                           │
│   │  4. Create OVRFLO Stream             │                           │
│   └────────────────┬─────────────────────┘                           │
│                    │                                                 │
│         ┌──────────┴──────────┐                                      │
│         ▼                     ▼                                      │
│   95 ovrfloETH          OVRFLO Stream                                │
│   (immediate)           5 ovrfloETH over remaining maturity          │
│                          │                                           │
│                          ▼                                           │
│   ┌──────────────────────────────────────┐                           │
│   │           OVRFLOLending              │                           │
│   │  Lender rests liquidity at an APR tick │                         │
│   │  Pledge stream ──▶ blind-fill borrow  │                          │
│   │  Stream repays loan at maturity       │                          │
│   └──────────────────────────────────────┘                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          OVRFLO Protocol                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌───────────────┐                                                      │
│   │   Timelocked  │                                                      │
│   │   Multisig    │ (verification + authorization)                       │
│   └───┬───────────┘                                                      │
│       │ owns                                                             │
│       ▼                                                                  │
│   ┌───────────────┐     registers + admin    ┌──────────────┐            │
│   │ OVRFLOFactory │────────────────────────▶ │   OVRFLO     │            │
│   │               │                          │  (core vault)│            │
│   │ - register    │                          │ - deposit()  │            │
│   │   Ovrflo()    │                          │ - claim()    │            │
│   │ - ovrfloTo    │     nested construct     │ - series()   │            │
│   │   Reserve     │                          └──────┬───────┘            │
│   │ - register    │                                 │ constructs         │
│   │   Lending()   │                                 ▼                    │
│   │ - prepare     │                    ┌──────────────────────┐          │
│   │   Oracle      │                    │   OVRFLOReserve      │          │
│   └───────┬───────┘                    │ - wrap() / unwrap()  │          │
│           │                            │ - wrappedUnderlying  │          │
│           │                            └──────┬───────────────┘          │
│           │                                   │ constructs               │
│           │                                   ▼                          │
│           │                            ┌──────────────────────┐          │
│           │                            │     OVRFLOToken      │          │
│           │                            │  vault + reserve     │          │
│           │                            │  named minters       │          │
│           │                            └──────────────────────┘          │
│           │                                                              │
│           │         ┌──────────────┐    ┌───────────────────┐            │
│           │registers│  OVRFLOLending───▶│  StreamPricing    │            │
│           └────────▶│  (lending)   │    │  (pricing library)│            │
│                     │ - supply     │    │ - factor          │            │
│                     │ - withdraw   │    │ - grossPrice      │            │
│                     │ - borrow     │    │ - obligation      │            │
│                     │ - repay      │    │ - requireEligible │            │
│                     │ - close      │    └───────────────────┘            │
│                     │ - claim      │    ┌───────────────────┐            │
│                     │ escrow:      │───▶│    TickTree       │            │
│                     │ ovrfloToken  │    │ (packed prefix-   │            │
│                     └──────────────┘    │  sum tree lib)    │            │
│                                          └───────────────────┘            │
│                                                                          │
│   External:                                                              │
│   ┌─────────────┐              ┌─────────────┐                           │
│   │   Pendle    │              │ OVRFLO      │                           │
│   │   Oracle    │              │ Streams     │                           │
│   │ (TWAP rate) │              │ (fork LL)   │                           │
│   └─────────────┘              └─────────────┘                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Nested deploy: the vault constructs `OVRFLOReserve`; the reserve constructs `OVRFLOToken`. The factory maps `ovrfloToReserve` at `registerOvrflo`. The vault has no wrap path and holds no underlying. Lending escrows ovrfloToken. PT flash is removed.

## Contracts

### OVRFLOLending.sol

Loan-only, fixed-rate tick order book for self-repaying loans. Lenders rest liquidity at a chosen APR tick; borrowers pledge a deterministic collateral stream and draw against tick liquidity with a single blind fill against a cumulative counter — no position IDs, no collisions, fill gas flat in the number of lender positions crossed. No liquidations — the collateral cannot underperform. Bound to one core vault and one OVRFLO Streams lockup instance at deployment (constructor arg; getter names stay `sablier` / `sablierLL`). Lender attribution is computed lazily from interval overlap against a `TickTree` packed prefix-sum tree rather than stored per fill. All pricing uses `StreamPricing` with a linear APR discount to series maturity. There is one lending primitive — loans — no sale listings; a full borrow is economically a sale (obligation caps at the stream's remaining face).

| Function | Description |
|----------|-------------|
| `constructor(factory, core, sablier, launchAprBps)` | Deploy lending market bound to one vault and OVRFLO Streams lockup; pulls treasury/ovrfloToken from factory; `underlying` from `ovrfloInfo` is a zero-check only |
| `supply(market, aprBps, amount)` | Escrow ovrfloToken and append a lender position at an APR tick (exact `UNIT` multiples, `>= MIN_LIQUIDITY_AMOUNT`) |
| `withdraw(positionId)` | Refund a position's entire unfilled suffix (lender-only, never market-gated) |
| `borrow(market, aprBps, targetBorrow, streamId, minAcceptable, onBehalfOf)` | Pledge an OVRFLO Stream and blind-fill from one tick's oldest live epoch; `onBehalfOf` applies only when `msg.sender` is the router |
| `repay(loanId, amount)` | Repay ovrfloToken at face value against a loan's outstanding (permissionless — third-party repay is a donation) |
| `close(loanId)` | Permissionless: once withdrawable covers outstanding, draw it and return the stream to the borrower |
| `claim(loanId, positionId, amount)` | Lender claims a contributing position's pro-rata share of a loan's recovered value |
| `advanceEpochCursor(market, aprBps, maxSteps)` | Permissionless recovery valve: advances a tick's borrowable cursor past drained/dust epochs |
| `contributionOf(loanId, positionId)` | View a position's overlap with a loan's frozen fill interval |
| `tickDepths(market)` | View the whole APR ladder for a market in one call: `(aprBps, availableUnits)[]` |
| `tickState(market, aprBps)` | Named tick view: cursor, current epoch, live borrowable depth |
| `positionState(positionId)` | Named position view: stored fields plus derived tape interval and unfilled amount |
| `loanState(loanId)` | Named loan view: stored fields plus derived outstanding (reverts for non-existent loan) |
| `loansOf(positionId, startSeq, maxN)` | Paginated claim discovery: a position's overlapping loans with contribution and claimable, no log scanning |
| `setAprBounds(aprMinBps, aprMaxBps)` | Set accepted APR range for new supplies and borrows (owner) |
| `setTickSpacing(market, spacing)` | Set a market's APR tick spacing exactly once (owner) |
| `setFee(feeBps)` | Set protocol fee on borrows (owner) |
| `setTreasury(treasury)` | Set fee recipient (owner) |

**Constants:** `APR_MAX_CEILING = 10_000` (100%, caps both `setAprBounds` and the constructor's `launchAprBps` argument), `MAX_FEE_BPS = 10_000` (100%), `UNIT = 1e12` (book quantization granule, in wei), `MIN_LIQUIDITY_AMOUNT = 1e15` (0.001 token; the shared supply-minimum and borrow-fill-minimum atom), `CURSOR_CAP = 32` (max epoch-cursor steps one `borrow` may perform), `MIN_STREAM_AMOUNT = 1e6` (minimum remaining stream face accepted by the borrower side). The launch APR is a constructor argument (`launchAprBps`, 25 bps steps) that seeds `aprMaxBps`; `aprMinBps` starts at 0, so the `[0, launchAprBps]` ladder is open from birth. Bounds are owner-governed afterwards but cannot exceed the hardcoded ceilings above.

### StreamPricing.sol

Pure library providing shared pricing and eligibility primitives for OVRFLOLending. All discounting uses a linear APR factor `f = 1 + apr * ttm / (YEAR * BPS)` in WAD. Rounding is directional and load-bearing: `grossPrice` floors (buyer-favorable), `obligation` ceils (lender-favorable). The invariant `obligation <= remaining` holds for all partial borrows, ensuring the pledged stream can always cover the debt. See `plans/streampricing-math-analysis.md` for the full proof and stress-test results.

| Function | Description |
|----------|-------------|
| `factor(aprBps, timeToMaturity)` | Linear accrual factor `f = 1 + apr * ttm / (YEAR * BPS)`, in WAD |
| `grossPrice(remaining, aprBps, timeToMaturity)` | Discounted present value of `remaining` face (floors) |
| `obligation(borrowAmount, aprBps, timeToMaturity)` | Future value at maturity of a borrowed amount (ceils) |
| `obligationForFill(borrowAmount, grossPrice_, remaining, aprBps, ttm)` | Obligation for a lending fill; fast-paths full-borrow to `remaining` |
| `fee(amount, feeBps)` | Protocol fee: `amount * feeBps / BPS` |
| `marketActive(factory, core, market)` | Validate market is approved, series approved, and not matured |
| `requireEligible(factory, sablier, core, market, streamId)` | Full stream validation: sender, asset, end time, no cliff, non-cancelable, remaining > 0 |

Also defines `IOVRFLOFactoryRegistry` (vault lookup + market approval) and `IOVRFLOSeriesRegistry` (per-market series config) interfaces.

### OVRFLOFactory.sol

Registry and admin hub for externally deployed OVRFLO vaults and OVRFLOLending markets. Owned by a timelocked multisig. Deploys nothing itself — children are deployed by any EOA/script, and the factory verifies every constructor-arg binding on-chain before registering a candidate, so the factory embeds no child creation code (EIP-170). The Pendle TWAP oracle address is set as an immutable at construction (singleton, same on all chains). `ovrfloToReserve` is write-once at `registerOvrflo`. The reserve is not replaceable.

| Function | Description |
|----------|-------------|
| `constructor(owner, oracle)` | Deploy factory with multisig owner and Pendle oracle (both immutable) |
| `registerOvrflo(ovrflo)` | Register an externally deployed OVRFLO vault: verifies factory/oracle/stream bindings, one vault per underlying, token minters (`vault()`/`reserve()`), and reserve wiring, then writes `ovrfloInfo` and `ovrfloToReserve` |
| `registerLending(lending)` | Register an externally deployed OVRFLOLending: verifies its core vault is registered, `factory()`/`owner()` match this factory, stream binding equals `factory.ovrfloStream()` (and matches the vault's `sablierLL`), then records it (1:1 per vault) |
| `replaceLending(newLending)` | Admit a replacement market for a vault that already has one; the old market stays known for repay/close/claim. Then call `setLendingRouter(oldLending, address(0))` so the old book stops filling |
| `setLendingRouter(lending, router)` | Set or clear the borrow router (`onBehalfOf` path); zero disables. Records the outgoing nonzero router in `priorRouterAt` |
| `setOvrfloStream(stream)` | Admit the canonical OVRFLO Streams lockup once (`onlyOwner`); checks lockup `factory()`/`admin()` and comptroller `admin()` |
| `setStreamNFTDescriptor(descriptor)` | Forward `setNFTDescriptor` to the canonical lockup; only lockup admin forwarder (no `transferAdmin`) |
| `addMarket(ovrflo, market, twapDuration, feeBps)` | Add a PT maturity; reads PT address and expiry from Pendle market; requires ready oracle and exact underlying match |
| `prepareOracle(market, twapDuration)` | Increase oracle cardinality before `addMarket`; duration must be 15-30 min (separate transaction) |
| `setMarketDepositLimit(ovrflo, market, limit)` | Set deposit cap for a market |
| `sweepExcessPt(ovrflo, ptToken, to)` | Sweep excess PT from an OVRFLO vault |
| `sweepExcessUnderlying(ovrflo, to)` | Sweep excess underlying from that vault's `OVRFLOReserve` |
| `setReserveFlashMintMax(ovrflo, max)` | Set that column's per-call flash-mint cap. Launch 0. Ceiling 100 billion whole tokens |
| `setReserveFlashFeeBps(ovrflo, bps)` | Set that column's flash-mint fee. Launch 0. Cap 9 bps |
| `transferOwnership(newOwner)` | Nominate a new factory owner (two-step; new owner must call `acceptOwnership`) |
| `acceptOwnership()` | Called by the pending owner to finalize the ownership transfer |

**Constants:** `FEE_MAX_BPS = 100` (1%), `MIN_TWAP_DURATION = 15 minutes`, `MAX_TWAP_DURATION = 30 minutes`.

### OVRFLO.sol

The core vault that creates collateral from Pendle PT deposits. Depositors receive immediate ovrfloTokens (principal at TWAP value, net of the mint-split fee) plus an OVRFLO Stream vesting the remaining discount. After maturity, ovrfloTokens can be burned 1:1 to claim the underlying PT. The vault constructs its `OVRFLOReserve` in the constructor; the reserve constructs the token. The vault holds no underlying and has no wrap, unwrap, or PT flash path. Vault-level immutables: `underlying`, `reserve`, `ovrfloToken`, `oracle`, `TREASURY_ADDR`, `sablierLL` (constructor-bound lockup; name kept). Constant: `MIN_PT_AMOUNT`.

| Function | Description |
|----------|-------------|
| `constructor(admin, treasury, underlying, name_, symbol_, oracle, stream)` | Nested deploy: vault constructs the reserve; reserve constructs the token. Last arg is the lockup (`sablierLL`) |
| `deposit(market, ptAmount, minToUser)` | Deposit PT; fee is minted to treasury in ovrfloToken from the immediate split. Depositor approves PT only |
| `claim(ptToken, amount)` | Burn ovrfloTokens to claim PT after maturity (1:1) |
| `setSeriesApproved(market, pt, twapDuration, expiry, feeBps)` | Approve a new PT market series (admin only) |
| `setMarketDepositLimit(market, limit)` | Set deposit cap for a market (admin only) |
| `sweepExcessPt(ptToken, to)` | Sweep excess PT above tracked deposits (admin only) |
| `series(market)` | Returns 7-tuple: `(twapDurationFixed, feeBps, expiryCached, ptToken, ovrfloToken, underlying, oracle)` — last 3 synthesized from vault immutables. Approved iff `ptToken != address(0)` |
| `previewDeposit(market, ptAmount)` | Preview deposit outcome: toUser (net), toStream, fee (ovrfloToken), rate |
| `previewStream(market, ptAmount)` | Preview immediate vs streamed split |
| `previewRate(market)` | Get current PT-to-SY TWAP rate |
| `claimablePt(ptToken)` | Check claimable PT balance for a PT token |

### OVRFLOReserve.sol

Wrap reserve for one column. Holds the underlying that backs 1:1 wrapped ovrfloToken. The vault constructs this contract; this contract constructs the token. Admin is the factory. `wrappedUnderlying` is the tracked unwrap bound. Direct transfers do not increase that counter. PT flash is not on this contract. ERC-3156 flash mint of ovrfloToken lives here. Launch `flashMintMax` is 0.

| Function | Description |
|----------|-------------|
| `constructor(admin, underlying, name_, symbol_, vault_)` | Bind factory, underlying, and vault; construct `OVRFLOToken` with `vault = vault_` and `reserve = msg.sender` |
| `wrap(amount)` | Pull underlying 1:1, mint ovrfloToken (permissionless, no fee, no stream) |
| `unwrap(amount)` | Burn ovrfloToken 1:1, send underlying, bounded by `wrappedUnderlying` |
| `sweepExcessUnderlying(to)` | Sweep underlying above `wrappedUnderlying` (factory admin). Sweep `to` is trusted to the multisig (R-02) |
| `maxFlashLoan(token)` / `flashFee(token, amount)` / `flashLoan(receiver, token, amount, data)` | ERC-3156 flash mint of ovrfloToken. Launch cap is 0. Nested flash reverts. Net `totalSupply` does not change |
| `setFlashMintMax(max)` / `setFlashFeeBps(bps)` | Factory admin. Ceiling 100 billion whole tokens. Fee cap 9 bps |

### OVRFLOToken.sol

ERC20 + Permit receipt token, one per column. The reserve constructs it. Two named immutable minters, fixed at construction: `vault()` (mint on deposit, burn on claim) and `reserve()` (mint on wrap, burn on unwrap). Neither authority can move. Name/symbol are full ERC20 strings, reviewed off-chain before registration (`OVRFLO ` / `ovrflo` prefix). Not OZ Ownable.

### OVRFLOStreamLens.sol

Deployless read lens. The frontend ships creation bytecode and calls via `eth_call` with no `to`. Not a DeploySize deployable. Holds no storage and is never in a transaction path.

## User Flows

### Supplying Liquidity

A lender rests ovrfloToken at a chosen APR tick. `supply` escrows the amount and appends a permanent lender position on that tick's current epoch tape:

```solidity
// Lender rests 5 ovrfloToken at the 1000bps (10%) tick.
IERC20(ovrfloToken).approve(lending, 5 ether);
uint256 positionId = lending.supply(market, 1000, 5 ether);
```

`amount` must be an exact `UNIT` multiple (`UNIT = 1e12` wei) and `>= MIN_LIQUIDITY_AMOUNT` (0.001 token). Supply reverts until the market's tick spacing is set (`setLendingTickSpacing`) and while the market is matured. `withdraw(positionId)` refunds the position's entire unfilled suffix — the lender-only, never market-gated exit before a borrow fills it.

### Borrowing Against a Stream

Borrowing is a single blind fill against one APR tick's cumulative `filled` counter — the borrower names no lender position, so fill gas is flat in how many positions the fill's interval eventually crosses:

```solidity
// Borrower pledges a stream and blind-fills up to 1 ovrfloToken from the 1000bps tick.
sablier.approve(lending, streamId);
uint256 loanId = lending.borrow(market, 1000, 1 ether, streamId, minAcceptable, borrower);
```

The borrower receives `actualBorrow - feeAmount` ovrfloToken and owes an `obligation` in ovrfloToken at maturity. The stream is escrowed via plain `transferFrom`. The obligation is computed via `StreamPricing.obligationForFill`, capped so `obligation <= remaining` — a max borrow (`targetBorrow` at or above the stream's discounted gross price) is economically a sale, since the whole stream's remaining value becomes the obligation and there is no separate sale mechanism. No liquidations, the stream is deterministic and non-cancelable. A self-borrow may pass the user address as `onBehalfOf`; a non-router caller is always `msg.sender`.

### Loan Servicing and Claims

```solidity
// Permissionless: once the stream's withdrawable accrual covers the outstanding,
// draw it and return the stream to the borrower.
lending.close(loanId);

// Borrower (or anyone — third-party repay is a pure donation) repays at face
// in ovrfloToken to reduce or clear the outstanding.
lending.repay(loanId, amount);

// A contributing lender claims its pro-rata share of the loan's recovered value.
lending.claim(loanId, positionId, amount);
```

`claim` pays a lender position its pro-rata share of the loan's `drawn + repaid`, plus (while the loan is open) the stream's not-yet-drawn accrual up to the outstanding — harvested just-in-time from the stream. The cap is order-independent: every contributing position can always reach its full pro-rata share regardless of who claims first. `close` is permissionless and requires the stream to have accrued enough to cover the outstanding; a full `repay` also closes the loan. `loansOf(positionId, startSeq, maxN)` returns a position's overlapping loans with contribution and claimable amounts for discovery, without log scanning.

### Creating Collateral (Core Vault)

#### Depositing

1. **Approve** PT token for OVRFLO contract
2. **Call** `deposit(market, ptAmount, minToUser)` — fee comes from the minted ovrfloToken; no underlying fee approval
3. **Receive** net ovrfloTokens immediately + OVRFLO Stream ID

```solidity
// Example deposit
IERC20(ptToken).approve(ovrflo, ptAmount);

(uint256 toUser, uint256 toStream, uint256 streamId) =
    ovrflo.deposit(market, ptAmount, minToUser);
```

#### Claiming (After Maturity)

Deposit limits only affect new deposits; claims always work for matured PTs.

1. **Wait** until PT maturity
2. **Call** `claim(ptToken, amount)` with ovrfloToken balance
3. **Receive** PT tokens 1:1

```solidity
// Example claim
ovrflo.claim(ptToken, amount);
// User now has PT tokens to redeem on Pendle
```

#### Withdrawing from Stream

Streams are managed by **OVRFLO Streams** (fork of Sablier v2-core v1.1.2; ERC721 identity `OVRFLOStream`). Identifier names in code stay Sablier-shaped. Users can:
- View stream status in Markets and in any wallet that reads `tokenURI`
- Withdraw vested ovrfloTokens anytime (`withdraw` is `payable` — requires an ETH fee via `calculateMinFeeWei(streamId)`)
- Transfer stream NFT to another address

#### Wrap / Unwrap

Permissionless 1:1 conversion between underlying and ovrfloToken with no fees or streams. Call `OVRFLOReserve`, not the vault. Useful for obtaining ovrfloTokens without depositing PT, or for converting ovrfloTokens back to underlying when the wrap reserve is funded.

```solidity
// Wrap underlying into ovrfloToken
IERC20(underlying).approve(reserve, amount);
reserve.wrap(amount);

// Unwrap ovrfloToken back to underlying
reserve.unwrap(amount);
```

### What's Fixed Will OVRFLO

The PT discount is fixed at deposit -- the oracle splits principal from yield deterministically. What's fixed will overflow: the yield portion vests through an OVRFLO Stream, and the composition of deposit, lending (a max borrow against the stream, economically a sale), and unwrap or swap lets that fixed yield flow out of the PT and into extractable value. Every participant benefits:

**With held PT:**
1. **Deposit 100 PT** (pre-maturity, PT trading at 95% of face) -- receive 95 ovrfloToken + OVRFLO Stream vesting 5 ovrfloToken
2. **Exit the 95 ovrfloToken** -- `unwrap()` for 95 underlying or swap on a DEX
3. **Max-borrow against the stream on the lending market**, receive ~4.5 ovrfloToken (unwrap for underlying if wanted)

**With zero capital (flash-loan underlying, available today):**
1. **Flash-loan 95 underlying** from Aave, Balancer, etc.
2. **Swap for 100 PT** on the Pendle AMM (at 0.95 rate)
3. **Deposit 100 PT** -- receive 95 ovrfloToken + OVRFLO Stream vesting 5 ovrfloToken
4. **Exit the 95 ovrfloToken** -- `unwrap()` for 95 underlying or swap on a DEX
5. **Max-borrow against the stream on the lending market** -- receive ~4.5 ovrfloToken
6. **Repay the flash loan** -- return 95 underlying + fee

**Net result:** ~4.5 underlying of PT yield captured. The flash-loan path works today -- you borrow underlying (widely flash-loanable), not PT, and the Pendle AMM swap replaces the PT acquisition.

```
┌──────────────────────────────────────────────────────────────────────┐
│                           OVRFLO CYCLE                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   HELD PT:  Start with 100 PT                                        │
│   ZERO-CAP: Flash-loan 95 underlying → swap for 100 PT on Pendle     │
│                          │                                           │
│                          ▼                                           │
│   ┌──────────────────────────────────────┐                           │
│   │         OVRFLO Core Vault            │                           │
│   │  Deposit 100 PT → 95 ovrflo + stream │                           │
│   └────────────────┬─────────────────────┘                           │
│                    │                                                 │
│         ┌──────────┴──────────┐                                      │
│         ▼                     ▼                                      │
│   95 ovrfloToken          Stream (5 ovrfloToken)                     │
│         │                     │                                      │
│         ▼                     ▼                                      │
│   ┌────────────┐     ┌──────────────┐                                │
│   │ unwrap()   │     │  borrow()    │                                │
│   │   or swap  │     │  (max fill)  │                                │
│   │  → ~95     │     │  → ~4.5      │                                │
│   │  underly   │     │  ovrfloToken │                                │
│   └────┬───────┘     └──────┬───────┘                                │
│        │                    │                                        │
│        ▼                    ▼                                        │
│   ~99.5 underlying total   (95 + 4.5)                                │
│        │                                                             │
│        ▼                    ZERO-CAP PATH:                           │
│   Repay 95 underly ──────── repay flash loan + fee                   │
│                             Yield: ~4.5 underlying                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Why everyone wins:**

| Participant | Outcome |
|-------------|---------|
| **Extractor** | Captures ~4.5 underlying of PT yield -- with held PT or zero capital via underlying flash loan |
| **Wrap reserve funder** | If unwrap is used: reserve drained by 95 underlying, but deposit added 100 PT backing -- can `claim` 100 ovrfloToken for 100 PT at maturity. Economically whole. If swap is used: reserve untouched. |
| **Lending liquidity lender** | Bought a stream worth 5 ovrfloToken at maturity for ~4.5 ovrfloToken today. Fair trade at their chosen APR. |
| **Protocol** | Remains solvent (E-1 holds: net ovrfloToken supply = net backing). No funds stolen. |

Any PT holder can do this today, or use a flash loan on the underlying (available on Aave/Balancer) to execute with zero capital -- swap underlying for PT on the Pendle AMM, run the cycle, repay in underlying. See `docs/audit/rejected-findings-record.md` for the full security analysis of why this is accepted by design.

## Admin Flows

All admin operations are initiated by the timelocked multisig.

### Deploying the Core System

The factory deploys nothing — children are deployed externally, then registered after on-chain verification. This keeps the factory's own bytecode under the EIP-170 runtime cap (it embeds no child creation code).

```solidity
// 1. Deploy factory (one-time, multisig is owner, oracle is singleton)
OVRFLOFactory factory = new OVRFLOFactory(multisig, PENDLE_ORACLE);

// 2. Deployer EOA/script deploys the vault. Nested constructors: the vault
//    creates OVRFLOReserve; the reserve creates OVRFLOToken. Last arg is the
//    admitted lockup (`sablierLL`).
OVRFLO ovrflo = new OVRFLO(
    address(factory), treasury, WETH, "OVRFLO Wrapped Ether", "ovrfloWETH",
    PENDLE_ORACLE, lockup
);

// 3. Multisig registers the vault, after off-chain verification that the
//    three creation transactions (vault, reserve, token) match the audited
//    compiler artifacts.
vm.prank(multisig);
factory.registerOvrflo(address(ovrflo));
address reserve = ovrflo.reserve();
address ovrfloToken = ovrflo.ovrfloToken();
```

`registerOvrflo` verifies, on-chain, every constructor-arg binding construction used to fix: the candidate's `factory()` and `oracle()` immutables must match this factory, `sablierLL() == factory.ovrfloStream()`, its `underlying` must have no existing registered vault, `token.vault() == vault` and `token.reserve() == vault.reserve()`, and the reserve binds this factory, vault, token, and underlying. Code identity for the three creation transactions stays off-chain. Child deployment is permissionless; only registration is `onlyOwner`.

### Deploying the Lending Market

```solidity
// 1. Deployer EOA/script deploys the lending market directly. Its constructor
//    pulls treasury/ovrfloToken from the factory registry and
//    reverts UnknownCore unless the vault was registered in step 2 above;
//    the factory is the lending market's owner from construction.
//    launchAprBps seeds both APR bounds; it must be a multiple of 25 bps and
//    cannot exceed APR_MAX_CEILING (100%).
OVRFLOLending lendingMarket = new OVRFLOLending(address(factory), address(ovrflo), sablier, 1000);

// 2. Multisig registers the lending market, after the same off-chain
//    bytecode-verification checklist item.
vm.prank(multisig);
factory.registerLending(address(lendingMarket));

// Multisig configures the market through factory forwarders.
factory.setLendingFee(address(lendingMarket), feeBps);
factory.setLendingAprBounds(address(lendingMarket), aprMin, aprMax);
factory.setLendingTreasury(address(lendingMarket), treasury);

// Tick spacing is per-Pendle-market and set-once: supply/borrow revert for a
// market until this is called, and a second call reverts. The multisig must
// sanity-check spacing during onboarding: the tick ladder view is O(rungs),
// where rungs = (aprMax - aprMin) / spacing, so a pathological small spacing
// permanently blows up ladder reads (keep rungs <= ~400).
factory.setLendingTickSpacing(address(lendingMarket), market, spacing);
```

`registerLending` verifies the candidate's `factory()`/`owner()` immutables match this factory, its stream binding equals `factory.ovrfloStream()` and the vault's `sablierLL`, enforces 1:1 (one lending market per vault), and registers it in `ovrfloToLending`/`lendingToOvrflo`. Matching audited vault bytecode alone is not a safe stream-binding predicate after KTD6 — registration is. APR bounds initialize to the launch APR (10%), which is also the only valid tick until the multisig widens the bounds. See `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md` for the full design and security analysis of the register-don't-construct model.

### Onboarding a New Market

```solidity
// 1. If Pendle reports more observations are needed, prepare the oracle first
//    in a separate transaction. twapDuration must be 15-30 minutes.
factory.prepareOracle(market, twapDuration);

// 2. Add market only after cardinality is sufficient and the oracle's
//    oldest observation already satisfies the requested TWAP window.
factory.addMarket(ovrflo, market, twapDuration, feeBps);
```

`addMarket` reads the PT address and expiry directly from the Pendle market contract, reuses the stored `ovrfloInfo[ovrflo].underlying` and shared `ovrfloInfo[ovrflo].ovrfloToken`, requires the market's exact SY underlying asset address to match that stored underlying, rejects duplicate PT mappings, and requires `twapDuration >= 15 minutes` plus a ready Pendle oracle window before approval. Fee is capped at `FEE_MAX_BPS` (100 bps = 1%).

## Fee Structure

Two separate fees operate at different layers:

- **Core deposit fee**: Charged on the immediate portion (`toUser`), taken from the minted ovrfloToken, sent to the vault's treasury. Capped at 1% (`FEE_MAX_BPS = 100` on `OVRFLOFactory`). Set per-market via `addMarket`.
- **Lending protocol fee**: Charged on the borrow amount, paid in ovrfloToken, and sent to the lending market treasury. Capped at 100% (`MAX_FEE_BPS = 10_000` on `OVRFLOLending`). Configure it through `OVRFLOFactory.setLendingFee`. The global `feeBps` is owner-mutable with no per-loan snapshot; `Borrowed` logs the fee actually charged (`feeAmount`) so net proceeds are reconstructible from events alone.

## Security

### Access Control

- **OVRFLOFactory**: Owned by timelocked multisig, serves as immutable `factory` (admin) for all deployed OVRFLOs
- **OVRFLO**: Controlled by factory (admin functions gated by `onlyAdmin` modifier)
- **OVRFLOToken**: Two named immutable minters (`vault()` and `reserve()`)
- **OVRFLOReserve**: Controlled by factory (admin functions gated by `onlyAdmin`)
- **OVRFLOLending**: Owned by `OVRFLOFactory`, bound to one vault and OVRFLO Streams lockup at construction, and administered through factory forwarders

### Safeguards

- **Multisig + Timelock**: All admin operations require multisig consensus and timelock delay
- **APR ceiling**: Hardcoded at 100% (`APR_MAX_CEILING = 10_000` on `OVRFLOLending`) — cannot be raised past 100% even by the owner
- **Fee ceilings**: Core deposit fee capped at 1% (`FEE_MAX_BPS = 100` on factory), lending protocol fee capped at 100% (`MAX_FEE_BPS = 10_000` on lending) — both hardcoded constants
- **No liquidations**: Deterministic, non-cancelable OVRFLO Streams cannot underperform — the stream itself repays the loan
- **StreamPricing math**: Floor/ceil rounding is directional and load-bearing. The invariant `obligation <= remaining` is proven and stress-tested (see `plans/streampricing-math-analysis.md`)
- **Oracle**: TWAP pricing for PT valuation prevents manipulation; oracle is a vault immutable set at factory construction
- **Slippage**: `minToUser` on deposits, `minAcceptable` on borrow fills
- **Deposit limits**: Per-market caps available (0 = unlimited; set a positive limit to cap deposits)
- **Two-step ownership**: `transferOwnership` on the factory nominates a pending owner; the new owner must call `acceptOwnership` to finalize

### Design Notes

**ovrfloTokens are fungible across series of the same underlying — by design.**

A single `OVRFLOToken` is shared by every PT market that resolves to the same underlying. `PT-stETH-JUN25` and `PT-stETH-DEC25` both mint `ovrfloWETH`, and any holder can burn `ovrfloWETH` against any matured series with sufficient `claimablePt(ptToken)`.

- `ovrfloX` is a claim on PTs, which are a claim on the underlying. Fungibility across maturities is what makes it a single liquid asset and usable as collateral — fragmenting into one token per maturity would defeat the point.
- Per-series accounting still holds: `series[market]`, `marketTotalDeposited[market]`, and `claimablePt[ptToken]` are tracked independently, fees are charged per deposit, and `OVRFLOFactory.addMarket` enforces an exact underlying match so unrelated assets can never share an `ovrfloToken`.

## External Dependencies

| Dependency | Address (Mainnet) | Purpose |
|------------|-------------------|---------|
| Pendle Oracle | `0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2` | PT-to-SY TWAP rates (singleton, same on all chains) |
| OVRFLO Streams lockup | `factory.ovrfloStream()` (not canonical `0xAFb979…`) | Token streaming; fork of Sablier v2-core v1.1.2 |

## Deployments

| Network | OVRFLOFactory | OVRFLO | OVRFLOLending |
|---------|---------------|--------|------------|
| Mainnet | TBD | TBD | TBD |

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)

### Build

```bash
forge build
```

### Test

```bash
forge test
```

### Fork Tests (factory/safety onboarding)

- Set `MAINNET_RPC_URL` to an archive-capable Ethereum mainnet RPC.
- The fork harness pins block `24609670` inside `test/fork/OVRFLOForkBase.t.sol` for deterministic runs.
- `foundry.toml` exposes the `mainnet` RPC alias from `MAINNET_RPC_URL` for local fork utilities.

```bash
MAINNET_RPC_URL=https://your-archive-mainnet-rpc \
forge test --match-path test/fork/OVRFLOFactoryMainnetFork.t.sol -vv
```

### Frontend (web)

The checked-in frontend launch config is pinned to Ethereum mainnet. Copy
`web/.env.example` to `web/.env.local` and set:

- `NEXT_PUBLIC_CHAIN_ID=1`
- `NEXT_PUBLIC_OVRFLO_FACTORY` to the deployed mainnet factory address
- `NEXT_PUBLIC_REOWN_PROJECT_ID` to your Reown / WalletConnect project ID

`NEXT_PUBLIC_RPC_URL` is optional. Set it only if you want the web app to use a
custom mainnet RPC endpoint; otherwise wagmi/AppKit use the default transport.

```bash
cd web
cp .env.example .env.local
npm test
npm run build
```

### Deploy

Mainnet / testnet deploys go through the Forge script:

```bash
forge script script/OVRFLO.s.sol --rpc-url <RPC_URL> --broadcast
```

### Local loop (`bootstrap:local`)

One command from clone to working DeFi UI against a mainnet-forked anvil:

```bash
export MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
npm --prefix web run bootstrap:local
```

This orchestrates (in order):

1. `anvil --fork-url $MAINNET_RPC_URL --chain-id 1` forked at the live
   mainnet head (PID tracked in `.bootstrap.pid`).
2. `script/seed-local.sh` — deploys OVRFLO + factory + token, discovers live
   Pendle markets, and seeds PT + wstETH to the dev/lender wallets. Writes
   `deployments/local.json`.
3. `tools/scripts/write-env.sh local` — renders `web/.env.local` from the
   deployment artifact.
4. `npm run dev` — boots `next dev` against the local stack.

No indexer or backend process is involved: the frontend discovers positions,
loans, streams, and demand from standard RPC event logs plus direct contract
hydration. Each step is also runnable standalone: `anvil:fork`,
`deploy:seed:local`, `env:write:local`, `ui:dev`. Teardown:
`npm --prefix web run bootstrap:local:clean` kills anvil and the dev server
and wipes `web/.env.local`.

The seed driver uses `forge create` + `cast send` instead of
`forge script --broadcast`; see the header comment in
[`script/seed-local.sh`](script/seed-local.sh) for the Foundry bug it works around.

### Devnet loop (`bootstrap:devnet` — Tenderly Virtual TestNet)

```bash
export PRIVATE_KEY=0x... DEV_WALLET=0x... TENDERLY_RPC_URL=https://...
npm --prefix web run bootstrap:devnet
```

Runs `forge script SeedDevnet.s.sol --broadcast` against the VTN and writes
`web/.env.devnet`. Discovery runs in the browser against the VTN RPC — no
indexer service is required. Teardown:
`npm --prefix web run bootstrap:devnet:clean`.

## Integration Guide

### For Frontends

Use preview functions before deposits:

```solidity
// Get full deposit preview
(uint256 toUser, uint256 toStream, uint256 fee, uint256 rate) =
    ovrflo.previewDeposit(market, ptAmount);

// Display to user:
// - Immediate: toUser ovrfloTokens
// - Streamed: toStream ovrfloTokens over remaining time
// - Fee: fee ovrfloTokens (minted to treasury; depositor never approves underlying)
// - Rate: rate / 1e18 = PT value as % of face
```

### For Aggregators

```solidity
// Check if market is active (7-tuple; approved iff ptToken != address(0))
(, , uint256 expiry, address ptToken, , , ) = ovrflo.series(market);
require(ptToken != address(0) && block.timestamp < expiry, "Market not active");

// Check deposit room
uint256 limit = ovrflo.marketDepositLimits(market);
uint256 deposited = ovrflo.marketTotalDeposited(market);
uint256 available = limit == 0 ? type(uint256).max : limit - deposited;
```

### For Lending Integrators

```solidity
// Quote a borrow against a stream
(uint256 grossPrice, uint128 obligation, uint256 fee, uint256 netToBorrower, uint128 residual) =
    lending.quote(market, streamId, aprBps, borrowAmount);

// Check loan state
(address borrower, address lender, uint256 streamId, uint128 obligation,
 uint128 drawn, uint128 repaid, uint128 outstanding, bool closed) =
    lending.loanState(loanId);
```

## License

MIT
