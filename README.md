# OVERFLOW

**OVFL enables access to bond yield before maturity.**

A wrapper protocol for [Pendle](https://pendle.finance) Principal Tokens (PTs) that immediately returns a user's contributed principal while streaming the embedded discount over the PT's remaining maturity.

## How It Works

Pendle PTs trade at a discount to their face value. When you buy a PT at 95% of face value, you're locking in a 5% yield—but you only receive it at maturity. **OVFL unlocks that value immediately.**

### Example

1. User deposits **100 PT-stETH** (currently trading at 95% of face value)
2. User immediately receives **95 ovflETH** (their principal)
3. User receives a **Sablier stream** that vests **5 ovflETH** linearly until PT maturity
4. After maturity, user can burn **100 ovflETH** to claim **100 PT-stETH** (now worth 100 stETH)

```
┌─────────────────────────────────────────────────────────────────┐
│                         DEPOSIT FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User deposits 100 PT (worth 95% of face value)                │
│                          │                                      │
│                          ▼                                      │
│   ┌──────────────────────────────────────────────┐              │
│   │              OVFL Contract                   │              │
│   │                                              │              │
│   │  1. Query Pendle Oracle for TWAP rate        │              │
│   │  2. Calculate split: 95 immediate / 5 stream │              │
│   │  3. Collect fee (if any) in underlying       │              │
│   │  4. Mint ovflTokens                          │              │
│   │  5. Create Sablier stream                    │              │
│   └──────────────────────────────────────────────┘              │
│                          │                                      │
│            ┌─────────────┴─────────────┐                        │
│            ▼                           ▼                        │
│   ┌─────────────────┐         ┌─────────────────┐               │
│   │  95 ovflETH     │         │  Sablier Stream │               │
│   │  (immediate)    │         │  5 ovflETH over │               │
│   │                 │         │  remaining time │               │
│   └─────────────────┘         └─────────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           OVFL Protocol                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐      configures      ┌─────────────────────────┐   │
│   │   Admin     │─────────────────────▶│         OVFL            │   │
│   │             │                      │                         │   │
│   │ - Timelock  │                      │ - deposit()             │   │
│   │ - Market    │                      │ - claim()               │   │
│   │   onboard   │                      │ - Series management     │   │
│   └─────────────┘                      └───────────┬─────────────┘   │
│         │                                          │                 │
│         │ deploys                                  │ mints/burns     │
│         ▼                                          ▼                 │
│   ┌─────────────┐                          ┌─────────────┐           │
│   │  OVFLETH    │◀─────────────────────────│  OVFLETH    │           │
│   │  (per       │      ownership           │  tokens     │           │
│   │  underlying)│      transferred         │             │           │
│   └─────────────┘                          └─────────────┘           │
│                                                                      │
│   External Dependencies:                                             │
│   ┌─────────────┐              ┌─────────────┐                       │
│   │   Pendle    │              │   Sablier   │                       │
│   │   Oracle    │              │   V2 LL     │                       │
│   │ (TWAP rate) │              │ (streaming) │                       │
│   └─────────────┘              └─────────────┘                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Contracts

### OVFL.sol

The core vault contract handling deposits and claims.

| Function | Description |
|----------|-------------|
| `deposit(market, ptAmount, minToUser)` | Deposit PT to receive ovflTokens + stream |
| `claim(ptToken, amount)` | Burn ovflTokens to claim PT after maturity |
| `previewDeposit(market, ptAmount)` | Preview deposit outcome including fees |
| `previewRate(market)` | Get current PT-to-SY TWAP rate |
| `claimablePt(ptToken)` | Check claimable PT balance |

### Admin.sol

Timelocked administrative contract for market onboarding.

| Function | Description |
|----------|-------------|
| `approveUnderlying(underlying, name, symbol)` | Deploy new ovflToken for an underlying |
| `queueAddMarket(market, twap, underlying, fee)` | Queue market with 24h timelock |
| `executeAddMarket(market)` | Execute queued market approval |
| `cancelPendingMarket(market)` | Cancel queued market |
| `setMarketDepositLimit(market, limit)` | Set deposit cap for a market |
| `setMinPtAmount(newMin)` | Set minimum deposit amount |

### OVFLETH.sol

ERC20 wrapper token deployed per underlying asset. Owned by OVFL contract.

## User Flows

### Depositing

1. **Approve** PT token for OVFL contract
2. **Approve** underlying token for fee (if applicable)
3. **Call** `deposit(market, ptAmount, minToUser)`
4. **Receive** ovflTokens immediately + Sablier stream ID

```solidity
// Example deposit
IERC20(ptToken).approve(ovfl, ptAmount);
IERC20(underlying).approve(ovfl, expectedFee);

(uint256 toUser, uint256 toStream, uint256 streamId) = 
    ovfl.deposit(market, ptAmount, minToUser);
```

### Claiming (After Maturity)

1. **Wait** until PT maturity
2. **Call** `claim(ptToken, amount)` with ovflToken balance
3. **Receive** PT tokens 1:1

```solidity
// Example claim
ovfl.claim(ptToken, amount);
// User now has PT tokens to redeem on Pendle
```

### Withdrawing from Stream

Streams are managed by [Sablier V2](https://sablier.com). Users can:
- View stream status on Sablier UI
- Withdraw vested ovflTokens anytime
- Transfer stream NFT to another address

## Admin Flows

### Onboarding a New Market

```
Day 0: Queue market
        │
        │  24 hour timelock
        ▼
Day 1+: Execute market (if oracle ready)
```

1. **Approve underlying** (one-time per underlying asset)
   ```solidity
   admin.approveUnderlying(WETH, "OVFL Wrapped ETH", "ovflETH");
   ```

2. **Queue market** (starts 24h timelock)
   ```solidity
   admin.queueAddMarket(
       market,      // Pendle market address
       900,         // 15 min TWAP
       WETH,        // underlying
       50           // 0.5% fee
   );
   ```

3. **Execute market** (after timelock + oracle ready)
   ```solidity
   admin.executeAddMarket(market);
   ```

### Oracle Requirements

- TWAP duration: 15-30 minutes
- Oracle must have sufficient cardinality (auto-increased during queue)
- Oldest observation must satisfy TWAP duration before execution

## Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `TIMELOCK_DELAY` | 24 hours | Delay before market activation |
| `MIN_TWAP_DURATION` | 15 minutes | Minimum oracle TWAP window |
| `MAX_TWAP_DURATION` | 30 minutes | Maximum oracle TWAP window |
| `FEE_MAX_BPS` | 100 (1%) | Maximum fee in basis points |
| `minPtAmount` | 0.01 ether | Minimum deposit (adjustable) |

## Fee Structure

- Fees are charged on the **immediate** portion (`toUser`), not the streamed portion
- Paid in the **underlying** token (e.g., WETH for PT-stETH)
- Sent directly to treasury address
- Maximum fee: 1% (100 bps)

## Security

### Access Control

- **OVFL**: Controlled by Admin contract
- **Admin**: Uses OpenZeppelin AccessControl with `ADMIN_ROLE`
- **OVFLETH**: Owned by OVFL (mint/burn restricted)

### Safeguards

- **Reentrancy**: All state-changing functions use `nonReentrant`
- **Timelock**: 24-hour delay on market additions
- **Oracle**: TWAP pricing (15-30 min) prevents manipulation
- **Slippage**: `minToUser` parameter protects depositors
- **Deposit limits**: Per-market caps available
- **Sweep**: Only excess PT (above tracked deposits) can be recovered

### External Dependencies

| Dependency | Address (Mainnet) | Purpose |
|------------|-------------------|---------|
| Pendle Oracle | `0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2` | PT-to-SY TWAP rates |
| Sablier V2 LL | `0x3962f6585946823440d274aD7C719B02b49DE51E` | Token streaming |

## Deployments

| Network | OVFL | Admin |
|---------|------|-------|
| Mainnet | TBD | TBD |

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

### Deploy

```bash
forge script script/OVFL.s.sol --rpc-url <RPC_URL> --broadcast
```

## Integration Guide

### For Frontends

Use preview functions before deposits:

```solidity
// Get full deposit preview
(uint256 toUser, uint256 toStream, uint256 fee, uint256 rate) = 
    ovfl.previewDeposit(market, ptAmount);

// Display to user:
// - Immediate: toUser ovflTokens
// - Streamed: toStream ovflTokens over remaining time
// - Fee: fee underlying tokens
// - Rate: rate / 1e18 = PT value as % of face
```

### For Aggregators

```solidity
// Check if market is active
(bool approved, , , uint256 expiry, , , ) = ovfl.series(market);
require(approved && block.timestamp < expiry, "Market not active");

// Check deposit room
uint256 limit = ovfl.marketDepositLimits(market);
uint256 deposited = ovfl.marketTotalDeposited(market);
uint256 available = limit == 0 ? type(uint256).max : limit - deposited;
```

## License

MIT
