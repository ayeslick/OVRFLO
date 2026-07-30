# Web frontend structural diagnosis and target architecture — 2026-07-29

Status: diagnosis + proposed target architecture and migration sequence. Review-only engagement; no code was changed. Companion to [2026-07-29-001-fix-web-review-findings-plan.md](2026-07-29-001-fix-web-review-findings-plan.md), which is the tactical layer of this same diagnosis.

**Question answered:** are the web app's bugs one-offs, or symptoms of the wrong architecture — and if structural, what architecture should replace it?

---

## 1. Outcome

**The bug rate is structural, but the architecture is not wrong — it is missing two layers.** About two-thirds of the ~60 recorded frontend defects collapse onto four boundaries, and the two biggest share one shape: a correctly centralized *mechanism* whose *policy* is hand-copied at every use site. The skeleton (indexer-as-discovery, pure planners in `lib/`, a chain-pinning write wrapper, scoped invalidation) is sound — it exceeds the ethskills structural bar and is ahead of Scaffold-ETH 2 and even Morpho on invalidation. What recurs is what has no owner:

1. **Per-form button/approval state machines** — 6 hand-rolled copies, 3 different `activeIndex` derivations, measurable drift in 4 of 5 approve gates.
2. **Per-read-site "unresolved ≠ zero" semantics** — `?? 0n` is the default idiom; the rule is re-implemented only where a bug already happened.

The peer research converges on exactly the missing pieces: Aave's shared `TxActionsWrapper` machine and Morpho's `{ getRequirements, buildTx }` action modules.

**Verdict: local refactor with structural additions — insert an action-module layer and a shared flow machine, unify the two write engines, and type the read results. Not a rewrite, not more form-level patches.** Estimated as a 3–5 week sequenced migration that keeps the app shippable at every step (§9).

---

## 2. Research log (provenance)

All claims below are grounded in tool evidence gathered 2026-07-29; nothing is from memory.

- **First-hand code verification (same session):** the ten findings in [2026-07-29-001](2026-07-29-001-fix-web-review-findings-plan.md) — verified in `ActionModal.tsx` (5 regions), `useHeldStreams` / `useLoanBook` / `useBorrowerLoans` / `useAllMarkets` / `useLending` / `useLendingLiquidity`, `config.ts`, `ponder.ts`, `MarketsApp` / `MarketsTable` / `PositionSummary`, CSP scripts, `vercel.json`, `OVRFLO.sol` claim path, plus Vercel's live project-configuration docs.
- **Lane A — project docs:** all of `docs/solutions/` (patterns, architecture-patterns, design-patterns, ui-bugs, logic-errors, runtime-errors, integration-issues, security-issues, test-failures), `docs/frontend-decision-map.md`, both 2026-07-28 plans, dogfood reports, audit report + `docs/audit/rejected-findings-record.md`, `CONCEPTS.md`, `web/reviews/` (WEB-*, NX-*, testing.md, test-accountability.md), `.scratch` issue tickets.
- **Lane D — code map:** grep-backed inventories of all 15 `writeContract` sites, 47 `useReadContract(s)` sites, 28 `disabled={` gate expressions, 5 `zeroFirst.submit` sites, all planner modules and consumers; the invalidation mechanism traced through `useWriteFlow` / `useTxQueue` / `lib/invalidate.ts`; six end-to-end journey traces; line-count scope table.
- **Lane B — standards:** live fetches of ethskills.com `SKILL.md`, `frontend-ux`, `indexing`, `qa`, `frontend-playbook`; 26 structural rules verified against code with file:line verdicts.
- **Lane C — peers (primary sources, current commits):** shallow clones inspected — `Uniswap/interface` @ `a69a38c2fab8` (2026-07-23), `aave/interface` @ `ff5e64b3ed2b` (2026-07-29), `scaffold-eth/scaffold-eth-2` @ `4b70535` (2026-07-29), `morpho-org/sdks` @ HEAD plus a worktree of the deprecated `simulation-sdk` v4.0.3 and its live npm deprecation notice; Pendle hosted-SDK API + docs.pendle.finance (their app is closed-source — the hosted API and examples repos are the primary source); Compound's Elm `palisade` via GitHub trees.

