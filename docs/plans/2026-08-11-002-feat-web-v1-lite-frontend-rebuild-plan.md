---
title: "Web frontend rebuild: v1-lite wiring + Three-Bay Instrument Workbench - Plan"
type: feat
date: 2026-08-11
topic: web-v1-lite-frontend-rebuild
artifact_readiness: implementation-ready
execution: code
revised: 2026-08-11 (deepened after experience review: briefs-first authority, component kit, payoff projection, guided first run, risk disclosure, mobile patterns, accessibility, RPC honesty, USD field map)
---

# Web frontend rebuild: v1-lite wiring + Three-Bay Instrument Workbench - Plan

> **SUPERSEDED (2026-08-11).** Implementation authority moved to `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`, which folds in this plan's still-valid machinery and replaces its stale compositions. Retained as history; do not implement from this file.

## Goal Capsule

**Objective.** Rebuild the Markets web app (`web/`) as one combined pass: rewire the data and transaction layer to the v1-lite OVRFLOLending contract (tick order book: `supply`/`withdraw`/`borrow`/`repay`/`close`/`claim`), and ship the app in the ratified Three-Bay Instrument Workbench visual world. The old loan-pool wiring and the Architectural Dark theme are both replaced, not patched. This is not a UI skin: it rebuilds routes, data reads, transaction execution, error handling, onboarding, and the test surface.

**Experience thesis.** A new financial mechanism inside a familiar machine. Three experience commitments rank above completeness:

1. **The self-repayment moment is visible.** Streams are deterministic, so the app shows the projected cover date on every loan — the one number no floating-yield competitor can honestly show.
2. **First success is designed, not assumed.** A visitor with no stream and no positions gets a guided path to their first borrow, not an empty state.
3. **Honesty over reassurance.** Freshness, degradation, partial fills, and reserve limits are always stated; nothing renders as fine when it is not.

**Authority and precedence.** When sources disagree, the higher one wins:

