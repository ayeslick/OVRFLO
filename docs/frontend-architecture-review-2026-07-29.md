# OVRFLO frontend architecture review

**Date:** 2026-07-29  
**Scope:** Review only — no code changes  
**Question:** Are `web/` defects mostly local bugs or structural architecture failures? What target architecture (peer-adapted, OVRFLO-trust-preserving) justifies or rejects a multi-week migration?

---

## 1. One-sentence outcome

Most recurring `web/` defects are structural ownership failures across ~5 boundaries — not “forgot a check” — but the existing outcome-first layering is sound enough that the smallest migration is redraw those boundaries in-tree, **not** a greenfield rewrite.

**Verdict:** Keep + redraw ownership. Reject SE2/full rebuild. Ship protocol discovery (H-4/H-5) + unify write runtime + ActionPlan + ReadResult.

---

## 2. Research log (depth bar)

| Lane | Sources inspected |
|------|-------------------|
| **A — Project contract** | `docs/frontend-decision-map.md`; `docs/solutions/patterns/ovrflo-critical-patterns.md`; `docs/solutions/architecture-patterns/web-markets-outcome-first-planners-and-tx-queue.md`, `enforce-write-invariants-at-the-write-layer-not-the-call-site.md`, `scoped-cache-invalidation-and-its-named-exception.md`, `narrow-the-ponder-read-surface-to-the-app-queries.md`; design patterns `freeze-what-you-show-recompute-what-you-submit.md`, `refs-beat-state-for-cross-effect-race-guards.md`, `optimistic-approve-with-classified-zero-first-fallback.md`; `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`; plans `2026-07-28-002`, `2026-07-28-003`, `2026-07-29-001`; dogfood `audit-2026-07-28.md`, `2026-07-28-c1024d9-dogfood.md`; `docs/audit/trust-assumption-ledger.md`, `rejected-findings-record.md`; `CONCEPTS.md`; `web/reviews/*`; `docs/solutions/ui-bugs/*` |
| **B — Ethskills** | Fetched: https://ethskills.com/SKILL.md, `/frontend-ux`, `/indexing`, `/qa`, `/frontend-playbook` — applied as structural checklist (§7) |
| **C — Peers (≥4)** | Morpho (`morpho-org/sdks` `morpho-sdk/ARCHITECTURE.md`, `morpho-org/morpho-lite-apps`); Aave (`aave/interface` hooks + `@aave/react` docs); Euler (`euler-xyz/euler-lite` `composables/useEulerTx.ts`); Uniswap (`Uniswap/interface` `apps/web`); Pendle (examples-public + docs — app UI not fully OSS); SE2 via plan 003 at commit `78ed3e8` |
| **D — Code map** | Greps: `writeContract` / `useWriteFlow` / `useTxQueue`; ponder `fetchHeldStreamIds` / `fetchBorrowDemand`; planners `router` / `borrow` / `claim-all` / `lending-math`; `invalidateOnChainReads`; `enumerateIds` in liquidity/loan hooks; confirmed **no** `lenderPosition*` / `simulateContract` in tree |

Absence of evidence ≠ fine. Gaps marked **Needs Verification**.

---

## 3. Current architecture map

### 3.1 Subsystems

| Layer | Path | Owns | Must not |
|-------|------|------|----------|
| App | `web/app/` | Route + metadata | Business logic |
| Compose | `web/components/` | `MarketsApp` two-level state; `ActionModal` forms (~1729 LOC) | Quote math as submit args |
| Hooks | `web/hooks/` (21) | wagmi/RQ; write runners; discovery hydrate | Display-only StreamPricing mirrors |
| Pure lib | `web/lib/` planners | `buildLadder`, `planSelectedBorrow`, `planClaimAll`, `lending-math*` | Fetch or write |
| Seams | wagmi / `WalletRuntime` / config / CSP | Chain pin, static export, AppKit vs E2E | Secrets in client |
| Ponder | `lib/ponder.ts` + `tools/ponder/src/api` | `GET /streams` ids, `GET /demand` events | Arbitrary SQL; position truth |

