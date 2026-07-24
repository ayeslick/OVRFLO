# OVRFLO

**OVRFLO enables Self-Repaying Loans.**

A Lending Platform where borrowers pledge OVRFLO streams, deterministic Sablier streams, as collateral. The stream itself repays the loan — no liquidations, no health checks. OVRFLO creates these streams from Pendle PT deposits, giving every PT holder a deterministic, non-cancelable income stream they can sell or borrow against.

## How It Works

OVRFLO operates in two layers:

**Layer 1 — The Market (OVRFLOLending):** Sell or borrow against a Sablier stream. Sell it outright for discounted underlying, or pledge it to borrow underlying and let the stream repay the loan at maturity. Because the stream is deterministic and non-cancelable, there are no liquidations, no health factors.

**Layer 2 — Collateral Creation (Core Vault):** The stream is created by depositing a Pendle PT. Depositors immediately receive ovrfloTokens (their principal at current market value) plus a Sablier stream that vests the remaining discount until PT maturity. The stream is deterministic and non-cancelable — it pays exactly what it promises, on schedule. That stream is the collateral.

### Example

1. A borrower **borrows 4 WETH** at 10% APR, pledging an OVRFLO stream — a deterministic Sablier stream vesting **5 ovrfloETH** until PT maturity — as collateral
2. The stream was created by depositing **100 PT-stETH** into OVRFLO; the depositor received **95 ovrfloETH** immediately plus this stream
3. At maturity, the stream has vested **5 ovrfloETH**; the lender draws the owed **4.4 ovrfloETH** obligation, and the **0.6 ovrfloETH** residual returns to the borrower

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
│   │  4. Create Sablier stream            │                           │
│   └────────────────┬─────────────────────┘                           │
│                    │                                                 │
│         ┌──────────┴──────────┐                                      │
│         ▼                     ▼                                      │
│   95 ovrfloETH          Sablier Stream                               │
│   (immediate)           5 ovrfloETH over remaining maturity          │
│                          │                                           │
│                          ▼                                           │
│   ┌──────────────────────────────────────┐                           │
│   │           OVRFLOLending              │                           │
│   │  Pledge stream ──▶ borrow WETH now   │                           │
│   │  Sell stream ──▶ receive WETH now    │                           │
│   │  Stream repays loan at maturity      │                           │
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
│   ┌───────────────┐     deploys + admin      ┌──────────────┐            │
│   │ OVRFLOFactory │────────────────────────▶ │   OVRFLO     │            │
│   │               │                          │  (core vault)│            │
│   │ - configure   │                          │ - deposit()  │            │
│   │   Deployment  │                          │ - claim()    │            │
│   │ - deploy()    │                          │ - wrap()     │            │
│   │ - addMarket() │                          │ - unwrap()   │            │
│   │ - prepare     │                          │ - series()   │            │
│   │   Oracle      │                          └──────┬───────┘            │
│   └───────┬───────┘                                 │ mints/burns        │
│           │                                         ▼                    │
│           │                            ┌──────────────────────┐          │
│           │                            │     OVRFLOToken      │          │
│           │                            │  (per underlying)    │          │
│           │                            └──────────────────────┘          │
│           │                                                              │
│           │         ┌──────────────┐    ┌───────────────────┐            │
│           │ deploys │  OVRFLOLending───▶│  StreamPricing    │            │
│           └────────▶│  (lending)   │    │  (pricing library)│            │
│                     │ - sell       │    │ - factor          │            │
│                     │ - borrow     │    │ - grossPrice      │            │
│                     │ - loan svc   │    │ - obligation      │            │
│                     │ - quote      │    │ - requireEligible │            │
│                     └──────────────┘    └───────────────────┘            │
│                                                                          │
│   External:                                                              │
│   ┌─────────────┐              ┌─────────────┐                           │
│   │   Pendle    │              │   Sablier   │                           │
│   │   Oracle    │              │   V2 LL     │                           │
│   │ (TWAP rate) │              │ (streaming) │                           │
│   └─────────────┘              └─────────────┘                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Contracts

### OVRFLOLending.sol

