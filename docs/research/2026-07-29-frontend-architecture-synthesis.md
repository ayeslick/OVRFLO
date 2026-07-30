# Frontend architecture: synthesis of the three 2026-07-29 documents

Status: synthesis. Review-only; no code changed.

**Inputs:**

- **[FIX]** [docs/plans/2026-07-29-001-fix-web-review-findings-plan.md](../plans/2026-07-29-001-fix-web-review-findings-plan.md) — tactical: 11 tasks for 10 code-verified findings.
- **[DIAG]** [docs/plans/2026-07-29-002-web-structural-architecture-diagnosis.md](../plans/2026-07-29-002-web-structural-architecture-diagnosis.md) — structural diagnosis: five research lanes (docs inventory, code map, ethskills checklist, Uniswap/Aave, Pendle/Morpho-SDKs/SE2/Compound).
- **[RES]** [docs/research/2026-07-29-ovrflo-frontend-architecture-research.md](2026-07-29-ovrflo-frontend-architecture-research.md) — an independent structural review of the same tree (peers: OpenPendle, Uniswap, Aave, Morpho Lite Apps).

DIAG and RES were produced independently on the same day from the same commit. Their agreement is therefore evidence, not repetition — two separate deep passes over the same code and docs reached the same verdict through different peer sets. Divergences below were resolved by re-checking code in this session, not by preference; two claims unique to RES were newly verified before being adopted (§4).

---

## 1. Headline

All three documents agree, at every level where they overlap:

**The defects are structural; the architecture is right; the fix is a headless refactor of narrow boundaries — insert the missing policy layers, do not rewrite, do not keep patching forms.**

- FIX proves the *current* defects (10 findings, all code-verified, four of them regressions of previously-fixed items).
- DIAG proves the *history*: ~60 recorded defects, 10 clusters, fixes re-broken by rewrites four separate times because there is no layer for fixes to live in.
- RES proves the *present concentration*: 15 of 16 current/open defect classes (~94%) map to four boundaries, none of them requiring UI redesign.

---

## 2. Convergence map

### 2.1 The verdict (unanimous)

Reject greenfield rebuild (would discard typed ABIs, OVRFLO planners, error mapping, chain-hydrated streams, scoped invalidation, receipt-status truth, queue sequencing, static export, a11y work). Reject continued per-form patching (the regression ledger proves hand-propagated fixes decay). Do a sequenced headless refactor.

### 2.2 The four boundaries (same substance, different names)

| RES boundary | DIAG boundary | Shared content |
|---|---|---|
| Discovery, completeness, remote-data semantics (7 classes) | **R** — typed read results (clusters 1+5, ≥17 defects, 3 recurrence waves) | Failed subcalls become 0/1n/absent; loading/error/empty conflated; discovery truncates silently; status flags exported but ignorable |
| Action-definition ownership (3 classes) | **W** part 1 — no owner for write policy (clusters 2+7, ≥14 defects) | Approval gates drift from action gates; validation, args, optimistic state hand-copied ×6 forms |
| Transaction executor (2 classes) | **W** part 2 — two write engines (cluster 3) | useTxQueue parallels useWriteFlow; RES adds simulation + chain-override (§4) |
| Runtime/deployment (3 classes) | **B** — build artifact lifecycle (cluster 8) | CSP mutation of committed files; zero-factory prod builds; RES adds RPC fallback |

DIAG additionally isolates the settled H-4/H-5 enumeration cliff as half-boundary/half-decision; RES counts it inside boundary 1 and elevates it to a P1 with a governance demand (§4.8). Same facts, compatible framings.

### 2.3 The target architecture (independently derived, near-identical)

Both DIAG and RES propose, without having seen each other:

- **Typed read results** — a `ReadResult` discriminant (`loading | ready | partial | unavailable`); failed subcalls never default; completeness required before aggregate actions; Ponder responses carry cursor/`hasMore`; successful siblings stay visible in `partial`.
- **One pure action definition per action** under `lib/actions/*` — near-identical file lists and identical responsibility sets: parsed input, required reads, preconditions (one derivation feeding both approve and submit buttons), required approvals, final-call builder, touched keys, receipt interpretation. Both explicitly warn against an inheritance framework or generic form builder.
- **One transaction runner** owning connect → wrong-network → preconditions → approval → sign → confirm → refresh → settled; Claim All routed through the same engine; invalidation scope derived from the action, not remembered at call sites.
- **Modal split last, and not as the fix** — both state that a six-file ActionModal with duplicated policy preserves every defect.
- **Same migration spine:** read-model first → action extraction → runner unification → modal split → build/runtime hardening.
- **Same untouchables:** discovery-only Ponder, no-USD, static export, 18-decimals, freeze-show/recompute-submit, classified zero-first, `0 = unlimited`, KTD11, scoped invalidation retained, disproven Sablier H-1 not re-raised.

### 2.4 Findings cross-confirmation

RES independently re-derived and confirmed all ten FIX findings (its P1/P2/P3 items map onto FIX Tasks 1–11; mapping table in §6) and endorsed FIX's task directions. Three documents now agree on the complete current-defect set.

---

## 3. Divergences and resolutions

### 3.1 "How structural?" — 94% vs two-thirds

RES: 15/16 *current/open defect classes* (~94%). DIAG: 8/10 clusters covering ~40/60 *historical recorded defects* (~two-thirds). **Not a contradiction — two denominators.** The historical view includes fixed one-off classes (a11y tranche, infra drifts) that dilute the ratio; the current view shows that what *remains* is almost entirely structural. **Synthesis position: use RES's figure for "what's left" and DIAG's regression ledger for "why patching doesn't hold."** Both numbers support the same verdict.

### 3.2 Simulation-before-sign

RES elevates "no mandatory final-call simulation" to a named executor gap and puts `revalidating → simulating` in the runner's state machine, writing the exact request simulation returns. DIAG carried this only implicitly (via SE2-plan R1 adoption). **Adopt RES's stronger position.** It is already sanctioned project direction ([2026-07-28-003](../plans/2026-07-28-003-refactor-web-adopt-se2-patterns-plan.md) R1–R3), SE2's `simulateContractWriteAndNotifyError` and viem's simulate→write contract support it directly, and it converts a whole class of "predictably reverting tx reaches the wallet" defects (borrow pre-gate, matured-claim capacity, fee-drift strand) from per-form validation problems into an engine guarantee.

### 3.3 Chain-ID override — new finding, **verified this session**