### 3.2 Entry points

```
app/page.tsx:Page
  → Providers
    → MarketsApp
         ├─ PositionSummary → ClaimAllModal → useTxQueue
         ├─ MarketsTable → MarketRowDetail → PositionList
         └─ MarketDetail → FormBody (ActionModal.tsx)
              ├─ supply → SupplyForm
              ├─ withdraw|claim_share|claim_stream|close → SimpleActionForm
              ├─ deposit|claim_matured|wrap|unwrap → ConvertForm
              ├─ borrow → BorrowForm
              ├─ adjust_rate → AdjustRateForm
              └─ repay → RepayForm
```

**Production `useWriteContract` consumers:** only `useWriteFlow.ts` and `useTxQueue.ts`.

### 3.3 Lib export inventory (major)

| Module | Key exports |
|--------|-------------|
| `router.ts` | `TickDepth`, `buildLadder` |
| `borrow.ts` | `planSelectedBorrow`, `resolveSelectedTick`, `classifyBorrowError`, `borrowReceiptSummary` |
| `claim-all.ts` | `QueuedTx`, `planClaimAll` |
| `convert.ts` | `depositCapStatus`, `bufferedFeeApproveAmount`, `convertApprovalNeeds`, `convertValidationError` |
| `lending-math.ts` | Display mirrors + `loanOutstanding`, `loanPoolClaimable`, `recoveredForClaimable`, `enumerateIds` |
| `modal-logic.ts` | `repayMax`, `canCloseLoan`, `applySlippageDown/Up`, `isSeriesMatchedStream` |
| `ponder.ts` | `fetchBorrowDemand`, `fetchHeldStreamIds` |
| `invalidate.ts` | `invalidateOnChainReads`, `invalidateAllOnChainReads`, `marketContracts`, `scheduleHeldStreamsRetry` |
| `query-keys.ts` | `streamKeys`, `demandKeys` |
| `errors.ts` | `userFacingError`, `STALE_LIQUIDITY_REASONS`, `isRevertFailure` |

### 3.4 End-to-end flows (file:symbol)

| Flow | Key symbols | Submit truth |
|------|-------------|--------------|
| Browse → expand | `useAllMarkets` → `MarketsTable.onSelect` → `MarketRowDetail` | n/a (reads) |
| Supply | `SupplyForm` → `zeroFirst.submit` → `supplyLiquidity` | User amount; allowance from chain |
| Borrow | `planSelectedBorrow` → `quote` + `gatherLiquidity` → `createBorrowerLoanPool` | Contract `quote`/`gather` only |
| Claim all | `planClaimAll` review → replan on CONFIRM → multicall / `withdrawMax` | Live replan; `MAX_UINT128` claim |
| Approve → invalidate | `useWriteFlow.writeContract` → `receipt.status` → `invalidateOnChainReads` | Scoped contracts + stream retry |

**Borrow detail:** `ActionModal.BorrowForm` clamps fill to `quote(…, 0).grossPrice`, then fill `quote` + `gatherLiquidity`; `minAcceptable = applySlippageDown(quote.net)`; stale revert → `useStaleRecovery` → `invalidateAllOnChainReads`.

**Claim-all detail:** freeze display plan at open; CONFIRM/RESUME replan from live props (R41); `queueOwner` ref pauses on signer switch (R42).

### 3.5 Structural invariants

| Invariant | Enforced? | Evidence |
|-----------|-----------|----------|
| Indexer ids-only; chain for stream values | **Yes** | `useHeldStreams`, `ponder.ts` |
| Never submit from `lending-math` display | **Yes** | BorrowForm quote path; module header |
| Wrong-chain write refused | **Yes** | `useChainGuard` + `chainId` inject |
| Revert ≠ confirmed | **Yes** | `receipt.data.status` |
| Claim-all replan on confirm | **Yes** | `ClaimAllModal` R41 |
| Write invariants only in one runner | **No** | `useTxQueue` duplicates `useWriteFlow` |
| Position discovery O(user) not O(history) | **No** | `enumerateIds` still live; no `lenderPosition*` in `src/` |
| Failed read ≠ domain zero | **No** | `withdrawable→0n`; multicall subcall drop |
| Discovery complete or fail-closed | **No** | streams `limit=100` silent |
| CSP is build artifact not committed stale | **No** | `vercel.json` localhost / mid-build mutation |

