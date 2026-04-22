# OVERFLOW

**OVRFLO makes Fixed Yield Collateral.**

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
│   │ - addMarket() │                              │   management │   │
│   │ - prepare     │                              └──────┬───────┘   │
│   │   Oracle      │      deploys                        │           │
│   └───────┬───────┘                                     │ mints/    │
│           │                                             │ burns     │
│           │            ┌─────────────┐          ┌───────▼───────┐   │
│           └───────────▶│ OVRFLOToken │◀─────────│  OVRFLOToken  │   │
│                        │ (per        │ ownership│   tokens      │   │
│                        │ underlying) │ transfer │               │   │
│                        └─────────────┘          └───────────────┘   │
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

Factory and admin hub for deploying and managing OVRFLO systems. Owned by a timelocked multisig.

| Function | Description |
|----------|-------------|
| `configureDeployment(treasury, underlying, nameSuffix, symbolSuffix)` | Stage deployment parameters; factory prepends `OVRFLO ` to the name and `ovrflo` to the symbol |
| `deploy()` | Deploy OVRFLO + OVRFLOToken from stored config |
| `cancelDeployment()` | Cancel a pending deployment |
| `addMarket(ovrflo, market, oracle, twapDuration, feeBps)` | Add a PT maturity using the stored OVRFLO underlying + shared `ovrfloToken`; requires an exact underlying match and ready oracle |
| `setMarketDepositLimit(ovrflo, market, limit)` | Set deposit cap for a market |
| `sweepExcessPt(ovrflo, ptToken, to)` | Sweep excess PT from an OVRFLO |
| `prepareOracle(market, oracle, twapDuration)` | Separate oracle-preparation step before `addMarket(...)` when cardinality must be increased |
| `transferOwnership(newOwner)` | Nominate a new factory owner (two-step; new owner must call `acceptOwnership`) |
| `acceptOwnership()` | Called by the pending owner to finalize the ownership transfer |

### OVRFLO.sol

The core contract handling deposits and claims.

| Function | Description |
|----------|-------------|
| `deposit(market, ptAmount, minToUser)` | Deposit PT to receive ovrfloTokens + stream |
| `claim(ptToken, amount)` | Burn ovrfloTokens to claim PT after maturity |
| `setMarketDepositLimit(market, limit)` | Set deposit cap for a market (admin) |
| `previewDeposit(market, ptAmount)` | Preview deposit outcome including fees |
| `previewStream(market, ptAmount)` | Preview immediate vs streamed split |
| `previewRate(market)` | Get current PT-to-SY TWAP rate |
| `claimablePt(ptToken)` | Check claimable PT balance |

### OVRFLOToken.sol

ERC20 wrapper token deployed per OVRFLO/underlying asset. Owned by the OVRFLO contract, with name/symbol provided by the multisig at `configureDeployment` (factory enforces the `OVRFLO ` / `ovrflo` prefixes) and fixed 18-decimal deploy-time semantics.

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

Deposit limits only affect new deposits; claims always work for matured PTs.

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
- Withdraw vested ovrfloTokens anytime (`withdraw` is `payable` — requires an ETH fee via `calculateMinFeeWei(streamId)`)
- Transfer stream NFT to another address

## Admin Flows

All admin operations are initiated by the timelocked multisig and routed through the factory.

### Deploying an OVRFLO

```solidity
// 1. Deploy factory (one-time, multisig is owner)
OVRFLOFactory factory = new OVRFLOFactory(multisig);

// 2. Multisig stages deployment config (factory builds "OVRFLO Wrapped Ether" / "ovrfloWETH")
factory.configureDeployment(treasury, WETH, "Wrapped Ether", "WETH");

// 3. Multisig executes deployment
(address ovrflo, address ovrfloToken) = factory.deploy();
```

The factory:
- Deploys OVRFLO with factory.
- Deploys OVRFLOToken (name/symbol from configured suffixes with `OVRFLO `/`ovrflo` prefixes, fixed 18-decimal deploy-time semantics)
- Transfers OVRFLOToken ownership to OVRFLO
- Registers the OVRFLO in its registry (`ovrflos[]` mapping)

### Onboarding a New Market