RES claims the write helper lets callers override the pinned chain. **Confirmed in code:** [useWriteFlow.ts:82](../../web/hooks/useWriteFlow.ts) executes `write.writeContract({ chainId: configuredChainId, ...args }, options)` — the spread comes *after* the injection, so an `args.chainId` would win. No current call site passes one (grep-verified in the DIAG lanes' inventories: all 15 sites pass address/abi/functionName/args only), so this is latent, exactly as RES states — but it inverts the intent of the R6/KTD5 comment directly above it (":60–70: 'a call site added later cannot forget it'" — a call site added later can now *override* it). DIAG's Lane D marked chain injection "enforced"; that entry is hereby corrected. **Fix (one line): `{ ...args, chainId: configuredChainId }`, or strip `chainId` from the caller-facing type.** Added to the consolidated register (§6) as the runner-unification move's first commit — it can also land immediately as a standalone fix.

### 3.4 Aave: how much to copy

DIAG (from `aave/interface` at HEAD): copy `TxActionsWrapper` as the shared approve→action machine. RES: Aave "still repeats approvals and invalidations inside individual action modules — evidence for centralization, not a structure to reproduce." **Both are right about different halves, and the resolution is already implicit in DIAG's own Lane C1 notes:** copy Aave's *shared guard-chain shell and state cells* (the part that stops button/step drift), but do **not** copy its per-flow ownership of invalidation and approval bookkeeping — those move into the action definition + runner (Morpho's `{ getRequirements, buildTx }` shape, OpenPendle's single txflow). The synthesis target centralizes strictly more than Aave does.

### 3.5 Peer sets — complementary, merged board

The two documents inspected five distinct primary sources between them (plus two shared). Merged takeaways, deduplicated:

| Peer (doc) | What the synthesis keeps |
|---|---|
| **OpenPendle** (RES) — highest affinity: Pendle mechanics, static browser/RPC deployment | Pure `ActionPlan` + one approval/check/simulate/send machine (`lib/actions.ts`, `lib/txflow.ts`); latch plan/account/chain while sending; discovery artifacts carry coverage/completeness. Existence proof that a static dApp needs no server-heavy architecture |
| **Uniswap** (both) | Typed step vocabulary; freeze-while-submitting / explicit re-accept on drift; button state as pure derivation; invalidation derived from the typed tx |
| **Aave** (both) | Shared guard-chain shell + `approvalTxState`/`mainTxState` cells + queryKeysFactory — shell only, per §3.4 |
| **Morpho SDKs** (DIAG) | `{ getRequirements, buildTx }` action contract; forward-timestamp bounds for streaming collateral; entity-keyed cache discipline; **the deprecation of their TS protocol-mirror simulator ("no replacement package") — the strongest argument against over-building** |
| **Morpho Lite Apps** (RES) | Event-range reads exposing contiguous completeness + exact-key invalidation; its bare unsimulated `TransactionButton` is the anti-pattern OVRFLO must not land on after refactoring |
| **SE2** (DIAG) | Confirms the 2026-07-28-003 plan's verdicts at a newer commit; simulate-before-sign mechanics; SE2's compare-then-toast chain check is *weaker* than per-write pinning — which sharpens §3.3: the pinning must actually be unoverridable |

### 3.6 P0 rubric

RES: "No P0 — no path directly enables theft or bypasses an on-chain security boundary." DIAG: two P0s (write policy unowned; reads untyped). **Both stand: RES grades exploitability, DIAG grades structural severity.** Synthesis register (§6) carries both axes: no security-P0 exists; the two structural-P0 boundaries are the refactor's reason to exist.

### 3.7 Migration ordering — merged sequence in §5

Differences: RES starts with an invariant-baselining test step and treats FIX as "present but untracked"; DIAG starts by landing FIX (its Tasks 3/5/10 pre-shape the layers) and adds a process guard for the rewrite-regression channel. **Merged:** baseline tests and FIX-landing are steps 0a/0b (they don't conflict — FIX's tests *are* a large part of the baseline; the extra baseline tests RES names — simulation-failure-without-wallet-prompt, chain-override refusal, awaited refresh — cover the runner properties FIX doesn't touch). One overlap to manage: FIX Task 5 (shared preconditions per form) is a tactical version of what action definitions later absorb — land it anyway; it is cheap, kills live defects now, and its tests transfer to the action modules unchanged.

### 3.8 H-4/H-5 governance

DIAG filed the enumeration cliff under "settled (KTD11), out of scope." RES adds a step DIAG lacked: **make the acceptance explicit** — either record H-4/H-5 as accepted residual limitations with improved direct-contract recovery guidance, or reopen the minimal per-user index + bounded/cursored `gatherLiquidity` contract work; no frontend reorganization can prove "every owner can discover every position" under the current interface. **Adopted as migration step 7.** This is a decision only the maintainer can make; the synthesis does not presume the answer.

### 3.9 Runner properties only RES named — adopted

- **Success is not exposed until critical invalidations settle** (await the refresh before the terminal state) — closes the last confirmation-to-cache window neither FIX nor DIAG addressed.
- **Latch account/chain/plan once signing starts** (generalizing the existing M-7 queue-owner ref and Uniswap's freeze into an engine property rather than per-form wiring).
- **RPC fallback transport** — DIAG's Lane B logged the bare-`http()` fallback as a one-liner; RES correctly attaches it to the runtime boundary. Fold into the build/runtime hardening move (SE2-plan R6–R8 already specify it).

### 3.10 Assurance-record drift — new finding, **verified this session**

RES reports `error.tsx`/`global-error.tsx`/`loading.tsx` absent despite `web/reviews/next-best-practices-audit.md` recording NX-002/NX-003 fixed. **Confirmed:** `web/app/` contains only `globals.css`, `layout.tsx`, `opengraph-image.tsx`, `page.tsx`. This is the **fifth instance of the rewrite-regression pattern** (after WEB-007, WEB-009, pattern #3's dead-component fix, and revert-as-confirmed) — a recorded fix whose artifact did not survive a later restructuring, unnoticed because the record was tied to files rather than behavior. It lands in the same migration step as DIAG's process guard (behavior-keyed tests for every FIXED record; the empty `test-accountability.md` log actually used). RES's related observations stand as recorded: coverage informational and `lib/hooks`-only, E2E CI deferred, E2E never exercises the production Reown path (build-time `wallet-runtime` alias).

---

## 4. Newly verified in this synthesis session

1. **Chain-override spread order** — [useWriteFlow.ts:82](../../web/hooks/useWriteFlow.ts): confirmed; latent (no call site currently passes `chainId`); one-line fix. Corrects DIAG's invariant table entry.
2. **App-router recovery files absent** — `web/app/` listing confirmed; NX-002/NX-003 records stale; fifth rewrite-regression instance.

Everything else adopted from RES was either already verified by FIX/DIAG or is a design position, not a fact claim. One RES caveat is preserved verbatim: **which CSP Vercel ultimately serves remains Needs-Verification** (`vercel build` or production headers) — all three documents agree the artifact lifecycle is broken regardless of that outcome.

---

## 5. Unified migration sequence

Supersedes DIAG §9 and RES's sequence where they differ; each step ships green.

| # | Move | Source | Kills |
|---|---|---|---|
| 0a | Baseline invariant tests that don't yet exist: simulation-failure-without-prompt, chain-override refusal (pin §3.3's fix), awaited-refresh-before-success, complete/partial/unavailable semantics | RES 1 | makes every later step provable; the one-line chain fix can land here |
| 0b | Land [FIX](../plans/2026-07-29-001-fix-web-review-findings-plan.md) Tasks 1–11 (Task 5's precondition tests transfer to step 2's action modules) | DIAG 0 | the 10 live defects |
| 1 | **Typed read results** wrapped around existing hooks + banned-pattern lint for read-data defaults + entity-keyed `queryKeysFactory`; paginate `/streams` with cursor/`hasMore` (FIX Task 2 lands here if not in 0b) | both | boundary R: the 3-wave zero-collapse channel; false-empty markets; silent truncation |
| 2 | **Action definitions** extracted from `ActionModal.tsx` into `lib/actions/*` (start Convert, Borrow, Repay — they contain all three demonstrated drift patterns); approve and submit render from one precondition result | both | boundary W part 1: gate drift, component math leaks, submit-from-display-state |
| 3 | **Single runner**: `useWriteFlow` gains revalidate → simulate-exact-call → latch account/plan → sign → confirm (`receipt.data.status`) → invalidate from `action.touched()` → **await critical refresh** → settled; chain pinned unoverridably; `useTxQueue` becomes a plan-runner over the same engine, re-planning each leg after the preceding receipt | RES 3–4 + DIAG L4 | boundary W part 2: engine duplication, call-site invalidation memory, wallet-reachable doomed txs, last confirm-to-cache window |
| 4 | **Flow shell + modal split** (Aave-shaped shell per §3.4; per-form migration behind existing E2E, Supply first, Borrow last; the split is maintenance, not the fix) | both | monolith/dead-code divergence; a11y recurrence (labeled primitives); connect-state ownership |
| 5 | **Runtime + deploy hardening**: fail prod builds on missing factory/RPC/indexer env (one step); `vercel.ts`/Build-Output CSP artifacts with export-vs-header verification; RPC `fallback()` transport + batching; restore `error.tsx`/`global-error.tsx`/`loading.tsx`; CI for unit/build, seeded E2E where infra permits | both + §3.10 | boundary B; assurance drift |
| 6 | **Process guard**: behavior-keyed regression tests for every FIXED record; `test-accountability.md` in actual use; stale review records corrected only after behavior is proven | DIAG 6 + RES 1 | the rewrite-regression channel (5 instances to date) |
| 7 | **Decide H-4/H-5 explicitly**: accepted residual limitation (documented, with direct-contract recovery guidance) or reopen per-user indexes + bounded `gatherLiquidity` | RES 7 | the one boundary no frontend work can close |

Steps 1–2 parallelizable. Nothing touches Solidity (except optionally step 7), the Ponder trust scope, or any settled decision.

---

## 6. Consolidated finding register (cross-document mapping)

| Finding | FIX | DIAG | RES | Status |
|---|---|---|---|---|
| CSP artifact lifecycle / vercel.json mutation | Task 1 | cluster 8 / B | P1 (deploy outcome Needs-Verification) | open |
| Stream discovery truncation (limit=100, no cursor) | Task 2 | cluster 4→R | P1 completeness | open |
| Failed reads → 0n; overlay state omitted | Task 3 | cluster 1 / R (P0) | P1 completeness | open |
| Approval ignores action preconditions (×3 forms) | Task 5 | cluster 2 / W (P0) | P2 action ownership | open |
| Zero factory accepted in prod (WEB-007 regression) | Task 4 | cluster 8 / B | P2 runtime config | open |
| Unnamed borrow stream select | Task 6 | cluster 9 (local) | P3 (the one local defect) | open |
| Matured-claim MAX exceeds capacity (WEB-009 regression) | Task 7 | cluster 2 / W | P2 action ownership | open |
| Loading/RPC failure renders NO APPROVED MARKETS | Task 8 | cluster 1 / R | P1 completeness | open |
| Claim All false completion under failed discovery | Task 9 | cluster 5 / R | P1 completeness | open |
| Multicall subcall failures erase state (×4 hooks) | Task 10 | cluster 1 / R | P1 completeness | open |
| Negative amounts arm writes | Task 11 | cluster 2 / W | P2 action ownership | open |
| No mandatory final-call simulation | — | implicit (SE2 R1) | P2 executor | open — adopted (§3.2) |
| **Chain-ID overridable via spread order** | — | — (Lane D corrected) | P2 executor (latent) | **open — verified this session (§4.1)** |
| Single RPC transport, no fallback | — | Lane B local note | P2 runtime | open — folded into step 5 |
| **`error.tsx`/`global-error`/`loading.tsx` absent; NX records stale** | — | — | P3 assurance drift | **open — verified this session (§4.2); 5th rewrite-regression** |
| Coverage informational; no E2E CI; E2E bypasses Reown path | — | Lane A test-signal notes | P3 assurance drift | open — step 5/6 |
| H-4/H-5 enumeration cliff | — | settled (KTD11) | P1, decision demanded | **decision required — step 7** |
| Write-policy duplication (6 machines, 2 engines) | — | P0 structural | P2 action ownership + executor | open — steps 2–4 |

Severity axes per §3.6: **no security-exploit P0 exists** (RES rubric); the two **structural P0s** are boundaries R and W (DIAG rubric).

---

## 7. Decisions that belong to the maintainer

1. **H-4/H-5**: accept as documented residual limitation, or reopen the contract-side work (step 7). The three documents are unanimous that nothing in between exists.
2. **Vercel deployment verification**: someone with deploy access should run `vercel build` / inspect production headers once step 5's artifact fix lands — the only claim in any of the three documents that repository evidence cannot close.
3. **CI scope**: unit/build CI is uncontroversial; whether seeded-fork E2E runs in CI is an infrastructure cost decision.
4. **Sequencing of FIX vs structural moves**: recommendation is FIX first (0b) — every task kills a live defect and none conflicts with the target architecture — but steps 1–2 can begin in parallel if FIX review stalls.

## 8. Bottom line

Three documents, two of them independent deep passes, one verdict: **keep the frontend, redraw the headless boundaries — typed read completeness, action definitions, one simulated/pinned/awaited transaction runner, hardened build artifacts — in the seven-step sequence above.** The synthesis adds two code-verified corrections the individual documents lacked (the chain-override spread order; the vanished app-router recovery files, which is also the fifth documented instance of fixes not surviving rewrites — the precise failure mode the target architecture exists to end).