1. Behavior: `docs/plans/2026-08-11-markets-frontend-flow-spec.md` (**read-only during implementation**; its Render Inventory is this plan's acceptance skeleton). This plan **extends** it with: payoff projection, guided first run, risk acknowledgment, and mobile navigation patterns — extensions are additive and never contradict a flow-spec rule.
2. UI region briefs: `docs/maps/ui/` **as rewritten by U2 of this plan** — written before flow implementation, per the maps charter's authority order (briefs over code; comps win pixels, briefs win meaning).
3. Visual: `docs/plans/2026-08-11-three-bay-instrument-workbench-design-direction.md` + the approved mock + Ratified Decisions below (ratifications amend the exploration comps and docs).
4. Disclosure defaults: `docs/plans/2026-08-11-progressive-markets-design-direction.md`.
5. Product truth: `PRODUCT.md`, `CONCEPTS.md`.
6. Contract truth: `src/OVRFLOLending.sol`, `src/OVRFLOFactory.sol`, `src/OVRFLO.sol` as built — never a doc's paraphrase.

All four 2026-08-11 exploration/direction docs are read-only specs. This plan records deltas; it does not edit them.

**Execution profile.** Next.js + wagmi + viem in `web/`. Verify with `npm --prefix web run build`, `npm --prefix web run test`, then Playwright E2E against a seeded local Anvil fork (`BOOT_NO_UI=1 npm --prefix web run bootstrap:local`; read `docs/agents/testing.md` first). The seed script already drives the v1-lite book (spacing, supply, borrow at `script/seed-local.sh:204-274`).

**Stop conditions.** Stop if implementation would require Solidity changes, new on-chain capabilities, health-factor/liquidation UX, or a backend/indexer service. Stop if a flow-spec screen cannot be built from on-chain reads plus the documented discovery pattern — surface the gap instead of inventing a data source. Stop if a region brief and the flow spec genuinely conflict — that is a spec defect to surface, not to resolve locally.

**Tail ownership.** After the units land: Impeccable finish review (desktop + mobile screenshot round, side-by-side against the approved mock, fix batch, verdict), then the Impeccable documenter rewrites `DESIGN.md` from the shipped UI (the Architectural Dark rulebook is replaced at finish, never pre-written), then the `ethskills:qa` pre-ship audit in a fresh reviewer context. `app.overflow.finance` DNS/hosting cutover is an ops checklist item, not a code unit. A build with a clean detector pass but no finish review and no rewritten `DESIGN.md` is unfinished.

**Open blockers.** None.

---

## Ratified Decisions (2026-08-11, user-directed)

- **D1. Combined rebuild, Markets app only.** Functional v1-lite wiring and the visual world ship together. Marketing landing is out of scope.
- **D2. Visual world: Three-Bay Instrument Workbench.** One-bit instrument language — white paper ground, hard black rules, bitmap texture, square controls, tabular readouts. Locked reference: `.impeccable/mocks/ovrflo-three-bay-instrument-workbench-approved.webp`. Companion comps (`ovrflo-three-bay-borrow/supply/positions.webp`) are approved **with the corrections in D3–D6**. The prior Clearing Ledger world and its wave-O mark are retired.
- **D3. No system-version naming, no job/console language.** The masthead is the `OVRFLO` wordmark alone — never `OVRFLO SYSTEM 1.0`. The step dock is titled `SETTLEMENT` (OVRFLO's own vocabulary: close is stream-draw settlement); its final step is `SETTLED`. Receipts are `PERMISSION RECEIPT` (pre-sign) and `ACTION RECEIPT` (post-sign). No `JOB STEPS`, no `STEPS`, no generic console terminology.
- **D4. Single accent.** Amber `#E8930C` marks the active operation only: selected tick chip, primary-action outline, current SETTLEMENT step. No cyan anywhere. Contextual navigation ("← Change stream") is ink with underline. Green/red appear only as CONFIRMED/ERROR transaction outcomes — state, not decoration.
- **D5. Typography.** Schibsted Grotesk (400/500/700/900) for navigation, decisions, and prose; Martian Mono (400/700, width axis condensed where tables are dense) for amounts, rates, IDs, labels, receipts, and state. Both OFL, self-hosted woff2 under `web/public/fonts/` via `next/font/local`. Inter appears nowhere.
- **D6. Token/USD display switch.** Every amount surface offers token units (default) and a USD reference, switchable at any time (persisted in `localStorage`). USD is display-only: transactions, inputs, MAX, and receipts are always denominated in token units. With no live price, the switch is disabled and labeled `USD UNAVAILABLE` — never a stale or invented number. Per-field mapping in "USD Reference" below.
- **D7. Disclosure defaults per the progressive doc.** Each default view answers one immediate question; rate/fee math, matching mechanics, approvals detail, activity, and contract data live behind explicit disclosure rows or the Review step. Positions defaults to the simple master/detail view; financial columns and terms are a disclosed level (no separate SIMPLE/DETAILED page modes).
- **D8. No image generation.** Remaining visual decisions are made against rendered HTML in the real app.
- **D9. Guided first run.** The no-stream/no-position state is a designed onboarding surface: it teaches the PT → deposit → stream → borrow cycle in OVRFLO's voice, deep-links to the Pendle market for the approved series, and hands off into the deposit flow. (Ratified 2026-08-11.)
- **D10. Risk disclosure.** A plain-language factual risk surface (smart-contract risk, audit status, Pendle/Sablier dependencies, not-financial-advice) reachable from the shell footer, plus a one-time per-wallet acknowledgment before the first transaction. Reads are never gated — only the first write. (Ratified 2026-08-11.)

**Late-session amendments (2026-08-11, user-directed — this plan awaits ce-plan reconciliation against `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`, which now carries the product contract):**

- **D2 amended.** Three-bay geometry is scoped to the Assets converter and the `ALL RATES` depth workspace only. Default Borrow/Supply are spacious single-decision flows and the split review composition, per `docs/plans/2026-08-11-004-ovrflo-liked-interface-reference-synthesis.md` and the approved `.impeccable/mocks/ovrflo-walkthrough-v3-approved.html`.
- **D3 amended.** The SETTLEMENT sequence renders as a step trace integrated into the task (inline trace or split-review rail), not a detached dock. Naming and receipt discipline unchanged.
- **D4 amended.** The single accent is gold `#E8930C` for value movement and the active operation; role-coded cyan/amber was trialed against renders and reversed. The amber contrast rule carries over unchanged.
- **Positions/watch superseded.** U5/U7's NOW/NEXT strip is deleted (rejected in rendered form twice); the watch surface (role-lens wall, roll-in heroes, dot-ribbon idiom, actions on entities) replaces the Positions index topology per the 003 contract.

---

## Design System Pins

Tokens (in `web/app/globals.css`; names final):

| Token | Value | Role |
|---|---|---|
| `--paper` | `#FFFFFF` | page and bay ground |
| `--ink` | `#0A0A0A` | text, rules, primary action fill, title bars |
| `--dim` | `#6B6B6B` | secondary labels, captions |
| `--rule` | `#0A0A0A` at 1px/1.5px/2px | structural borders (weight = hierarchy; no grays-as-borders) |
| `--halftone` | `#F2F2F0` | app frame outside the work area; dither/bitmap texture fills |
| `--amber` | `#E8930C` | active operation only (D4) |
| `--amber-ink` | `#FFB84D` | amber-family text on ink ground only |
| `--ok` | `#177245` | CONFIRMED outcome only |
| `--err` | `#C22F2F` | ERROR/reverted outcome only |

**Amber contrast rule (hard).** Amber on paper fails text contrast (≈2.2:1). Amber therefore appears as: (a) a fill behind ink text (selected tick chip), (b) an outline/underline ≥2px on interactive elements, or (c) text on ink ground (`--amber-ink`). Amber body/label text on paper is banned. The active SETTLEMENT step on paper renders as ink text with an amber leading marker, not amber text.

- Corners square everywhere. Depth from borders and inversion only — no shadows, glass, blur, gradients, glow, pills, or rounded cards.
- Selection/active = inversion (ink ground, paper text) per the one-bit language.
- Focus: 2px ink outline, 2px offset; no glow; no layout shift. Focus order follows reading order: context bay → decision bay → outcome bay → dock.
- Motion: color/border/background at `0.2s ease`; dock check transitions instant; no entrance cascades, parallax, or scale-on-hover. Live values update in place without flashing. `prefers-reduced-motion` targets the actual animated properties, not a global 0.01ms collapse.
- Bitmap texture (dither fields, hatched dividers) is CSS/SVG pattern, confined to the frame and dividers — never behind body text, never near amounts, never reducing numeric contrast. At signing surfaces (Review, receipts) texture is absent: receipts are plain paper and ink.
- Touch targets ≥44×44px where space permits, never below 24×24px.

**Three-bay geometry and responsive contract.**

- ≥1024px: left bay = context, center = decision, right = outcome/next action; dock (SETTLEMENT + receipt) spans below center+right.
- <1024px: bays stack in reading order — context, decision, outcome — and the dock attaches directly below the decision bay's primary action; it never floats or detaches.
- Positions <1024px: master/detail becomes list → detail **navigation** (detail is its own screen with a `← POSITIONS` return; URL carries the entity ID so Back works). The fixed in-place detail pane exists only ≥1024px.
- Tick chips wrap to two rows before shrinking; `ALL RATES` opens as a full-width disclosure (desktop) / full-screen sheet (narrow) — same content either way.
- Labels are never dropped, values never clipped, controls never shrink below minimum targets to fit.

**Numbers.** Tabular numerals everywhere. Token amounts: 2 decimals by default, 4 below one unit, always with symbol (live `symbol()` reads — the generic term `ovrfloToken` never appears in customer-facing copy). Rates: 2 decimals. Maturity identifiers `30 JUN 2027`; captions sentence case; countdowns only where time drives the decision. Addresses/IDs truncate middle with copy affordance.

---

## USD Reference (D6 mechanism and field map)

**Price path** (wstETH launch market): Chainlink ETH/USD aggregator × Lido wstETH `stEthPerToken` (stETH≈ETH reference basis) — direct `eth_call` reads through the app's RPC layer; no third-party price API, no backend. Exact feed addresses pinned at implementation from Chainlink's mainnet docs and verified against Etherscan before use (`ethskills:addresses` discipline); they live in `web/lib/config.ts` beside other chain constants. Staleness: answer older than 24h ⇒ switch disabled, labeled `USD UNAVAILABLE`.

**Field map** — which values carry a USD reference in USD mode:

| Value class | USD reference | Basis |
|---|---|---|
| wstETH amounts (balances, supply, proceeds, fees) | yes | wstETH price |
| ovrfloWSTETH amounts in 1:1 contexts (wrap/unwrap, repay, obligation, recovered, claims) | yes | wstETH price, labeled `AT 1:1 UNWRAP BASIS` in the disclosure the first time it appears per surface |
| ovrfloWSTETH in post-maturity PT-claim contexts | no | no honest USD equivalence; token-only |
| PT amounts (deposit flow) | yes | wstETH price (PT redeems to underlying at maturity; labeled `AT MATURITY BASIS`) |
| APR, ticks, IDs, dates | never | — |

USD values render beside token values (small, `--dim`) in token mode where a signing decision benefits (Review screens); in USD mode the emphasis inverts but the token value never disappears. Rounding: USD to cents below $1,000, whole dollars above. USD never appears in a PERMISSION/ACTION RECEIPT's committed lines — receipts are token-exact.

---

## Payoff Projection (experience commitment #1)

- `lib/payoff.ts` computes, from the pledged stream's on-chain schedule (linear: deposited, start, end) and the loan's current `outstanding` and drawn state: the timestamp at which the stream's withdrawable value covers the outstanding. Pure function, unit-tested against hand-computed fixtures.
- Displayed as `COVERS ON ~14 MAR 2027` (day precision, `~` always present since repayments/claims shift it) on: Borrow REVIEW and CONFIRMED (projection for the proposed loan), loan detail, loan rows in the Positions index, and the `NOW / NEXT` strip (`LOAN #014 COVERS IN ~212d`).
- Recomputed from live reads on every refresh; after full coverage it yields to the actionable state (`CLOSE READY`).
- A repay preview shows the moved date (`COVERS ON ~03 JAN 2027 → ~09 NOV 2026`) before signing.
- This is a projection of a deterministic schedule, not a promise about third-party behavior; the disclosure row `HOW YOUR STREAM REPAYS` carries the one-sentence basis.

---

## Information Architecture

Next.js App Router routes (new):

- `/` — `ENTRY.DISCONNECTED` explainer or the compact route chooser when connected with no intent (flow spec "Shared shell and entry"). For a connected wallet with zero streams, zero positions, and zero loans, `/` and `/borrow` present the **guided first-run surface** (U9) instead of a bare chooser.
- `/borrow`, `/supply`, `/positions`, `/assets` — the four destinations. Positions supports `?position=`, `?loan=`, `?stream=` deep links; Borrow accepts `?stream=` context.
- `/risk` — the factual risk disclosure surface (D10), linked from the shell footer and the acknowledgment step.
- Shell (all routes): masthead `OVRFLO` wordmark left; destination nav; network + wallet control right; status line beneath with **real data freshness** and the token/USD switch; footer with `RISK`, contract addresses (truncated, copyable), and the git build identifier.

**Status line honesty (RPC policy).** The status line shows `SYNCED <relative time>` from the freshest successful read batch. Read failures flip it to `RECONNECTING` (with automatic retry via the existing transport fallback in `web/lib/rpc.ts`); persistent failure renders `DEGRADED — SHOWING LAST KNOWN` and every transacting surface enters `STALE` (signing disabled). There is no decorative `LIVE` indicator; the word appears nowhere.

**Direction contract.** The comment below is the first child of `body` in `web/app/layout.tsx`; after `npm --prefix web run build`, grep the production output for `THESIS:` to prove it survived.

```
THESIS: A new financial mechanism inside a familiar machine — one decision per viewport, receipts before signatures; the category's dark casino is refused.
OWN-WORLD: One-bit instrument workbench — paper white, hard black rules, bitmap texture, square controls; Schibsted Grotesk decisions over Martian Mono receipts; a single amber active-operation accent.
STORY: Choose Borrow, Supply, Positions, or Assets; make one decision per bay; read the exact obligation and the date the stream covers it; sign; keep the receipt.
FIRST VIEWPORT: OVRFLO masthead and four destinations; three bays — context left, decision center, outcome right; SETTLEMENT dock with receipt below; primary action black with amber outline in the center bay.
FORM: Three-Bay Instrument Workbench (user-pinned direction, 2026-08-11 session; supersedes Clearing Ledger).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
```

---

## Contract Surface (verified against `src/OVRFLOLending.sol`, 2026-08-11)

Writes: `supply(market, aprBps, amount) → positionId`, `withdraw(positionId)`, `borrow(market, aprBps, targetBorrow, streamId, minAcceptable)`, `repay(loanId, amount)`, `close(loanId)`, `claim(loanId, positionId, amount)` (`type(uint128).max` = claim everything), `advanceEpochCursor` (recovery valve; no routine UI).

Views/getters: `tickDepths(market)` (whole ladder, one read), `tickState`, `positionState(positionId)`, `loanState(loanId)` (reverting named views), `contributionOf`, `loansOf(positionId, startSeq, maxN) → (entries[], nextSeq)` (paginated claim discovery; `startSeq` must be a `nextSeq` from the same position), enumeration `lenderPositionCount/lenderPositionAt`, `borrowerLoanCount/borrowerLoanAt`, config `aprMinBps/aprMaxBps/feeBps/treasury/tickSpacing`, constants `UNIT`, `MIN_LIQUIDITY_AMOUNT`, `MIN_STREAM_AMOUNT` (read on-chain — never duplicated into frontend config).

Events (absolute-checkpoint pattern): `Supplied`, `Withdrawn`, `Borrowed` (includes `feeAmount`), `Repaid`, `Closed` (both closure paths), `Claimed`, `EpochOpened`, `EpochCursorAdvanced`, `TickSpacingSet`.

Custom errors replace all require-strings. The decoder enumerates the generated ABI's error entries (`ZeroAmount`, `NotUnitAligned`, `BelowMinimum`, `SpacingUnset`, `SpacingAlreadySet`, `ZeroSpacing`, `InvalidTick`, `ZeroTarget`, `EmptyTick`, `BelowMinAcceptable`, `NotLender`, `NothingToWithdraw`, `NothingToClaim`, `NoOverlap`, `EpochMismatch`, `LoanClosed`, `LoanMissing`, `RepayExceedsOutstanding`, `NotCovered`, `EpochBacklog`, `ZeroSteps`, `PositionMissing`) so catalog drift is impossible by construction; a unit test fails if an ABI error lacks human copy + one recovery action. `BelowMinimum` on borrow is disambiguated client-side from off-chain stream reads (fill floor vs stream-face floor).

Discovery rules: the ladder and all position/loan/claim data are view reads — no log scanning for execution decisions. Stream discovery keeps the existing two-step pattern (standard-RPC `eth_getLogs` candidates → Sablier `eth_call` truth; three-valued found/none/unavailable; unavailable never renders as empty). Lenders enumerate their own positions via `lenderPositionAt`, never via the ladder.

**Wallet/chain scope.** The existing connector set in `web/lib/wagmi.ts` carries over unchanged; no new connectors. Chain/deployment addresses stay in `web/lib/deployment.ts`/`config.ts` under their existing runtime-profile pattern. No analytics, telemetry, or error-reporting service is added — a deliberate privacy decision, recorded here.

---

## Implementation Units

Order: U1 → U2 → U3 → U4 → (U5, U6, U7, U8 in any order) → U9 → U10 → U11 → U12. U5–U8 are independent once U4 lands.

### U1. Foundation: ABI, tokens, fonts, shell

- **Goal:** The app builds against the v1-lite ABI inside the new shell with the new tokens; every surviving screen renders in the new world even where flows are stubbed.
- **Work:** `forge build` then `npx wagmi generate` in `web/` (regenerates `lib/generated.ts`; all old symbols disappear). Retoken `globals.css` per Design System Pins, deleting the obsidian/carbon/graphite system and the 40px `grid-bg` canvas. Self-host Schibsted Grotesk + Martian Mono (`next/font/local`, latin subset, licenses committed beside the files). Build the shell: routes, masthead wordmark, destination nav, wallet/network control (existing `WalletRuntime`/`useChainGuard` carry over), status line (freshness + token/USD switch UI; pricing lands in U4), footer (RISK link, addresses, build id). Insert the direction contract comment. Delete modules that exist only for the old contract: `useLendingProjection`, `useProjectionSync`, `useLendingLiquidity`, `useBorrowDemand`, `useLoanBook`, `lib/demand.ts`, and old-ABI branches of `lib/lending-math.ts`, `lib/positions.ts`, `lib/claim-all*.ts`. Grep gate: `loanPool`, `liquidityId`, `createBorrowerLoanPool`, `SaleListing`, `Inter`, `LIVE` appear nowhere in `web/` source (tests included).
- **Verification:** `npm --prefix web run build` clean; grep gates pass; production output contains `THESIS:`; `ENTRY.DISCONNECTED` renders in the new world.

### U2. Region briefs (authority before code)

- **Goal:** `docs/maps/ui/` describes the new topology **before** any flow is implemented, so U5–U9 build against briefs instead of making micro-decisions (maps charter: briefs win meaning; comps win pixels).
- **Work:** Rewrite the region briefs to the new surfaces: `shell.md` (masthead, nav, wallet, status line, footer, risk acknowledgment), `borrow.md`, `supply.md`, `positions.md` (including the <1024px list→detail navigation contract), `assets.md`, and `settlement-dock.md` (the shared SETTLEMENT + receipt control contract: step naming per flow, skip-without-renumber rule, receipt line schemas, checkpoint revalidation). Each brief carries, per screen: purpose in one sentence, the region's single dominant decision, every control with its visibility/enablement condition and data authority, state-by-state copy (LOADING/EMPTY/READY/STALE/WALLET_PENDING/CHAIN_PENDING/CONFIRMED/ERROR), keyboard order, and aria-live regions. Copy is drafted here in OVRFLO voice (contract-literal token language from the direction docs; "state the present balance and the additional amount needed" — never "shortfall"). Follow `docs/maps/ui/CODING_STANDARD.md` and `docs/maps/REVIEW.md` for the change process.
- **Verification:** Every flow-spec screen key and every render-inventory item maps to exactly one brief section (a coverage table closes the unit); `ce-doc-review` (or equivalent doc review) passes on the briefs.

### U3. Component kit

- **Goal:** The shared vocabulary all four routes compose from, built once, with accessibility inside the component rather than at call sites.
- **Work:** `web/components/kit/`: `Bay` (title, kicker, rule structure), `SettlementDock` (steps + receipt; step states pending/current/done/skipped; `aria-current="step"`; skip-without-renumber), `Receipt` (PERMISSION/ACTION variants; token-exact lines; copy affordances), `TickChips` (three contextual + selected inversion + amber fill w/ ink text; wrap rule), `AmountField` (mono, `inputmode="decimal"`, persistent label, balance line, truthful MAX, inline unit/minimum errors with `aria-invalid` + linked error text; never a toast), `TokenUsdSwitch` + `Amount` (renders token+USD per the field map), `ProgressRule` (labeled, numeric value, the recovered ruler), `CoverDate` (payoff projection display), `EntityRow` (positions/loans/streams list rows with state line), `DisclosureRow` (the `+` rows; `aria-expanded`), `StatusLine`, `ActionButton` (primary ink/amber-outline, neutral, disabled-with-reason — reason text mandatory when disabled), `AddressChip`. Every component: keyboard operable, visible focus, reduced-motion safe, and a Vitest render test per state.
- **Verification:** A fixture page (dev-only route) renders the full kit in all states at 1280px and 360px; kit unit tests green; the design-detector hook passes on the kit.

### U4. Data layer: reads, errors, prices, projection

- **Goal:** Every screen's data need in the flow spec and briefs is answerable by a hook, with the 8-state grammar in types and loading never rendered as zero.
- **Work:** Hooks over the verified contract surface: ladder (`tickDepths` + config bounds → three-contextual-ticks + ALL RATES model), lender book (`lenderPositionCount/At` → `positionState` batch → `loansOf` pagination), borrower book (`borrowerLoanCount/At` → `loanState` + Sablier `withdrawableAmountOf` coverage), stream discovery (existing pattern re-anchored to v1-lite pledge status), balances/allowances (existing patterns). Custom-error decoder per Contract Surface. USD price hook (feeds, staleness classification, field-map helpers). `lib/payoff.ts` per Payoff Projection. RPC transport fallback + freshness classification feeding the status line. Query keys/invalidation per existing conventions; event-checkpoint refresh after receipts. Risk-acknowledgment store (per-wallet, `localStorage`, consulted by the write executor: first write per wallet routes through the acknowledgment step; reads never gated).
- **Verification:** Vitest units for tick math (UNIT alignment, spacing multiples, bounds), ladder shaping, `loansOf` pagination (`nextSeq` reuse), every error-catalog entry, USD staleness + field map, payoff fixtures (incl. repay-shift), freshness classification. `npm --prefix web run test` green.

### U5. Supply flow

- **Goal:** `SUPPLY.SELECT_MARKET → ENTER_AMOUNT → SELECT_RATE → REVIEW → APPROVE → SIGN → PENDING → CONFIRMED` per the flow spec's Supply table + exceptions, against `docs/maps/ui/supply.md`, in the composition of `ovrflo-three-bay-supply.webp` (corrected per D3–D6).
- **Work:** Left bay: wallet/available context. Center: amount (inline unit-alignment + minimum feedback, exact MAX), tick chips with live depth, ALL RATES ladder disclosure, queue position ("currently ahead"). Right: order summary — principal, APR, `RESTS UNTIL MATCHED`, earnings-begin-when-filled statement, withdrawability note. Dock: SETTLEMENT (AMOUNT → APR → APPROVE wstETH → SUPPLY → SETTLED; approval skipped-not-renumbered when allowance suffices) + PERMISSION RECEIPT (token, spender, exact allowance, `MATCH EXACT`). Reviewed-action semantics per `CONCEPTS.md`: rebuild calldata and recheck account/chain at every checkpoint; drift returns to Review with a visible diff.
- **Verification:** Component tests per screen state incl. exceptions (market matured, tick config changed, allowance rejected, revert decoding); E2E happy path on the seeded fork creates a position and lands on `VIEW POSITION`.

### U6. Borrow flow

- **Goal:** `BORROW.SELECT_STREAM → ENTER_AMOUNT → SELECT_RATE → REVIEW → APPROVE_STREAM → SIGN → PENDING → CONFIRMED` per the flow spec's Borrow table + exceptions, against `docs/maps/ui/borrow.md`, in the composition of `ovrflo-three-bay-borrow.webp` (corrected).
- **Work:** Left bay: selected stream (maturity, remaining, repay capacity; `← CHANGE STREAM` ink link). Center: request vs stream-derived cap (balance-independent MAX), tick selection with live depth + explicit partial-fill warning, Review with gross/fee/net/obligation/residual **and the projected cover date**. Right: net proceeds, obligation, residual-returns statement, `COVERS ON ~…`. Dock: SETTLEMENT (STREAM → AMOUNT → APPROVE STREAM → BORROW → SETTLED) + PERMISSION RECEIPT for the Sablier NFT (asset, operator, `SINGLE STREAM` scope; fee-deducted-from-proceeds stated — no fee approval exists). `minAcceptable` derives from the reviewed net (reviewed-numeric-bounds window rule); partial fills re-present actuals before signing; `QUOTE UPDATED` freezes signing.
- **Verification:** Component tests for exceptions (no eligible stream → guided-path handoff, never a disabled form; empty tick; below `minAcceptable`; quote drift; revert decoding); E2E borrow against the seeded stream confirms loan + `VIEW LOAN` + cover date rendered.

### U7. Positions

- **Goal:** `POSITIONS.INDEX` master/detail (≥1024px in-place pane; <1024px list→detail navigation) with `NOW / NEXT` strip, role filters (zero-count hidden), and all detail panes + actions per the flow spec, against `docs/maps/ui/positions.md`, in the composition of `ovrflo-three-bay-positions.webp` (corrected).
- **Work:** Index rows with human-readable state lines and cover dates on loans. Supplied detail: supplied/filled/unfilled/claimable/APR/maturity/ahead; `WITHDRAW UNFILLED` and `CLAIM` only when actionable; last-intent primary rule. Loan detail: net/obligation/recovered/outstanding/stream/maturity, recovered `ProgressRule`, `COVERS ON ~…`, `CLOSE FROM STREAM` only under verified coverage, `REPAY` while outstanding. Repay flow incl. `REPAY_PREPARE` wrap hand-off (present balance + additional amount needed; returns with amount preserved; third-party payer note; repay preview shows the moved cover date). Claim flow with `POSITIONS.CLAIM_CONFIRMED` three-exit receipt (`RECEIVED <amount> ovrfloWSTETH`; unwrap enabled only under reserve coverage — reserve insufficiency is an unavailable route, never a failed claim; PT exit stated as PT; no swap route). Unwrap review/confirm. Stream detail with pledge status and `BORROW AGAINST THIS STREAM`. All actions: checkpoint grammar `READY → WALLET_SIGNATURE → PENDING → CONFIRMED → REFRESHED_DETAIL` with SETTLEMENT dock + ACTION RECEIPT.
- **Verification:** Component tests per pane and action incl. `NotLender`, zero-overlap claim, `NotCovered` close, both claim-confirmed variants; E2E claim → unwrap and repay → close on the seeded fork; E2E narrow-viewport list→detail navigation.

### U8. Assets

- **Goal:** The 1:1 converter exactly per the approved mock (composition reproduced; D3–D6 applied) plus the PT-deposit stream-creation flow (`STREAM.*`), against `docs/maps/ui/assets.md`.
- **Work:** Converter: left reserve bay (wallet, tracked wrap reserve, reserve rule), center wrap/unwrap with deterministic `OUTPUT` (not EST.), right ovrfloWSTETH bay with the claim-on-PT explanation (contract-literal), disclosure rows (`HOW THE RESERVE WORKS`, `CONTRACT DETAILS`), `USE FOR REPAY` return path. Stream creation: market select → PT amount → review (PT in, ovrfloWSTETH out, stream amount, underlying fee with the existing 2% buffer policy shown as current fee + bounded approval, maturity, cap status) → approve PT → approve fee → sign → confirmed with `BORROW AGAINST THIS STREAM`. Entry points: wallet control, Borrow's no-stream state, Repay prepare.
- **Verification:** Component tests for reserve-limited unwrap, skipped-allowance checkpoints, fee-buffer display; E2E wrap and deposit-create-stream on the seeded fork.

### U9. First run and risk surface

- **Goal:** D9 and D10 as designed surfaces, not afterthoughts.
- **Work:** Guided first run (connected wallet, zero streams/positions/loans): a three-bay teaching surface in the same world — left: what a self-repaying loan is (four sentences, OVRFLO voice); center: the cycle as a labeled sequence (GET PT → DEPOSIT → RECEIVE STREAM → BORROW) with the single action `GET wstETH PT ON PENDLE` (external deep link to the approved series' Pendle market, address-verified, opens with an explicit external-destination note) and `I ALREADY HOLD PT → DEPOSIT`; right: what the visitor will have at each step. Dismissible to the plain chooser; returns whenever the wallet is empty of protocol objects. External-link brittleness degrades honestly: link failure state names the market address and directs to Pendle by series. `/risk`: factual sections (smart-contract risk; audit status — stated truthfully from the repo's audit record, no invented assurances; Pendle/Sablier/Chainlink dependencies; fixed-schedule basis of projections; not financial advice). Acknowledgment step: first write per wallet inserts one `ACKNOWLEDGE RISK` checkpoint into that flow's SETTLEMENT sequence (renders the risk summary inline, links `/risk`, records per-wallet in `localStorage`); never re-prompts, never gates reads.
- **Verification:** Component tests: first-run renders only for protocol-empty wallets; acknowledgment appears exactly once per wallet and before the first approval; `/risk` renders disconnected. E2E: fresh wallet → guided surface → deposit handoff.

### U10. States, navigation, persistence hardening

- **Goal:** The flow spec's Global Rendering States and Navigation/Persistence sections hold everywhere, plus the status-line honesty policy.
- **Work:** Route-level enforcement: Back moves one decision and preserves valid selections; checkpoints revalidate and fall back to Review (never enterable from stale history); Borrow/Supply drafts persist independently per wallet+chain (selections only — quotes always rebuild from live `tickDepths`); wallet/chain change clears approvals, quotes, checkpoints, and ownership assumptions, returning to the nearest safe selection; receipts recoverable by tx hash until reads reflect the new entity. `STALE` treatment (signing disabled, refresh affordance) visually distinct from `LOADING` on every transacting surface; `DEGRADED — SHOWING LAST KNOWN` wired end-to-end.
- **Verification:** Component tests for the state matrix on one representative topology per route; E2E wallet-switch mid-flow and RPC-blackout (fork paused) scenarios.

### U11. Repo sync: concepts, Gherkin, metadata

- **Goal:** The repo's authority layers and the app's public metadata describe the shipped product.
- **Work:** `CONCEPTS.md` web-app entries: retire `Clearing Ledger` (superseded note → workbench direction doc), rewrite `Loan book` for the v1-lite reads, prune stale `Ponder` claims, keep `Reviewed action`. Update `web/tests/e2e/*.feature` Gherkin to the new flows (authority #3 moves with the briefs). Metadata: page titles/descriptions per route in OVRFLO voice, `opengraph-image.tsx` rebuilt in the workbench world (wordmark, one-bit rules — no invented metrics), favicon set from the wordmark treatment, `ethskills` pre-publish metadata checklist applied.
- **Verification:** Gherkin suite parses and runs; metadata checklist items checked; grep gate: `Clearing Ledger` survives only in historical/plan records.

### U12. Acceptance: render inventory and suites

- **Goal:** Every item in the flow spec's 24-item Render Inventory — plus this plan's additions (guided first run, risk acknowledgment, both claim-confirmed variants, `DEGRADED` status, narrow-viewport Positions navigation, cover-date renders) — renders deterministically, and the full test surface is green.
- **Work:** Fixture-driven render harness (Vitest + testing-library) mounting each inventory item with pinned fixtures, asserting the brief's labels, states, and action-visibility rules, at 1280px and 360px for every transacting topology. Migrate or delete every legacy test encoding old-contract behavior (U1 grep gates apply to tests). Playwright covers the six E2E paths named in U5–U10.
- **Verification:** `npm --prefix web run build`, `npm --prefix web run test`, `npm --prefix web run test:e2e` green on the seeded fork; the inventory checklist (spec 24 + additions) committed in the PR description.

---

## Experience Review Gate (checked at finish, before the reviewer spawns)

1. On every surface the dominant decision is identifiable in five seconds, and it is the only amber operation on screen.
2. A first-time visitor can state what a self-repaying loan is and reach a first action from the guided surface without leaving the app except the labeled Pendle step.
3. Every loan answers "when is this over?" with a date.
4. Every wallet prompt is preceded by a receipt naming exact asset, amount, spender/operator, and scope; users sign numbers.
5. No surface claims freshness it doesn't have; STALE, DEGRADED, EMPTY, LOADING, UNAVAILABLE are visually and verbally distinct.
6. Keyboard-only completion of supply, borrow, repay, claim, wrap; focus visible throughout; async updates announced via aria-live.
7. 360px: same hierarchy, same labels, no clipped values, list→detail navigation in Positions.
8. Amber text never sits on paper (contrast rule holds everywhere).
9. The USD switch never changes what would be signed.
10. No invented numbers anywhere: no fake TVL, no decorative sparklines, no `LIVE` badge.

## Risks and Mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Martian Mono width breaks dense tables at narrow widths | Width axis condensed in tables; U12 renders every transacting topology at 360px as a gate |
| 2 | USD feed unavailability or staleness misleads | Three-valued price state; switch disabled `USD UNAVAILABLE`; E2E asserts degraded render; USD absent from receipts by design |
| 3 | Error-catalog drift between contract and decoder | Decoder enumerates generated-ABI errors; unit test fails on missing copy |
| 4 | One-bit texture reads as parody at signing moments | Texture banned from Review/receipt surfaces (Design Pins); finish review side-by-sides receipt gravity against the approved mock |
| 5 | Projection reads as a promise | `~` always shown; day precision; basis sentence in `HOW YOUR STREAM REPAYS`; recomputed live; `/risk` states the fixed-schedule basis |
| 6 | Pendle deep-link rot | Link failure state names the market address and series; the guided path never hard-depends on the URL resolving |
| 7 | Acknowledgment gate friction | One checkpoint, once per wallet, inline summary, never gates reads or browsing |
| 8 | Amber contrast violations creep in | Hard rule in tokens + detector-visible pattern (no `--amber` as `color` on `--paper` ground); kit encapsulates all amber usage |
| 9 | Briefs and flow spec drift during build | Stop condition: conflicts surface as spec defects; briefs carry a coverage table back to flow-spec screen keys |
| 10 | Deleted machinery leaves dead exports | U1 grep gates + build with `noUnusedLocals` intact |

## Out of Scope

Marketing landing; brand mark/glyph design (wordmark-only until approved); swap-route exits; any indexer/backend/analytics; Solidity changes; `advanceEpochCursor` UI; mobile-native apps; `app.overflow.finance` DNS cutover (ops checklist).
