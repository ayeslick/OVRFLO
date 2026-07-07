---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
title: "Wire the Markets UI to OVRFLOBook + OVRFLO contracts"
date: 2026-07-07
---

# Plan: Wire the Markets UI (mockups) to OVRFLOBook + OVRFLO contracts

Date: 2026-07-07
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
| Data/indexing | Extend the vendored Envio indexer (`tools/envio/`) to also index OVRFLOBook events | An order book needs indexed discovery + history. One indexer stack for Sablier AND the book beats adding Ponder/The Graph. On-chain enumeration remains the v1/local mechanism (Phase 2); the indexer is Phase 6 and replaces enumeration behind the same hook interfaces. |
| Sablier stream lookup | Hybrid: indexer for discovery, chain for amounts (section 0.7) | Correctness rule: money numbers on screen are never indexer-sourced. |
| Design system | Adopt `DESIGN.md` "Architectural Dark" theme across all of `web/`, replacing the existing light/neobrutalist classes (`nb-*` in `globals.css`) | The existing light theme (white surfaces, hard offset shadows, 2px black borders, blurred scrims) contradicts `DESIGN.md` (obsidian `#050505`, no shadows, no blur, 1px graphite borders, cyan `#00e5ff` / gold `#ffcf00` accents). `mockups/landing-v3.html` and `mockups/app-tables-v2.html` implement the dark theme. The migration is Phase 0 — existing components (`Header`, `Footer`, `Dashboard`, `ClaimModal`, `NewOvrfloModal`, `SlippageSettings`, `StreamList`, `StreamTableRow`) are rewritten to DESIGN.md tokens before any Markets-page work begins. |

---

## 0. Ground truth: what the contracts actually expose

Read this section first. Every UI number must come from one of these sources.

### 0.1 Addresses and discovery chain

```
env NEXT_PUBLIC_OVRFLO_FACTORY
  -> factory.ovrflos(i) / ovrfloCount()            (vault addresses)
  -> factory.ovrfloInfo(vault)                     (treasury, underlying, ovrfloToken)
  -> factory.approvedMarketCount(vault) / getApprovedMarket(vault, i)
  -> vault.series(market)                          (approved, twapDurationFixed, feeBps,
                                                    expiryCached, ptToken, ovrfloToken,
                                                    underlying, oracle)
  -> factory.ovrfloToBook(vault)                   (the OVRFLOBook for that vault)  <-- NEW
```

The frontend already implements everything above except `ovrfloToBook`
(see `web/hooks/useOvrflos.ts`, `web/hooks/useAllMarkets.ts`). The book address is
the only new discovery step.

### 0.2 OVRFLOBook read surface (src/OVRFLOBook.sol)

| Data | Function | Returns |
|---|---|---|
| Book params | `aprMinBps()`, `aprMaxBps()`, `feeBps()` (all `uint16`) | APR bounds and protocol fee. APRs are whole percents only (`APR_STEP_BPS = 100`). |
| Id cursors | `nextOfferId()`, `nextSaleListingId()`, `nextLoanId()`, `nextPoolId()` (all `uint256`, start at 1) | Upper bound (exclusive) for enumeration. |
| Offer | `offerState(uint256 offerId)` | `(address maker, address market, uint16 aprBps, uint128 capacity, bool active)`. Reverts `"OVRFLOBook: unknown offer"` for never-created ids. |
| Listing | `saleListingState(uint256 listingId)` | `(address maker, address market, uint256 streamId, uint16 aprBps, uint16 listingFeeBps, bool active)`. Reverts for unknown ids. |
| Loan | `loanState(uint256 loanId)` | `(address borrower, address lender, uint256 streamId, uint128 obligation, uint128 drawn, uint128 repaid, uint128 outstanding, bool closed)`. Reverts for unknown ids. |
| Pool | `pools(uint256 poolId)` | `(address creator, uint16 aprBps, address market, uint128 totalContributed, uint128 totalObligation)` (public mapping getter; zero struct for unknown ids). |
| Pool accounting | `poolContributions(uint256, address)`, `poolReceived(uint256, address)`, `poolProceeds(uint256)`, `poolLoanId(uint256)`, `loanPoolId(uint256)` | Public mapping getters. |
| Pricing | `quote(address market, uint256 streamId, uint16 aprBps, uint128 borrowAmount)` | `(uint256 grossPrice, uint128 obligation, uint256 feeAmount, uint256 netToBorrower, uint128 residual)`. Pass `borrowAmount = 0` to price a full sale (then `grossPrice` is the sale price and `netToBorrower`/`feeAmount` still apply at global `feeBps`). Reverts on ineligible streams. |
| Offer matching | `gatherOfferCapacities(address market, uint16 aprBps, uint128 targetAmount, uint256 startId)` | `(uint256[] ids, bool sufficient)`. Use `startId = 1`. |

### 0.3 OVRFLOBook write surface