### 3.6 Layer leaks

| Leak | Where | Risk |
|------|-------|------|
| Planning orchestration in components | `BorrowForm` composes ladder+plan+quote+gather; `RatesCell` uses display math | Thickest in borrow form |
| Submit-from-display-math | Borrow fill/net: clean. Claim All **gating** uses client `loanPoolClaimable` | UX under/over-include; contract validates |
| Indexer-as-truth | Demand intentional. Stream ids truncated silently. Summary treats empty as complete when discovery fails | Active P1/P2 |
| Duplicated write policy | `useWriteFlow` vs `useTxQueue` | Drift (already bitten on revert-as-confirmed) |
| Inconsistent approval gating | Convert/Repay/Borrow approve weaker than action `modeDisabled` | Wasted signatures / bypass |
| Zero-collapsed multicalls | `useAllMarkets` / `useLending` / liquidity / loan book | Empty UI / wrong gates |

---

## 4. Bug class → structural root cause

| Bug class | Signal | Root | Status | Note |
|-----------|--------|------|--------|------|
| Wrong-network writes / silent L2 no-ops | audit-2026-07-28 H-2 | R1 Write-SM ownership | Fixed | `useChainGuard` + write-layer `chainId` |
| Re-arm after CONFIRMED (double deposit) | H-3 | R1 confirm→cache | Fixed | `useClearOnConfirm` + `isConfirmed` in disabled |
| O(history) eth_call storms + id-500 cliff | H-4 / H-5 | R3 Discovery topology | **Open** | `enumerateIds` live; per-user index not in `src/` |
| Indexer fields as eligibility | M-9 / R37 | R2 Indexer≠truth | Fixed | ids-only + Sablier hydrate + `ownerOf` |
| Silent stream discovery truncation | 2026-07-29 P1 | R2 + R3 | **Open** | `ponder.ts` `limit=100`; no `hasMore` |
| Claim-all plan frozen at open | M-6 | R1 freeze-show/recompute-submit | Fixed | replan at CONFIRM |
| Signer-switch queue race | M-7 / R42 | R1 refs-vs-state | Fixed | `queueOwner` ref |
| Revert receipt treated as confirmed | logic-errors writeup | R1 dual write runners | Fixed | `receipt.status`; still duplicated in 2 hooks |
| Failed reads collapse to 0 / empty | nullish-default + 07-29 P2 | R4 Read failure semantics | **Open** | `withdrawable→0n`; multicall drop |
| Approve buttons weaker than action gates | 07-29 P2 | R1 + R5 Form concentration | **Open** | Convert/Repay/Borrow |
| Claim All under unavailable discovery | 07-29 P2 | R2 aggregates | **Open** | `PositionSummary` ignores `stale`/`unavailable` |
| WEB-009 claim capacity / WEB-007 zero factory | reviews + 07-29 | R5 rewrite regressions | **Open** | FIXED tracker stale after rebuild |
| CSP localhost / mid-build `vercel.json` | M-17 / 07-29 P1 | R6 Deploy artifact ownership | **Open** | committed CSP; build mutates source |
| A11y labels / focus / target size | M-1, M-4, M-5, M-16 | Local (presentation) | Mixed | Own tranche; not ownership |

**Share:** ~10 of 14 recurring classes map to R1–R5 ownership. A11y is local. USD is intentional non-compliance.

### Root boundary index

