---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "Wire the Markets UI to OVRFLOLending + OVRFLO contracts"
date: 2026-07-07
revised: 2026-07-14
deepened: 2026-07-14
---

> SUPERSEDED by 2026-07-18-002-feat-web-markets-rebuild-plan.md

# Plan: Wire the Markets UI (mockups) to OVRFLOLending + OVRFLO contracts

Date: 2026-07-07 (revised 2026-07-14 — see Revision Addendum at the bottom)
Status: proposed
Scope: `web/` (Next.js + wagmi + viem), `mockups/`, `script/seed-local.sh`
Goal: A "Markets" page in the real app, matching `mockups/app-tables-v2.html`, fully
wired to the deployed contracts, runnable end-to-end on a local Anvil fork via
`npm --prefix web run bootstrap:local`.

This plan is written to be executed step by step. Every step names exact files, exact function signatures, and exact
verification commands. Do not improvise beyond what is written; where a choice
exists, the choice has already been made here.

---

## Stack decision (locked — do not revisit during implementation)

Evaluated against OVRFLO's needs as a lending platform; everything except the UI
design was on the table. Verdict: keep the current stack, extend the data layer.

| Layer | Decision | Why |
|---|---|---|
| Framework | Keep Next.js static export + React + Tailwind 4 | Landing page needs SEO/metadata; app pages are pure client components; CSP + static-export tooling already exists. A Vite SPA or other framework is a lateral move with migration cost and zero lending-specific gain. |
| Contract IO | Keep wagmi v2 + viem + TanStack Query | Best-in-class typed reads/writes, multicall batching, cache invalidation. No superior alternative exists. |
| Wallet modal | Keep Reown AppKit | Works today. (Acceptable future swap: RainbowKit to drop the WalletConnect Cloud dependency; NOT part of this plan.) |
| Data/indexing | Extend the vendored Envio indexer (`tools/envio/`) to also index OVRFLOLending events | The lending market needs indexed discovery + history. One indexer stack for Sablier AND the lending market beats adding Ponder/The Graph. On-chain enumeration remains the v1/local mechanism (Phase 2); the indexer is Phase 6 and replaces enumeration behind the same hook interfaces. |
| Sablier stream lookup | Hybrid: indexer for discovery, chain for amounts (section 0.7) | Correctness rule: money numbers on screen are never indexer-sourced. |
| Design system | Adopt `DESIGN.md` "Architectural Dark" theme across all of `web/`, replacing the existing light/neobrutalist classes (`nb-*` in `globals.css`) | The existing light theme (white surfaces, hard offset shadows, 2px black borders, blurred scrims) contradicts `DESIGN.md` (obsidian `#050505`, no shadows, no blur, 1px graphite borders, cyan `#00e5ff` / gold `#ffcf00` accents). `mockups/landing-v3.html` and `mockups/app-tables-v2.html` implement the dark theme. The migration is Phase 0 — existing components (`Header`, `Footer`, `Dashboard`, `ClaimModal`, `NewOvrfloModal`, `SlippageSettings`, `StreamList`, `StreamTableRow`) are rewritten to DESIGN.md tokens before any Markets-page work begins. |

---

## High-Level Technical Design

### Component interaction

The frontend discovers and renders lending data through a layered chain:

```
NEXT_PUBLIC_OVRFLO_FACTORY
  │
  ├─ useOvrflos ──────────── vault addresses + infos (treasury, underlying, ovrfloToken)
  │    │
  │    └─ useAllMarkets ──── per-vault approved markets (series metadata: ptToken, expiry, feeBps)
  │         │
  │         └─ useLending ── factory.ovrfloToLending(vault) → lending address + aprMin/Max/feeBps
  │              │
  │              ├─ useLendingOrders ─── all liquidity positions + sale listings (market-wide)
  │              │
  │              └─ useLendingPositions ─ wallet-scoped: my liquidity, loan pools, loans,
  │                                       listings, pledged streams, held streams
  │                    │
  │                    └─ useUserStreams ── Envio GraphQL (recipient=user) + escrow overlay
  │                                       (recipient=lending → intersect with lending state)
  │                                       → on-chain withdrawableAmountOf multicall
  │
  └─ Writes: modal form → preflight (simulateContract) → writeContractAsync
             → waitForTransactionReceipt → cache invalidation (see matrix below)
             → refetch affected hooks
```

External dependency (ZapModal only): Pendle Hosted SDK REST → raw calldata → `sendTransaction`
(cannot be preflighted; failure caught at receipt stage).

### State lifecycle

**Liquidity positions:** `supplied` → `consumed-by-loan` (via `createBorrowerLoanPool`, partial or
full) / `consumed-by-sale` (via `sellStreamToLiquidity`) / `withdrawn` (via `withdrawLiquidity`).
A partially consumed position stays `active` with reduced `availableLiquidity`; the consumed
portion appears as a separate loan-pool contribution with a CLAIM button.

**Loans:** `created` (obligation = full, outstanding = obligation) → `partially-repaid` (drawn +
repaid < obligation) → `closed` (via full `repayLoan` or `closeLoan` when stream accrues to
outstanding). On close, stream returns to borrower.

**Streams:** `deposited` (held by user, recipient=user) → `sold` (transferred to lender) /
`listed` (escrowed in lending, recipient=lending) / `pledged` (escrowed for loan,
recipient=lending) → `returned` (after cancel/close/repay, recipient=user) → `withdrawn`
(Sablier `withdrawMax`, depleted).

**Sale listings:** `posted` (stream escrowed) → `cancelled` (stream returned to seller) /
`taken` (stream transferred to buyer, seller paid net of fee).

### Cache invalidation matrix

The existing codebase has **no cache invalidation pattern** — neither `ClaimModal` nor
`NewOvrfloModal` calls `invalidateQueries` or `refetch` after a successful transaction. The
TanStack Query default `staleTime` is 5 minutes (`providers.tsx`), so on-chain reads won't
refresh until the user navigates away or 5 minutes elapse. The lending market requires immediate
invalidation after writes because a single transaction affects multiple data domains.

Implementation: the lending hooks (sections 2.2-2.4) are built on wagmi's
`useReadContracts`, whose query keys are wagmi-generated and not directly
addressable by `invalidateQueries({ queryKey: [...] })`. Use the `refetch()`
function each hook already returns: `Markets.tsx` passes the relevant `refetch`
callbacks into each modal's `onSuccess` handler. For `useUserStreams` (the only
hook with a custom TanStack Query key, `["streams", factory, user,
sortedAddresses]`), use `queryClient.invalidateQueries({ queryKey: ["streams",
...] })` to override its 5-minute `staleTime`. Do not invent custom key prefixes
like `["lending-orders", lending]` — those queries do not exist under that key.

| Write function | Invalidate |
|---|---|
| `supplyLiquidity` | `useLendingOrders`, `useLendingPositions.lending`, markets table depth |
| `withdrawLiquidity` | `useLendingOrders`, `useLendingPositions.lending`, markets table depth |
| `sellStreamToLiquidity` | `useLendingOrders`, `useUserStreams` (stream transferred), markets table depth |
| `postSaleListing` | `useLendingOrders`, `useUserStreams` (stream escrowed), `useLendingPositions.selling`, markets table FOR SALE |
| `cancelSaleListing` | `useLendingOrders`, `useUserStreams` (stream returned), `useLendingPositions.selling`, markets table FOR SALE |
| `buyListing` | `useLendingOrders`, `useUserStreams` (stream to buyer), markets table FOR SALE |
| `createBorrowerLoanPool` | `useLendingOrders` (liquidity consumed), `useLendingPositions.borrowing` + `.lending`, `useUserStreams` (stream escrowed), markets table depth |
| `repayLoan` | `useLendingPositions.borrowing` + `.lending` (claimable increases), `useUserStreams` (if loan closes, stream returned) |
| `closeLoan` | `useLendingPositions.borrowing` + `.lending`, `useUserStreams` (stream returned) |
| `claimLoanPoolShare` | `useLendingPositions.lending` (received increases, claimable decreases) |
| `withdrawMax` (StreamClaim) | `useLendingPositions.streams` (withdrawable resets), `useUserStreams` |

**Stream-moving writes** (`sellStreamToLiquidity`, `postSaleListing`,
`createBorrowerLoanPool`, `cancelSaleListing`, `buyListing`, `closeLoan`, `repayLoan` when it
closes) must invalidate `useUserStreams` immediately, overriding the 5-minute `staleTime`.
Without this, the STREAMS panel shows a stream as "held" after it has been sold/pledged, and
the SELLING panel won't show a just-listed stream, until a manual refetch.

### Multi-vault hook invocation

`useLending`, `useLendingOrders`, and `useLendingPositions` are single-vault/single-lending
hooks. The Markets page shows all markets from all vaults (`useAllMarkets` spans all
`ovrflos`). To avoid violating React's Rules of Hooks with a dynamic vault count, render one
`<MarketSection>` child component per vault, each calling the hooks independently. The parent
`Markets.tsx` maps over vaults and aggregates totals across sections for the position panels. On
local fork there is one vault, but the component structure must handle the general case.

### Error decoding strategy

The codebase has two error mappers:
- `classifyUserError` (`web/lib/errors.ts`): handles `ContractFunctionRevertedError` via
  `walkFor()`, reads `reverted.reason ?? reverted.data?.errorName ?? reverted.shortMessage`,
  matches against `SIGNALS`. CAN decode custom errors via `data?.errorName` but `SIGNALS` has
  no lending entries.
- `parseUserError` (`web/lib/tx-errors.ts`): substring matching on `error.message` only. Custom
  Solidity errors do NOT appear as substrings in `error.message` in viem's error chain — they
  appear as decoded `errorName` on `ContractFunctionRevertedError`.

Plan: extend `parseUserError` to extract `ContractFunctionRevertedError.data?.errorName` and
match against a custom-error map (the 10 `StreamPricing` errors). Also add `SIGNALS` entries in
`errors.ts` for lending revert strings (note: existing `SIGNALS` uses `/ovrflo: /i`
which matches the vault's revert prefix but not the lending market's `"OVRFLOLending: "`
prefix — different token, not just case — use `/ovrflolending: /i`).

