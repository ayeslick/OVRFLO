# OVRFLO Factory + App UI Plan

Add on-chain approved markets storage to OVRFLOFactory and build the OVRFLO stream management app UI with Next.js, matching overflow.finance brand.

---

## Part 1: Factory Contract — Completed Changes

### Changes to src/OVRFLOFactory.sol

**Renamed all "vault" references to "ovrflo"** for clarity:
- `VaultInfo` → `OvrfloInfo`
- `vaultCount` → `ovrfloCount`
- `vaultInfo` → `ovrfloInfo`
- `_requireKnownVault` → `_requireKnownOvrflo`
- `getVaultInfo` → `getOvrfloInfo`
- All event and parameter names updated accordingly

**Added fee cap:**
```solidity
uint256 public constant FEE_MAX_BPS = 100; // 1% max
```

**Added OVRFLO enumeration:**
```solidity
mapping(uint256 => address) public ovrflos;

// In deploy():
ovrflos[ovrfloCount] = ovrflo;
ovrfloCount += 1;
```

**Added approved market tracking:**
```solidity
mapping(address ovrflo => uint256) public approvedMarketCount;
mapping(address ovrflo => mapping(uint256 index => address)) public approvedMarketAt;
mapping(address ovrflo => mapping(address market => bool)) public isMarketApproved;
```

**Replaced `setSeriesApproved` with `addMarket`:**
```solidity
function addMarket(
    address ovrflo,
    address market,
    uint32 twapDuration,
    uint16 feeBps
) external onlyOwner {
    _requireKnownOvrflo(ovrflo);
    require(feeBps <= FEE_MAX_BPS, "OVRFLOFactory: fee too high");

    OvrfloInfo memory info = ovrfloInfo[ovrflo];
    (, address pt,) = IPendleMarket(market).readTokens();
    uint256 expiry = IPendleMarket(market).expiry();

    OVRFLO(ovrflo).setSeriesApproved(
        market, pt, info.underlying, info.ovrfloToken, twapDuration, expiry, feeBps
    );

    if (!isMarketApproved[ovrflo][market]) {
        isMarketApproved[ovrflo][market] = true;
        approvedMarketAt[ovrflo][approvedMarketCount[ovrflo]] = market;
        approvedMarketCount[ovrflo]++;
    }
}
```

**Added view function:**
```solidity
function getApprovedMarket(address ovrflo, uint256 index) external view returns (address) {
    return approvedMarketAt[ovrflo][index];
}
```

---

## Part 2: OVRFLO App UI

New Next.js app in `web/` for stream management. Matches overflow.finance brand.

### Architecture

- Factory deploys **multiple OVRFLOs** (one per underlying: WETH, stETH, rETH, etc.)
- Each OVRFLO has **one OVRFLOToken** and **multiple PT maturities** as series
- Factory tracks all deployments via `ovrflos[]` mapping + `ovrfloCount`
- Adding a new maturity: `factory.addMarket(ovrflo, market, twapDuration, feeBps)`
- UI discovers all OVRFLOs from factory via `NEXT_PUBLIC_OVRFLO_FACTORY`
- If an OVRFLO migrates to a new factory, already-added markets/tokens continue to work (series state is in OVRFLO)

### UI + Web Security Hardening (Mandatory)

1. **Indexer is display-only**
   - Use Envio to list streams/markets for UI rendering.
   - Before any write action (`deposit`, `claim`, `withdraw`), re-read execution-critical values onchain.
   - Never build tx params from indexer-only data.

2. **Strict chain + address gating**
   - Block all writes unless `wallet.chainId === NEXT_PUBLIC_CHAIN_ID`.
   - Validate factory and discovered contract addresses are non-zero and contract addresses before use.
   - Keep a persistent wrong-network banner and disable write buttons on mismatch.

3. **Approval policy**
   - Default approval mode is **exact amount** (PT amount and fee amount).
   - Unlimited approvals, if offered, must be explicit opt-in in settings.

4. **Bigint-only amount math**
   - Use bigint/viem units for all token and slippage math.
   - No JS floating-point math in tx path.
   - `minToUser` must be deterministic round-down:
     - `minToUser = toUser * (10000n - slippageBps) / 10000n`

