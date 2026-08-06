# 11 — Delete Ponder/Envio and indexer-era tooling

**What to build:** Remove the custom-backend indexer stack and every hidden local, CI, environment, CSP, fixture, or docs dependency. Local bootstrap starts Anvil and the frontend without Ponder/Envio processes or readiness waits. Seeded E2E discovers liquidity, transferred streams, third-party fills, permissionless close, and Claim All candidates from standard RPC. Keep a verified Sablier ABI fixture relocated out of the dead Envio tree.

**Blocked by:** 09 — Shadow parity and live frontend cutover; 10 — Remove `gatherLiquidity`.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U12 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/11-delete-ponder-envio-tooling.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U12.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- Goal Capsule stop conditions in the plan
- `docs/agents/testing.md (bootstrap / owned-Anvil rules)`
- this ticket's acceptance criteria


- [x] Ponder client, hooks, config, env, CSP origins, scripts, tests, and process management are gone (`tools/ponder/`, `lib/ponder.ts`, `useIndexerSync`, `@ponder/client`, `NEXT_PUBLIC_PONDER_URL`, CSP indexer origin, `ponder:*` scripts, bootstrap process control)
- [x] Unused Envio runtime/config removed; verified Sablier ABI fixture relocated to `web/tests/fixtures/SablierV2LockupLinear.verified-abi.json` and `abis.test.ts` updated
- [x] Bootstrap/E2E run without indexer readiness: clean bootstrap starts Anvil + seed (+ dev server) only — verified no `tools/ponder` process and port 42069 closed — and the full E2E suite passes 32/32 in 40s (owned-Anvil / single-worker rules preserved in docs)
- [x] Parity instrumentation removed only after a final streams/demand comparison vs Ponder against the post-`gatherLiquidity` ABI (recorded 2026-07-31: held streams agree for both wallets; borrow demand agrees with one real event — non-vacuous)
- [x] Repo search finds no live Ponder/Envio package, process-control, env, or CSP dependency (AE18) — remaining mentions are negative-assertion guards, past-tense docs, and the accountability ledger

**Resolution note (2026-07-31):** 714 unit tests, typecheck, security lint green; lockfile pruned (7 packages removed); docs (README bootstrap section, testing.md, e2e README, CONCEPTS.md, AGENTS.md) updated to the no-backend architecture.

## Plan unit

U12 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
