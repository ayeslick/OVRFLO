# Mainnet execution router — campaign spec

**Authoritative plan:** `docs/plans/2026-08-15-008-meta-mainnet-execution-router-plan.md` (ordering
and ownership) plus the child plan named on each ticket (implementation detail).

**Objective:** Land plans 001–007 in router order so OVRFLO can deploy to mainnet: owner-only
stream enumeration in the fork (002), direct `previewBorrow` under via-IR in core (007), the
deployless stream lens (005), factory-only bootstrap (006), the pinned Watch pager (001+003), and
adversarial E2E (004). Immutable core (002, 007) is final before the deploy transaction; everything
else gates the UI launch.

**Tickets:** `.scratch/mainnet-execution-router/issues/` (01–15). Local markdown tracker, same
shape as `.scratch/ovrflo-streams/`. Do not open GitHub issues.

**Orchestrator:** the Fable 5 chat that wrote this spec. Workers get one ticket each, dispatched
as Cursor subagents with a pinned model. Campaign branch in OVRFLO: `feat/008-mainnet-campaign`.

**Repos:**

| Work | Path | Branch constraint |
|---|---|---|
| Fork lockup (002) | `/Users/jay/OVRFLO-Streams-u4` | `feat/u4-fork-deploy`; HEAD contains `57e5cf2b` (verified at boot: HEAD `0f501abf`, contains it) |
| OVRFLO core + web (rest) | `/Users/jay/OVRFLO` | `feat/008-mainnet-campaign` |

This OVRFLO repo never compiles the fork. Artifacts are consumed by address.

---

## How to execute

One ticket per worker, fresh context. The orchestrator claims, dispatches, reviews, closes.

1. Orchestrator sets `Status: claimed` on the issue file and dispatches the ticket's Session
   prompt as a subagent `Task` with the pinned model.
2. Worker echoes repo path, branch, HEAD, and a baseline test result **before the first write**.
   Fork expected baseline: 605 passed / 11 known failures (expected-unverified — reproduce first;
   if it does not reproduce, stop and report, do not invent a new baseline). OVRFLO: `forge build`
   then `forge test` (366 passed / 6 skipped at campaign start).
   **CWD (2026-08-16):** every `forge` / `npm` / `vitest` / `typegen` / `git commit` runs inside
   the ticket worktree named in the dispatch. Same command: `cd $WORKTREE` (web: `$WORKTREE/web`),
   echo `pwd`, `git rev-parse --show-toplevel`, branch, short HEAD, then the test. Use the local
   binary (`./node_modules/.bin/vitest` or `npm test`). Never `npx vitest` from another tree.
   Never `/Users/jay/OVRFLO` when the ticket lives in `/Users/jay/OVRFLO-tN`. A green suite from
   the wrong tree is not evidence. Reviewers obey the same rule.
   **Worktree load (2026-08-16):** a new worktree has no `web/node_modules`, no `web/.env.local`,
   and no Foundry `out/`. That is bootstrap, not a failed baseline. Before the baseline command:
   symlink or `npm ci` modules; copy `web/.env.local` from `/Users/jay/OVRFLO/web/` if missing
   (do not print secrets); `forge build` so `out/` exists. See
   `.scratch/mainnet-execution-router/memory/2026-08-16-worktree-baseline-bootstrap.md`.
   A red suite **after** load is a real baseline failure — stop and report; do not invent totals.
3. Worker posts the intent record (assumptions, predicted blast radius, the verification that
   fails if the ticket is wrong, owns vs not-owns) **before the first code write**.
4. Worker implements only this ticket. Unpinned decision → stop and return a blocker.
5. Worker returns the envelope: status, changed files, verification commands with pasted totals,
   blockers, deviations, `git diff --stat`.
6. Orchestrator audits the envelope against pasted output, dispatches a fresh-context reviewer on
   a different model family (report only), decides bug / deviation / residual, dispatches fixes,
   fills Final diff, sets `Status: resolved`, commits.
7. Commits: plain `git commit` is verified clean in this environment (no attribution trailers as
   of `ae4c93b`). After each commit run `git log -1 --format='%B'` and confirm no
   `Co-authored-by` / `Made-with` trailer; if one ever appears, switch to write-tree /
   commit-tree / update-ref plumbing and record it in memory.

### Do not (campaign)