---

## 3. Current architecture map

**Shape.** Single-route static export; one dispatcher (`FormBody`, `web/components/ActionModal.tsx:78`) routes 12 action types into 6 forms inside one 1,729-line file — half of all component code (`components/` total 3,455 lines). ~1,378 lines of hand-written `lib/` (planners: `router`, `borrow`, `lending-math`, `convert`, `modal-logic`, `claim-all`, `positions`, `demand`, `errors`), 21 hooks (1,612 lines), 14 components. Forms: `SupplyForm` :355, `SimpleActionForm` :535 (withdraw / claim_share / claim_stream / close), `ConvertForm` :652 (deposit / claim_matured / wrap / unwrap), `BorrowForm` :909, `AdjustRateForm` :1334, `RepayForm` :1574.

**Write path.** `hooks/useWriteFlow.ts` centralizes chainId injection (:82), revert-truth (`hasFailed` includes on-chain revert, :96–103; `isConfirmed` requires `receipt.data?.status === "success"`, :40), and scoped invalidation on confirm (:44–56). `useApprovalWriteFlows` pairs approve+action; `useZeroFirstApprove` handles USDT-class tokens. **But `useTxQueue` (Claim All) is a second, parallel write engine** re-implementing receipt-status doctrine, chainId injection, and invalidation (`useTxQueue.ts:51`, :125–161). Everything *above* the wrapper — gates, approval predicates, step/`activeIndex` machines, optimistic-approval mirrors, reset-on-failure effects, tx-status JSX — is re-built per form:

- 6 step machines with 3 different `activeIndex` derivations (ActionModal.tsx:436–437, :562–563, :780–781, :1112–1113, :1437–1438, :1650–1651).
- 5 copies of the optimistic-`approvedAmount` + reset-on-`hasFailed` effect (:402–404, :685–690, :1036–1038, :1399–1401, :1630–1632).
- 2 forms hand-roll SIGNING/CONFIRMING/CONFIRMED lines instead of `TxState` (:1302–1306, :1547–1551).
- BorrowForm renders zeroFirst's `clearing` banner (:1296) though its NFT-approval path can never trigger zeroFirst.
- 15 `writeContract` submission sites; 28 distinct `disabled` gates.

**Read path.** 47 wagmi read sites (19 inside ActionModal). Indexer surface is exactly two fetches (`lib/ponder.ts`: `fetchHeldStreamIds`, `fetchBorrowDemand`) + a status poll, served by the fixed 2-endpoint Ponder REST API (`tools/ponder/src/api/index.ts`). **The indexer-as-discovery boundary is enforced three layers deep** (ids-only API, ids-only client, on-chain `ownerOf` re-check in `useHeldStreams.ts:148–151`) — zero instances found of indexer data driving a transaction.

**Invalidation.** Address-scoped substring matching over serialized query keys (`lib/invalidate.ts:31–56`), triggered from confirm effects. The *scope* is a per-call-site duty (each of 6 call sites must remember to pass `marketContracts(market)`; `useWriteFlow.ts:10–15` warns about it in its own doc comment), the mechanism exists in two copies (useWriteFlow + useTxQueue), and `lib/claim-all.ts:4–11` carries `asset` on plan rows purely so the queue can invalidate the right balance read — invalidation concerns leaking into the planner's data shape.

**Seams.** `wallet-runtime` is a build-time module alias (`next.config.ts:20–31`) switching between the Reown runtime and the E2E mock. `lib/config.ts` hard-fails on any chain but 1. CSP ships as deploy-target artifacts generated by `scripts/build-csp.mjs` + `csp-hash-inline.mjs` (with the lifecycle defect recorded as Task 1 of the companion plan).

**Invariant enforcement status (abbreviated):**

