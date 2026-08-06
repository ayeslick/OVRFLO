# On-chain liquidity discovery

**Authoritative plan:** `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`

**Objective:** Replace Ponder, global frontend enumeration, and `gatherLiquidity` with authoritative on-chain liquidity depth, standard-RPC event discovery in the browser, and fresh contract hydration before execution — while carrying forward still-valid frontend safety requirements from superseded plans 003/004.

**Tickets:** `.scratch/onchain-liquidity-discovery/issues/` (01–12). Work the frontier: any ticket whose blockers are done. Start with 01 and 02 in parallel.

---

## How to execute (ce-work + tickets)

Do **one ticket per chat**. Do not run all of plan 005 in one session.

### Every session

1. Open a **new** agent chat (clear context).
2. Claim the ticket: set `Status: claimed` near the top of that issue file.
3. Paste the **Session prompt** block from that ticket (already filled in).
4. Let `/ce-work` implement only that plan unit; it must read Required reading before code.
5. Search `docs/solutions/**/*.md` for the ticket's actual implementation surfaces, read every relevant solution file in full, reconcile the patch with that guidance, and report the paths read. Reading is scope-sensitive:
   - Frontend/tooling-only tickets do **not** read `BASE_SECURITY.md` or Solidity-only solution docs, even if an older ticket template lists broad security boilerplate. They may read ETHSKILLS only for frontend-relevant guidance such as wallet UX, transaction flows, RPC/read behavior, account/chain handling, approvals, and client-side safety. Do not follow ETHSKILLS branches about Solidity authoring or contract security.
   - Tickets explicitly scoped to change Solidity/onchain contracts from the start read `BASE_SECURITY.md`, ETHSKILLS, and the relevant Solidity/security solution docs before code.
   - Mixed tickets explicitly scoped that way from the start read only the guidance relevant to the files they are authorized to change. If a frontend/tooling ticket unexpectedly appears to require any Solidity or contract change, stop and return to the orchestrator; do not read into contract-authoring guidance, edit contracts, or expand scope independently.
6. Before hand-writing production code, run a **mandatory reuse audit**:
   - Search the existing codebase for helpers, hooks, components, reducers, adapters, registries, test fixtures, and utilities that already implement all or part of the required behavior.
   - Search relevant `docs/solutions/**/*.md` for the established implementation pattern and the files that solved similar problems.
   - Prefer extending, composing, or reusing an existing implementation over adding a parallel same-purpose path. Do not duplicate business rules, state machines, formatting, validation, refresh logic, or query-key construction.
   - In the final report, list the existing implementations considered and what was reused. If a new abstraction was necessary, state the concrete incompatibility that prevented reuse.
   - Apply this decision hierarchy: (1) correct, complete, fail-closed functionality; (2) reuse proven existing code; (3) the simplest clear implementation that fully works; (4) a new abstraction only when it removes real duplication without obscuring behavior. Functionality outranks simplicity, and simple explicit code outranks complicated generalization.
   - Keep the result DRY without premature abstraction. Do not create frameworks, indirection, or generic helpers merely to make code look reusable.
7. Before implementation, run a **mandatory unit-boundary and dependency reconciliation**:
   - Read the plan's implementation-unit dependency table, the current unit in full, and the immediately adjacent/dependent units that own later cutover, removal, or presentation work.
   - State what this ticket owns now, what intentionally remains on a legacy path, what later tickets cut over or delete, and the adapter/seam that allows those states to coexist.
   - Resolve apparent conflicts from the authoritative dependency graph and explicit coexistence/cutover language before code. A ticket must not declare itself blocked on a later unit that depends on it; identify the temporary bridge the dependency order requires.
   - Check for circular dependencies before implementation and again before final review. Escalate only when the plan provides no valid seam; do not discover or invent a cross-unit blocker after most of the ticket is built.
   - Keep later-unit work out of scope: a bridge may preserve a legacy source or interface, but it must not silently perform the later cutover/deletion.