| Action | Function | Token movements (what the user must approve first) |
|---|---|---|
| Post lending/buying liquidity | `postOffer(address market, uint16 aprBps, uint128 capacity)` | Pulls `capacity` of `underlying` from caller. Approve `underlying` -> book. |
| Cancel offer | `cancelOffer(uint256 offerId)` | Refunds remaining capacity in `underlying`. No approval. |
| Sell stream into offer | `sellIntoOffer(uint256 offerId, uint256 streamId, uint256 minNetOut)` | Transfers the Sablier stream NFT from caller to maker; pays caller `underlying`. Approve Sablier NFT -> book. |
| List stream for sale | `postSaleListing(address market, uint256 streamId, uint16 aprBps)` | Escrows the stream NFT in the book. Approve Sablier NFT -> book. |
| Cancel listing | `cancelSaleListing(uint256 listingId)` | Returns the stream NFT. No approval. |
| Buy a listing | `buyListing(uint256 listingId, uint256 maxPriceIn)` | Pulls `grossPrice` of `underlying` from caller; transfers stream NFT to caller. Approve `underlying` -> book. |
| Borrow | `createBorrowPool(uint256[] offerIds, uint256 streamId, uint128 targetBorrow, uint128 minAcceptable)` | Escrows the stream NFT; pays caller `underlying` net of fee. Approve Sablier NFT -> book. This is the ONLY way loans are created. |
| Repay | `repayLoan(uint256 loanId, uint128 amount)` | Pulls `amount` of `ovrfloToken` from caller (borrower only). Approve `ovrfloToken` -> book. |
| Close (permissionless) | `closeLoan(uint256 loanId)` | Draws remaining outstanding from the stream, returns stream to borrower. No approval. |
| Claim lender share | `claimPoolShare(uint256 poolId, uint128 amount)` | Pays caller `ovrfloToken`. No approval. |

### 0.4 Denomination rules (get these right in every label)

- Offer capacity, sale prices, loan principal, borrower net proceeds: **underlying**
  (stETH on the local fixture).
- Loan obligation, repayments, pool proceeds, lender claims, stream payouts:
  **ovrfloToken**.
- All 18 decimals. APRs are bps, whole-percent steps, clamped to
  `[aprMinBps, aprMaxBps]` (both are `1000` = 10% at launch; read them, never
  hardcode).

### 0.5 Sablier stream NFT

The book moves streams with `sablier.transferFrom`, so the user must first call
either `approve(book, streamId)` or `setApprovalForAll(book, true)` on the Sablier
Lockup contract (`SABLIER_LOCKUP` in `web/lib/config.ts`,
`0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`). Use per-stream `approve` (least
privilege). User streams are already fetched via the Envio indexer
(`web/lib/sablier.ts: fetchUserStreams`), which returns `tokenId` = streamId.

### 0.6 Discovery strategy decision

Two mechanisms, phased:

- **Phases 2-5 (this plan's core):** enumerate the book on-chain. Id spaces are
  small, monotonic from 1, and `useReadContracts` batches everything into
  multicalls. Foolproof, no infra.
- **Phase 6 (production data layer):** extend the vendored Envio indexer
  (`tools/envio/`) with OVRFLOBook events so discovery and history scale. The
  hooks from Phase 2 keep their return shapes; only their internals change.

### 0.7 Sablier stream lookup (decision)

The best lookup is a hybrid with one hard rule: **the indexer discovers stream
IDs; the chain supplies every displayed amount.**

1. **Discovery** — Envio GraphQL (`web/lib/sablier.ts`), filtered to
   `sender IN (vault addresses)`. Two recipient queries, not one:
   - `recipient = user` -> streams the wallet holds (including streams BOUGHT on
     the book — a purchase is an NFT transfer, so the indexer's recipient updates).
   - `recipient = book` -> escrowed streams; intersect with book state
     (`saleListings` where `maker = user`, open `loans` where `borrower = user`)
     to recover the user's listed and pledged streams. Without this overlay the
     user's listed/pledged streams vanish from the UI.
2. **Live amounts** — for every stream id surfaced, read on-chain via one
   multicall: `withdrawableAmountOf(streamId)`, and (for escrow sanity)
   `getRecipient(streamId)`. Indexer fields (`depositAmount`, `withdrawnAmount`,
   `intactAmount`) may be used for sorting/labels only, never for action inputs
   or displayed balances.
3. **Local loop** — the vendored indexer at `http://localhost:8080/v1/graphql`
   already serves this (bootstrap:local wires `NEXT_PUBLIC_SABLIER_INDEXER_URL`).

### 0.8 What OVRFLO lending ACTUALLY is (drives all rate/depth labels)

OVRFLO is not a pooled money market. There is no utilization curve, no floating
"supply APY" vs "borrow APY" spread, and no interest accrual per block. What
actually happens:

- Makers post **fixed-APR offers** in underlying, at whole-percent rates inside
  the owner-set band `[aprMinBps, aprMaxBps]` (both 1000 = 10% at launch, so at
  launch there is exactly ONE rate).
- A single offer is consumable two ways at the SAME rate: as a **loan** (maker
  becomes lender; borrower's obligation = principal grossed up at that APR to
  maturity) or as a **purchase** (maker buys the stream outright at that APR
  discount). The maker cannot restrict which.
- The borrower's true cost = offer APR + the protocol fee (`book.feeBps`) taken
  from proceeds up front. The lender's true yield = offer APR (fee is paid by the
  taker side, not the maker).
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
component retains `nb-*` classes or light-theme styling.

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

## Phase 1 — Contracts side: expose the book locally

### 1.1 Extend `script/seed-local.sh` to deploy the book

After the `[4/6] approve markets` step, add a step that calls (owner-only):

```bash
echo "[5/7] deploy OVRFLOBook"
send "$FACTORY" 'deployBook(address)' "$OVRFLO"
BOOK=$(cast call --rpc-url "$RPC" "$FACTORY" 'ovrfloToBook(address)(address)' "$OVRFLO")
echo "      book    = $BOOK"
```

Renumber the existing `[5/6]`/`[6/6]` step labels to `[6/7]`/`[7/7]`, add
`--arg book "$BOOK"` to the final `jq` invocation and a `book: $book` field to
`deployments/local.json`, and print `book:` in the summary block.

Note: the book launches with `aprMinBps = aprMaxBps = 1000` (10% only). That is
fine for the local loop; do not add `setBookAprBounds` calls unless a test needs a
second rate.

Verification:

```bash
npm --prefix web run bootstrap:local:clean || true
npm --prefix web run bootstrap:local
jq .book deployments/local.json          # non-zero address
cast call <BOOK> 'aprMinBps()(uint16)' --rpc-url http://127.0.0.1:8545   # 1000
```

(If `bootstrap-local.sh` snapshots or caches the seed, re-run the clean variant
first. Do not run `forge script --broadcast` against local anvil — foundry#11714.)

### 1.2 No new env var

The frontend derives the book from `factory.ovrfloToBook(vault)`. Do not add a
`NEXT_PUBLIC_BOOK` variable and do not modify `tools/scripts/write-env.sh`.

---

## Phase 2 — Frontend data layer

### 2.1 ABIs — edit `web/lib/contracts.ts`

Append these exports (same hand-written minimal-ABI style as the file already
uses, `as const` on every array):

1. `ovrfloFactoryAbi`: add one entry
   - `ovrfloToBook(address) -> address`, view.
2. New `ovrfloBookAbi` with exactly these entries:
   - views: `aprMinBps() -> uint16`, `aprMaxBps() -> uint16`, `feeBps() -> uint16`,
     `nextOfferId() -> uint256`, `nextSaleListingId() -> uint256`,
     `nextLoanId() -> uint256`, `nextPoolId() -> uint256`,
     `offerState(uint256) -> (address,address,uint16,uint128,bool)` with named
     outputs `(maker, market, aprBps, capacity, active)`,
     `saleListingState(uint256) -> (address,address,uint256,uint16,uint16,bool)`
     named `(maker, market, streamId, aprBps, listingFeeBps, active)`,
     `loanState(uint256) -> (address,address,uint256,uint128,uint128,uint128,uint128,bool)`
     named `(borrower, lender, streamId, obligation, drawn, repaid, outstanding, closed)`,
     `pools(uint256) -> (address,uint16,address,uint128,uint128)`
     named `(creator, aprBps, market, totalContributed, totalObligation)`,
     `poolContributions(uint256,address) -> uint128`,
     `poolReceived(uint256,address) -> uint128`,
     `poolProceeds(uint256) -> uint128`,
     `poolLoanId(uint256) -> uint256`, `loanPoolId(uint256) -> uint256`,
     `quote(address,uint256,uint16,uint128) -> (uint256,uint128,uint256,uint256,uint128)`
     named `(grossPrice, obligation, feeAmount, netToBorrower, residual)`,
     `gatherOfferCapacities(address,uint16,uint128,uint256) -> (uint256[],bool)`.
   - writes: `postOffer(address,uint16,uint128) -> uint256`,
     `cancelOffer(uint256)`, `sellIntoOffer(uint256,uint256,uint256)`,
     `postSaleListing(address,uint256,uint16) -> uint256`,
     `cancelSaleListing(uint256)`, `buyListing(uint256,uint256)`,
     `createBorrowPool(uint256[],uint256,uint128,uint128) -> uint256`,
     `repayLoan(uint256,uint128)`, `closeLoan(uint256)`,
     `claimPoolShare(uint256,uint128)`.
3. `sablierLockupAbi`: add entries
   - `approve(address to, uint256 tokenId)`, nonpayable
   - `getApproved(uint256 tokenId) -> address`, view
   - `getRecipient(uint256 streamId) -> address`, view (needed by StreamClaim
     preflight in 3.3 item 7)
   - `withdrawableAmountOf` already exists; keep it.

Cross-check every signature against `src/OVRFLOBook.sol` before committing; a
wrong ABI fails silently as reverts.

### 2.2 New hook `web/hooks/useBook.ts`

Resolves the book and its params for a vault:

```ts
useBook(ovrflo: `0x${string}` | undefined): {
  book?: `0x${string}`;          // factory.ovrfloToBook(ovrflo), undefined if zero address
  aprMinBps?: number; aprMaxBps?: number; feeBps?: number;
  isLoading: boolean; error?: Error;
}
```

Implementation: one `useReadContract` for `ovrfloToBook`, then one
`useReadContracts` (enabled when book is set) for the three params. Treat
`0x000...0` as "no book deployed" (return `book: undefined`, no error). Follow the
memoization/error style of `useAllMarkets.ts` and reuse
`getReadContractsError` from `web/lib/errors.ts`.

### 2.3 New hook `web/hooks/useBookOrders.ts`

Enumerates offers and listings for one book:

```ts
useBookOrders(book?: `0x${string}`): {
  offers: BookOffer[];      // { id: bigint, maker, market, aprBps, capacity, active }
  listings: BookListing[];  // { id: bigint, maker, market, streamId, aprBps, feeBps, active }
  isLoading: boolean; error?: Error; refetch: () => void;
}
```

Implementation, exactly this shape:
1. `useReadContracts` for `nextOfferId` + `nextSaleListingId`.
2. Build contract arrays `offerState(i)` for `i in [1, nextOfferId)` and
   `saleListingState(i)` for `i in [1, nextSaleListingId)`; one batched
   `useReadContracts` with `allowFailure: true` (default). Individual result
   failures are impossible here (ids below the cursor always exist) but keep
   `allowFailure` anyway.
3. Map results into the typed arrays. Keep inactive rows in the arrays (callers
   filter); tag each row with its id.
4. Cap enumeration at 500 ids per side; if `nextOfferId > 501`, surface
   `error: new Error("Order book too large for on-chain enumeration")`. (Local
   and devnet stay far below this; the cap prevents pathological multicalls.)

### 2.4 New hook `web/hooks/useBookPositions.ts`

Everything shown in the "Lending" and "Borrowing" panels for the connected wallet:

```ts
useBookPositions(book: `0x${string}` | undefined, user: `0x${string}` | undefined): {
  lending: {
    myOffers: BookOffer[];                    // maker === user, active
    postedCapacity: bigint;                   // sum of active offer capacity (underlying)
    pools: LenderPool[];                      // pools where poolContributions[poolId][user] > 0
    totalClaimable: bigint;                   // sum of claimable across pools (ovrfloToken)
  };
  borrowing: {
    loans: BorrowerLoan[];                    // loanState rows where borrower === user
    totalObligation: bigint; totalOutstanding: bigint;  // ovrfloToken
  };
  selling: {
    myListings: BookListing[];                // maker === user, active (SELLING panel)
    pledged: BorrowerLoan[];                  // open loans' escrowed streams (PLEDGED badge)
  };
  streams: HeldStream[];                      // STREAMS panel: discovery per section 0.7
                                              // (useUserStreams + book-escrow overlay),
                                              // each with on-chain withdrawableAmountOf
  isLoading: boolean; error?: Error; refetch: () => void;
}
```

Enumeration mirrors 2.3: read `nextLoanId` + `nextPoolId`, batch `loanState(i)`
and `pools(i)`, then a second batch for `poolContributions(poolId, user)`,
`poolReceived(poolId, user)`, `poolProceeds(poolId)`, `poolLoanId(poolId)` on
pools the user touched, plus `withdrawableAmountOf(streamId)` on the Sablier
lockup for each open pool loan.

Claimable per pool (`LenderPool.claimable`) replicates `_claimFair` exactly:

```
loan       = loanState(poolLoanId[poolId])
recovered  = loan.drawn + loan.repaid
             + (loan.closed ? 0 : min(withdrawableAmountOf(loan.streamId), loan.outstanding))
entitled   = poolContributions[poolId][user] * recovered / pool.totalContributed   // floor
claimable  = entitled > poolReceived[poolId][user] ? entitled - poolReceived[poolId][user] : 0
```

Do this math in `bigint`. Put the pure function in `web/lib/book-math.ts` as
`poolClaimable(...)` so it is unit-testable without wagmi.

### 2.5 New pure module `web/lib/book-math.ts`

- `poolClaimable(...)` as above.
- `formatAprBps(aprBps: number): string` -> `"10.00%"` (reuse helpers from
  `web/lib/format.ts` where they exist; do not duplicate).
- `aprChoices(minBps: number, maxBps: number): number[]` -> inclusive whole-percent
  steps of 100 bps. Used by every rate `<select>`.

Unit tests in `web/tests/lib/book-math.test.ts` (Vitest, mirror existing test
style): claimable floor rounding, claimable clamps at zero when
`poolReceived > entitled`, open vs closed loan recovery, apr step generation with
min == max.

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
   - `LENDING` (gold): active offers (rate, remaining capacity in underlying,
     `CANCEL` each), pool contributions with per-pool claimable (ovrfloToken) and
     `CLAIM` buttons, totals across both.
   - `BORROWING` (cyan): per-loan rows with obligation, outstanding, pledged
     stream id, a **self-repay progress bar** (`(drawn + repaid) / obligation`,
     per DESIGN.md ProgressBar rules), `REPAY` button, and `CLOSE` enabled when
     `withdrawableAmountOf(streamId) >= outstanding`; totals.
   - `STREAMS` (gold; the buyer position): every stream the wallet holds —
     deposited, bought on the book, or returned after loan close (discovery per
     section 0.7). Per row: face remaining, **withdrawable now** (on-chain read),
     maturity countdown, and two actions: `CLAIM` (Sablier
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
   Columns reflect what the book actually is (section 0.8), NOT money-market
   supply/borrow spreads:
   - `ASSET`: PT symbol + maturity date + countdown.
   - `OFFER DEPTH`: sum of active offer capacity (underlying) — capital standing
     ready to lend or buy at the book rate.
   - `FOR SALE`: count of active listings + aggregate live ask (underlying).
   - `BOOK APR`: the admitted rate band from `aprMinBps`/`aprMaxBps` (a single
     number at launch, e.g. `10.00%`; render `min-max%` when they diverge).
     One neutral column, chalk — the SAME rate is a lender's yield and a
     borrower's accrual, so splitting it into "LEND APR"/"BORROW APR" columns
     misrepresents the mechanism.
   - `FEE`: `book.feeBps` as percent, dim — paid by takers (borrower proceeds and
     offer-fill sellers), not by makers.
   - Actions: `LEND` (gold), `BORROW` (cyan), `SELL` (gold outline), `BUY` (cyan
     outline). BUY disabled when the market has no active listings; all four
     disabled + `MATURED` badge when `expiry <= now`.
   - Borrower cost transparency lives in the BorrowModal quote breakdown (APR +
     fee -> net proceeds and obligation), not in extra table columns.
3. **Order book detail** (per selected market, below the table): two flat tables —
   active offers (id, maker truncated, APR, remaining capacity) and active
   listings (id, maker, streamId, APR, live price via `quote(market, streamId,
   aprBps, 0)` read). This is what BUY consumes.

### 3.3 Transaction modals (new files in `web/components/`)

All modals: show exact consequences before signing (per DESIGN.md section 9),
approval step first when allowance/getApproved is insufficient, wagmi
`useWriteContract` + `useWaitForTransactionReceipt`, refetch relevant hooks on
success.

1. **LendModal.tsx** — `postOffer`.
   Inputs: market (preselected), APR `<select>` from `aprChoices`, capacity amount.
   Steps: `underlying.approve(book, capacity)` if `allowance < capacity`, then
   `postOffer(market, aprBps, capacity)`.
   Summary row: `CAPACITY <n> <underlying> @ <apr>% APR`.
2. **BorrowModal.tsx** — `createBorrowPool`.
   Inputs: one of the user's eligible streams (from `useUserStreams`, filtered to
   streams whose `sender` is the vault for this market and not depleted/canceled),
   APR select, target borrow amount.
   Preview: call `quote(market, streamId, aprBps, targetBorrow)` (read) and show
   `grossPrice`, `obligation`, `feeAmount`, `netToBorrower`, `residual`. Cap the
   amount input at `grossPrice`.
   Offer selection: call `gatherOfferCapacities(market, aprBps, targetBorrow, 1)`;
   if `sufficient` is false show "insufficient offer capacity" and disable submit.
   Steps: `sablier.approve(book, streamId)` if `getApproved(streamId) != book`,
   then `createBorrowPool(ids, streamId, targetBorrow, minAcceptable)` where
   `minAcceptable = netToBorrower * (1 - slippageBps)` using the existing
   `SlippageSettings` component.
3. **SellModal.tsx** — two tabs sharing one modal:
   - "Sell now" (`sellIntoOffer`): pick stream, show best-price preview via
     `quote(market, streamId, offer.aprBps, 0)`; pick the cheapest-APR active offer
     with `capacity >= grossPrice` (compute client-side from `useBookOrders`);
     steps: stream approve, then `sellIntoOffer(offerId, streamId, minNetOut)`
     with slippage-derived `minNetOut`.
   - "List for sale" (`postSaleListing`): pick stream + APR; steps: stream
     approve, then `postSaleListing(market, streamId, aprBps)`.
4. **BuyModal.tsx** — `buyListing`.
   Shows the selected listing's live `grossPrice` (from `quote` with the LISTING's
   `aprBps` and `borrowAmount = 0`) and fee at the listing's snapshotted
   `listingFeeBps`. Steps: `underlying.approve(book, maxPriceIn)` then
   `buyListing(listingId, maxPriceIn)` with `maxPriceIn = grossPrice *
   (1 + slippageBps)`.
5. **RepayModal.tsx** — `repayLoan`.
   Input capped at `outstanding`; "MAX" fills `outstanding` exactly (closing repay
   returns the stream — say so in the summary). Steps:
   `ovrfloToken.approve(book, amount)` then `repayLoan(loanId, amount)`.
6. **Claim + Close + Cancels** need no modal-grade input: wire them as
   confirm-only modals or inline two-click buttons following the existing
   `ClaimModal` pattern. `claimPoolShare(poolId, claimable)` uses the computed
   claimable; `closeLoan(loanId)`; `cancelOffer(id)`; `cancelSaleListing(id)`.
7. **StreamClaim** (STREAMS panel `CLAIM` action) — reuse the Dashboard's
   existing withdraw flow: `sablier.withdrawMax(streamId, user)` with
   `msg.value = calculateMinFeeWei(streamId)` (both already in
   `sablierLockupAbi`). Preflight: `withdrawableAmountOf > 0` and the wallet is
   the current on-chain recipient (`getRecipient(streamId) == user` — add
   `getRecipient` to the ABI). Never rely on indexer recipient for this check.
8. **ZapModal.tsx — underlying -> PT -> deposit (Pendle SDK path).**
   Purpose: a customer holding only underlying (e.g. wstETH) can enter OVRFLO in
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
   - The zap is additive: the plain PT `deposit` path (existing
     `NewOvrfloModal`) stays for users who already hold PT.
   - Local-fork caveat: the hosted SDK quotes against LIVE mainnet state, which
     drifts from the pinned fork block. On local, expect the swap leg to be
     inaccurate or fail; guard the modal with an env check
     (`NEXT_PUBLIC_RPC_URL` pointing at 127.0.0.1 -> show a dim
     `ZAP UNAVAILABLE ON LOCAL FORK` note and test only the preview rendering).
     Full zap verification happens on devnet/mainnet.

### 3.4 Error and preflight handling

- Map known revert strings to friendly copy in `web/lib/tx-errors.ts` (append,
  do not rewrite): `"OVRFLOBook: slippage"`, `"OVRFLOBook: insufficient capacity"`,
  `"OVRFLOBook: loan not closable"`, `"OVRFLOBook: not offer maker"`,
  `"OVRFLOBook: repay too much"`, `"OVRFLOBook: apr out of bounds"`,
  `"OVRFLOBook: apr not whole"`.
- Eligibility/maturity failures surface as CUSTOM ERRORS from
  `src/StreamPricing.sol` (`SeriesMatured`, `MarketNotApproved`,
  `SeriesNotApproved`, `WrongSender`, `WrongAsset`, `WrongEndTime`,
  `CliffPresent`, `CancelableStream`, `RemainingZero`). Add these error
  definitions to `ovrfloBookAbi` (type "error" entries) so viem decodes them, and
  map each to friendly copy (e.g. `SeriesMatured` -> "This market has matured;
  trading is closed.").
- Expired markets: `quote`/`gatherOfferCapacities` revert post-maturity. Guard in
  UI: if `market.expiry <= now`, render the row dimmed with actions disabled
  (label `MATURED`), and skip quote reads.

### 3.5 Tests (Vitest, `web/tests/`)

- `tests/lib/book-math.test.ts` (see 2.5).
- `tests/hooks/useBookOrders.test.ts`: mock `useReadContracts` (mirror how
  existing hook tests mock wagmi) — verifies id-range construction from cursors,
  inactive rows retained, cap error at >500.
- `tests/components/Markets.test.tsx`: renders with mocked hooks; asserts all
  four panel labels are exactly "LENDING" / "BORROWING" / "STREAMS" / "SELLING"
  (no "YOUR" anywhere), the markets table headers are
  ASSET / OFFER DEPTH / FOR SALE / BOOK APR / FEE, and BUY disabled with zero
  listings.
- `tests/lib/pendle.test.ts`: mocked fetch — happy path parses `tx`/`amountOut`,
  HTTP and GraphQL-style error paths throw typed errors.

---

## Phase 4 — Mockup corrections (mockups/, do together with Phase 3 so the app matches)

1. `mockups/app-tables-v2.html`:
   - `YOUR LENDING` -> `LENDING`; `YOUR BORROWS` -> `BORROWING`; drop possessive
     wording anywhere else.
   - Replace the two-panel strip with the 2x2 four-role grid from section 3.2:
     `LENDING`, `BORROWING`, `STREAMS` (with mock withdrawable + CLAIM/SELL),
     `SELLING` (mock listing row: stream id, APR, live ask, CANCEL; plus one
     `PLEDGED` badge row).
   - Fix the markets table headers to ASSET / OFFER DEPTH / FOR SALE / BOOK APR /
     FEE per section 3.2 (the current LEND APR / BORROW APR split misrepresents
     the single-rate book — see section 0.8).
   - Add `SELL` (gold outline) and `BUY` (cyan outline) buttons to each market row
     alongside `LEND` / `BORROW`.
   - Update the wiring-map comment at the top of the file to match section 0 of
     this plan (capacity/prices in underlying, obligations in ovrfloToken —
     the current comment wrongly says amounts are ovrfloToken-denominated).
2. `mockups/landing-v3.html`: center the System Architecture block within the
   right hero column. Keep `border-left` on the column; inside it, wrap the label
   and `<pre>` in a div and center that div horizontally, e.g. change the column to
   `display:flex; flex-direction:column; align-items:center; justify-content:center;
   padding-left:0;` (the label stays left-aligned relative to the diagram). Result:
   the diagram sits in the middle of the right half, as in "The Self-Repaying.heic",
   not hugging the divider.
3. Marketing copy: mention buying/selling explicitly. Hero paragraph already says
   "Sell the stream"; add a buy-side clause (e.g. "or buy discounted streams
   outright") and ensure the FOR LENDERS block notes that offers can be filled as
   purchases, not only loans (the contract's unified-offer semantics).

---

## Phase 5 — Local end-to-end verification (run all of it)

```bash
# 1. Fresh local stack (anvil fork + deploy + book + envio + env)
npm --prefix web run bootstrap:local
jq . deployments/local.json                       # has factory, ovrflo, token, book

# 2. Static checks
npm --prefix web run lint:security
npm --prefix web run test
npm --prefix web run build

# 3. App
npm --prefix web run dev
```

Manual flow in the browser (dev wallet = anvil key #1,
`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, seeded with PT + stETH):

1. Dashboard: deposit PT into the primary market -> receive ovrfloToken + a stream.
2. Markets / LEND: post an offer at 10% APR with 50 stETH capacity. LENDING panel
   shows posted capacity 50; offer appears in the market's order book; OFFER DEPTH
   updates.
3. Markets / BORROW: pledge the stream from step 1, target borrow within the
   quoted `grossPrice`. Wallet stETH increases by `netToBorrower`; BORROWING panel
   shows the loan with `outstanding = obligation`.
4. Advance time to accrue the stream:
   `cast rpc evm_increaseTime 604800 --rpc-url http://127.0.0.1:8545 && cast rpc evm_mine --rpc-url http://127.0.0.1:8545`.
   LENDING panel claimable becomes > 0; `claimPoolShare` pays ovrfloToken.
5. REPAY the loan in full with ovrfloToken -> loan closes, stream returns to the
   dev wallet (BORROWING panel empties).
6. SELL: list the returned stream via `postSaleListing`; the stream moves from
   the STREAMS panel to the SELLING panel. From the same wallet, BUY it back via
   `buyListing` (self-trade is allowed for sale listings). Prices move in stETH;
   the listing deactivates; the stream reappears under STREAMS.
7. STREAMS / CLAIM: after another `evm_increaseTime`, the stream shows
   withdrawable > 0; CLAIM (`withdrawMax`) pays ovrfloToken to the wallet and the
   panel's withdrawable resets to ~0.
8. Cancel a leftover offer -> capacity refunds.

Each step must reflect on-chain state after refetch without a page reload.

---

## Phase 6 — Envio indexer extension (production data layer)

Do this only after Phases 1-5 are green. It changes hook internals, not UI.

1. Extend `tools/envio/` config + schema with OVRFLOBook entities driven by its
   events (all listed in `src/OVRFLOBook.sol`): `Offer` (from
   `OfferPosted`/`OfferCancelled`/`SaleOfferHit`/`PoolCreated` consumption),
   `SaleListing` (from `SaleListingPosted`/`Cancelled`/`Taken`), `Loan` (from
   `PoolCreated`/`LoanRepaid`/`LoanClosed`), `Pool` (+ `PoolShareClaimed`), and
   an append-only `BookActivity` entity (one row per event) for the activity feed.
   The book address comes from the factory's `BookDeployed` event.
2. Swap `useBookOrders` / `useBookPositions` discovery from id enumeration to
   GraphQL queries against the same endpoint config as `web/lib/sablier.ts`
   (`NEXT_PUBLIC_SABLIER_INDEXER_URL` — one indexer serves both schemas).
   Return shapes must not change; live amounts (capacity, outstanding,
   withdrawable, claimable) STAY on-chain reads per section 0.7's rule.
3. Remove the 500-id enumeration cap once the swap lands.

## Phase 7 — Customer-expectation backlog (OVRFLO-specific, ordered)

Items a customer will reasonably expect. Implement after Phase 5-6, in this order.

1. **Wrap / Unwrap** (highest priority; it is a core exit path and currently has
   no UI): `vault.wrap(amount)` / `vault.unwrap(amount)` (underlying <->
   ovrfloToken 1:1, bounded by the wrap reserve). Panel on the Dashboard;
   show remaining unwrap capacity from the vault's wrap reserve accessor.
2. **Matured-series claim surfacing**: when `expiry <= now`, promote the
   existing `claim` (burn ovrfloToken -> PT) flow: matured markets get a
   `CLAIM PT` action in the markets table and a Callout on the Dashboard.
3. **USD context**: extend the existing `useUsdPrices` to annotate offer depth,
   obligations, and stream values with dim USD equivalents (display only).
4. **Activity history**: per-wallet table (posted, filled, borrowed, repaid,
   claimed, bought, sold) from the Phase 6 `BookActivity` entity, with tx links.
5. **Self-repay ETA**: on each open loan, project when
   `withdrawableAmountOf >= outstanding` (linear stream => closable date is
   computable client-side from stream start/end/deposit) and render
   `CLOSABLE ~<date>`; enable a `NOTIFY` mailto/ics stub, no backend.
6. **Obligation vs stream health check** in BorrowModal: warn when
   `residual` from `quote` is a small fraction of the stream (the user is
   borrowing near the stream's full value and will get little back at close).
7. **Book capacity guardrails**: LendModal shows the market's remaining time to
   maturity and warns when posting into a series expiring within 7 days.

---

## Execution order and checkpoints

| Step | Deliverable | Checkpoint |
|---|---|---|
| 0 | Phase 0: rewrite globals.css + migrate all existing components to DESIGN.md dark theme + landing page to landing-v3 | `npm --prefix web run build` green; all pages dark-themed |
| 1 | seed-local.sh book deploy + deployments/local.json | Phase 1 verification commands pass |
| 2 | ABIs + useBook + useBookOrders + book-math (+ unit tests) | `npm --prefix web run test` green |
| 3 | useBookPositions + stream discovery overlay (0.7) (+ claimable math tests) | test green |
| 4 | Markets page skeleton + four position panels + corrected table (reads only) | page renders live data from local fork |
| 5 | LendModal + cancel offer | manual flow steps 2, 8 |
| 6 | BorrowModal + RepayModal + close | manual flow steps 3-5 |
| 7 | SellModal + BuyModal + StreamClaim | manual flow steps 6-7 |
| 8 | ZapModal + web/lib/pendle.ts (+ tests) | preview renders; full zap deferred to devnet |
| 9 | Mockup corrections (Phase 4) | visual check vs reference image |
| 10 | Full Phase 5 sweep + `npm --prefix web run lint:security && npm --prefix web run build` | all green |
| 11 | Phase 6 indexer swap | hooks return identical shapes; enumeration cap removed |
| 12 | Phase 7 backlog items 1-2 minimum | wrap/unwrap + matured claim usable locally |

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

End-to-end validation against `src/OVRFLOBook.sol`, existing `web/` code, and
`script/seed-local.sh`. All contract signatures, math, and referenced
infrastructure were verified.

### Verified correct

- All contract function signatures match source: `claimPoolShare`, `quote`,
  `gatherOfferCapacities`, `loanState` (8 returns incl. computed `outstanding`),
  `saleListingState` (6 returns incl. `listingFeeBps`), `pools` struct (5 fields
  after `Pool.active` removal in commit `5afa9dc`).
- `quote(borrowAmount=0)` prices the full stream — confirmed in source:
  `effectiveBorrowAmount = borrowAmount == 0 ? grossPrice : borrowAmount`.
- `poolClaimable` math in `web/lib/book-math.ts` correctly replicates
  `_claimFair`'s `claimable` computation. Traced the invariant:
  `entitled <= poolProceeds + harvestable` always holds (for open loans the
  harvest covers the deficit; for closed loans `sum(entitled_all) == poolProceeds`
  so any individual `entitled <= poolProceeds`). Therefore the entitled amount
  is fully backed by available proceeds (not merely theoretical); the per-call
  claimable remains `entitled - poolReceived[user]` as specified in section 2.4.
- All referenced existing code verified present: `SABLIER_LOCKUP` in `config.ts`,
  `fetchUserStreams` in `sablier.ts`, `SlippageSettings` component,
  `calculateMinFeeWei` and `withdrawMax` (payable) and `withdrawableAmountOf`
  already in `sablierLockupAbi`.
- `getRecipient` and `ovrfloToBook` correctly identified as needing ABI additions.
- `buyListing` has no self-match guard — self-buy is allowed (plan step 6 valid).
- seed-local.sh 6-step structure compatible with planned 7-step extension.
- DESIGN.md exists.
- M-02 net slippage check (`netToBorrower >= minAcceptable`) confirmed in source.

### Gaps to address during implementation

1. **Zero-struct pool filtering in `useBookPositions`.** `pools(uint256)` is a
   public mapping getter that returns a zero struct for unknown ids (unlike
   `offerState`/`loanState`/`saleListingState` which revert). When enumerating
   `pools(1)` through `pools(nextPoolId)`, filter out results where
   `totalContributed == 0` to avoid phantom pools. Add this to section 2.4's
   implementation.

2. **Fully-settled pool UI treatment.** When a loan is closed and all
   contributors have claimed their full share, `claimable = 0` and the pool is
   dead. Decide during Phase 3 implementation whether to hide, dim, or badge
   these in the LENDING panel. They would otherwise show as rows with 0
   claimable indefinitely.

3. **ZapModal placement.** ZapModal (execution step 8) is in the main execution
   path but is the least testable component — the Pendle Hosted SDK quotes
   against live mainnet state, not the local fork. The plan acknowledges this
   with an env guard (`ZAP UNAVAILABLE ON LOCAL FORK`). Consider moving ZapModal
   to Phase 7 backlog. The core markets loop (lend, borrow, sell, buy, claim,
   repay, close — steps 1-7) is fully testable on local fork without it. If
   moved, step 8 becomes part of Phase 7 item set and the execution order
   compresses by one step.