Lending market for selling OVRFLO streams or borrowing against them. Bound to one core vault and one Sablier V2 LL instance at deployment. Two primitives: unified liquidity positions (consumable as sale or loan) and sale listings. All pricing uses `StreamPricing` with a linear APR discount to series maturity. Liquidity positions front-load market gating; listings and all fills run full stream validation. Fees are snapshotted per listing at post time to protect sellers; the global `feeBps` applies to liquidity positions.

| Function | Description |
|----------|-------------|
| `constructor(factory, core, sablier)` | Deploy lending market bound to one vault and Sablier instance; pulls treasury/underlying/ovrfloToken from factory |
| `supplyLiquidity(market, aprBps, availableLiquidity)` | Supply standing liquidity for any eligible stream from `market` (consumable as sale or loan) |
| `withdrawLiquidity(liquidityId)` | Withdraw unmatched liquidity and refund the remaining amount |
| `sellStreamToLiquidity(liquidityId, streamId, minNetOut)` | Sell a stream into a standing liquidity for discounted underlying |
| `postSaleListing(market, streamId, aprBps)` | List a specific stream for sale (escrows stream, snapshots fee) |
| `cancelSaleListing(listingId)` | Cancel unmatched sale listing, return stream |
| `buyListing(listingId, maxPriceIn)` | Buy a listed stream at its discounted price |
| `createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, minAcceptable)` | Batch-borrow against multiple liquidity positions, pledging one stream as collateral |
| `claimLoanPoolShare(loanPoolId, amount)` | Loan-pool lender claims pro-rata from accumulated `loanPoolProceeds` |
| `closeLoan(loanId)` | Permissionless: draw remaining outstanding, return stream to borrower |
| `repayLoan(loanId, amount)` | Borrower repays ovrfloToken to reduce or clear the obligation |
| `quote(market, streamId, aprBps, borrowAmount)` | Preview price, obligation, fee, net, and residual (pass `0` for full borrow) |
| `loanState(loanId)` | View full loan state (reverts for non-existent loan) |
| `liquidityState(liquidityId)` | View liquidity state (reverts for non-existent liquidity) |
| `saleListingState(listingId)` | View sale listing state (reverts for non-existent listing) |
| `setAprBounds(aprMinBps, aprMaxBps)` | Set accepted APR range for new posts (owner) |
| `setFee(feeBps)` | Set protocol fee on liquidity fills (owner) |
| `setTreasury(treasury)` | Set fee recipient (owner) |

**Constants:** `APR_MAX_CEILING = 10_000` (100%), `MAX_FEE_BPS = 10_000` (100%), `LAUNCH_APR_BPS = 1000` (10%). APR bounds and fee are owner-governed but cannot exceed these hardcoded ceilings.

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

Factory and admin hub for deploying and managing OVRFLO vaults. Owned by a timelocked multisig. The Pendle TWAP oracle address is set as an immutable at construction (singleton, same on all chains).

| Function | Description |
|----------|-------------|
| `constructor(owner, oracle)` | Deploy factory with multisig owner and Pendle oracle (both immutable) |
| `configureDeployment(treasury, underlying, nameSuffix, symbolSuffix)` | Stage deployment parameters; factory prepends `OVRFLO ` to name and `ovrflo` to symbol |
| `deploy()` | Deploy OVRFLO + OVRFLOToken from stored config; returns both addresses |
| `deployLending(ovrflo)` | Deploy an OVRFLOLending for an existing vault (1:1, one lending market per vault); reads Sablier from the vault and retains factory ownership |
| `cancelDeployment()` | Cancel a pending deployment |
| `addMarket(ovrflo, market, twapDuration, feeBps)` | Add a PT maturity; reads PT address and expiry from Pendle market; requires ready oracle and exact underlying match |
| `prepareOracle(market, twapDuration)` | Increase oracle cardinality before `addMarket`; duration must be 15-30 min (separate transaction) |
| `setMarketDepositLimit(ovrflo, market, limit)` | Set deposit cap for a market |
| `sweepExcessPt(ovrflo, ptToken, to)` | Sweep excess PT from an OVRFLO |
| `sweepExcessUnderlying(ovrflo, to)` | Sweep excess underlying from an OVRFLO |
| `transferOwnership(newOwner)` | Nominate a new factory owner (two-step; new owner must call `acceptOwnership`) |
| `acceptOwnership()` | Called by the pending owner to finalize the ownership transfer |