| Invariant | Enforced | How |
|---|---|---|
| Chain id must be 1 | Yes | Belt-and-braces: config parse, FormBody gate, per-write chainId (in 3 write-implementation copies) |
| Indexer ids are hints, chain is truth | Yes | Three layers; held everywhere |
| Receipt success requires `status === "success"` | Partially | Two implementations of the doctrine |
| Approval inherits action validity | **No — drifted** | Per-form hand-rolled subsets (:836/:848, :1259, :1521, :1691 vs action gates) |
| Unresolved read never renders as a value | **Partially — per-surface** | Enforced only at previously-bitten sites; `?? 0n` is the default idiom elsewhere |
| Every write invalidates its readers | Partially | Mechanism central; scope is call-site memory |

---

## 4. Bug-class → structural-root-cause table

Every recorded frontend defect (WEB-*, NX-*, audit H/M/L/I-*, dogfood, solutions writeups, the ten 2026-07-29 findings — ~60 total) clusters as follows. Boundaries: **R** = typed read results, **W** = shared action/flow machine + single write engine + action-derived invalidation, **B** = build artifact lifecycle.

| # | Cluster (member count) | Recurrence evidence | Root cause | Boundary |
|---|---|---|---|---|
| 1 | Unresolved read collapses to a valid value (≥9: deposit-cap `?? 0n`, unconfigured-indexer `[]` ×2, withdrawable→`0n` ×3 sites, multicall defaults ×4 hooks, "NO APPROVED MARKETS", empty-invalidation-scope near-miss) | **3 waves after fixes; 2 tests pinned the bug** | No typed read-result representation; convention each site must remember; `data ?? 0n` is the path of least resistance | **R** |
| 2 | Write-gate / precondition drift (≥8: H-3 re-arm, M-2, unwrap gate, borrow pre-gate, fee-approve strand, L-11 maturity freeze ×4 forms, approval-ignores-preconditions ×3 forms, negative amounts) | H-3's own fix caused a hook-order crash in 4 forms (applied by hand ×4) | 6 hand-copied gate/step/approval machines; approve gates are hand-rolled subsets of action gates | **W** |
| 3 | Receipt/outcome truth (5: WEB-003, revert-as-confirmed ×2 sibling hooks, M-2, dead receipt comparison) | Fixed in queue, then found again in sibling hook | Two parallel write engines | **W** |
| 4 | Enumeration truncation (4: H-4/H-5 open-descoped, M-15 open, L-2 fixed, stream `limit=100`) | Class diagnosed by audit; fresh instance found 2026-07-29 | Contract-side per-user indexes declined (KTD11 — settled); client discovery has no completeness contract | half settled / half **R** |
| 5 | Indexer trust / reliability-domain conflation (8: transferred-NFT, M-9, PositionList blanket error, PositionSummary ignoring `stale`/`unavailable`, 4 infra drifts) | Per-source rule fixed in PositionList 2026-07-28; missing in sibling PositionSummary 2026-07-29 | Boundary itself sound; *consuming* status flags is per-consumer duty with no type enforcement | **R** |
| 6 | Cache/invalidation (5: H-4 storms, empty-scope near-miss, RepayForm never-refetch, timer leak, dedup hazards) | — | Scope is call-site knowledge, not derived from the action; two mechanism copies | **W** |
| 7 | Race/stale-state guards (6: M-6, M-7, shrink race, fee drift, hook-below-guard crash ×4) | Fix-induced regression ×4 forms | Patterns exist (freeze/recompute, refs-vs-state) but wiring is per-form | **W** |
| 8 | Build/config artifact lifecycle (≥8: M-17, vercel.json mutation, WEB-007 regression, env/key/start-block drifts) | CSP fixed in U12; new lifecycle defect found next day | No single env-validation step; build mutates committed files | **B** |
| 9 | Accessibility (≥12 mostly fixed; unnamed select = fresh instance of fixed M-1 class) | 1 recurrence | Mostly local; no shared labeled-input primitives; axe sweep doesn't open modals | local (+ small W) |
| 10 | Dead-code / live-vs-fixed divergence (5: error-boundary fix landed on dead ActionModal wrapper, etc.) | Pattern #3 regressed via divergence | Process + monolith: 1,729-line file with 6 forms makes "which copy is live" a real question | aggravated by **W** |