| ID | Boundary |
|----|----------|
| R1 | Write state-machine ownership (gates, confirm→cache, dual runners, freeze/recompute) |
| R2 | Indexer vs chain truth (discovery completeness, empty≠unavailable, aggregates) |
| R3 | Discovery topology (enumerate 1..500 vs per-user index; stream pagination) |
| R4 | Read failure semantics (failed ≠ domain zero / empty) |
| R5 | Form concentration / duplicated write policy in `ActionModal` |
| R6 | Deploy/CSP artifact ownership |

---

## 5. Peer pattern board

| Peer | Modules inspected | Extracted pattern | C/A/R | Why |
|------|-------------------|-------------------|-------|-----|
| **Morpho** | `morpho-sdk/ARCHITECTURE.md`; `morpho-lite-apps` `apps/fallback` | Client→Entity→Action; `getRequirements`/`buildTx`; deepFreeze; app owns wagmi/RQ cache | **Adapt** | Matches pure planners; requirements system beats per-form approve drift |
| **Aave** | `aave/interface` `hooks/useApprovalTx`, `useIsWrongNetwork`; `@aave/react` ExecutionPlan | prepare → `ApprovalRequired` \| `TransactionRequest`; wrong-network hook | **Adapt** | Central plan enum kills approve/action gate duplication; keep OVRFLO `FormBody` UX |
| **Euler** | `euler-lite` `composables/useEulerTx.ts`; `utils/sdk-query-cache`; `waitForSubgraphBlock` | SDK `TransactionPlan` + simulate/prepare + invalidate-after-tx + indexer catch-up | **Adapt** | Explicit confirm→cache + indexer lag; OVRFLO already has half (retry ladder) |
| **Uniswap** | `Uniswap/interface` `apps/web` hooks `usePermit2Allowance`, `useUniswapXSwapCallback` | Derived trade vs submit callback; gas estimate preflight | **Adapt (narrow)** | Copy derived≠submit + simulate; reject Redux megastore & brand UI |
| **Pendle** | `pendle-examples-public`; Hosted SDK / OpenAPI docs; core contracts public | Hosted quote API + on-chain settle; frontend not fully OSS | **Adapt/Reject** | Adapt quote-then-submit; reject API/indexer as submit authority |
| **SE2** | Plan 2026-07-28-003 at `78ed3e8` | Confirm-wait writes; **no** post-write invalidate; zero a11y in `@scaffold-ui` | **Adapt/Reject** | Take simulate + fallback transport + scoped keys; reject UI components & rebuild |

**Missing peer patterns that explain recurrence better than “forgot a check”:**

1. Single execution-plan / requirements object per action — OVRFLO has pure planners for borrow/claim but approve+gate policy still lives in six forms.
2. One write/runtime module — dual runners already caused revert-as-confirmed twice.
3. Explicit indexer catch-up gate on aggregates — Euler `waitForSubgraphBlock` / OVRFLO retry exists but summary bypasses.
4. Fail-closed incomplete discovery — Morpho fallback is chain-first; OVRFLO truncates silently.

---

## 6. Target architecture (implementable)

### Keep OVRFLO-specific (settled)

- Pure planners in `lib/` (`router`, `borrow`, `claim-all`)
- Display math never submitted
- Freeze-show / recompute-submit
- Indexer discovery-only; protocol for positions/loans
- Optimistic zero-first approve
- No USD feed; static export; Reown AppKit
- `errors.ts` protocol revert map

### Resemble peers (ownership redraw)

| Piece | Model after | Role |
|-------|-------------|------|
| **WriteRuntime** | Morpho/Euler | One place for `chainId`, simulate, receipt-truth, invalidate, stream retry |
| **ActionPlan** | Aave ExecutionPlan | `{ needs: Approval\|Ready, gates, buildTx() }` registered catalog |
| **ReadResult\<T\>** | — | Fail ≠ 0 / empty |
| **Discovery** | Settled decision map | Protocol per-user index + paginated stream ids with `hasMore` |
| **Thin forms** | — | `ActionModal` becomes renderer of ActionPlan slots |

### Add a new action (target path)

