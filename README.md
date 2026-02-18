# OVERFLOW

**OVRFLO enables access to bond yield before maturity.**

A wrapper protocol for [Pendle](https://pendle.finance) Principal Tokens (PTs) that immediately returns a user's contributed principal while streaming the embedded discount over the PT's remaining maturity.

## How It Works

Pendle PTs trade at a discount to their face value. When you buy a PT at 95% of face value, you're locking in a 5% yield—but you only receive it at maturity. **OVRFLO unlocks that value immediately.**

### Example

1. User deposits **100 PT-stETH** (currently trading at 95% of face value)
2. User immediately receives **95 ovrfloETH** (their principal)
3. User receives a **Sablier stream** that vests **5 ovrfloETH** linearly until PT maturity
4. After maturity, user can burn **100 ovrfloETH** to claim **100 PT-stETH** (now worth 100 stETH)

```
┌─────────────────────────────────────────────────────────────────┐
│                         DEPOSIT FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   User deposits 100 PT (worth 95% of face value)                │
│                          │                                      │
│                          ▼                                      │
│   ┌──────────────────────────────────────────────┐              │
│   │             OVRFLO Contract                  │              │
│   │                                              │              │
│   │  1. Query Pendle Oracle for TWAP rate        │              │
│   │  2. Calculate split: 95 immediate / 5 stream │              │
│   │  3. Collect fee (if any) in underlying       │              │
│   │  4. Mint ovrfloTokens                        │              │
│   │  5. Create Sablier stream                    │              │
│   └──────────────────────────────────────────────┘              │
│                          │                                      │
│            ┌─────────────┴─────────────┐                        │
│            ▼                           ▼                        │
│   ┌─────────────────┐         ┌─────────────────┐               │
│   │  95 ovrfloETH   │         │  Sablier Stream │               │
│   │  (immediate)    │         │  5 ovrfloETH    │               │
│   │                 │         │  over remaining  │               │
│   └─────────────────┘         └─────────────────┘               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          OVRFLO Protocol                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌───────────────┐                                                  │
│   │   Timelocked  │                                                  │
│   │   Multisig    │ (verification + authorization)                   │
│   └───────┬───────┘                                                  │
│           │ owns                                                     │
│           ▼                                                          │
│   ┌───────────────┐     deploys + is admin of     ┌──────────────┐   │
│   │ OVRFLOFactory │─────────────────────────────▶│    OVRFLO    │   │
│   │               │                              │              │   │
│   │ - configure   │                              │ - deposit()  │   │
│   │   Deployment  │                              │ - claim()    │   │
│   │ - deploy()    │                              │ - series     │   │
│   │ - setSeries   │                              │   management │   │
│   │   Approved    │                              └──────┬───────┘   │
│   │ - prepare     │                                     │           │
│   │   Oracle      │      deploys                        │ mints/    │
│   └───────┬───────┘                                     │ burns     │
│           │                                             ▼           │
│           │            ┌─────────────┐          ┌─────────────┐     │
│           └───────────▶│ OVRFLOToken │◀─────────│ OVRFLOToken │     │
│                        │ (per        │ ownership│  tokens     │     │
│                        │ underlying) │ transfer │             │     │
│                        └─────────────┘          └─────────────┘     │
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

### OVRFLOFactory.sol

Factory and admin hub for deploying and managing OVRFLO vault systems. Owned by a timelocked multisig.

| Function | Description |
|----------|-------------|
| `configureDeployment(treasury, underlying)` | Stage deployment parameters |
| `deploy()` | Execute deployment from stored config |
| `cancelDeployment()` | Cancel a pending deployment |
| `setSeriesApproved(vault, ...)` | Approve a market series on a vault |
| `setMarketDepositLimit(vault, market, limit)` | Set deposit cap for a market |
| `sweepExcessPt(vault, ptToken, to)` | Sweep excess PT from a vault |
| `disableSeries(vault, market)` | Disable deposits for a market series |
| `enableSeries(vault, market)` | Re-enable a previously disabled series |
| `prepareOracle(market, twapDuration)` | Increase oracle cardinality if needed |
| `transferVaultAdmin(vault, newAdmin)` | Migrate a vault to a new factory |
| `transferOwnership(newOwner)` | Transfer factory ownership |

### OVRFLO.sol

The core vault contract handling deposits and claims.

| Function | Description |
|----------|-------------|
| `deposit(market, ptAmount, minToUser)` | Deposit PT to receive ovrfloTokens + stream |
| `claim(ptToken, amount)` | Burn ovrfloTokens to claim PT after maturity |
| `disableSeries(market)` | Disable deposits for a market (admin) |
| `enableSeries(market)` | Re-enable a disabled market (admin) |
| `setMarketDepositLimit(market, limit)` | Set deposit cap for a market (admin) |
| `previewDeposit(market, ptAmount)` | Preview deposit outcome including fees |
| `previewStream(market, ptAmount)` | Preview immediate vs streamed split |
| `previewRate(market)` | Get current PT-to-SY TWAP rate |
| `claimablePt(ptToken)` | Check claimable PT balance |

### OVRFLOToken.sol

ERC20 wrapper token deployed per underlying asset. Owned by OVRFLO contract.

## User Flows

### Depositing

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

### Claiming (After Maturity)

Claims always work for matured PTs regardless of whether the series is currently enabled or disabled. Disabling a series only prevents new deposits—it never blocks redemptions.

1. **Wait** until PT maturity
2. **Call** `claim(ptToken, amount)` with ovrfloToken balance
3. **Receive** PT tokens 1:1

```solidity
// Example claim
ovrflo.claim(ptToken, amount);
// User now has PT tokens to redeem on Pendle
```

### Withdrawing from Stream

Streams are managed by [Sablier V2](https://sablier.com). Users can:
- View stream status on Sablier UI
- Withdraw vested ovrfloTokens anytime
- Transfer stream NFT to another address

## Admin Flows

All admin operations are initiated by the timelocked multisig and routed through the factory.

### Deploying a Vault

```solidity
// 1. Deploy factory (one-time, multisig is owner)
OVRFLOFactory factory = new OVRFLOFactory(multisig);

// 2. Multisig stages deployment config
factory.configureDeployment(treasury, WETH);

// 3. Multisig executes deployment
(address vault, address ovrfloToken) = factory.deploy();
```

The factory:
- Deploys OVRFLO with factory as `adminContract`
- Deploys OVRFLOToken (name/symbol derived from underlying)
- Transfers OVRFLOToken ownership to OVRFLO
- Registers the vault in its registry

### Onboarding a New Market

```solidity
// 1. Prepare oracle cardinality (if needed)
factory.prepareOracle(market, twapDuration);

// 2. Approve series on the vault
factory.setSeriesApproved(
    vault,
    market,
    ptToken,
    underlying,
    ovrfloToken,
    twapDuration,
    expiry,
    feeBps
);
```

Market verification (TWAP bounds, fee caps, oracle readiness) is handled off-chain by the multisig before submitting transactions.

## Fee Structure

- Fees are charged on the **immediate** portion (`toUser`), not the streamed portion
- Paid in the **underlying** token (e.g., WETH for PT-stETH)
- Sent directly to treasury address

## Security

### Access Control

- **OVRFLOFactory**: Owned by timelocked multisig, serves as `adminContract` for all deployed vaults
- **OVRFLO**: Controlled by factory (admin functions gated by `onlyAdmin` modifier)
- **OVRFLOToken**: Owned by OVRFLO (mint/burn restricted)

### Safeguards

- **Reentrancy**: All state-changing functions use `nonReentrant`
- **Multisig + Timelock**: All admin operations require multisig consensus and timelock delay
- **Oracle**: TWAP pricing prevents manipulation
- **Slippage**: `minToUser` parameter protects depositors
- **Series control**: Markets can be disabled/re-enabled; disabling blocks new deposits but never blocks claims
- **Deposit limits**: Per-market caps available
- **Transparency**: `TREASURY_ADDR` is publicly readable on-chain
- **Sweep**: Only excess PT (above tracked deposits) can be recovered
- **Upgradeability**: Factory can transfer vault admin to a new factory via `transferVaultAdmin`

### External Dependencies

| Dependency | Address (Mainnet) | Purpose |
|------------|-------------------|---------|
| Pendle Oracle | `0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2` | PT-to-SY TWAP rates |
| Sablier V2 LL | `0x3962f6585946823440d274aD7C719B02b49DE51E` | Token streaming |

## Deployments

| Network | OVRFLOFactory | OVRFLO |
|---------|---------------|--------|
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
forge script script/OVRFLO.s.sol --rpc-url <RPC_URL> --broadcast
```

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
// Check if market is active
(bool approved, , , uint256 expiry, , , ) = ovrflo.series(market);
require(approved && block.timestamp < expiry, "Market not active");

// Check deposit room
uint256 limit = ovrflo.marketDepositLimits(market);
uint256 deposited = ovrflo.marketTotalDeposited(market);
uint256 available = limit == 0 ? type(uint256).max : limit - deposited;
```

## License

MIT