8. Run dependency setup as a **mandatory preflight before the first frontend test, type-generation, or build command** in every isolated worktree; do not wait for the command to fail:
   - Copy only the already-installed **working-tree contents** from the primary checkout into the worktree's tracked `lib/forge-std` and `lib/openzeppelin-contracts` directories. Explicitly exclude each source submodule's `.git` file/directory and all Git metadata; copying that metadata makes worktree Git inspection fail with a `.git/modules/...` error. `npm --prefix web test` runs `pretest` → `wagmi generate` → the Foundry plugin, so even frontend-only tests require both Solidity submodules.
   - Never symlink either tracked submodule path: Git cannot inspect tracked submodule symlinks.
   - While those metadata-free dependency copies are hydrated, run every explicit Foundry gate **offline on its first attempt** so Foundry cannot reinterpret the missing submodule Git metadata as an installation request, initialize submodules, mutate `.git`, or reach the network. For Solidity-scoped tickets, preserve the required order as `forge build --offline` followed by `forge test --offline`; frontend/tooling tickets that need an explicit Foundry check use `forge test --offline`. Do not first run plain `forge build`/`forge test` and recover after it attempts submodule initialization.
   - If any Next/compiler build will run, also create a temporary local copy of `web/node_modules` before the build. Next rejects an external `web/node_modules` symlink. Do not discover this reactively after tests/builds start.
   - Immediately after hydration—and before tests—prove `git status --short` and `git submodule status` still work. Keep all dependency hydration out of the ticket diff. Before the final scope check and commit, remove the temporary `web/node_modules` copy and all copied submodule contents, restore the original empty submodule directories, and prove with `git status` plus directory-emptiness checks that only ticket files remain.
9. Choose the build path **before invoking a build command**:
   - `npm --prefix web run build` is the deployable immutable wrapper. It intentionally requires `NEXT_PUBLIC_RUNTIME_PROFILE=production`, a verified `OVRFLO_DEPLOYMENT_ARTIFACT`, and `DEPLOYMENT_RPC_URL`. An isolated ticket worktree normally has none of these.
   - Inspect those inputs first. When they are unavailable, do not run the deployable wrapper merely to rediscover its expected guard, and never invent or copy production identity/RPC values. Preserve the existing guard tests/full-suite result as fail-closed evidence and report the deployable wrapper as unavailable for the expected environment reason.
   - Proactively run local compiler/static-export coverage instead with `NEXT_PUBLIC_RUNTIME_PROFILE=local` and `OVRFLO_DEPLOYABLE_BUILD` unset: `npm run typegen`, `node scripts/build-csp.mjs`, `npm exec -- next build`, `node scripts/csp-hash-inline.mjs`, then `node scripts/verify-static-export.mjs`, all from `web/`. This is compiler/prerender/security-artifact verification, not deployable-production proof.
   - In the managed Codex sandbox, Turbopack's Next build may start a CSS worker that binds a temporary loopback port; the sandbox rejects that worker with `Operation not permitted` before compilation. For ticket 09 onward, request narrowly scoped elevated permission for the local-profile `npm exec -- next build` step **before its first run**, then execute that step outside the sandbox. Do not run it unprivileged merely to reproduce the known failure. The surrounding typegen/CSP/static-export scripts may remain sandboxed. If the elevated build is unavailable or denied, record an environment-gate result rather than a product regression.
   - Only tickets explicitly responsible for production release evidence may require the deployable wrapper itself; if its verified artifact/RPC inputs are unavailable, report that external-input gap instead of synthesizing them.
10. During the mandatory review phase, do **not** dispatch the external Claude/Anthropic cross-model pass for the remaining tickets in this feature run. Consecutive large-diff attempts returned only heartbeats until the hard timeout and produced no structured review artifact. Treat that route as unavailable, do not retry it, and do not poll it. Run the complete bounded local multi-lens reviewer roster, evidence-gate its findings, apply valid fixes, and synthesize the review from those completed receipts.
11. When acceptance checkboxes are done: set `Status: resolved`, commit on the feature branch, stop.
12. Next ticket → new chat again.

### Parallel start

`01` and `02` have no blockers — two chats (or two worktrees) is fine. Everything else waits on its Blocked by line.

### Do not

- Point `ce-work` at the whole plan with no unit scope
- Use bare `/implement` without the Required reading list
- Edit the plan file while implementing
- Flip live discovery before ticket 09, or delete Ponder/`gatherLiquidity` before 10–11
- Symlink tracked submodule paths in an isolated worktree
- Run an explicit Foundry gate without `--offline` while using metadata-free dependency copies
- Dispatch or retry the external Claude/Anthropic review route after its repeated no-artifact hard timeouts
- Add a parallel same-purpose helper, hook, state machine, validator, refresh path, or query-key builder without first proving the existing implementation cannot be reused