**Synthesis answer 1 (structural %):** 8 of 10 clusters collapse onto four boundaries (**R**, **W**, **B**, one settled protocol decision). By defect count, the boundary-attributable clusters (1–3, 5–7) hold ~40 of ~60 recorded defects. The regression ledger is decisive against "devs forgot a check": WEB-007 and WEB-009 both re-broken by rewrites; the error-boundary fix landed on a dead component; revert-as-confirmed fixed twice in sibling hooks; per-source-degrade fixed in PositionList and missed in PositionSummary; H-3's fix hand-applied four times and wrong once. **Fixes don't propagate because there is no layer for them to live in.**

---

## 5. Peer pattern board

All inspected from primary sources at the commits listed in §2.

### Uniswap interface
- **Inspected:** `packages/uniswap/src/features/transactions/steps/` (typed step unions, runner options incl. `onModification` calldata-tamper detection), swap sagas (`apps/web/src/state/sagas/transactions/`), zustand stores (`swapFormStore` with frozen-during-submission `derivedSwapInfo` vs `dangerouslyGetLatestDerivedSwapInfo`), `refetchQueriesViaOnchainOverrideVariantSaga.ts` (post-tx: fetch affected balances on-chain, overwrite API cache, refetch API after 3s), `useIsSwapButtonDisabled`.
- **Pattern:** typed step list generated by pure functions, executed by one runner; button state as pure derivation; post-confirm invalidation computed from the typed tx (`getCurrenciesWithExpectedUpdates`); freeze-at-review with explicit re-accept on drift.
- **COPY:** derived button state; typed-invalidation derivation. **ADAPT:** freeze-at-review (stream valuations drift like quotes; OVRFLO's `staleRecovery` is the seed). **REJECT:** redux-saga machinery, server quoting, block-number refresh (Uniswap itself marks it deprecated) — wrong scale, and server quoting is forbidden by static export.

### Aave interface
- **Inspected:** `src/components/transactions/TxActionsWrapper.tsx` (single guard chain for 30+ flows: blocked → wrong-network → fetching → amount-missing → preparing → approving → approve-confirmed → ready), FlowCommons (`ModalWrapper`, shared Success/Error), per-flow `*Actions.tsx`, `useApprovedAmount` + `checkRequiresApproval` (measured allowances; self-healing "approval succeeded but insufficient ⇒ reset" branch), `ui-config/queries.ts` `queryKeysFactory`, coarse post-confirm invalidation (`invalidateQueries({queryKey: keys.pool})` after `wait(1)`).
- **Pattern:** one component owns the approve→action machine; per-flow execution components supply only `handleApproval`/`handleAction`/`requiresApproval`; one query-key vocabulary; action-critical values never from the subgraph.
- **COPY:** the `TxActionsWrapper` shape; `queryKeysFactory`; shared `approvalTxState`/`mainTxState` cells + Success/Error screens; config-object + on-chain-enumeration market model. **REJECT:** mega-`AppDataProvider` context (Aave marks half of it deprecated), store-built transactions, permit machinery.

### Morpho SDKs
- **Inspected:** `blue-sdk` entities (`Market.accrueInterest`, `toSupplyShares(assets, "Down"|"Up")` — per-call rounding direction), current `morpho-sdk` action modules (`{ getRequirements, buildTx }`; `getRequirementsApproval.ts` handles USDT zero-first; supply bound forward-accrued 2h "so an un-accrued bound reverts on quiet markets"), `evm-simulation` (real `eth_simulateV1`/Tenderly simulation of built txs), historical `simulation-sdk` v4.0.3 (full TS protocol-state mirror + operation algebra) **and its live npm deprecation notice: "The broad simulation engine has no replacement package."**
- **Pattern:** pure entity math; per-action modules producing prerequisite txs + frozen typed main tx; entity-keyed cache with block number deliberately excluded from keys; discovery API explicitly disclaimed ("as-is … implement fallback mechanisms") while action-critical state is always chain-read.
- **COPY:** the action-module contract; forward-timestamp bounds for streaming collateral; rounding-direction-in-signature honesty. **ADAPT:** entity-key discipline, but keep OVRFLO's write-triggered (not per-block) invalidation. **REJECT:** any TS protocol-state mirror — the strongest TS-DeFi team retired theirs; wagmi `simulateContract` pre-flight fills the outcome-prediction role at OVRFLO's scale.

### Scaffold-ETH 2
- **Inspected:** `useScaffoldWriteContract` (chain compare-then-toast, simulate-before-sign via `simulateContractWriteAndNotifyError`), `useTransactor` (toast-sequence lifecycle; `receipt.status === "reverted"` throw), `useScaffoldReadContract` (per-block `invalidateQueries` per hook instance), `wagmiConfig` (`fallback()` transports), `.yarnrc.yml` (`npmMinimalAgeGate: 7d`), typegen.
- **Verdict:** confirms [2026-07-28-003](2026-07-28-003-refactor-web-adopt-se2-patterns-plan.md) line-by-line at one commit newer than that plan's read: SE2 has **no post-write invalidation at all**, no `staleTime`, and its chain check races (OVRFLO's per-write `chainId` is stronger). Adopt the R1–R8-class hardening; reject the rest. SE2 is *behind* OVRFLO on the layers this diagnosis concerns.