5. **Write preflight and failure handling**
   - Simulate/estimate before send.
   - Handle and message: user rejection, nonce conflicts, replacement-underpriced, RPC timeout.

6. **Sablier withdraw requires ETH fee**
   - `withdraw(streamId, to, amount)` is `payable` and requires `msg.value >= calculateMinFeeWei(streamId)`.
   - Before each withdrawal, call `calculateMinFeeWei(streamId)` to get the fee.
   - Display the ETH fee to the user and check they have sufficient ETH balance.
   - `withdrawMax` and `withdrawMultiple` also require this fee.

7. **Full Sablier Lockup ABI required in UI**
   - The local interface `ISablierV2LockupLinear` only declares `createWithDurations` (used by the contract).
   - The UI's `lib/contracts.ts` must include the full read+write ABI: `withdraw`, `withdrawMax`, `withdrawableAmountOf`, `calculateMinFeeWei`, `getRecipient`, `statusOf`.

8. **`claim(ptToken, amount)` takes ptToken address, not market**
   - The Claim Modal displays markets by name, but must resolve to `series[market].ptToken` for the contract call.
   - Data flow: user picks market -> UI reads `ovrflo.series(market).ptToken` -> calls `ovrflo.claim(ptToken, amount)`.

9. **Stream-to-market reverse lookup for PT name display**
   - Envio returns stream `asset` (ovrfloToken address) and `endTime`.
   - Match `asset` to OVRFLO via factory enumeration (`ovrfloInfo.ovrfloToken`).
   - Match `endTime` to a specific market's `series.expiryCached` for PT name.
   - This lookup is needed to display the PT name (e.g., "PT-weETH-DEC26") on each stream card.

### Tech Stack

- Next.js 16 (App Router, Turbopack)
- wagmi v3, viem v2
- AppKit by Reown (RainbowKit is stuck on wagmi v2, cannot use)
- TanStack Query v5
- Tailwind CSS
- Sablier Envio GraphQL
- Deploy: Vercel

### Design System (from overflow.finance)

| Element    | Spec                                                    |
| ---------- | ------------------------------------------------------- |
| Background | `#0b1221`                                               |
| Cards      | `#0f1829`, border `#1a2a45`, radius 12px                |
| Text       | `#ffffff` (headings), `#a3c0e8` (body)                  |
| Accent     | `#5dc0f5`                                               |
| Borders    | `#1a2a45`, hover `#264270`                              |
| Typography | Fraunces (display), Geist (body), JetBrains Mono (data) |
| Effects    | Grain overlay, optional radial gradients                |

### App Structure

```
web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Main dashboard
│   └── globals.css
├── components/
│   ├── Header.tsx            # OVRFLO logo, Connect Wallet
│   ├── Footer.tsx            # Twitter, Docs, GitHub links
│   ├── StreamCard.tsx        # Single stream: progress, withdraw
│   ├── StreamList.tsx        # All user streams across all OVRFLOs
│   ├── NewOvrfloModal.tsx    # Two-step: underlying → maturity, deposit
│   ├── SlippageSettings.tsx  # Gear icon, 0.5% default, 0.1-5% range
│   └── ClaimModal.tsx        # Mature markets, burn ovrfloTokens for PT
├── lib/
│   ├── constants.ts          # SABLIER_LOCKUP, OVRFLO_FACTORY
│   ├── contracts.ts          # OVRFLO, factory ABIs
│   ├── sablier.ts            # GraphQL client, stream queries
│   └── wagmi-config.ts       # AppKit + wagmi v3 config
├── package.json
└── tailwind.config.ts
```

### Data Flow

```mermaid
flowchart TB
    subgraph OnChain [On-Chain]
        Factory[OVRFLOFactory]
        OVRFLO[OVRFLO]
        SablierContract[Sablier Lockup]
    end

    subgraph UI [App UI]
        StreamList[StreamList]
        NewOvrflo[NewOvrfloModal]
        Claims[ClaimModal]
    end

    Factory -->|ovrflos[i], ovrfloInfo, approvedMarketCount, getApprovedMarket| NewOvrflo
    Factory -->|ovrflos[i], ovrfloInfo| Claims
    OVRFLO -->|series, previewDeposit, deposit| NewOvrflo
    OVRFLO -->|claim, claimablePt| Claims
    SablierGraphQL[Envio GraphQL] -->|recipient=user, sender=ovrflo| StreamList
    SablierContract -->|withdraw, withdrawableAmountOf| StreamList
```