- Point `ce-work` at `008` or a whole child plan with no ticket scope
- Edit a child plan during implementation (sweep tickets 02–06 are the only exception)
- Rewrite `007` (landed at `ae4c93b`) or re-pin `solc` (landed at `ee7778e`)
- Implement quote-by-revert, enrich `BelowMinAcceptable`, or bump `ABI_VERSION`
- Split `via_ir = true` and `previewBorrow` into two commits
- Compile the fork inside OVRFLO, submodule it, or `vm.etch` fork bytecode
- Rename Solidity identifiers (`SablierV2LockupLinear`, `sablierLL`, `SablierMismatch`,
  `SABLIER_LOCKUP_ADDRESS`, `MockSablier`)
- Add `setMinter` or `ovrfloStream()` on the vault
- Build the pager before the lens protocol client; hand-roll a wall pager (TanStack owns it)
- Restore `MAX_ENUMERATION_IDS` as a refusal threshold
- Split one snapshot across providers; ship `markets[0].lending` as Watch scope
- Add a lens address to config (deployless; CREATE2 flip only on probe failure, recipe in `005`)
- Implement campaign two (Next/Wagmi/TanStack/Reown removal) or the rewrite brief §3/§12
- Run `forge script --broadcast` against local Anvil
- Push or open a PR unless the user asks
- Start coding before the intent record is in the chat; reconstruct one afterward
- Run forge, vitest, or npm from the campaign checkout or a sibling worktree when the ticket
  was dispatched to `/Users/jay/OVRFLO-tN` (wrong-tree totals are void)

---

## Ticket map

**Sweep track retired 2026-08-15 by user directive** (too much planning, no convergence gate).
Tickets 02–06 are cancelled; the lens findings already collected were folded directly into the
dispatch prompts of tickets 08, 09, and 13 as binding pins. No ticket waits on a sweep. Plan
files are not edited further.

| # | Title | Plan | Repo | Blocked by | Pinned model |
|---|---|---|---|---|---|
| 01 | Wave 0: dead borrow-route + browser historical-RPC delete | 008 wave 0 | OVRFLO | — | `cursor-grok-4.5-high` |
| 02 | Sweep `007` (rewritten body) | sweep | OVRFLO | — | lenses `gemini-3.7-flash-high`, critic `cursor-grok-4.6-xhigh` |
| 03 | Sweep `005` | sweep | OVRFLO | — | same as 02 |
| 04 | Sweep `006` | sweep | OVRFLO | — | same as 02 |
| 05 | Sweep `001` (post-amendment) | sweep | OVRFLO | — | same as 02 |
| 06 | Reconciliation re-sweep `004` | sweep | OVRFLO | — | same as 02 |
| 07 | `002` owner-only index in the fork | 002 | OVRFLO-Streams-u4 | verify 002 Sweep Contracts | `cursor-grok-4.6-xhigh` (no persona — user directive) |
| 08 | `007` Solidity: via-IR + `previewBorrow` + safety net | 007 | OVRFLO | 02 | `cursor-grok-4.6-xhigh` (no persona — user directive) |
| 09 | `005` lens Solidity + Foundry tests | 005 | OVRFLO | 03 | `cursor-grok-4.6-xhigh` (no persona — user directive) |
| 10 | Fork artifact integration gate | 008 gate | OVRFLO | 07 | `cursor-grok-4.5-high` |
| 11 | Wave 1B: lens bytecode + drift gate + protocol client + **pin capability probe** | 005 web half | OVRFLO | 09 (rebuild bytecode after 08 if 09 landed first) | `cursor-grok-4.5-high` |
| 12 | Wave 1B: `previewBorrow` protocol client + ABI regen (no bump) | 007 web half | OVRFLO | 08 | `cursor-grok-4.5-high` |
| 13 | `006` factory-only bootstrap | 006 | OVRFLO | 04 | `cursor-grok-4.5-high` |
| 14 | Wave 3: Watch pager + pin (`001`+`003` as one change) | 001+003 | OVRFLO | 05, 11, **13** | `cursor-grok-4.6-xhigh` |
| 15 | `004` E2E: omission + reorg + cross-source | 004 | OVRFLO | 06, 14, 10 | `cursor-grok-4.5-high` |

```
01 ── (any time)
02 ── 08 ── 12
03 ── 09 ── 11 ──┐
04 ── 13 ────────┤
05 ──────────────┼── 14 ── 15
07 ── 10 ────────┼─────────15
06 ──────────────┴─────────15
```