**Constants:** `FEE_MAX_BPS = 100` (1%), `MIN_TWAP_DURATION = 15 minutes`, `MAX_TWAP_DURATION = 30 minutes`.

### OVRFLO.sol

The core vault that creates collateral from Pendle PT deposits. Depositors receive immediate ovrfloTokens (principal at TWAP value) plus a Sablier stream vesting the remaining discount. After maturity, ovrfloTokens can be burned 1:1 to claim the underlying PT. Vault-level immutables: `underlying`, `ovrfloToken`, `oracle`, `TREASURY_ADDR`, `sablierLL` (hardcoded). Constant: `MIN_PT_AMOUNT`.

| Function | Description |
|----------|-------------|
| `constructor(admin, treasury, underlying, ovrfloToken, oracle)` | Initialize vault with factory as admin, treasury, underlying, token, and Pendle oracle |
| `deposit(market, ptAmount, minToUser)` | Deposit PT to receive ovrfloTokens + Sablier stream |
| `claim(ptToken, amount)` | Burn ovrfloTokens to claim PT after maturity (1:1) |
| `wrap(amount)` | Wrap underlying 1:1 into ovrfloToken (permissionless, no fees) |
| `unwrap(amount)` | Unwrap ovrfloToken 1:1 into underlying (permissionless, no fees) |
| `setSeriesApproved(market, pt, twapDuration, expiry, feeBps)` | Approve a new PT market series (admin only) |
| `setMarketDepositLimit(market, limit)` | Set deposit cap for a market (admin only) |
| `sweepExcessPt(ptToken, to)` | Sweep excess PT above tracked deposits (admin only) |
| `sweepExcessUnderlying(to)` | Sweep excess underlying above wrap reserve (admin only) |
| `series(market)` | Returns 8-tuple: `(approved, twapDurationFixed, feeBps, expiryCached, ptToken, ovrfloToken, underlying, oracle)` — last 3 synthesized from vault immutables |
| `previewDeposit(market, ptAmount)` | Preview deposit outcome: toUser, toStream, fee, rate |
| `previewStream(market, ptAmount)` | Preview immediate vs streamed split |
| `previewRate(market)` | Get current PT-to-SY TWAP rate |
| `claimablePt(ptToken)` | Check claimable PT balance for a PT token |

### OVRFLOToken.sol

ERC20 wrapper token deployed per OVRFLO/underlying asset. Owned by the OVRFLO contract, with name/symbol provided by the multisig at `configureDeployment` (factory enforces the `OVRFLO ` / `ovrflo` prefixes) and fixed 18-decimal deploy-time semantics. Mint and burn are restricted to the owner (the OVRFLO vault).

## User Flows

### Borrowing Against a Stream

Borrowing is handled via the borrower loan-pool primitive that batches across multiple liquidity positions in a single transaction:

**Borrower loan pool, batch borrow against multiple liquidity positions:**
```solidity
// Borrower pledges a stream and borrows underlying from several liquidity positions.
uint256 loanPoolId = lending.createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, minAcceptable);
```

The borrower receives `borrowAmount` underlying (net of fee) and owes an `obligation` in ovrfloToken at maturity. The stream is escrowed by the lending market. The obligation is computed via `StreamPricing.obligationForFill`, which guarantees `obligation <= remaining` so the stream can always cover the debt. No liquidations, the stream is deterministic and non-cancelable.

### Loan Servicing

Loan servicing routes through loan-pool claim channels. `closeLoan` and `repayLoan` route proceeds to `loanPoolProceeds` rather than directly to a lender:

```solidity
// Loan-pool lender claims pro-rata from accumulated proceeds.
lending.claimLoanPoolShare(loanPoolId, amount);

// Permissionless: draw remaining outstanding, return stream to borrower (proceeds to loanPoolProceeds)
lending.closeLoan(loanId);

// Borrower repays early in ovrfloToken to reduce or clear the obligation (proceeds to loanPoolProceeds)
lending.repayLoan(loanId, amount);
```