### Pendle (hosted SDK API — app is closed-source)
- **Inspected:** live `GET /core/v1/1/markets/active` + `/v2/markets/all`, hosted-SDK Convert endpoint contract (`requiredApprovals`, `routes[0].tx` + `outputs` + `priceImpact` from one response), frozen 2023 TS-SDK repo, docs freshness tiers (display API ~30s / on-chain pre-checks / TWAP oracle for action-critical), `getOracleState` cardinality handshake.
- **COPY:** the three-tier freshness doctrine *stated as written policy* per displayed number; the invariant that the number on the button and the bound in the calldata come from one computation. **ADAPT:** endpoint-split maturity filtering → one chain-sourced `marketActive`-mirroring predicate in `lib/`. **REJECT:** hosted quoting API; fat client-side SDK entity graph (Pendle themselves abandoned it).

### Compound (bonus — Elm `palisade`)
Tx lifecycle, validations, protocol math, and API clients as four separate modules with a language-enforced pure view, in production for six years. Nothing to copy literally; validates the `lib/`-pure direction as durable.

**Synthesis answer 2 (which missing peer patterns explain the recurrence):** the two patterns every surviving peer has and OVRFLO lacks — a **single owner for the approve→action machine** (Aave/Uniswap) and a **typed action object from which requirements, submitted args, and invalidation scope all derive** (Morpho/Uniswap). Where OVRFLO already has the peer pattern (indexer-as-discovery, pure planners, chain-pinned writes), the corresponding bug classes stopped recurring.

**Synthesis answer 3 (what stays OVRFLO-specific):** discovery-only Ponder (validated by Morpho's API disclaimer and Pendle's tiers), no-USD, freeze-show/recompute-submit, classified zero-first, write-triggered scoped invalidation (ahead of all four peers), static export, Pendle-specific non-generalized code. All preserved; the target gives them enforcement homes.

---

## 6. Target architecture

Six layers, each with one owner.

**L0 — Build/config.** One `verify-env` step validating every required production variable (factory, RPC, Ponder origins) behind a single local-build escape flag; `vercel.ts` or Build Output API for headers; no build step writes inside the committed tree. (Specified as Tasks 1+4 of the companion plan.)