### Key Implementation Details

**1. OVRFLO enumeration**: Loop `i = 0` to `factory.ovrfloCount() - 1`, call `factory.ovrflos(i)` then `factory.ovrfloInfo(addr)` to get underlying + ovrfloToken + treasury.

**2. Approved markets per OVRFLO**: Loop `i = 0` to `factory.approvedMarketCount(ovrflo) - 1`, call `factory.getApprovedMarket(ovrflo, i)`. For each market, read `ovrflo.series(market)` for full config.

**3. Sablier streams**: Envio Lockup GraphQL `https://indexer.hyperindex.xyz/53b7e25/v1/graphql`. For each OVRFLO, fetch streams where:
   - `recipient = userAddress` (connected wallet)
   - `sender = ovrfloAddress` (streams created by this OVRFLO)
   - `contract = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` (Sablier Lockup)
   - `chainId = 1`

   Merge streams from all OVRFLOs into one list.

   For execution (withdraw/deposit/claim), re-read onchain state before submitting tx.

**4. Caching**: `staleTime: 5 * 60 * 1000` (5 minutes) for approved markets. New markets appear automatically within 5 minutes.

### Sablier GraphQL Query

```graphql
query GetUserStreams($user: String!, $ovrflo: String!) {
  Stream(where: {
    recipient: {_eq: $user},
    sender: {_eq: $ovrflo},
    contract: {_eq: "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9"},
    chainId: {_eq: "1"}
  }) {
    id
    tokenId
    depositAmount
    withdrawnAmount
    startTime
    endTime
    canceled
    depleted
    intactAmount
    asset { symbol decimals address }
  }
}
```

### Two User Flows

**Flow A: Stream Withdrawal (Sablier)**
- Withdraw vested ovrfloTokens from stream to wallet
- Available anytime (linear vesting until maturity)
- Contract: `SablierLockup.withdraw{value: fee}(streamId, to, amount)` (payable, requires ETH fee)
- Before calling: read `calculateMinFeeWei(streamId)` and pass as `msg.value`
- Consider using `withdrawMax(streamId, to)` for simpler UX (withdraws all available)

**Flow B: Claim PT (OVRFLO)**
- Burn ovrfloTokens from wallet to receive PT 1:1
- Only after market maturity, NO stream NFT required
- Contract: `OVRFLO.claim(ptToken, amount)`

### Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Logo                                     Connect Wallet    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  My OVRFLOs                      [New OVRFLO]  [Claim]      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OVRFLO #12345  ·  PT-weETH-DEC26                   │   │
│  │  ████████████░░░░░░░░  58.3% vested                 │   │
│  │  Withdrawable: 1.33 ovrfloWETH         [Withdraw]   │   │
│  │  Ends: Dec 26, 2026                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  OVRFLO #6789  ·  PT-rETH-MAR27                     │   │
│  │  ██████░░░░░░░░░░░░░░  32.1% vested                 │   │
│  │  Withdrawable: 0.45 ovrfloRETH         [Withdraw]   │   │
│  │  Ends: Mar 15, 2027                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Streams from ALL OVRFLOs shown together (PT name shown)    │
│  "OVRFLO #12345" = Sablier stream NFT tokenId              │
│  Empty: "No OVRFLOs yet."                                   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Footer: Twitter  Docs  GitHub                              │
└─────────────────────────────────────────────────────────────┘
```

### New OVRFLO Modal — Two-Step Dropdown

```
┌─────────────────────────────────────────┐
│  New OVRFLO                      [⚙] [X]│
├─────────────────────────────────────────┤
│                                         │
│  Select Underlying                      │
│  [WETH                         ▼]       │
│  [stETH                          ]      │
│  [rETH                           ]      │
│                                         │
│  After selection, replaces with:        │
│                                         │
│  ← WETH                                │
│  Select Maturity                        │
│  [PT-weETH-DEC26              ▼]        │
│  (click "← WETH" to go back)           │
│                                         │
│  Amount (PT)                            │
│  [________________]  Balance: 25.5 PT   │
│                                         │
│  ─────────── Preview ───────────        │
│  Immediate:    9.50 ovrfloWETH          │
│  Streamed:     0.50 ovrfloWETH          │
│  Fee:          0.05 WETH                │
│  Min received: 9.45 ovrfloWETH (0.5%)   │
│  Stream ends:  Dec 26, 2026             │
│  ⚠ Market matures soon (< 24h)         │
│                                         │
│  [Approve PT]        ← Step 1 if needed │
│  [Approve WETH]      ← Step 2 if needed │
│  [Create OVRFLO]     ← Final step       │
└─────────────────────────────────────────┘