`claimLoanPoolShare` lets a lender claim pro-rata from a loan pool's accumulated `loanPoolProceeds` (fed by `closeLoan` and `repayLoan`), working for both open and closed loans. `closeLoan` is permissionless and requires the stream to have accrued enough to cover the outstanding. `repayLoan` lets the borrower repay early in ovrfloToken; when the obligation is fully satisfied, the stream is returned.

### Selling a Stream

Two paths to sell a Sablier stream for discounted underlying:

**Path A — Sell into a standing liquidity:**
```solidity
// Seller hits an existing liquidity
lending.sellStreamToLiquidity(liquidityId, streamId, minNetOut);
// Stream transfers to liquidity lender, seller receives net underlying
```

**Path B — List for sale:**
```solidity
// List the stream
uint256 listingId = lending.postSaleListing(market, streamId, aprBps);
// Buyer purchases it
lending.buyListing(listingId, maxPriceIn);
// Stream transfers to buyer, seller receives net underlying
```

Both paths transfer the stream permanently. The sale price is the stream's remaining face value discounted by the APR over the time to maturity.

### Creating Collateral (Core Vault)

#### Depositing

1. **Approve** PT token for OVRFLO contract
2. **Approve** underlying token for fee (if applicable)
3. **Call** `deposit(market, ptAmount, minToUser)`
4. **Receive** ovrfloTokens immediately + Sablier stream ID

```solidity
// Example deposit
IERC20(ptToken).approve(ovrflo, ptAmount);
IERC20(underlying).approve(ovrflo, expectedFee);

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

Streams are managed by [Sablier V2](https://sablier.com). Users can:
- View stream status on Sablier UI
- Withdraw vested ovrfloTokens anytime (`withdraw` is `payable` — requires an ETH fee via `calculateMinFeeWei(streamId)`)
- Transfer stream NFT to another address

#### Wrap / Unwrap

Permissionless 1:1 conversion between underlying and ovrfloToken with no fees or streams. Useful for obtaining ovrfloTokens without depositing PT, or for converting ovrfloTokens back to underlying when the wrap reserve is funded.

```solidity
// Wrap underlying into ovrfloToken
IERC20(underlying).approve(ovrflo, amount);
ovrflo.wrap(amount);

// Unwrap ovrfloToken back to underlying
ovrflo.unwrap(amount);
```

### What's Fixed Will OVRFLO

The PT discount is fixed at deposit -- the oracle splits principal from yield deterministically. What's fixed will overflow: the yield portion vests through a Sablier stream, and the composition of deposit, lending sale, and unwrap or swap lets that fixed yield flow out of the PT and into extractable value. Every participant benefits:

**With held PT:**
1. **Deposit 100 PT** (pre-maturity, PT trading at 95% of face) -- receive 95 ovrfloToken + Sablier stream vesting 5 ovrfloToken
2. **Exit the 95 ovrfloToken** -- `unwrap()` for 95 underlying or swap on a DEX
3. **Sell the stream on the lending market** into liquidity, receive ~4.5 underlying

**With zero capital (flash-loan underlying, available today):**
1. **Flash-loan 95 underlying** from Aave, Balancer, etc.
2. **Swap for 100 PT** on the Pendle AMM (at 0.95 rate)
3. **Deposit 100 PT** -- receive 95 ovrfloToken + Sablier stream vesting 5 ovrfloToken
4. **Exit the 95 ovrfloToken** -- `unwrap()` for 95 underlying or swap on a DEX
5. **Sell the stream on the lending market** -- receive ~4.5 underlying
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
│   │ unwrap()   │     │  sellInto    │                                │
│   │   or swap  │     │  LiquidityPosition()                          │
│   │  → ~95     │     │  → ~4.5      │                                │
│   │  underly   │     │    underly   │                                │
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
| **Lending liquidity lender** | Bought a stream worth 5 ovrfloToken at maturity for ~4.5 underlying today. Fair trade at their chosen APR. |
| **Protocol** | Remains solvent (E-1 holds: net ovrfloToken supply = net backing). No funds stolen. |

Any PT holder can do this today, or use a flash loan on the underlying (available on Aave/Balancer) to execute with zero capital -- swap underlying for PT on the Pendle AMM, run the cycle, repay in underlying. See `docs/audit/rejected-findings-record.md` for the full security analysis of why this is accepted by design.

## Admin Flows

All admin operations are initiated by the timelocked multisig.

### Deploying the Core System

```solidity
// 1. Deploy factory (one-time, multisig is owner, oracle is singleton)
OVRFLOFactory factory = new OVRFLOFactory(multisig, PENDLE_ORACLE);

