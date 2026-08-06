# 12 — Durable CI and release evidence

**What to build:** Make verification and release evidence match the final no-backend architecture: CI gates for Foundry, ABI checks, security lint, typecheck, scanner/reducer/unit tests, and static export (no Ponder gates). Document seeded-fork E2E and human release gates (anchors, historical RPC, CSP, Reown, R39 ledger, Claim All two-provider, rollback vs key forward-roll, post-cutover incident path). Update current architecture/vocabulary docs; leave historical solution writeups as history.

**Blocked by:** 01 — Fail-closed runtime and verified deployment anchors; 02 — Authoritative liquidity depth and checkpoint events; 03 — Standard-RPC scanner and pure projections; 04 — Explicit read outcomes and shadow discovery adapters; 05 — Pure action definitions (Borrow on projected routes); 06 — Single-action transaction executor; 07 — Claim All through the executor; 08 — Shared flow shell and incremental modal split; 09 — Shadow parity and live frontend cutover; 10 — Remove `gatherLiquidity`; 11 — Delete Ponder/Envio and indexer-era tooling.

**Status:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U10 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/12-durable-ci-and-release-evidence.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U10.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Goal Capsule stop conditions in the plan
- `docs/agents/testing.md`
- `docs/frontend-architecture-review-2026-07-29.md`
- this ticket's acceptance criteria


- [ ] CI fails on contract, stale ABI, scanner/reducer, frontend unit, security lint, typecheck, or static build failure
- [ ] CI/production builds use valid nonsecret fixture config and leave tracked inputs unchanged
- [ ] Release rejects unverified anchors, incapable historical RPC, missing finalized advancement, exceeded R39 budget, or unapproved browser origin
- [ ] Rollback re-promotes the previous immutable artifact and re-runs route/runtime/RPC/CSP/wallet checks; credential forward-roll is separately exercised
- [ ] Post-cutover history-breach path fails affected projections closed, preserves aggregate depth and direct recovery, and does not misrepresent artifact rollback as a history fix (AE38)
- [ ] Architecture/vocabulary docs name aggregate depth, event discovery, and direct hydration; review records do not claim Ponder/H-4/H-5 fixed without the new evidence
- [ ] Manual E2E instructions distinguish environment collision from product regression

## Plan unit

U10 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