1. Add pure planner/validator in `lib/`
2. Register `ActionPlan` (approvals, related contracts, `buildTx` from quote reads)
3. Thin form binds `AmountInput` + `FormBody`
4. `WriteRuntime` submits
5. Tests: planner unit + gate matrix + one write-flow integration  
**No new `writeContract` outside WriteRuntime.**

---

## 7. Ethskills structural checklist

| Rule | OVRFLO today | Gap |
|------|--------------|-----|
| UX R1/QA: per-action pending + confirm→cache cooldown | Partial→Yes on forms | No shared `approvalSubmitting`/`approveCooldown` primitive across all forms |
| UX R2/QA: Connect→Switch→Approve→Execute one-at-a-time | Yes (`FormBody` + `useChainGuard`) | Approve gating weaker than action on some forms (07-29) |
| Indexing: historical via indexer; current via chain | Yes for streams; No for liquidity/loans | Settled fix is per-user protocol index — not shipped |
| Indexing: never treat mirror as truth for action | Yes (`ownerOf`) | Aggregates (`PositionSummary`) still soft-fail empty |
| Playbook: clean build / trailingSlash / no public RPC | Partial | CSP artifact lifecycle broken; trailingSlash deploy-target unset |
| UX R4: USD context | Deliberately No | Known intentional (decision map §5) |

---

## 8. Structural findings P0–P3

| Pri | Finding | Checked against |
|-----|---------|-----------------|
| **P0** | Position/loan discovery still `enumerateIds(1..500)` — H-4/H-5 unfixed in code | `frontend-decision-map` §3; remediation plan; `src/` no `lenderPosition*` |
| **P0** | Dual write runtimes (`useWriteFlow` ∥ `useTxQueue`) — invariant drift surface | `enforce-write-invariants-at-write-layer`; grep `writeContract` |
| **P1** | `ActionModal` concentrates duplicated write/approve policy (~1729 LOC) | outcome-first pattern; 07-29 approval gating; Morpho/Aave plans |
| **P1** | Stream discovery silent truncate + aggregates ignore unavailable | `indexer-is-discovery-hint`; ethskills indexing; 07-29 Tasks 2/8 |
| **P1** | Failed multicall/overlay reads collapse to empty/zero | `nullish-default-flips-read-semantics`; ethskills QA honesty |
| **P2** | CSP/deploy artifact ownership broken | frontend-playbook; `fail-the-build-on-missing-security-config`; M-17 |
| **P2** | No `simulateContract` preflight (SE2 plan 003 R1 open) | 2026-07-28-003; Euler simulate; Uniswap estimateGas |
| **P2** | Single RPC transport; `demandKeys` never invalidated | ethskills UX R5; scoped-cache-invalidation; `query-keys.ts` |
| **P3** | Review tracker WEB-* stale after rewrite → regressions reopen as “new” | `web/reviews/issues-and-fixes.md`; 07-29 WEB-007/009 |
| **P3** | Presentation a11y set remaining | decision-map §2; ethskills UX — local, not ownership |

---

## 9. Known / intentional

| Item | Disposition | Path |
|------|-------------|------|
| USD context | Not built; CoinGecko CSP removed by plan | decision-map §5 #2 |
| 18-decimal hardcode | Pendle PT invariant; L-1 rejected | rejected-findings; R-01 |
| Ponder not for positions | Protocol per-user index settled | decision-map §5 #1 |
| Optimistic zero-first (not always) | wstETH set; classified fallback | `useZeroFirstApprove` |
| Sale side disclosure only | Settled | remediation plan |
| SE2 UI components | Rejected (a11y zero; EtherInput reset) | plan 003 |
| Sablier public withdraw (audit H-1) | Disproven v1.1 ACL | rejected-findings-record |
| Cross-market ovrfloToken fungibility | Design feature | AGENTS / CONCEPTS |

---

## 10. Migration plan

Ordered moves from the **current tree**. Do not edit plan files while implementing. Preserve design system.

