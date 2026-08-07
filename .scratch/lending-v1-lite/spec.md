# OVRFLOLending v1-lite

**Authoritative plan:** `docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`

**Objective:** Replace OVRFLOLending with the loan-only fixed-rate tick order book: blind fills against a cumulative counter, lazy interval-overlap attribution, the TickTree library, epochs, and full on-chain discovery. Contracts and tests only; vault untouched except the factory tick-spacing forwarder.

**Tickets:** `.scratch/lending-v1-lite/issues/` (01–08). Work the frontier: any ticket whose blockers are done. Strictly linear except 06 and 07, which run in parallel after 05.

---

## How to execute (ce-work + tickets)

Do **one ticket per chat**. Do not run the whole plan in one session.

### Every session

1. Open a **new** agent chat (clear context).
2. Claim the ticket: set `Status: claimed` near the top of that issue file.
3. Paste the **Session prompt** block from that ticket (already filled in).
4. Let `/ce-work` implement only that plan unit; it must read Required reading before code.
5. **Onboarding (first ticket only for a given coder):** also read `README.md` (Architecture + OVRFLOLending sections), `CONCEPTS.md` (especially "OVRFLOLending v1-lite"), and skim `docs/research/2026-08-03-lending-market-design-space.md` for design rationale. Every ticket is Solidity-scoped: `BASE_SECURITY.md`, `docs/solutions/patterns/solidity-implementation-discipline.md`, ETHSKILLS, and `docs/solutions/patterns/ovrflo-critical-patterns.md` are mandatory before code, plus the ticket's specific solution docs.
6. **The plan is the single decision authority.** Every constant, type, unit, error name, event field, and behavioral choice is pinned in the plan's "Pinned Conventions and Schemas" section — search there before assuming anything is open. If something genuinely is not pinned and requires a decision, STOP and surface it; do not decide locally. Do not re-litigate settled ground: `docs/audit/rejected-findings-record.md` and the plan's session-settled KTD annotations are binding.
7. Before hand-writing production code, run a **mandatory reuse audit**:
   - Search the existing codebase for helpers, mocks, harnesses, and patterns that already implement part of the behavior (`test/mocks/LendingMocks.sol`, `LendingInternalHarness`, `StreamPricing`, OZ utilities, existing invariant-handler/ghost patterns).
   - `StreamPricing` is carried over unchanged — never re-derive its math. OZ `Math`/`SafeCast` only; no new dependencies (plan KTD2 records the build-vs-borrow survey — do not reopen it).
   - In the final report, list what was reused; if a new abstraction was necessary, state the concrete incompatibility that prevented reuse.
8. Before implementation, run a **mandatory unit-boundary and dependency reconciliation**: read the plan's Sequencing section, the current unit in full, and adjacent units; state what this ticket owns, what a later ticket owns, and the seam between them. Do not perform a later unit's work early (e.g., 02 leaves epoch machinery inert at epoch 0; 05 activates it).
9. **Test integrity is a hard requirement.** Tests are written to be uncheatable: differential tests assert against independent reference models (U1's O(n) model), unit tests assert exact concrete values from the plan's Acceptance Examples, and invariants assert state identities — never assertions that mirror the implementation's own arithmetic back at itself. Where a unit carries an Execution note (e.g., U1 test-first), honor it. A test that would pass against a subtly wrong implementation is a defect; say so in review rather than shipping it.
10. In an **isolated worktree**, run dependency setup as a mandatory preflight before the first build command: copy the already-installed working-tree contents of `lib/forge-std` and `lib/openzeppelin-contracts` from the primary checkout (excluding all `.git` metadata; never symlink tracked submodule paths), then run every Foundry gate **offline on its first attempt**: `forge build --offline` then `forge test --offline`. Prove `git status --short` and `git submodule status` still work after hydration; before commit, remove copied contents, restore empty submodule dirs, and prove only ticket files remain in the diff.
11. Verification gates per the plan's Verification Contract, in order: `forge build` → `forge test` → (06 only) `FOUNDRY_PROFILE=invariant forge test --match-contract OVRFLOLendingInvariant -vvv` → (07 only) `forge snapshot --match-contract OVRFLOLending` → `forge fmt --check`. Ticket 08's seed-script smoke needs an Anvil mainnet fork (`MAINNET_RPC_URL`); if unavailable, record an environment-gate result, never fake it. Never `forge script --broadcast` against local Anvil (critical pattern #2).
12. During the mandatory review phase, run the complete bounded local multi-lens reviewer roster; do not dispatch or retry the external cross-model review route (previously produced only heartbeat timeouts with no artifact).
13. When acceptance checkboxes are done: set `Status: resolved`, commit on the feature branch, stop.
14. Next ticket → new chat again.

### Do not

- Point `ce-work` at the whole plan with no unit scope
- Edit the plan file, its Product Contract, or its session-settled KTD annotations while implementing
- Touch `src/StreamPricing.sol` or the OVRFLO vault (the only factory change is the U2 forwarder)
- Add any dependency (no solady, no PRB-Math; OZ only — KTD2)
- Use `safeTransferFrom` for Sablier NFTs anywhere (risk #6: plain `transferFrom` only)
- Use require-strings in new code (custom errors per the plan's error catalog, exact names)
- Renumber U-IDs, reorder acceptance criteria meanings, or invent constants/fields not in Pinned Conventions
- Leave sale-path code, `loanPoolContributions`, or other deleted machinery stranded ("no dead code" is in the Definition of Done)
- Declare a ticket done with a failing or skipped gate; report failures verbatim instead