Slippage: gear icon, default 0.5%, range 0.1%-5%
minToUser = toUser * (10000 - slippageBps) / 10000

Approval flow:
1. Read series(market) → get ptToken + underlying
2. Check PT allowance → [Approve PT] if needed
3. Check underlying allowance for fee → [Approve WETH] if needed
4. [Create OVRFLO] → deposit(market, ptAmount, minToUser)

Approval mode:
- Default: exact approval amounts
- Optional: unlimited approvals only via explicit user opt-in
```

### Claim Modal

```
┌─────────────────────────────────────────┐
│  Claim                              [X] │
├─────────────────────────────────────────┤
│  Select Mature Market                   │
│  [PT-weETH-DEC26              ▼]        │
│  (shows mature markets across ALL       │
│   OVRFLOs)                              │
│                                         │
│  OVRFLO Balance:    15.50 ovrfloWETH    │
│  PT reserves:       1,234.56 PT         │
│                                         │
│  Amount to claim                        │
│  [________________]           [MAX]     │
│                                         │
│  You receive: 15.50 PT-weETH-DEC26      │
│                                         │
│  [Claim]                                │
└─────────────────────────────────────────┘
```

### Component States & Error Handling

```
StreamList: loading | empty | populated
StreamCard: streaming | fully-vested | depleted | withdrawing | insufficient-eth-for-fee
NewOvrfloModal: loading-markets | no-markets | ready |
  approving-pt | error-approve-pt |
  approving-underlying | error-approve-underlying |
  creating | error-create | success
ClaimModal: loading | no-mature-markets | no-balance |
  ready | claiming | error-claim | success

Errors:
- Modals: Inline error + [Retry]
- StreamCard withdraw: Toast notification
- Wrong network: Persistent banner
- Wallet disconnected: "Please reconnect."

Revert reasons:
- NewOvrflo: slippage, deposit limit, matured, amount < min, nothing to stream
- Claim: insufficient PT reserves, not matured, amount is zero
```

### Address Configuration

**Per-deployment (env):**

| Variable                     | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_OVRFLO_FACTORY` | Factory address (UI discovers OVRFLOs here) |
| `NEXT_PUBLIC_CHAIN_ID`       | Chain ID (e.g. 1 for mainnet)               |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown/AppKit project ID for wallet connect |

**Fixed (constants):**

| Contract              | Address                                      |
| --------------------- | -------------------------------------------- |
| Sablier Lockup        | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` |

**lib/constants.ts:**

```ts
export const SABLIER_LOCKUP = "0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9" as const;
export const OVRFLO_FACTORY = process.env.NEXT_PUBLIC_OVRFLO_FACTORY!;
```

---

## Part 3: Files Modified/Created

| Action   | Path                                   |
| -------- | -------------------------------------- |
| Modified | src/OVRFLOFactory.sol                  |
| Modified | test/OVRFLO.t.sol                      |
| Modified | README.md                              |
| Create   | web/ (full Next.js app)                |

---

## Execution Order

1. Factory contract changes — done, `forge build` passes
2. Create `web/` scaffold — Next.js 16, Tailwind, wagmi v3, AppKit
3. Implement layout, Header, Footer, design system (globals.css)
4. Implement NewOvrfloModal (two-step dropdown, deposit flow, slippage)
5. Implement StreamList (Sablier GraphQL, withdraw, merged across OVRFLOs)
6. Implement ClaimModal (mature markets, claim flow)
7. Wire config and test against fork or testnet