| Move | Risk | Bug classes killed | Verification |
|------|------|--------------------|--------------|
| **M0** Unify write runtime | Med | Dual receipt/chain/invalidate drift; new-action forgetting invariants | All production writes via one wrapper; `useTxQueue` calls it |
| **M1** Action catalog + shared gates | Med | Approve/action gate skew; FormBody policy copy-paste; WEB-009-class regressions | New action = register plan + thin form; no new `writeContract` in ActionModal |
| **M2** Read-result ADT (`ok` \| `null` \| `error`) | Med | nullish→0; multicall erasure; false empty markets | Hooks never return domain 0 for failed subcalls; UI distinct states |
| **M3** Discovery completeness | High (Solidity) | H-4/H-5; silent stream truncation | `lenderPosition*` + paginated streams; `TruncationNotice` only if `hasMore` known |
| **M4** Aggregate trust wiring | Low | Claim All under unavailable; demand never refreshed | `PositionSummary` uses `stale`/`unavailable`; `demandKeys` invalidate on borrow |
| **M5** Deploy/CSP ownership | Med | M-17 / localhost CSP ship risk | Build never mutates committed files; header artifact verified |
| **M6** SE2 additive (simulate, fallback RPC) | Low | Wallet prompts on known reverts; single-RPC fragility | Plan 003 R1–R8 tests green; no visual change |

**Sequencing note:** M0–M2 are web-only and kill most recurrence without waiting on Solidity re-audit. M3 is the multi-week contract surface already settled in the remediation plan.

---

## 11. Synthesis answers

### Are most defects structural?

Yes. Roughly **70%** of recurring bug classes collapse to **five ownership boundaries** (R1–R5). Form-level patches will not hold if write policy, discovery, and read-failure semantics stay duplicated or silent.

### Which missing peer patterns explain recurrence?

Central **ActionPlan/requirements**, a **single WriteRuntime**, **aggregate indexer catch-up**, and **fail-closed incomplete discovery** — not more per-form checks.

### What must stay OVRFLO-specific vs peer-shaped?

**Stay:** planners, display-math boundary, indexer discovery-only, no USD, zero-first classify, static export, protocol (not Ponder) for positions.  
**Resemble Morpho/Aave/Euler:** write runtime, execution plan, confirm→cache + indexer lag on aggregates.

### Smallest migration that kills whole classes?

Not greenfield. **M0→M2** (web ownership) + **M3** (settled protocol discovery) + **M5** (CSP). Plan 003 SE2 pieces are additive (M6), not a rebuild.

---

## 12. Verdict

| Option | Decision |
|--------|----------|
| Keep as-is | **No** — open P0/P1 recurrence |
| Local refactor only | **Insufficient** — ownership is duplicated |
| Greenfield rewrite | **Reject** — logic layer already ahead of SE2 on invalidate, staleTime, errors, CSP |
| **Keep + redraw ownership** | **Yes** — finish settled architecture in current tree |

Relative to Solidity, `web/` feels bug-heavy because cross-cutting policy is still owned by forms and dual runners, while the protocol already centralizes invariants. The Jul 23 outcome-first architecture and Jul 28–29 remediation patterns are the right shape; peers validate that shape. What is missing is finishing ownership consolidation and the settled discovery redesign.

---

## Needs Verification

- Whether Vercel honors mid-build `vercel.json` mutation in practice
- Bit-exact `lending-math` vs `StreamPricing.sol` on fee/TTM edges
- Whether any production market can ever be non-18 decimals (decisions say no)
- E2E comments still naming `invalidateAllOnChainReads` for `useWriteFlow` (code uses scoped `invalidateOnChainReads`)

---

## Related artifacts

- Interactive canvas: sibling Cursor canvas `ovrflo-frontend-architecture-review.canvas.tsx` (same findings)
- Orientation: `docs/frontend-decision-map.md`
- Remediation: `docs/plans/2026-07-28-002-fix-audit-2026-07-28-remediation-plan.md`
- SE2 gaps: `docs/plans/2026-07-28-003-refactor-web-adopt-se2-patterns-plan.md`
- Open web findings: `docs/plans/2026-07-29-001-fix-web-review-findings-plan.md`