---

## 0. Ground truth: what the contracts actually expose

Read this section first. Every UI number must come from one of these sources.
All names below are verified against `src/OVRFLOLending.sol` and
`src/OVRFLOFactory.sol` as of 2026-07-14.

### 0.1 Addresses and discovery chain

```
env NEXT_PUBLIC_OVRFLO_FACTORY
  -> factory.ovrflos(i) / ovrfloCount()            (vault addresses)
  -> factory.ovrfloInfo(vault)                     (treasury, underlying, ovrfloToken)
  -> factory.approvedMarketCount(vault) / getApprovedMarket(vault, i)
  -> vault.series(market)                          (approved, twapDurationFixed, feeBps,
                                                    expiryCached, ptToken, ovrfloToken,
                                                    underlying, oracle)
  -> factory.ovrfloToLending(vault)                (the OVRFLOLending for that vault)  <-- NEW
```

The frontend already implements everything above except `ovrfloToLending`
(see `web/hooks/useOvrflos.ts`, `web/hooks/useAllMarkets.ts`). The lending address
is the only new discovery step. (The factory also exposes `lendingCount()` /
`lendings(i)` / `lendingToOvrflo(lending)` for enumeration; not needed by the app.)

### 0.2 OVRFLOLending read surface (src/OVRFLOLending.sol)

| Data | Function | Returns |
|---|---|---|
| Market params | `aprMinBps()`, `aprMaxBps()`, `feeBps()` (all `uint16`) | APR bounds and protocol fee. APRs are whole percents only (`APR_STEP_BPS = 100`). Bounds initialize to `LAUNCH_APR_BPS = 1000` (10%). `feeBps` initializes to 0 (the constructor never sets it; the owner sets it via `factory.setLendingFee`) — always read it, never assume. |
| Id cursors | `nextLiquidityId()`, `nextSaleListingId()`, `nextLoanId()`, `nextLoanPoolId()` (all `uint256`, start at 1) | Upper bound (exclusive) for enumeration. |
| Liquidity position | `liquidityState(uint256 liquidityId)` | `(address lender, address market, uint16 aprBps, uint128 availableLiquidity, bool active)`. Reverts `"OVRFLOLending: unknown liquidity"` for never-created ids. |
| Listing | `saleListingState(uint256 listingId)` | `(address seller, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active)`. Reverts for unknown ids. |
| Loan | `loanState(uint256 loanId)` | `(address borrower, address lender, uint256 streamId, uint128 obligation, uint128 drawn, uint128 repaid, uint128 outstanding, bool closed)`. Reverts for unknown ids. |
| Loan pool | `loanPools(uint256 loanPoolId)` | `(address borrower, uint16 aprBps, address market, uint128 totalContributed, uint128 totalObligation)` (public mapping getter; zero struct for unknown ids). |
| Pool accounting | `loanPoolContributions(uint256, address)`, `loanPoolReceived(uint256, address)`, `loanPoolProceeds(uint256)`, `loanPoolLoanId(uint256)`, `loanToLoanPool(uint256)` | Public mapping getters. |
| Pricing | `quote(address market, uint256 streamId, uint16 aprBps, uint128 borrowAmount)` | `(uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual)`. Pass `borrowAmount = 0` to price a full sale (then `grossPrice` is the sale price and `netToBorrower`/`feeAmount` still apply at global `feeBps`). Reverts on ineligible streams. |
| Liquidity matching | `gatherLiquidity(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)` | `(uint256[] ids, bool sufficient)`. Use `startId = 1`. |

### 0.3 OVRFLOLending write surface

| Action | Function | Token movements (what the user must approve first) |
|---|---|---|
| Supply lending/buying liquidity | `supplyLiquidity(address market, uint16 aprBps, uint128 availableLiquidity)` | Pulls `availableLiquidity` of `underlying` from caller. Approve `underlying` -> lending. |
| Withdraw liquidity | `withdrawLiquidity(uint256 liquidityId)` | Refunds remaining liquidity in `underlying`. No approval. |
| Sell stream into liquidity | `sellStreamToLiquidity(uint256 liquidityId, uint256 streamId, uint256 minNetOut)` | Transfers the Sablier stream NFT from caller to the position's lender; pays caller `underlying` (net of global `feeBps`). Approve Sablier NFT -> lending. |
| List stream for sale | `postSaleListing(address market, uint256 streamId, uint16 aprBps)` | Escrows the stream NFT in the lending market. Approve Sablier NFT -> lending. |
| Cancel listing | `cancelSaleListing(uint256 listingId)` | Returns the stream NFT. No approval. |
| Buy a listing | `buyListing(uint256 listingId, uint256 maxPriceIn)` | Pulls `grossPrice` of `underlying` from caller; transfers stream NFT to caller. Approve `underlying` -> lending. |
| Borrow | `createBorrowerLoanPool(uint256[] liquidityIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)` | Escrows the stream NFT; pays caller `underlying` net of fee. Approve Sablier NFT -> lending. This is the ONLY way loans are created. `liquidityIds` must be strictly increasing and share one market + aprBps. |
| Repay | `repayLoan(uint256 loanId, uint128 amount)` | Pulls `amount` of `ovrfloToken` from caller (borrower only). Approve `ovrfloToken` -> lending. |
| Close (permissionless) | `closeLoan(uint256 loanId)` | Draws remaining outstanding from the stream, returns stream to borrower. No approval. |
| Claim lender share | `claimLoanPoolShare(uint256 loanPoolId, uint128 amount)` | Pays caller `ovrfloToken`. `amount` is a request capped at claimable; reverts `"OVRFLOLending: nothing claimable"` when nothing is payable. No approval. |

### 0.4 Denomination rules (get these right in every label)

- Liquidity amounts, sale prices, loan principal, borrower net proceeds:
  **underlying** (wstETH on the local fixture — see AGENTS.md: wstETH, not
  stETH, is the correct vault underlying).
- Loan obligation, repayments, loan-pool proceeds, lender claims, stream
  payouts: **ovrfloToken**.
- All 18 decimals. APRs are bps, whole-percent steps, clamped to
  `[aprMinBps, aprMaxBps]` (both are `1000` = 10% at launch; read them, never
  hardcode).

### 0.5 Sablier stream NFT

The lending market moves streams with `sablier.transferFrom`, so the user must
first call either `approve(lending, streamId)` or `setApprovalForAll(lending, true)`
on the Sablier Lockup contract (`SABLIER_LOCKUP` in `web/lib/config.ts`). Use
per-stream `approve` (least privilege). User streams are already fetched via the
Envio indexer (`web/lib/sablier.ts: fetchUserStreams`), which returns
`tokenId` = streamId.

### 0.6 Discovery strategy decision

Two mechanisms, phased:

- **Phases 2-5 (this plan's core):** enumerate the lending market on-chain. Id
  spaces are small, monotonic from 1, and `useReadContracts` batches everything
  into multicalls. Foolproof, no infra.
- **Phase 6 (production data layer):** extend the vendored Envio indexer
  (`tools/envio/`) with OVRFLOLending events so discovery and history scale. The
  hooks from Phase 2 keep their return shapes; only their internals change.

### 0.7 Sablier stream lookup (decision)

The best lookup is a hybrid with one hard rule: **the indexer discovers stream
IDs; the chain supplies every displayed amount.**

1. **Discovery** — Envio GraphQL (`web/lib/sablier.ts`), filtered to
   `sender IN (vault addresses)`. Two recipient queries, not one:
   - `recipient = user` -> streams the wallet holds (including streams BOUGHT on
     the lending market — a purchase is an NFT transfer, so the indexer's
     recipient updates). Feeds the **STREAMS panel** only.
   - `recipient = lending` -> escrowed streams; intersect with lending state
     (`saleListings` where `seller = user`, open `loans` where `borrower = user`)
     to recover the user's listed and pledged streams. Feeds the **SELLING
     panel** only. Without this overlay the user's listed/pledged streams
     vanish from the UI. Implementation: add a new function
     `fetchEscrowedStreams({ user, lendingAddresses, ovrfloAddresses })` that
     queries `recipient IN (lendingAddresses) AND sender IN (ovrfloAddresses)`,
     then matches returned streamIds against `useLendingOrders.listings` (where
     `seller == user`) and `useLendingPositions.borrowing.loans` (where
     `borrower == user`). For multi-vault, resolve all lending addresses from
     `useLending` per vault before querying.
2. **Live amounts** — for every stream id surfaced, read on-chain via one
   multicall: `withdrawableAmountOf(streamId)`, `getDepositedAmount(streamId)`,
   `getWithdrawnAmount(streamId)` (compute face remaining as
   `deposited - withdrawn`), and (for escrow sanity)
   `getRecipient(streamId)`. Indexer fields (`depositAmount`, `withdrawnAmount`,
   `intactAmount`) may be used for sorting/labels only, never for action inputs
   or displayed balances.
3. **Local loop** — the vendored indexer at `http://localhost:8080/v1/graphql`
   already serves this (bootstrap:local wires `NEXT_PUBLIC_SABLIER_INDEXER_URL`).

### 0.8 What OVRFLO lending ACTUALLY is (drives all rate/depth labels)

OVRFLO is not a pooled money market. There is no utilization curve, no floating
"supply APY" vs "borrow APY" spread, and no interest accrual per block. What
actually happens:

- Lenders supply **fixed-APR liquidity positions** in underlying, at
  whole-percent rates inside the owner-set band `[aprMinBps, aprMaxBps]` (both
  1000 = 10% at launch, so at launch there is exactly ONE rate).
- A single liquidity position is consumable two ways at the SAME rate: as a
  **loan** (`createBorrowerLoanPool`; the position's lender becomes the loan-pool
  lender; borrower's obligation = principal grossed up at that APR to maturity)
  or as a **purchase** (`sellStreamToLiquidity`; the lender buys the stream
  outright at that APR discount). The lender cannot restrict which.
- The borrower's true cost = position APR + the protocol fee (`lending.feeBps`,
  0 at launch) taken from proceeds up front. The lender's true yield = position
  APR (fee is paid by the taker side, not the liquidity supplier).
- There is no term choice: everything matures at the series expiry.

Therefore the market table must NOT say "LEND APR" / "BORROW APR" as if they were
independent floating rates. Correct columns are specified in section 3.2.

---

## Phase 0 — Theme migration: adopt DESIGN.md across web/

The existing `web/` app uses a light/neobrutalist theme (`nb-*` classes in
`globals.css`: white surfaces, `#5dc0f5` accent, `4px 4px 0 0 #000` hard shadows,
`2px solid #000` borders, `backdrop-filter: blur(8px)` on modals). `DESIGN.md`
specifies a dark "Architectural Dark" system that the mockups already implement.
This phase replaces the light theme entirely so the Markets page (Phase 3) and all
existing pages share one consistent design language.

### 0.0 Rewrite `web/app/globals.css`

Replace all `nb-*` custom utility classes and CSS variables with DESIGN.md tokens:

| DESIGN.md token | Value | Replaces |
|---|---|---|
| `--obsidian` | `#050505` | `--color-surface: #ffffff` |
| `--carbon` | `#111111` | (new; secondary bg / hovers) |
| `--graphite` | `#333333` | `2px solid #000` borders → `1px solid var(--graphite)` |
| `--chalk` | `#f4f4f4` | `--color-ink: #000000` |
| `--dim` | `#888888` | (new; muted text) |
| `--accent-cyan` | `#00e5ff` | `--color-accent: #5dc0f5` (borrow side) |
| `--accent-gold` | `#ffcf00` | (new; lend side) |

Remove all `box-shadow` declarations (DESIGN.md: no drop shadows). Remove
`backdrop-filter: blur(...)` from modal overlays (DESIGN.md: no blur). Set
`border-radius: 0` (or max `2px`) on all elements. Add the 40px grid background
pattern overlay. Add `font-variant-numeric: tabular-nums` to all mono data
elements. Load `IBM Plex Mono` alongside `Inter` (both via `next/font`).

### 0.1 Migrate existing components

Each component in `web/components/` must be rewritten to DESIGN.md tokens. No
component retains `nb-*` classes or light-theme styling. Affected component
Vitest suites in `web/tests/components/` (ClaimModal, Dashboard, StreamList,
etc.) must be updated as part of the migration — selectors and class assertions
that reference `nb-*` or light-theme values will fail otherwise.

- `Header.tsx`: transparent bg with 1px graphite bottom border; nav links mono,
  dim → chalk on hover; "Markets" link added here (for Phase 3.1).
- `Footer.tsx`: 1px graphite top border, dim mono text.
- `Dashboard.tsx`: obsidian bg, chalk text, graphite-bordered sections.
- `ClaimModal.tsx` / `NewOvrfloModal.tsx`: carbon panel, 1px graphite border,
  no shadow, no blur scrim (85% opacity obsidian), mono step list for tx
  lifecycle, bordered summary row. These become the modal pattern for Phase 3.
- `SlippageSettings.tsx`: transparent inputs with 1px graphite border, mono
  numeric entry, focus border → chalk (no glow/outline).
- `StreamList.tsx` / `StreamTableRow.tsx`: flat border-collapse table, mono
  uppercase headers, bottom borders only for rows. Replace `animate-pulse`
  skeleton with dim mono `—` / `LOADING` placeholders (DESIGN.md section 10:
  no spinners or skeleton shimmer).
- `WalletActionCta` / wallet connection UI: follow DESIGN.md button rules
  (transparent bg, 1px border matching text color, hover inverts).

### 0.2 Migrate the landing page to `mockups/landing-v3.html`

Replace `web/app/page.tsx` (the landing page) with the structure and styling from
`mockups/landing-v3.html`. The mockup already implements DESIGN.md: 1200px fixed
column with graphite rails, split panels with 1px vertical rule, ASCII diagrams
in mono, stat-label treatment for section headers.

### 0.3 Verification

```bash
npm --prefix web run build      # static export succeeds with new theme
npm --prefix web run dev        # visual check: every page is dark-themed
```

Manual check: navigate Dashboard, deposit flow, stream list — all pages render
on obsidian bg with chalk text, graphite borders, no shadows, no blur. The
landing page matches `mockups/landing-v3.html`.

---

## Phase 1 — Contracts side: expose the lending market locally

### 1.0 Realign `script/seed-local.sh` with the current factory (prerequisite)

The seed script has drifted from `src/OVRFLOFactory.sol` and
`script/lib/OVRFLOTestFixtures.sol` and will fail as-is. Fix before adding the
lending step (keep the constants in lockstep with `OVRFLOTestFixtures.sol`, per
the script's own comment):

1. Factory constructor is now `constructor(address _owner, address _oracle)` —
   `forge create` needs `--constructor-args "$OWNER" "$ORACLE"`.
2. `prepareOracle` is now `prepareOracle(address market, uint32 twapDuration)`
   (2 args — the oracle is a factory immutable, drop the `$ORACLE` argument).
3. `addMarket` is now `addMarket(address ovrflo, address market, uint32
   twapDuration, uint16 feeBps)` (4 args — drop `$ORACLE`).
4. Underlying is wstETH, not stETH: `configureDeployment` with
   `WSTETH=0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`, name suffix
   `"Wrapped Staked Ether"`, symbol suffix `"WSTETH"` (matching
   `OVRFLOTestFixtures.sol`).
5. Dev wallet seeding: replace the stETH transfer with wstETH — `submit` ETH to
   stETH as today, then `stETH.approve(WSTETH, bal)` +
   `WSTETH.wrap(bal)` from the owner, then transfer the wstETH balance to
   `$DEV_WALLET`.
6. **Seed a second anvil wallet** (needed for the Phase 5 manual flow —
   `createBorrowerLoanPool` enforces `lender != borrower`, so the dev wallet
   cannot borrow against its own liquidity). Use anvil account #2
   (`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`,
   pk `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`).
   Transfer wstETH and PT to this wallet alongside the dev wallet. Add
   `--arg lenderWallet "$LENDER_WALLET"` and `lenderWallet: $lenderWallet` to
   `deployments/local.json`.

Verification: `bash script/seed-local.sh` completes against a fresh anvil fork
at block 24609670. This is a **hard prerequisite** — if the realignment fails
(e.g., the wstETH wrapping path has issues), Phase 1.1 (lending deploy) and all
downstream phases are blocked. Do not proceed until the seed script succeeds.

### 1.1 Extend `script/seed-local.sh` to deploy the lending market

After the `[4/6] approve markets` step, add a step that calls (owner-only):

```bash
echo "[5/7] deploy OVRFLOLending"
send "$FACTORY" 'deployLending(address)' "$OVRFLO"
LENDING=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrfloToLending(address)(address)' "$OVRFLO")
echo "      lending = $LENDING"
```

Renumber the existing `[5/6]`/`[6/6]` step labels to `[6/7]`/`[7/7]`, add
`--arg lending "$LENDING"` to the final `jq` invocation and a `lending: $lending`
field to `deployments/local.json`, and print `lending:` in the summary block.

Note: the lending market launches with `aprMinBps = aprMaxBps = 1000` (10% only)
and `feeBps = 0`. That is fine for the local loop; do not add
`setLendingAprBounds` / `setLendingFee` calls unless a test needs a second rate
or a nonzero fee.

Verification:

```bash
npm --prefix web run bootstrap:local:clean || true
npm --prefix web run bootstrap:local
jq .lending deployments/local.json          # non-zero address
cast call <LENDING> 'aprMinBps()(uint16)' --rpc-url http://127.0.0.1:8545   # 1000
```

(If `bootstrap-local.sh` snapshots or caches the seed, re-run the clean variant
first. Do not run `forge script --broadcast` against local anvil — foundry#11714.)

### 1.2 No new env var

The frontend derives the lending address from `factory.ovrfloToLending(vault)`.
Do not add a `NEXT_PUBLIC_LENDING` variable and do not modify
`tools/scripts/write-env.sh`.

---

## Phase 2 — Frontend data layer

### 2.1 ABIs — edit `web/lib/contracts.ts`

Append these exports (same hand-written minimal-ABI style as the file already
uses, `as const` on every array):

1. `ovrfloFactoryAbi`: add one entry
   - `ovrfloToLending(address) -> address`, view.
2. New `ovrfloLendingAbi` with these entries (plus error definitions per section 3.4):
   - views: `aprMinBps() -> uint16`, `aprMaxBps() -> uint16`, `feeBps() -> uint16`,
     `nextLiquidityId() -> uint256`, `nextSaleListingId() -> uint256`,
     `nextLoanId() -> uint256`, `nextLoanPoolId() -> uint256`,
     `liquidityState(uint256) -> (address,address,uint16,uint128,bool)` with named
     outputs `(lender, market, aprBps, availableLiquidity, active)`,
     `saleListingState(uint256) -> (address,address,uint256,uint16,uint16,bool)`
     named `(seller, market, streamId, aprBps, listingFeeBps, active)`,
     `loanState(uint256) -> (address,address,uint256,uint128,uint128,uint128,uint128,bool)`
     named `(borrower, lender, streamId, obligation, drawn, repaid, outstanding, closed)`,
     `loanPools(uint256) -> (address,uint16,address,uint128,uint128)`
     named `(borrower, aprBps, market, totalContributed, totalObligation)`,
     `loanPoolContributions(uint256,address) -> uint128`,
     `loanPoolReceived(uint256,address) -> uint128`,
     `loanPoolProceeds(uint256) -> uint128`,
     `loanPoolLoanId(uint256) -> uint256`, `loanToLoanPool(uint256) -> uint256`,
     `quote(address,uint256,uint16,uint128) -> (uint256,uint128,uint256,uint256,uint128)`
     named `(grossPrice, obligation, feeAmount, netToBorrower, residual)`,
     `gatherLiquidity(address,uint16,uint128,uint256) -> (uint256[],bool)`.
   - writes: `supplyLiquidity(address,uint16,uint128) -> uint256`,
     `withdrawLiquidity(uint256)`, `sellStreamToLiquidity(uint256,uint256,uint256)`,
     `postSaleListing(address,uint256,uint16) -> uint256`,
     `cancelSaleListing(uint256)`, `buyListing(uint256,uint256)`,
     `createBorrowerLoanPool(uint256[],uint256,uint128,uint128) -> uint256`,
     `repayLoan(uint256,uint128)`, `closeLoan(uint256)`,
     `claimLoanPoolShare(uint256,uint128)`.
3. `sablierLockupAbi`: add entries
   - `approve(address to, uint256 tokenId)`, nonpayable
   - `getApproved(uint256 tokenId) -> address`, view
   - `getRecipient(uint256 streamId) -> address`, view (needed by StreamClaim
     preflight in 3.3 item 7)
   - `getDepositedAmount(uint256 streamId) -> uint128`, view (face remaining
     computation per 0.7)
   - `getWithdrawnAmount(uint256 streamId) -> uint128`, view (face remaining
     computation per 0.7)
   - `isApprovedForAll(address owner, address operator) -> bool`, view (skip
     redundant per-stream approve when operator approval is already set)
   - `withdrawableAmountOf` already exists; keep it.

Cross-check every signature against `src/OVRFLOLending.sol` before committing; a
wrong ABI fails silently as reverts.

### 2.2 New hook `web/hooks/useLending.ts`

Resolves the lending market and its params for a vault:

```ts
useLending(ovrflo: `0x${string}` | undefined): {
  lending?: `0x${string}`;       // factory.ovrfloToLending(ovrflo), undefined if zero address
  aprMinBps?: number; aprMaxBps?: number; feeBps?: number;
  isLoading: boolean; error?: Error;
}
```

Implementation: one `useReadContract` for `ovrfloToLending`, then one
`useReadContracts` (enabled when lending is set) for the three params. Treat
`0x000...0` as "no lending deployed" (return `lending: undefined`, no error).
Follow the memoization/error style of `useAllMarkets.ts` and reuse
`getReadContractsError` from `web/lib/errors.ts`.

### 2.3 New hook `web/hooks/useLendingOrders.ts`

Enumerates liquidity positions and listings for one lending market:

```ts
useLendingOrders(lending?: `0x${string}`): {
  liquidity: LendingLiquidity[]; // { id: bigint, lender, market, aprBps, availableLiquidity, active }
  listings: LendingListing[];    // { id: bigint, seller, market, streamId, aprBps, listingFeeBps, active }
  isLoading: boolean; error?: Error; refetch: () => void;
}
```

Implementation, exactly this shape:
1. `useReadContracts` for `nextLiquidityId` + `nextSaleListingId`.
2. Build contract arrays `liquidityState(i)` for `i in [1, nextLiquidityId)` and
   `saleListingState(i)` for `i in [1, nextSaleListingId)`; one batched
   `useReadContracts` with `allowFailure: true` (default). Individual result
   failures are impossible here (ids below the cursor always exist) but keep
   `allowFailure` anyway.
3. Map results into the typed arrays. Keep inactive rows in the arrays (callers
   filter); tag each row with its id.
4. Cap enumeration at 500 ids per side; if `nextLiquidityId > 501`, surface
   `error: new Error("Lending market too large for on-chain enumeration")`.
   (Local and devnet stay far below this; the cap prevents pathological
   multicalls.)

### 2.4 New hook `web/hooks/useLendingPositions.ts`

Everything shown in the "Lending" and "Borrowing" panels for the connected wallet:

```ts
useLendingPositions(lending: `0x${string}` | undefined, user: `0x${string}` | undefined): {
  lending: {
    myLiquidity: LendingLiquidity[];          // lender === user, active
    suppliedLiquidity: bigint;                // sum of active availableLiquidity (underlying)
    loanPools: LenderPool[];                  // pools where loanPoolContributions[poolId][user] > 0
    totalClaimable: bigint;                   // sum of claimable across pools (ovrfloToken)
  };
  borrowing: {
    loans: BorrowerLoan[];                    // loanState rows where borrower === user
    totalObligation: bigint; totalOutstanding: bigint;  // ovrfloToken
  };
  selling: {
    myListings: LendingListing[];             // seller === user, active (SELLING panel)
    pledged: BorrowerLoan[];                  // open loans' escrowed streams (PLEDGED badge)
  };
  streams: HeldStream[];                      // STREAMS panel: streams where recipient == user
                                              // (from useUserStreams), each with on-chain
                                              // withdrawableAmountOf. Escrowed streams
                                              // (recipient == lending) are NOT here — they
                                              // appear in selling.myListings / selling.pledged.
  isLoading: boolean; error?: Error; refetch: () => void;
}
```

Enumeration mirrors 2.3: read `nextLoanId` + `nextLoanPoolId`, batch
`loanState(i)` and `loanPools(i)` (filter out zero structs where
`borrower == 0x000...0` — `loanPools` is a mapping getter and does not revert),
then a second batch for `loanPoolContributions(poolId, user)`,
`loanPoolReceived(poolId, user)`, `loanPoolProceeds(poolId)`,
`loanPoolLoanId(poolId)` on **all enumerated pools** (not just "pools the user
touched" — you only learn which pools were touched by reading contributions, so
the batch must cover every pool id in `[1, nextLoanPoolId)`), plus
`withdrawableAmountOf(streamId)` on the Sablier lockup for each open pool loan.

Claimable per pool (`LenderPool.claimable`) replicates `_claimFair` exactly:

```
loan       = loanState(loanPoolLoanId[loanPoolId])
recovered  = loan.drawn + loan.repaid
             + (loan.closed ? 0 : min(withdrawableAmountOf(loan.streamId), loan.outstanding))
entitled   = loanPoolContributions[loanPoolId][user] * recovered / pool.totalContributed   // floor
claimable  = entitled > loanPoolReceived[loanPoolId][user]
             ? entitled - loanPoolReceived[loanPoolId][user] : 0
```

Do this math in `bigint`. Put the pure function in `web/lib/lending-math.ts` as
`loanPoolClaimable(...)` so it is unit-testable without wagmi.

### 2.5 New pure module `web/lib/lending-math.ts`

- `loanPoolClaimable(...)` as above.
- `formatAprBps(aprBps: number): string` -> `"10.00%"` (reuse helpers from
  `web/lib/format.ts` where they exist; do not duplicate).
- `aprChoices(minBps: number, maxBps: number): number[]` -> inclusive whole-percent
  steps of 100 bps. Used by every rate `<select>`.

Unit tests in `web/tests/lib/lending-math.test.ts` (Vitest, mirror existing test
style): claimable floor rounding, claimable clamps at zero when
`loanPoolReceived > entitled`, open vs closed loan recovery, apr step generation
with min == max.

---

## Phase 3 — Frontend UI

Follow `DESIGN.md` strictly (mono for data, cyan = borrow side, gold = lend side,
sharp corners, 1px graphite borders, tabular-nums). After Phase 0, all existing
components (`ClaimModal.tsx`, `NewOvrfloModal.tsx`, `Header.tsx`, etc.) already
use DESIGN.md dark-theme tokens — reuse their migrated structure as the pattern
for modal layout, `useModalA11y`, error mapping via `web/lib/tx-errors.ts`, and
preflight checks via `web/lib/preflight.ts`. Do not reintroduce any `nb-*` light
classes.

### 3.1 New route `web/app/markets/page.tsx`

Server component wrapper (Header/Footer/Suspense, same as `app/page.tsx`) around a
client `components/Markets.tsx`. Add a "Markets" link to `components/Header.tsx`.

### 3.2 `components/Markets.tsx` layout (top to bottom)

1. **Position panels — the four roles.** A connected customer can hold four
   position types simultaneously; render a 2x2 grid of bordered boxes (stacked
   single-column below ~800px). Labels have no "YOUR" prefix — the wallet is
   connected, possession is implicit. Empty panels render their dim mono empty
   state (`NO OPEN LOANS`, etc.), never disappear.
   - `LENDING` (gold): active liquidity positions (rate, remaining liquidity in
     underlying, `WITHDRAW` each), loan-pool contributions with per-pool
     claimable (ovrfloToken) and `CLAIM` buttons, totals across both. Settled
     pools (loan closed, claimable = 0) stay visible, dimmed with a `SETTLED`
     badge for one session-worth of history; they do not disappear immediately.
     Note: a single supply action can result in two LENDING panel entries — a reduced
     liquidity position (remaining `availableLiquidity`) and a loan-pool
     contribution (the consumed portion, recoverable via `claimLoanPoolShare`).
     `withdrawLiquidity` on a partially consumed position refunds only the
     remaining `availableLiquidity`, not the consumed portion.
   - `BORROWING` (cyan): per-loan rows with obligation, outstanding, pledged
     stream id, a **self-repay progress bar** (`(drawn + repaid) / obligation`,
     per DESIGN.md ProgressBar rules), `REPAY` button, and `CLOSE` enabled when
     `withdrawableAmountOf(streamId) >= outstanding`; totals. Note: the progress
     bar reflects realized recovery (actual draws/repayments), not stream
     accrual. A loan may be closable (withdrawable >= outstanding) while the
     progress bar shows 0%; add a dim `CLOSABLE` mono label when this is the
     case.
   - `STREAMS` (gold; the buyer position): every stream the wallet holds —
     deposited, bought on the lending market, or returned after loan close
     (discovery per section 0.7). Per row: face remaining, **withdrawable now**
     (on-chain read), maturity countdown, and two actions: `CLAIM` (Sablier
     `withdrawMax(streamId, user)` with `msg.value = calculateMinFeeWei(streamId)`
     — the holder claims accrued ovrfloToken; this satisfies the signed-in
     stream-claim requirement and reuses the Dashboard's existing withdraw
     pattern) and `SELL` (opens SellModal preloaded with that stream).
   - `SELLING` (cyan): active sale listings (escrowed streams) with live ask
     price (`quote(market, streamId, aprBps, 0)` read) and `CANCEL` each;
     pledged-as-collateral streams shown here read-only with a `PLEDGED` badge so
     the user never loses sight of an escrowed stream.
   - Render the grid only when a wallet is connected; otherwise the existing
     `WalletActionCta` pattern.
2. **Markets table** — one row per approved market (from `useAllMarkets`).
   Columns reflect what the lending market actually is (section 0.8), NOT
   money-market supply/borrow spreads:
   - `ASSET`: PT symbol + maturity date + countdown.
   - `LIQUIDITY DEPTH`: sum of active liquidity (underlying) — capital standing
     ready to lend or buy at the market rate.
   - `FOR SALE`: count of active listings + aggregate live ask (underlying).
   - `APR`: the admitted rate band from `aprMinBps`/`aprMaxBps` (a single number
     at launch, e.g. `10.00%`; render `min-max%` when they diverge). One neutral
     column, chalk — the SAME rate is a lender's yield and a borrower's accrual,
     so splitting it into "LEND APR"/"BORROW APR" columns misrepresents the
     mechanism.
   - `FEE`: `lending.feeBps` as percent, dim — always deducted from the
     stream-holder side's proceeds (borrowers and sellers), never from
     liquidity suppliers or buyers. 0 at launch.
   - Actions: `LEND` (gold), `BORROW` (cyan), `SELL` (gold outline), `BUY` (cyan
     outline). BUY disabled when the market has no active listings; all four
     disabled + `MATURED` badge when `expiry <= now`.
   - Borrower cost transparency lives in the BorrowModal quote breakdown (APR +
     fee -> net proceeds and obligation), not in extra table columns.
3. **Market depth detail** (per selected market, below the table): two flat
   tables — active liquidity positions (id, lender truncated, APR, remaining
   liquidity) and active listings (id, seller, streamId, APR, live price via
   `quote(market, streamId, aprBps, 0)` read). This is what BUY consumes. Use
   `allowFailure: true` for per-listing quote reads; a listing whose stream has
   become ineligible (depleted, canceled, or market matured since posting) will
   revert. Render failed listings as `STREAM DEPLETED` with a `CANCEL` action
   (the seller should cancel to recover the NFT, even if the stream is empty).
   Batched quote reads in the SELLING panel follow the same pattern.

### 3.3 Transaction modals (new files in `web/components/`)

All modals: show exact consequences before signing (per DESIGN.md section 9),
approval step first when allowance/getApproved is insufficient, wagmi
`useWriteContract` + `useWaitForTransactionReceipt`, refetch relevant hooks on
success.

1. **LendModal.tsx** — `supplyLiquidity`.
   Inputs: market (preselected), APR `<select>` from `aprChoices`, liquidity amount.
   Steps: `underlying.approve(lending, amount)` if `allowance < amount`, then
   `supplyLiquidity(market, aprBps, amount)`.
   Summary row: `LIQUIDITY <n> <underlying> @ <apr>% APR`.
2. **BorrowModal.tsx** — `createBorrowerLoanPool`.
   Inputs: one of the user's eligible streams (from `useUserStreams`, filtered
   by **series match**: `stream.sender === vault` AND
   `Number(stream.endTime) === Number(market.expiry)` AND
   `stream.asset.address === market.ovrfloToken` — all series on the same vault
   share the same sender and ovrfloToken, so the contract discriminates via
   `getEndTime(streamId) == expiryCached`; selecting a wrong-series stream
   reverts with `WrongEndTime`). Also filter out depleted/canceled streams.
   APR select, target borrow amount.
   Preview: call `quote(market, streamId, aprBps, targetBorrow)` (read) and show
   `grossPrice`, `obligation`, `feeAmount`, `netToBorrower`, `residual`. Label
   `residual` as "RETURNED AT CLOSE" so the user understands the economics.
   Cap the amount input at `grossPrice`.
   Liquidity selection: assemble `liquidityIds` client-side from
   `useLendingOrders.liquidity` — filter `active && market === selectedMarket &&
   aprBps === selectedApr && lender !== user`, sort ascending by id, and
   accumulate `availableLiquidity` until `targetBorrow` is met. This replaces
   `gatherLiquidity` (which counts the caller's own positions in its
   `sufficient` flag and stops scanning before reaching later non-self
   positions, causing false "insufficient" results after self-exclusion). If
   accumulated liquidity < `targetBorrow`, show "insufficient liquidity" and
   disable submit. If all rate-matching liquidity is self-owned (every
   position's `lender === user`), show "no borrowable liquidity at this rate
   (your own liquidity is excluded)" instead, so the user understands why.
   All data is already in the hook; no extra contract call
   needed.
   Steps: `sablier.approve(lending, streamId)` if `getApproved(streamId) != lending`
   AND `!isApprovedForAll(user, lending)`,
   then `createBorrowerLoanPool(ids, streamId, targetBorrow, minAcceptable)` where
   `minAcceptable = netToBorrower * (1 - slippageBps)` using the existing
   `SlippageSettings` component.
   Partial fill: the transaction may succeed with `actualBorrow < targetBorrow`
   if liquidity was consumed between preview and submission — but only when
   the shortfall stays within the slippage tolerance (since `minAcceptable` is
   derived from the full `targetBorrow` quote, any shortfall beyond tolerance
   reverts `"OVRFLOLending: slippage"`). After success, refetch and show the
   actual loan terms (obligation, net proceeds) from `loanState` / `loanPools`,
   not the preview.
3. **SellModal.tsx** — two tabs sharing one modal. Stream picker applies the
   same **series match** filter as BorrowModal (sender + endTime + asset).
   - "Sell now" (`sellStreamToLiquidity`): pick stream, show best-price preview
     via `quote(market, streamId, position.aprBps, 0)`; pick the cheapest-APR
     active position with `availableLiquidity >= grossPrice` (compute client-side
     from `useLendingOrders`); steps: stream approve, then
     `sellStreamToLiquidity(liquidityId, streamId, minNetOut)` with
     slippage-derived `minNetOut`. Handle "liquidity inactive" and "insufficient
     availableLiquidity" reverts by re-fetching `useLendingOrders` and
     re-selecting, or surfacing "liquidity no longer available, refresh."
   - "List for sale" (`postSaleListing`): pick stream + APR; steps: stream
     approve, then `postSaleListing(market, streamId, aprBps)`.
   When opened from the markets table SELL action, the market is preselected and
   the stream picker is populated with the user's series-matched streams (none
   pre-selected). If no eligible streams, show "NO ELIGIBLE STREAMS FOR THIS
   MARKET."
4. **BuyModal.tsx** — `buyListing`.
   Shows the selected listing's live `grossPrice` (from `quote` with the LISTING's
   `aprBps` and `borrowAmount = 0`) and fee at the listing's snapshotted
   `listingFeeBps`. Note: `listingFeeBps` is fixed (snapshotted at post time)
   but `grossPrice` is re-priced at fill time, so the net amount the seller
   receives may differ from the preview. Compute the fee client-side as
   `grossPrice * listingFeeBps / 10000`; do not use `quote`'s `feeAmount`,
   which applies the global `feeBps` (not the listing's snapshotted fee).
   Steps: `underlying.approve(lending, maxPriceIn)` then
   `buyListing(listingId, maxPriceIn)` with `maxPriceIn = grossPrice *
   (1 + slippageBps)`.
5. **RepayModal.tsx** — `repayLoan`.
   Input capped at `outstanding`; "MAX" fills `outstanding` exactly (closing repay
   returns the stream — say so in the summary). Note: a lender's claim-harvest
   between UI read and tx submission increases `drawn`, shrinking `outstanding`,
   so a "MAX" repay can revert `"OVRFLOLending: repay too much"`. Handle by
   re-fetching `useLendingPositions` on revert and re-displaying the updated
   `outstanding`. Steps:
   `ovrfloToken.approve(lending, amount)` then `repayLoan(loanId, amount)`.
6. **Claim + Close + Cancels** need no modal-grade input: wire them as
   confirm-only modals or inline two-click buttons following the existing
   `ClaimModal` pattern. `claimLoanPoolShare(loanPoolId, type(uint128).max)` —
   pass `max` as the amount; the contract caps it at actual claimable via
   `_minUint128(amount, claimable)`, so the user claims everything available in
   one call without stale-data risk. Disable the CLAIM button when computed
   claimable is 0 (the contract reverts with "nothing claimable").
   `closeLoan(loanId)`; `withdrawLiquidity(id)`; `cancelSaleListing(id)`.
7. **StreamClaim** (STREAMS panel `CLAIM` action) — reuse the Dashboard's
   existing withdraw flow: `sablier.withdrawMax(streamId, user)` with
   `msg.value = calculateMinFeeWei(streamId)` (both already in
   `sablierLockupAbi`). Preflight: `withdrawableAmountOf > 0` and the wallet is
   the current on-chain recipient (`getRecipient(streamId) == user` — add
   `getRecipient` to the ABI; verify it exists on the deployed Sablier Lockup
   at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`; if unavailable, use
   `ownerOf(streamId) == user` as an equivalent check for non-cancelable
   streams). Never rely on indexer recipient for this check.
8. **ZapModal.tsx — underlying -> PT -> deposit (Pendle SDK path).**
   Purpose: a customer holding only underlying (wstETH) can enter OVRFLO in
   one flow without leaving the app.
   - Quote/calldata source: **Pendle Hosted SDK** (REST — no heavy npm package;
     this respects the no-new-dependencies rule):
     `GET https://api-v2.pendle.finance/core/v1/sdk/1/markets/{market}/swap`
     with query `receiver=<user>&tokenIn=<underlying>&tokenOut=<ptToken>`
     `&amountIn=<wei>&slippage=<fraction>`. Response contains
     `data.{tx: {to, data, value}, amountOut, priceImpact}` where `tx.to` is the
     Pendle Router. Add a small client in `web/lib/pendle.ts` with the same
     fetch/error hygiene as `web/lib/sablier.ts`; base URL behind
     `NEXT_PUBLIC_PENDLE_API_URL` (default `https://api-v2.pendle.finance/core`).
   - Preview panel chains both legs so fees are explicit, "PTs from their
     underlying less the OVRFLO fees": Pendle `amountOut` (PT) ->
     `vault.previewDeposit(market, amountOut)` -> show
     `PT received`, `OVRFLO fee (feeAmount)`, `ovrfloToken to wallet (toUser)`,
     `streamed (toStream)`, price impact.
   - Steps: `underlying.approve(pendleRouter, amountIn)` -> raw
     `sendTransaction(tx)` from the SDK response -> `ptToken.approve(vault, ptOut)`
     -> `vault.deposit(market, ptOut, minToUser)` (slippage-derived `minToUser`,
     reusing `SlippageSettings`). Four steps, one modal, per-step status list per
     DESIGN.md section 9.
   - **Deposit fee approval**: if `previewDeposit` returns `feeAmount > 0`, add
     `underlying.approve(vault, feeAmount)` before `vault.deposit` (the vault
     pulls the fee in underlying from the caller). Mirror the existing
     `NewOvrfloModal` which already handles this. At launch `feeBps = 0` so this
     is a no-op, but the modal must be correct for nonzero fees.
   - **Actual balance, not quoted**: after the Pendle swap, read the user's
     actual `ptToken.balanceOf(user)` delta and use that amount (not the SDK's
     `amountOut`) for steps 3-4. Positive slippage may deliver more PT than
     quoted; depositing the quoted `ptOut` would under-deposit.
   - **Failure recovery**: on any step failure, show completed steps as
     confirmed and the failed step as retryable. If the swap (step 2) succeeds
     but approve/deposit (steps 3-4) fail, the PT is in the user's wallet and
     is not lost — show "PT received, retry deposit" and allow retrying from
     step 3. The existing `NewOvrfloModal` can serve as a manual fallback.
   - **Two-tier error strategy**: the raw `sendTransaction` (step 2) cannot be
     preflighted (no ABI entry for the Pendle Router calldata); failure is
     caught at `useWaitForTransactionReceipt` time. The `approve` and `deposit`
     steps (3-4) CAN be preflighted via `simulateContract`. Handle each tier
     with the appropriate error mapper.
   - **tx.to validation**: pin the canonical Pendle Router address as a
     hardcoded constant in `web/lib/config.ts` (verified against Pendle's
     docs/registry at implementation time). Before sending, require
     `tx.to === PENDLE_ROUTER` and the approval spender to equal it.
     If `NEXT_PUBLIC_PENDLE_API_URL` is compromised or spoofed, this prevents
     an attacker contract from receiving both the approval and the calldata
     execution. Reject the quote with "invalid router address" if the check
     fails. Do not derive the constant from the API response (trust-on-first-use
     would pin the attacker's address on the first call).
   - The zap is additive: the plain PT `deposit` path (existing
     `NewOvrfloModal`) stays for users who already hold PT.
   - Local-fork caveat: the hosted SDK quotes against LIVE mainnet state, which
     drifts from the pinned fork block. On local, expect the swap leg to be
     inaccurate or fail; guard the modal with an env check
     (`NEXT_PUBLIC_RPC_URL` pointing at 127.0.0.1 -> show a dim
     `ZAP UNAVAILABLE ON LOCAL FORK` note and test only the preview rendering).
     Full zap verification happens on devnet/mainnet.

### 3.4 Error and preflight handling

- **Error decoding strategy**: see the High-Level Technical Design section above
  for the two-mapper strategy (`parseUserError` extended for custom errors via
  `ContractFunctionRevertedError.data?.errorName`, plus `SIGNALS` entries in
  `errors.ts` with `/ovrflolending: /i` prefix (the existing `SIGNALS` uses
  `/ovrflo: /i` which matches the vault's revert prefix but not the lending
  market's `"OVRFLOLending: "` prefix — different token, not just case).
- Map known revert strings to friendly copy in `web/lib/tx-errors.ts` (append,
  do not rewrite): `"OVRFLOLending: slippage"`,
  `"OVRFLOLending: insufficient availableLiquidity"`,
  `"OVRFLOLending: loan not closable"`, `"OVRFLOLending: not lender"`,
  `"OVRFLOLending: not listing seller"`, `"OVRFLOLending: not borrower"`,
  `"OVRFLOLending: repay too much"`, `"OVRFLOLending: apr out of bounds"`,
  `"OVRFLOLending: apr not whole"`, `"OVRFLOLending: borrow above price"`,
  `"OVRFLOLending: self-match"`, `"OVRFLOLending: nothing claimable"`,
  `"OVRFLOLending: liquidity inactive"`,
  `"OVRFLOLending: unknown liquidity"`, `"OVRFLOLending: unknown loan"`,
  `"OVRFLOLending: unknown listing"`, `"OVRFLOLending: duplicate or unsorted ids"`,
  `"OVRFLOLending: empty liquidity"`, `"OVRFLOLending: borrow zero"`,
  `"OVRFLOLending: repay zero"`, `"OVRFLOLending: claim zero"`,
  `"OVRFLOLending: price zero"`, `"OVRFLOLending: availableLiquidity zero"`,
  `"OVRFLOLending: nothing outstanding"`, `"OVRFLOLending: transfer mismatch"`,
  `"OVRFLOLending: loan closed"`, `"OVRFLOLending: listing inactive"`,
  `"OVRFLOLending: not loan pool lender"`, `"OVRFLOLending: market mismatch"`,
  `"OVRFLOLending: apr mismatch"`.
- Eligibility/maturity failures surface as CUSTOM ERRORS from
  `src/StreamPricing.sol` (`SeriesMatured`, `MarketNotApproved`,
  `SeriesNotApproved`, `WrongSender`, `WrongAsset`, `WrongEndTime`,
  `CliffPresent`, `CancelableStream`, `RemainingZero`, `CoreNotRegistered`). Add these error
  definitions to `ovrfloLendingAbi` (type "error" entries) so viem decodes them,
  and map each to friendly copy (e.g. `SeriesMatured` -> "This market has
  matured; trading is closed.", `WrongEndTime` -> "This stream belongs to a
  different series.", `RemainingZero` -> "This stream is fully vested.").
- Expired markets: `quote`/`gatherLiquidity` revert post-maturity. Guard in
  UI: if `market.expiry <= now`, render the row dimmed with actions disabled
  (label `MATURED`), and skip quote reads. Use `allowFailure: true` for all
  batched quote reads so a single matured/depleted stream
  doesn't fail the entire batch; handle failures per-row by dimming and
  disabling actions on refetch.
- **No-lending-deployed empty state**: when `ovrfloToLending(vault)` returns
  `address(0)`, render that vault's market rows with lending columns as
  `NOT DEPLOYED` (dim mono) and lending actions disabled. The seed always
  deploys lending for every vault (Phase 1.1), so this is a devnet/mainnet-only
  concern.
- **Single-APR select at launch**: when `aprMinBps == aprMaxBps` (launch
  config), `aprChoices` returns one element. Render the APR as a dim mono
  fixed value, not a disabled `<select>`, to avoid implying choice.

### 3.5 Tests (Vitest, `web/tests/`)

- `tests/lib/lending-math.test.ts` (see 2.5).
- `tests/hooks/useLendingOrders.test.ts`: mock `useReadContracts` (mirror how
  existing hook tests mock wagmi) — verifies id-range construction from cursors,
  inactive rows retained, cap error at >500, zero-struct pool filtering
  (`borrower == address(0)`).
- `tests/components/Markets.test.tsx`: renders with mocked hooks; asserts all
  four panel labels are exactly "LENDING" / "BORROWING" / "STREAMS" / "SELLING"
  (no "YOUR" anywhere), the markets table headers are
  ASSET / LIQUIDITY DEPTH / FOR SALE / APR / FEE, BUY disabled with zero
  listings, MATURED badge when `expiry <= now`, `NOT DEPLOYED` when lending
  address is zero.
- `tests/lib/pendle.test.ts`: mocked fetch — happy path parses `tx`/`amountOut`,
  HTTP and GraphQL-style error paths throw typed errors.
- `tests/lib/lending-math-fork.test.ts` (optional, fork-based): cross-validate
  `loanPoolClaimable` against the contract's `claimLoanPoolShare` on a mainnet
  fork — assert that `claimLoanPoolShare` reverts with "nothing claimable" iff
  `loanPoolClaimable` returns 0. This closes the drift risk between
  `lending-math.ts` and `_claimFair`.

---

## Phase 4 — Mockup corrections (mockups/, do together with Phase 3 so the app matches)

1. `mockups/app-tables-v2.html` (already partially renamed to OVRFLOLending
   vocabulary; the structural corrections below are still pending):
   - `YOUR LENDING` -> `LENDING`; `YOUR BORROWS` -> `BORROWING`; drop possessive
     wording anywhere else.
   - Replace the two-panel strip with the 2x2 four-role grid from section 3.2:
     `LENDING`, `BORROWING`, `STREAMS` (with mock withdrawable + CLAIM/SELL),
     `SELLING` (mock listing row: stream id, APR, live ask, CANCEL; plus one
     `PLEDGED` badge row).
   - Fix the markets table headers to ASSET / LIQUIDITY DEPTH / FOR SALE / APR /
     FEE per section 3.2 (the current LEND APR / BORROW APR split misrepresents
     the single-rate market — see section 0.8; "LiquidityPosition Depth" is a
     mechanical rename artifact, use LIQUIDITY DEPTH).
   - Add `SELL` (gold outline) and `BUY` (cyan outline) buttons to each market row
     alongside `LEND` / `BORROW`.
   - Update the wiring-map comment at the top of the file to match section 0 of
     this plan: current function/mapping names (`liquidityState`,
     `gatherLiquidity`, `loanPoolContributions`, `loanPoolProceeds`), liquidity
     amounts and prices in underlying (wstETH), obligations in ovrfloToken —
     the current comment wrongly says amounts are ovrfloToken-denominated, names
     a nonexistent `.capacity` field, and still shows a Lend/Borrow APR spread.
2. `mockups/landing-v3.html`: center the System Architecture block within the
   right hero column. Keep `border-left` on the column; inside it, wrap the label
   and `<pre>` in a div and center that div horizontally, e.g. change the column to
   `display:flex; flex-direction:column; align-items:center; justify-content:center;
   padding-left:0;` (the label stays left-aligned relative to the diagram). Result:
   the diagram sits in the middle of the right half, as in "The Self-Repaying.heic",
   not hugging the divider.
3. Marketing copy: mention buying/selling explicitly. Hero paragraph already says
   "Sell the stream"; add a buy-side clause (e.g. "or buy discounted streams
   outright") and ensure the FOR LENDERS block notes that liquidity can be filled
   as purchases, not only loans (the contract's unified-liquidity semantics).

---

## Phase 5 — Local end-to-end verification (run all of it)

```bash
# 1. Fresh local stack (anvil fork + deploy + lending + envio + env)
npm --prefix web run bootstrap:local
jq . deployments/local.json                       # has factory, ovrflo, token, lending

# 2. Static checks
npm --prefix web run lint:security
npm --prefix web run test
npm --prefix web run build

# 3. App
npm --prefix web run dev
```

Manual flow in the browser (two wallets required — `createBorrowerLoanPool`
enforces `lender != borrower`, so the liquidity provider cannot be the same
wallet as the borrower):

- **Dev wallet** (anvil key #1, `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`):
  deposits PT, borrows against streams, repays, sells, buys, claims streams.
- **Lender wallet** (anvil account #2, `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`):
  supplies liquidity that the dev wallet borrows against.

1. Dashboard (dev wallet): deposit PT into the primary market -> receive
   ovrfloToken + a stream.
2. Markets / LEND (**lender wallet**): supply liquidity at 10% APR with 50
   wstETH. LENDING panel shows supplied liquidity 50; the position appears in
   the market depth detail; LIQUIDITY DEPTH updates.
3. Markets / BORROW (**dev wallet**): pledge the stream from step 1, target
   borrow within the quoted `grossPrice`. The BorrowModal filters out the
   dev wallet's own liquidity (if any) and uses the lender wallet's position.
   Wallet wstETH increases by `netToBorrower`; BORROWING panel shows the loan
   with `outstanding = obligation`.
4. Advance time to accrue the stream:
   `cast rpc evm_increaseTime 604800 --rpc-url http://127.0.0.1:8545 && cast rpc evm_mine --rpc-url http://127.0.0.1:8545`.
   LENDING panel (lender wallet) claimable becomes > 0; `claimLoanPoolShare`
   pays ovrfloToken.
5. REPAY the loan in full with ovrfloToken (dev wallet) -> loan closes, stream
   returns to the dev wallet (BORROWING panel empties).
6. SELL (dev wallet): list the returned stream via `postSaleListing`; the
   stream moves from the STREAMS panel to the SELLING panel. From the same
   wallet, BUY it back via `buyListing` (self-trade is allowed for sale
   listings). Prices move in wstETH; the listing deactivates; the stream
   reappears under STREAMS.
7. STREAMS / CLAIM (dev wallet): after another `evm_increaseTime`, the stream
   shows withdrawable > 0; CLAIM (`withdrawMax`) pays ovrfloToken to the wallet
   and the panel's withdrawable resets to ~0.
8. Withdraw a leftover liquidity position (lender wallet) -> remaining liquidity
   refunds.

Each step must reflect on-chain state after refetch without a page reload.

---

## Phase 6 — Envio indexer extension (production data layer)

Do this only after Phases 1-5 are green. It changes hook internals, not UI.

1. Extend `tools/envio/` config + schema with OVRFLOLending entities driven by
   its events (all listed in `src/OVRFLOLending.sol`): `LiquidityPosition` (from
   `LiquiditySupplied`/`LiquidityWithdrawn`/`StreamSoldToLiquidity`/
   `BorrowerLoanPoolCreated` consumption), `SaleListing` (from
   `StreamSaleListingPosted`/`Cancelled`/`Taken`), `Loan` (from
   `BorrowerLoanPoolCreated`/`LoanRepaid`/`LoanClosed`), `LoanPool`
   (+ `LoanPoolShareClaimed`), and an append-only `LendingActivity` entity (one
   row per event) for the activity feed. The lending address comes from the
   factory's `LendingDeployed` event.
2. Swap `useLendingOrders` / `useLendingPositions` discovery from id enumeration
   to GraphQL queries against the same endpoint config as `web/lib/sablier.ts`
   (`NEXT_PUBLIC_SABLIER_INDEXER_URL` — one indexer serves both schemas).
   Return shapes must not change; live amounts (availableLiquidity, outstanding,
   withdrawable, claimable) STAY on-chain reads per section 0.7's rule.
3. Remove the 500-id enumeration cap once the swap lands.
4. Specify `staleTime`, `refetchInterval`, and cache key conventions for the
   GraphQL-backed hooks. Match the `useUserStreams` pattern
   (`["streams", factory, user, sortedAddresses]`) but with shorter `staleTime`
   (or `refetchInterval` polling, e.g. 15s) for near-real-time lending data.
   The GraphQL query needs the lending address as a filter; resolve it on-chain
   first via `useLending`, then pass to the query.

## Phase 7 — Customer-expectation backlog (OVRFLO-specific, ordered)

Items a customer will reasonably expect. Implement after Phase 5-6, in this order.

1. **Wrap / Unwrap** (highest priority; it is a core exit path and currently has
   no UI): `vault.wrap(amount)` / `vault.unwrap(amount)` (underlying <->
   ovrfloToken 1:1, bounded by the wrap reserve). Panel on the Dashboard;
   show remaining unwrap capacity from the vault's wrap reserve accessor.
2. **Matured-series claim surfacing**: when `expiry <= now`, promote the
   existing `claim` (burn ovrfloToken -> PT) flow: matured markets get a
   `CLAIM PT` action in the markets table and a Callout on the Dashboard.
3. **USD context**: extend the existing `useUsdPrices` to annotate liquidity
   depth, obligations, and stream values with dim USD equivalents (display only).
4. **Activity history**: per-wallet table (supplied, filled, borrowed, repaid,
   claimed, bought, sold) from the Phase 6 `LendingActivity` entity, with tx links.
5. **Self-repay ETA**: on each open loan, project when
   `withdrawableAmountOf >= outstanding` (linear stream => closable date is
   computable client-side from stream start/end/deposit) and render
   `CLOSABLE ~<date>`; enable a `NOTIFY` mailto/ics stub, no backend.
6. **Obligation vs stream health check** in BorrowModal: warn when
   `residual` from `quote` is a small fraction of the stream (the user is
   borrowing near the stream's full value and will get little back at close).
7. **Liquidity guardrails**: LendModal shows the market's remaining time to
   maturity and warns when supplying into a series expiring within 7 days.
8. **ZapModal** (moved from execution step 8): underlying -> PT -> deposit
   via Pendle Hosted SDK. See section 3.3 item 8 for the full spec. The
   Pendle SDK API endpoint/params/response in that spec need rewriting
   against the current Convert API before implementation (doc-review P0
   finding). Full verification deferred to devnet/mainnet.

---

## Execution order and checkpoints

| Step | Deliverable | Checkpoint |
|---|---|---|
| 0 | Phase 0: rewrite globals.css + migrate all existing components to DESIGN.md dark theme + landing page to landing-v3 | `npm --prefix web run build` and `npm --prefix web run test` green; all pages dark-themed |
| 1 | Phase 1.0 seed realignment + seed-local.sh lending deploy + deployments/local.json | Phase 1 verification commands pass |
| 2 | ABIs + useLending + useLendingOrders + lending-math (+ unit tests) | `npm --prefix web run test` green |
| 3 | useLendingPositions + stream discovery overlay (0.7) (+ claimable math tests) | test green |
| 4 | Markets page skeleton + four position panels + corrected table (reads only) | page renders live data from local fork |
| 5 | LendModal + withdraw liquidity | manual flow steps 2, 8 |
| 6 | BorrowModal + RepayModal + close | manual flow steps 3-5 |
| 7 | SellModal + BuyModal + StreamClaim | manual flow steps 6-7 |
| 8 | Mockup corrections (Phase 4) | visual check: diagram centered in right hero column, four-role grid, corrected table headers, SELL/BUY buttons present |
| 9 | Full Phase 5 sweep + `npm --prefix web run lint:security && npm --prefix web run build` | all green |
| 10 | Phase 6 indexer swap | hooks return identical shapes; enumeration cap removed |
| 11 | Phase 7 backlog items 1-3 minimum | wrap/unwrap + matured claim + ZapModal usable |

Rules for the implementer:
- Treat this file as a read-only spec; do not edit it while implementing.
- Never run `forge script --broadcast` against local anvil (foundry#11714); the
  seed path is `bash script/seed-local.sh` via `bootstrap:local`.
- Match existing code style in `web/` (hand-written minimal ABIs, hook patterns
  from `useAllMarkets`, modal patterns from the Phase 0 migrated `ClaimModal`);
  do not add new dependencies. `DESIGN.md` is the visual authority — no `nb-*`
  light classes, no shadows, no blur, no border-radius > 2px.
- All bigint math stays bigint; never route token amounts through `Number`.

---

## Validation Addendum (2026-07-07)

End-to-end validation against the lending contract source, existing `web/` code,
and `script/seed-local.sh`. All contract signatures, math, and referenced
infrastructure were verified (names updated to post-rename equivalents in the
2026-07-14 revision).

### Verified correct

- All contract function signatures match source: `claimLoanPoolShare`, `quote`,
  `gatherLiquidity`, `loanState` (8 returns incl. computed `outstanding`),
  `saleListingState` (6 returns incl. `listingFeeBps`), `loanPools` struct
  (5 fields after the pool `active` field removal in commit `5afa9dc`).
- `quote(borrowAmount=0)` prices the full stream — confirmed in source:
  `effectiveBorrowAmount = borrowAmount == 0 ? grossPrice : borrowAmount`.
- `loanPoolClaimable` math in `web/lib/lending-math.ts` correctly replicates
  `_claimFair`'s `claimable` computation. Traced the invariant:
  `entitled <= loanPoolProceeds + harvestable` always holds (for open loans the
  harvest covers the deficit; for closed loans `sum(entitled_all) ==
  loanPoolProceeds` so any individual `entitled <= loanPoolProceeds`). Therefore
  the entitled amount is fully backed by available proceeds (not merely
  theoretical); the per-call claimable remains `entitled -
  loanPoolReceived[user]` as specified in section 2.4.
- All referenced existing code verified present: `SABLIER_LOCKUP` in `config.ts`,
  `fetchUserStreams` in `sablier.ts`, `SlippageSettings` component,
  `calculateMinFeeWei` and `withdrawMax` (payable) and `withdrawableAmountOf`
  already in `sablierLockupAbi`.
- `getRecipient` and `ovrfloToLending` correctly identified as needing ABI
  additions.
- `buyListing` has no self-match guard — self-buy is allowed (plan step 6 valid).
- DESIGN.md exists.
- M-02 net slippage check (`netToBorrower >= minAcceptable`) confirmed in source.

### Gaps to address during implementation

1. **Zero-struct pool filtering in `useLendingPositions`.** `loanPools(uint256)`
   is a public mapping getter that returns a zero struct for unknown ids (unlike
   `liquidityState`/`loanState`/`saleListingState` which revert). When
   enumerating `loanPools(1)` through `loanPools(nextLoanPoolId)`, filter out
   results where `borrower == address(0)` to avoid phantom pools. `allowFailure`
   is irrelevant for `loanPools` reads (mapping getters never revert). Add this
   to section 2.4's implementation.

2. **Fully-settled pool UI treatment** (resolved 2026-07-14). Settled pools
   (loan closed, claimable = 0) stay visible, dimmed with a `SETTLED` badge
   for one session-worth of history. They do not disappear immediately.
   Section 3.2 item 1 updated with this decision.

3. **ZapModal placement** (resolved 2026-07-14). ZapModal moves to Phase 7
   backlog. The core markets loop (lend, borrow, sell, buy, claim, repay,
   close — steps 1-7) is fully testable on local fork without it. Execution
   step 8 is removed; the execution order compresses from 12 to 11 steps.
   ZapModal (section 3.3 item 8) and `web/lib/pendle.ts` are now Phase 7
   items. This also removes the only new external API dependency from the
   core execution path.

4. **Self-match constraint in manual flow** (resolved 2026-07-14 deepening). The
   Phase 5 manual flow now uses two anvil wallets (lender + dev) because
   `createBorrowerLoanPool` enforces `lender != borrower`. The seed script
   (Phase 1.0 item 6) seeds a second anvil key with wstETH + PT.

5. **Series-match stream filter** (resolved 2026-07-14 deepening). All series on
   the same vault share the same `sender` and `ovrfloToken`. The contract
   discriminates markets via `getEndTime(streamId) == expiryCached` (reverts
   `WrongEndTime`). BorrowModal and SellModal stream pickers now specify a
   series-match filter: `stream.sender === vault` AND
   `Number(stream.endTime) === Number(market.expiry)` AND
   `stream.asset.address === market.ovrfloToken`.

6. **Cache invalidation infrastructure** (added 2026-07-14 deepening). The
   existing codebase has no cache invalidation pattern after writes. The HTD
   section now includes a full cache invalidation matrix mapping each write
   function to the hooks/queries that must be invalidated. Stream-moving writes
   must invalidate `useUserStreams` immediately, overriding the 5-minute
   `staleTime`.

7. **Error decoding for custom Solidity errors** (added 2026-07-14 deepening).
   `parseUserError` in `tx-errors.ts` does substring matching on
   `error.message` which cannot decode custom errors. The HTD error decoding
   strategy specifies extending `parseUserError` to extract
   `ContractFunctionRevertedError.data?.errorName` and adding `SIGNALS` entries
   in `errors.ts` with case-insensitive `/ovrflolending: /i` prefix.

8. **Claimable math drift risk** (added 2026-07-14 deepening).
   `lending-math.ts`'s `loanPoolClaimable` replicates `_claimFair` but has no
   cross-validation against the contract. Section 3.5 now includes an optional
   fork-based integration test that asserts `claimLoanPoolShare` reverts with
   "nothing claimable" iff `loanPoolClaimable` returns 0.

---

## Revision Addendum (2026-07-14)

The plan was refreshed against current `main` (52df0d3). No implementation had
started (`web/` has no markets page, lending hooks, or lending ABIs). Changes:

1. **OVRFLOBook -> OVRFLOLending rename** (commits `e2e5305` and the
   OVRFLOBook->OVRFLOLENDING rebrand). Every contract, function, mapping, event,
   and revert-string reference updated, verified against `src/OVRFLOLending.sol`
   and `src/OVRFLOFactory.sol`:
   - factory: `deployBook`/`ovrfloToBook` -> `deployLending`/`ovrfloToLending`;
     event `BookDeployed` -> `LendingDeployed`; admin forwarders are
     `setLendingAprBounds`/`setLendingFee`/`setLendingTreasury`.
   - offers -> liquidity positions: `postOffer` -> `supplyLiquidity`,
     `cancelOffer` -> `withdrawLiquidity`, `sellIntoOffer` ->
     `sellStreamToLiquidity`, `offerState` -> `liquidityState` (field
     `capacity` -> `availableLiquidity`, `maker` -> `lender`), `nextOfferId` ->
     `nextLiquidityId`, `gatherOfferCapacities` -> `gatherLiquidity`.
   - pools -> loan pools: `createBorrowPool` -> `createBorrowerLoanPool`,
     `claimPoolShare` -> `claimLoanPoolShare`, `pools` -> `loanPools` (first
     field is `borrower`, not `creator`), `nextPoolId` -> `nextLoanPoolId`,
     `poolContributions`/`poolReceived`/`poolProceeds`/`poolLoanId`/`loanPoolId`
     -> `loanPoolContributions`/`loanPoolReceived`/`loanPoolProceeds`/
     `loanPoolLoanId`/`loanToLoanPool`.
   - listings: `maker` -> `seller`.
   - revert prefix `"OVRFLOBook: "` -> `"OVRFLOLending: "`; added
     `"not listing seller"`, `"not lender"`, `"self-match"`,
     `"borrow above price"`, `"nothing claimable"` to the 3.4 map; dropped the
     nonexistent `"insufficient capacity"`/`"not offer maker"` strings.
2. **Planned frontend names updated to match**: `useBook`/`useBookOrders`/
   `useBookPositions`/`book-math.ts`/`ovrfloBookAbi` -> `useLending`/
   `useLendingOrders`/`useLendingPositions`/`lending-math.ts`/
   `ovrfloLendingAbi`; markets-table column `OFFER DEPTH` -> `LIQUIDITY DEPTH`
   and `BOOK APR` -> `APR` (test assertions in 3.5 updated to match).
3. **Underlying is wstETH, not stETH** (per AGENTS.md learned fact and
   `OVRFLOTestFixtures.sol`). All denomination examples and the manual flow
   updated.
4. **New Phase 1.0**: `script/seed-local.sh` drifted from the current factory
   (constructor now takes `(owner, oracle)`; `prepareOracle` and `addMarket`
   dropped their oracle argument; fixture underlying is wstETH) and must be
   realigned before the lending deploy step is added.
5. **`feeBps` launches at 0**: the OVRFLOLending constructor never sets it;
   noted in 0.2/0.8 and the FEE column spec.
6. **Gap #1 filter updated**: filter phantom `loanPools` rows by
   `borrower == address(0)` (the struct no longer matches the old
   `(creator, ...)` shape).
7. **Phase 4 note**: `mockups/app-tables-v2.html` was mechanically renamed to
   OVRFLOLending vocabulary on 2026-07-14 but still needs every structural
   correction listed (four-role grid, header fix, SELL/BUY buttons, wiring-map
   comment rewrite).
8. **Deepening pass (2026-07-14)**: ce-plan confidence check dispatched a
   spec-flow-analyzer (Implementation Units) and an architecture-strategist
   (HTD + System-Wide Impact). All findings accepted. Key additions:
   - New High-Level Technical Design section (component interaction, state
     lifecycle, cache invalidation matrix, multi-vault hook pattern, error
     decoding strategy).
   - C-1 fix: Phase 5 manual flow now uses two anvil wallets (lender + dev) to
     avoid the self-match revert; Phase 1.0 seeds a second anvil key.
   - C-2 fix: BorrowModal/SellModal stream pickers now specify a series-match
     filter (sender + endTime + asset) to prevent `WrongEndTime` reverts.
   - I-2: BorrowModal filters self-owned liquidity from `gatherLiquidity` results.
   - I-1/I-3: ZapModal adds deposit fee approval, actual-balance-not-quoted,
     failure recovery, and two-tier error strategy.
   - I-4/I-5: Section 0.7 escrow overlay implementation specified; STREAMS vs
     SELLING panel boundary clarified.
   - I-6: Partial liquidity consumption UX note in LENDING panel.
   - I-7: Depleted listing handling with `allowFailure: true` + "STREAM DEPLETED"
     state.
   - I-9/I-10: Partial-fill and position-availability-race handling in modals.
   - X-1/X-2/X-3: Cache invalidation matrix, stream-write invalidation, error
     decoding strategy (all in HTD section).
   - M-1 through M-9: progress-bar semantics, claim amount strategy, stream
     pre-selection, `getRecipient` verification, no-lending empty state,
     single-APR select, mid-session maturity, residual labeling, listing fee
     semantics.
   - Section 3.4 expanded with complete revert string list and `allowFailure`
     guidance.
   - Section 3.5 expanded with zero-struct pool filtering test, fork-based
     claimable math cross-validation test, and MATURED/NOT DEPLOYED assertions.
   - Phase 6 expanded with cache convention specs (staleTime, refetchInterval,
     cache keys).
   - Validation Addendum gaps 4-8 added for the resolved/new findings.