**Campaign end (user 2026-08-16):** ticket 14 plus its review is the last work. Do **not**
dispatch ticket 15. Adversarial E2E is ongoing testing, not a launch checkbox.
building the wall on the pre-006 env bootstrap is rework by construction — orchestrator fix to the
source prompt). Ticket 11 owns the **pin capability probe** (deployless `code`+calldata pinned to
a known past block returning `block.number`; block-independent probes pass on non-compliant
providers) — its per-provider result feeds 14's pin fallback and is the CREATE2 flip trigger.
If 09 lands before 08, ticket 11 regenerates lens bytecode under via-IR.

## Model policy (2026-08-16)

Cost order: **Grok and GLM first.** GPT and Anthropic cost more; they are not the default.
One empty GLM turn is not a ban. Pick the cheap slug that fits the ticket (Grok for long
agentic/Solidity, GLM when it fits or Grok is busy). A died/empty review is retried on a cheap
family (same slug once, then the other cheap family if that is convenient) — not skipped to GPT
because GLM failed once.

Available Task slugs: `cursor-grok-4.6-xhigh`, `glm-5.2-high`, `gpt-5.6-sol-medium`,
`gpt-5.6-luna-medium`, `claude-opus-5-thinking-high`, `gemini-3.7-flash-high`,
`composer-2.5-fast`. There is no `cursor-grok-4.5-high` slug; use `cursor-grok-4.6-xhigh`.

| Job | Model |
|---|---|
| Orchestrator | this chat |
| Implementation (web, tests, config, codegen) | `cursor-grok-4.6-xhigh` or `glm-5.2-high` |
| Hard Solidity (002/007/005, storage, size, commit-flag) | `cursor-grok-4.6-xhigh` |
| Standard review | cheap family, different *instance* from the implementer; GLM is eligible |
| Money-path Solidity review | cheap family first. GPT (`gpt-5.6-sol-medium`) only as a second opinion on 002/007, or if cheap reviews died |
| Empty/died review | retry cheap family. Do not treat one GLM miss as a ban |
| Scouts | `composer-2.5-fast` / `gemini-3.7-flash-high` |
| Escalation after two failures on one ticket | `claude-opus-5-thinking-high`, once, then stop |

**No user-authored personas (user directive 2026-08-15, clarified):** the personas the user
made themselves are stale and must not be used — `ovfl-solidity-developer`,
`ovfl-comprehensive-tester`, `ovfl-docs-generator`, `project-storyteller`,
`solidity-security-auditor`. Built-in and other shared agent types (generalPurpose, explore,
best-of-n-runner, browser-use, compound/matts-style shared agents, etc.) remain allowed.
Ticket prompts carry the discipline requirements regardless of agent type.

Never omit `model` on a Task call (inherit spawns another Fable). Do not dispatch
`claude-fable-5-thinking-medium` as a worker. Implementer and reviewer must differ (different
instance; cheap cross-family when it is convenient, not mandatory).

Pinned implementation does not need GPT/Opus by default. Require `typecheck` on web tickets
rather than paying a dearer model to notice Vitest-without-tsc. Escalate to GPT/Opus when a
cheap review died twice or a money-path claim is still unreviewed.

---

## Authority

1. Router `008` — ordering and ownership.
2. The child plan named on the ticket — implementation detail.
3. `docs/solutions/patterns/ovrflo-critical-patterns.md` (ALWAYS REQUIRED).
4. Live `src/` and the test that would fail if the claim were wrong.
5. This spec, then the ticket.
6. `CONCEPTS.md`, `AGENTS.md`, historical plans — leads only.

**Stale signals to ignore:** `007`'s filename still says quote-by-revert — the body (previewBorrow
under via-IR) is authoritative; quote-by-revert is a recorded fallback at `5213e59`, not work.
Child-plan status lines saying "Not build-ready" are stale where a `### Sweep Contracts` section
exists — verify the section, trust the router. `.scratch/preview-probe/` is the reference
implementation for 007's commit-flag threading; read it, do not copy stale files from it.

**Already landed (do not redo):** 007 plan rewrite; solc 0.8.36 pin; quote-revert-transport
investigation retired; `NEXT_PUBLIC_ABI_VERSION` stays 1.

**Landed in code (campaign branch `feat/008-mainnet-campaign`):** `via_ir = true` +
`previewBorrow` (ticket 08, merge `738bed7`); `OVRFLOStreamLens` (ticket 09, merge `2b21200`);
factory-only bootstrap (ticket 13, merge `2f5a975`); fork artifacts at `0f77e638` (ticket 10,
merge `56133b0`). Ticket 07 resolved in the fork at `0f77e638`.
- Size budget under via-IR (re-measured at 08 review on `7e723ad`): `OVRFLOLending` runtime
  22,827 bytes, 1,237 under the 24,064 canary. Legacy runtime 24,193 (383 under EIP-170).