**L1 — Chain reads: typed results.** A settled/unresolved discriminant (`ReadResult<T>` or `T | null` + surfaced error, per companion Tasks 3/10) is the only legal shape for on-chain data leaving a hook. Rules: no `?? 0n`-style defaults on read data — enforced by extending `scripts/check-banned-patterns.sh` (already wired into `pretest`); a multicall subcall failure marks the entity unresolved, never defaults; overlay reads compose into hook-level `isLoading`/`error`. Query keys move to an Aave-style `queryKeysFactory` in `lib/query-keys.ts` (entity-keyed: `series(market)`, `loan(id)`, `stream(id)`, `allowance(owner, token, spender)`); domain queries never ride raw wagmi keys.

**L2 — Discovery (Ponder).** Role unchanged — ids only, chain is truth. Adds a completeness contract: paginated, complete-or-throw (companion Task 2); `stale`/`unavailable` ship inside the typed result so a consumer cannot obtain the ids without the status.

**L3 — Action modules (`lib/actions/*.ts`) — the Morpho import.** One pure module per action (deposit, claim, wrap, unwrap, supply, withdraw, adjust, borrow, repay, close, claim-pool-share, claim-stream):

```ts
{
  preconditions(ctx): ValidationError | null   // ONE derivation; approve and action buttons both consume it
  getRequirements(ctx): ApprovalRequirement[]  // measured from live allowance reads; zero-first classified here
  buildTx(ctx): FrozenTx                       // typed, frozen args — fill clamps, minAcceptable, repay clamp,
                                               // multicall encoding move here out of components
  touched(ctx): QueryKeyScope                  // invalidation derives from the action, not call-site memory
  summarizeReceipt?(logs): ReceiptSummary      // partial-fill / drift detection
}
```