```solidity
// 1. If Pendle reports more observations are needed, prepare the oracle first
//    in a separate successful transaction. twapDuration must be >= 15 minutes.
factory.prepareOracle(market, oracle, twapDuration);

// 2. Add market only after cardinality is sufficient and the oracle's
//    oldest observation already satisfies the requested TWAP window.
factory.addMarket(ovrflo, market, oracle, twapDuration, feeBps);
```

`addMarket` reads the PT address and expiry directly from the Pendle market contract, reuses the stored `ovrfloInfo[ovrflo].underlying` and shared `ovrfloInfo[ovrflo].ovrfloToken`, requires the market's exact SY underlying asset address to match that stored underlying, rejects duplicate PT mappings, and requires `twapDuration >= 15 minutes` plus a ready Pendle oracle window before approval rather than preparing it inline. After success, the factory still records the market in its approved-market enumeration. Fee is capped at `FEE_MAX_BPS` (100 bps = 1%).

## Fee Structure

- Fees are charged on the **immediate** portion (`toUser`), not the streamed portion
- Paid in the **underlying** token (e.g., WETH for PT-stETH)
- Sent directly to treasury address
- Maximum fee enforced at 1% (`FEE_MAX_BPS = 100`)

## Security

### Access Control

- **OVRFLOFactory**: Owned by timelocked multisig, serves as `adminContract` for all deployed OVRFLOs
- **OVRFLO**: Controlled by factory (admin functions gated by `onlyAdmin` modifier)
- **OVRFLOToken**: Owned by OVRFLO (mint/burn restricted)

### Safeguards

- **Multisig + Timelock**: All admin operations require multisig consensus and timelock delay
- **Fee cap**: Maximum fee enforced at 1% (`FEE_MAX_BPS = 100`)
- **Oracle**: TWAP pricing prevents manipulation
- **Slippage**: `minToUser` parameter protects depositors
- **Deposit limits**: Per-market caps available (set limit to freeze or block new deposits)
- **Transparency**: `TREASURY_ADDR` is publicly readable on-chain
- **Sweep**: Only excess PT (above tracked deposits) can be recovered
- **Two-step factory ownership**: `transferOwnership` only nominates a pending owner; the new owner must call `acceptOwnership` to finalize, preventing fat-fingered transfers to unreachable addresses

### Design Notes

**ovrfloTokens are fungible across series of the same underlying — by design.**

A single `OVRFLOToken` is shared by every PT market that resolves to the same underlying. `PT-stETH-JUN25` and `PT-stETH-DEC25` both mint `ovrfloWETH`, and any holder can burn `ovrfloWETH` against any matured series with sufficient `claimablePt(ptToken)`.

- `ovrfloX` is a claim on PTs, which are a claim on the underlying. Fungibility across maturities is what makes it a single liquid asset and usable as collateral — fragmenting into one token per maturity would defeat the point.
- Per-series accounting still holds: `series[market]`, `marketTotalDeposited[market]`, and `claimablePt[ptToken]` are tracked independently, fees are charged per deposit, and `OVRFLOFactory.addMarket` enforces an exact underlying match so unrelated assets can never share an `ovrfloToken`.

### External Dependencies

| Dependency | Address (Mainnet) | Purpose |
|------------|-------------------|---------|
| Pendle Oracle | `0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2` | PT-to-SY TWAP rates |
| Sablier V2 LL | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | Token streaming |

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

### Local seed (anvil fork of mainnet)

For a fork-against-mainnet UI loop, start anvil and run the seed driver:

```bash
anvil --fork-url "$MAINNET_RPC_URL" --chain-id 1 --fork-block-number 24609670
./script/seed-local.sh
```

The driver deploys OVRFLO + OVRFLOFactory + OVRFLOToken, approves the wstETH
markets, funds anvil account #1 with PT + stETH, and writes
`deployments/local.json` for the web app to pick up. Overrides:
`PRIVATE_KEY` (owner/broadcaster), `DEV_WALLET` (funded EOA), `RPC`.

The driver uses `forge create` + `cast send` instead of `forge script
--broadcast`; see the header comment in [`script/seed-local.sh`](script/seed-local.sh)
for the Foundry bug it works around.

### Devnet seed (Tenderly Virtual Testnet)

```bash
PRIVATE_KEY=0x... DEV_WALLET=0x... \
  forge script script/SeedDevnet.s.sol --rpc-url "$TENDERLY_RPC_URL" --broadcast --slow
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