---

## Problem statement

Seven plans must land in dependency order before mainnet. Immutable core (002 owner-only
enumeration, 007 previewBorrow) gets one chance. The frontend (001/003 pinned pager, 005 lens,
006 factory bootstrap) must never present a truncated or mixed-block financial list as truth.
Prior campaigns lost context when one chat ran a whole plan; tickets exist so a fresh-context
worker cannot invent a rejected design, follow a stale filename, or build the pager before the
lens.

## Solution

The router (008) orders the work into waves; each wave's tickets carry the settled decisions
copied inline so no worker has to interpret plan history. The orchestrator holds campaign
judgment: decomposition, routing, review verdicts, hard stops. Workers hold exactly one ticket.

## Implementation decisions (binding, copy onto tickets that touch them)

- Lens is launch-set, deployless: bytecode in the bundle, `call({ code })`. Drift gate compares
  **creation** bytecode (`bytecode.object`). CREATE2 flip only on probe failure.
- `STREAM_PAGE_SIZE` (25) owned by `004`; `MAX_ENUMERATION_IDS` (500) retires with the pager.
- Complete-set routes on known `balanceOf`: below threshold one `streamsOfOwner`; above, merge
  `streamsOfOwnerIn` windows at one pin. Threshold is frontend policy. `claim-all` and BorrowFlow
  eligibility use this path, never the wall pager.
- Work rate bounded: sequential cancellable page loads; obsolete loads cancel on re-pin; complete
  sets rebuild only on consumer demand.
- Re-pin on block-not-found: fresh pin, restart page one.
- Snapshots are provider-affine: `{blockNumber, blockHash}` from provider P, every snapshot call
  through P, discard and restart on the next provider if P fails.
- Watch is factory-wide; keys are `(chainId, lendingAddress, id)`.
- Every successful protocol read stamps `fetchedAtMs`, `blockNumber`, `blockHash`.
- Size budget under via-IR: after 007, `OVRFLOLending` = 22,827 bytes, 1,237 under the 24,064
  canary (re-measured at ticket 08 review). Re-measure after any core change under shipping
  settings. Legacy figures are the dual-pipeline EIP-170 floor only (24,193).
- `previewBorrow` public ABI: three wei-denominated returns; `BelowMinAcceptable` unchanged.
- 007 is one indivisible commit (`via_ir = true` + `previewBorrow`); non-view on purpose; MAX is
  `previewBorrow` with `type(uint128).max` target; via-IR safety net in scope (storage-layout
  golden, `vm.load` packed-slot tests, dual-pipeline gate, deploy-day `bugs_by_version` check).

## Testing decisions

**No CI is used at this time (user directive 2026-08-16).** Do not add GitHub Actions
workflows, CI jobs, or "wire it so CI runs X" as ticket work. Local gates that already
run with `forge test` / `npm --prefix web run test` (pretest bytecode check, storage-layout
script if invoked locally) are the campaign gates. Deep/CI-shaped work is out of scope.

**Invariant tests run the SMOKE profile only (user directive 2026-08-15).** Use the default
`[invariant]` settings (25 runs / depth 10 class); do NOT run `FOUNDRY_PROFILE=invariant`
(500 runs / depth 40) or equivalent deep campaigns as ticket gates. Deep invariant campaigns are
an ongoing background process outside this campaign, not a merge gate.

**Ticket 15 / plan 004 E2E is not a campaign close-out (user 2026-08-16).** Testing is
incorporated continuously, not checked off here. Do not dispatch 15 after 14.

- Fork: inherited suite is a local-only gate; new tests standalone (R7b discipline from the
  ovrflo-streams campaign carries over).
- OVRFLO: dual-pipeline (legacy + via-IR) suite green before deploy, from ticket 08 onward.
- E2E fixture page size 2; production `STREAM_PAGE_SIZE` re-derived from measured lens cost.
- Frontend tests assert protocol-client behavior without React where possible; wall pager tests
  mock the protocol client, not the transport.

## Out of scope

Campaign two (framework removal), rewrite-brief §3/§12, quote-by-revert, 007 plan rewrite,
solc pin, hand-rolled pager, indexers, `ABI_VERSION` bump, LockupDynamic deployment.

## Memory

`.scratch/mainnet-execution-router/memory/` — one lesson per file, first line is the summary.
Read at the start of each dispatch day. Current entries: see directory.