Bounds on streaming collateral are computed at a forward timestamp (Morpho's accrual discipline): a stream keeps streaming between quote and signature.

**L4 — One write engine.** `useWriteFlow` absorbs `useTxQueue` (the queue becomes a plan-runner feeding txs through the same engine). ChainId injection, receipt-status truth, invalidation (scope from `action.touched()`), and the held-streams retry live in exactly one place. Freeze-at-review formalized: an `accepted` snapshot at review; material drift ⇒ explicit re-accept (generalizing the existing borrow `staleRecovery`).

**L5 — One flow machine (`<ActionFlow>`) — the Aave import.** A single component owning the guard chain: connect → wrong-network (keep the existing `FormBody` seam) → preconditions → requirements (approve buttons disabled by the *same* preconditions) → action → confirming → settled — with the shared step indicator, the single optimistic-approval mirror + reset effect, shared Success/Error rendering, and labeled input/select primitives (closes the a11y recurrence channel). Forms shrink to field markup + an action-module reference; `ActionModal.tsx` splits into per-action content files around this one machine.

**"Add a new action" procedure:** write `lib/actions/<name>.ts` (the 5 functions) + unit tests against the pure module; register the `ActionType`; render `<ActionFlow action={newAction}>` with its fields. Zero new `disabled` expressions, step machines, invalidation knowledge, or reset effects. (Today the same task means hand-building all four and getting each right.)

---

## 7. Structural findings

- **P0 — Write policy has no owner** (clusters 2+3+7, ≥19 defects). 6 gate/step machines, 3 `activeIndex` derivations, 5 optimistic-reset copies, drift in 4 of 5 approve gates (ActionModal.tsx:836/:848/:1259/:1521/:1691 vs action gates), 2 write engines. Docs already name the cause: `docs/solutions/best-practices/enforce-write-invariants-at-the-write-layer-not-the-call-site.md`.
- **P0 — Read results are untyped** (clusters 1+5, ≥17 defects, 3 recurrence waves, 2 bug-pinning tests). `?? 0n` default idiom vs per-site settled checks; status flags exported but ignorable (`useHeldStreams.ts:174–177` vs `PositionSummary.tsx`). Rule stated in `docs/solutions/ui-bugs/nullish-default-flips-read-semantics.md`; nothing enforces it.
- **P1 — Invalidation scope is call-site knowledge** (cluster 6). `useWriteFlow.ts:10–15`'s own warning; `lib/claim-all.ts:4–11`.
- **P1 — Build artifacts mutate the committed tree; env validation scattered** (cluster 8; companion Tasks 1+4).
- **P2 — Planner math leaks into components** (borrow fill clamp ActionModal.tsx:996–998, `minAcceptable` :1074, AdjustRate in-component `encodeFunctionData` :1440–1475, repay clamp :1601) — absorbed by L3.
- **P3 — No shared address/tx-hash primitive; connect state has no single owner** (ethskills checklist gaps) — absorbed by L5.

## 8. Known / intentional (not re-litigated)

No-USD pricing; zero Reown project-ID fallback; indexer-as-discovery + public bounded endpoints; KTD11 (per-user on-chain indexes declined — H-4/H-5 knowingly open); static export; freeze-show/recompute-submit; classified zero-first approve; fee approve = exact × 1.02; no SE2 UI components; `useStaleRecovery` deliberately unscoped; `wrongChain` false while disconnected; `workers: 1` E2E. Doc paths in `docs/frontend-decision-map.md`, the 2026-07-28 plans, and the corresponding solutions writeups. The target architecture changes none of these.

---

## 9. Migration plan (ordered; each move ships green)

| # | Move | Kills | Risk | Verification |
|---|---|---|---|---|
| 0 | Land [2026-07-29-001](2026-07-29-001-fix-web-review-findings-plan.md) first (Tasks 3/5/10 pre-shape L1/L5) | the 10 live defects | Low | that plan's criteria |
| 1 | **L1 typed reads** + banned-pattern lint for read-data defaults + `queryKeysFactory` | Cluster 1; cluster 5's consumer leaks — the 3-wave recurrence channel | Med (touches every hook; flips 4 bug-pinning tests) | unit suite + one-failed-subcall test per hook |
| 2 | **L3 action modules**: extract component math into `lib/actions/*` with the 5-function contract; forms call them but keep their machines temporarily | Layer leaks (planning in components, submit-from-display-math); enables moves 3–4 | Low (pure extraction) | new pure-module tests; E2E unchanged |
| 3 | **L5 `<ActionFlow>`**: build the machine; migrate forms one at a time (Supply first — simplest; Borrow last — richest) | Cluster 2; cluster 7's wiring duty; cluster 10's monolith; a11y recurrence | Med-high (behavioral surface; per-form migration behind existing E2E) | per-form E2E green before the next form migrates |
| 4 | **L4 engine unification**: useTxQueue onto useWriteFlow; invalidation from `action.touched()` | Cluster 3 residual; cluster 6 | Med (Claim All is the sensitive flow) | claim-all E2E incl. mid-queue failure + signer switch; the count-asserting invalidation tests |
| 5 | Formalize freeze/accept snapshots + forward-timestamp bounds in L3 | Cluster 7 drift class; quiet-market revert class | Low | borrow/adjust E2E + math unit tests |
| 6 | Process guard: every "FIXED" record gets a test keyed to *behavior*, not component identity; `web/reviews/test-accountability.md` actually used (currently zero entries) | the WEB-007/WEB-009 rewrite-regression channel | Low | review checklist |

Moves 1–2 are independent and can run in parallel. Nothing requires touching Solidity, the Ponder scope, or any settled decision.

---

## 10. Verdict

**Local refactor — redraw two layers, keep everything else.**

- A **full rewrite is unjustified**: the hard decisions (trust boundaries, planner purity, write hardening) are already right and battle-validated by the peer research — Morpho's deprecation of their protocol-mirror simulator specifically vindicates *not* building more machinery than this.
- **Continued form-level patching is equally unjustified**: the regression ledger proves hand-propagated fixes decay — fixed items re-broke via rewrites four separate times.
- The [2026-07-28-003](2026-07-28-003-refactor-web-adopt-se2-patterns-plan.md) "no framework rebuild" conclusion stands, but it answered the wrong comparison: SE2 lacks the layer OVRFLO is missing. Aave and Morpho have it, and it is precisely the layer where OVRFLO's defects concentrate.