// 2. Multisig stages deployment config (factory builds "OVRFLO Wrapped Ether" / "ovrfloWETH")
factory.configureDeployment(treasury, WETH, "Wrapped Ether", "WETH");

// 3. Multisig executes deployment
(address ovrflo, address ovrfloToken) = factory.deploy();
```

The factory:
- Deploys OVRFLO with factory as admin, treasury, underlying, ovrfloToken, and oracle (all as vault immutables)
- Deploys OVRFLOToken (name/symbol from configured suffixes with `OVRFLO `/`ovrflo` prefixes, fixed 18-decimal deploy-time semantics)
- Transfers OVRFLOToken ownership to OVRFLO
- Registers the OVRFLO in its registry

### Deploying the Lending Market

```solidity
// Factory deploys and remains the owner of the lending market.
vm.prank(multisig);
address lendingMarket = factory.deployLending(ovrflo);

// Multisig configures the market through factory forwarders.
factory.setLendingFee(lendingMarket, feeBps);
factory.setLendingAprBounds(lendingMarket, aprMin, aprMax);
factory.setLendingTreasury(lendingMarket, treasury);
```

The factory reads the Sablier address from the vault's `sablierLL` immutable, enforces 1:1 (one lending market per vault), registers it in `ovrfloToLending` and `lendingToOvrflo`, and remains its owner. The lending market pulls treasury, underlying, and ovrfloToken from the factory registry at construction. APR bounds initialize to the launch APR (10%). Factory deployment is the only supported production path.

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

- **Core deposit fee**: Charged on the immediate portion (`toUser`), paid in underlying, sent to the vault's treasury. Capped at 1% (`FEE_MAX_BPS = 100` on `OVRFLOFactory`). Set per-market via `addMarket`.
- **Lending protocol fee**: Charged on the sale price or borrow amount, paid in underlying, and sent to the lending market treasury. Capped at 100% (`MAX_FEE_BPS = 10_000` on `OVRFLOLending`). Configure it through `OVRFLOFactory.setLendingFee`. Listings snapshot the fee at post time to protect sellers from retroactive changes; liquidity positions use the current global fee.

## Security

### Access Control

- **OVRFLOFactory**: Owned by timelocked multisig, serves as immutable `factory` (admin) for all deployed OVRFLOs
- **OVRFLO**: Controlled by factory (admin functions gated by `onlyAdmin` modifier)
- **OVRFLOToken**: Owned by OVRFLO (mint/burn restricted)
- **OVRFLOLending**: Owned by `OVRFLOFactory`, bound to one vault and Sablier instance at construction, and administered through factory forwarders

### Safeguards

- **Multisig + Timelock**: All admin operations require multisig consensus and timelock delay
- **APR ceiling**: Hardcoded at 100% (`APR_MAX_CEILING = 10_000` on `OVRFLOLending`) — cannot be raised past 100% even by the owner
- **Fee ceilings**: Core deposit fee capped at 1% (`FEE_MAX_BPS = 100` on factory), lending protocol fee capped at 100% (`MAX_FEE_BPS = 10_000` on lending) — both hardcoded constants
- **No liquidations**: Deterministic, non-cancelable Sablier streams cannot underperform — the stream itself repays the loan
- **StreamPricing math**: Floor/ceil rounding is directional and load-bearing. The invariant `obligation <= remaining` is proven and stress-tested (see `plans/streampricing-math-analysis.md`)
- **Oracle**: TWAP pricing for PT valuation prevents manipulation; oracle is a vault immutable set at factory construction
- **Slippage**: `minToUser` on deposits, `minNetOut` on lending fills, `minAcceptable` on borrow pools, `maxPriceIn` on buy-listing
- **Deposit limits**: Per-market caps available (0 = unlimited; set a positive limit to cap deposits)
- **Two-step ownership**: `transferOwnership` on the factory nominates a pending owner; the new owner must call `acceptOwnership` to finalize

### Design Notes

**ovrfloTokens are fungible across series of the same underlying — by design.**

A single `OVRFLOToken` is shared by every PT market that resolves to the same underlying. `PT-stETH-JUN25` and `PT-stETH-DEC25` both mint `ovrfloWETH`, and any holder can burn `ovrfloWETH` against any matured series with sufficient `claimablePt(ptToken)`.

- `ovrfloX` is a claim on PTs, which are a claim on the underlying. Fungibility across maturities is what makes it a single liquid asset and usable as collateral — fragmenting into one token per maturity would defeat the point.
- Per-series accounting still holds: `series[market]`, `marketTotalDeposited[market]`, and `claimablePt[ptToken]` are tracked independently, fees are charged per deposit, and `OVRFLOFactory.addMarket` enforces an exact underlying match so unrelated assets can never share an `ovrfloToken`.

## Roadmap

**The Pool** — passive, closed-end, sealed, pro-rata aggregation of loans over the same StreamPricing core. Many lenders pool underlying, many borrowers each pledge a stream, residuals return per borrower, and lenders own a pro-rata share of the sum of obligations. Built after the Lending establishes a market APR.

## External Dependencies

| Dependency | Address (Mainnet) | Purpose |
|------------|-------------------|---------|
| Pendle Oracle | `0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2` | PT-to-SY TWAP rates (singleton, same on all chains) |
| Sablier V2 LL | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | Token streaming |

## Deployments

| Network | OVRFLOFactory | OVRFLO | OVRFLOLending |
|---------|---------------|--------|------------|
| Mainnet | TBD | TBD | TBD |

## Development

### Prerequisites

- [Foundry](https://lending.getfoundry.sh/getting-started/installation)

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

1. `anvil --fork-url $MAINNET_RPC_URL --chain-id 1 --fork-block-number 24609670`
   (PID tracked in `.bootstrap.pid`).
2. `script/seed-local.sh` — deploys OVRFLO + factory + token, approves the
   wstETH markets, and seeds PT + stETH to anvil account #1. Writes
   `deployments/local.json`.
3. `npm run envio:up` — starts the local Sablier indexer under
   [`tools/envio/`](tools/envio/README.md) (Postgres:5433, Hasura:8080,
   indexer:8081) via Envio's internal docker stack.
4. `tools/scripts/write-env.sh local` — renders `web/.env.local` from the
   deployment artifact.
5. `npm run dev` — boots `next dev` against the local stack.

Each step is also runnable standalone: `anvil:fork`, `deploy:seed:local`,
`envio:up`, `env:write:local`, `ui:dev`. Teardown:
`npm --prefix web run bootstrap:local:clean` kills anvil + envio, wipes
`web/.env.local` + Envio's Postgres volume.

The seed driver uses `forge create` + `cast send` instead of
`forge script --broadcast`; see the header comment in
[`script/seed-local.sh`](script/seed-local.sh) for the Foundry bug it works around.

### Devnet loop (`bootstrap:devnet` — Tenderly Virtual TestNet)

```bash
export PRIVATE_KEY=0x... DEV_WALLET=0x... TENDERLY_RPC_URL=https://...
npm --prefix web run bootstrap:devnet
```

Runs `forge script SeedDevnet.s.sol --broadcast` against the VTN and writes
`web/.env.devnet`. Devnet uses the hosted Sablier indexer (no local Envio).
Teardown: `npm --prefix web run bootstrap:devnet:clean`.

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
// - Fee: fee underlying tokens
// - Rate: rate / 1e18 = PT value as % of face
```

### For Aggregators

```solidity
// Check if market is active (8-tuple destructuring)
(bool approved, , , uint256 expiry, , , , ) = ovrflo.series(market);
require(approved && block.timestamp < expiry, "Market not active");

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
