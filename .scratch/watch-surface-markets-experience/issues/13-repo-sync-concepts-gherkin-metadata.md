# 13 — Repo sync: concepts, Gherkin, metadata

**What to build:** The authority layers above code and the app's public metadata describe the shipped product. Gherkin journeys match watch, supply, borrow, repay-close, deposit-wrap-unwrap, and first-run. CONCEPTS matches v1-lite reads and per-position claim.

**Blocked by:** 07 — Shell + watch surface; 08 — Supply flow; 09 — Borrow flow; 10 — Assets: converter + stream creation; 11 — First run + risk surface

**Status:** resolved (docs + Gherkin parse). E2E on a seeded fork and production `next build` metadata collection remain U14.

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md

Scope: U13 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/watch-surface-markets-experience/issues/13-repo-sync-concepts-gherkin-metadata.md
Spec: .scratch/watch-surface-markets-experience/spec.md
Do not edit the plan. Do not invent protocol metrics in Open Graph. Gherkin stays flow-level.
Before any writes, read Required reading below and the plan sections: Goal Capsule, KTD2, KTD16, ### U13.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/watch-surface-markets-experience/spec.md`
- Plan KTD2, KTD16, ### U13, ethskills Rule 8
- `CONCEPTS.md` current Loan book / Claim-all / Ponder entries
- Current `web/tests/e2e` features and `web/reviews/testing.md`
- `docs/agents/testing.md` (E2E: `workers: 1`, lazy `deployments/local.json`)
- this ticket's acceptance criteria

- [x] CONCEPTS Loan book describes v1-lite reads; Claim-all is rewritten as per-position claim; stale Ponder claims are pruned; watch/ribbon entries match shipped behavior
- [x] Gherkin journeys exist for watch, supply, borrow, repay-close, deposit-wrap-unwrap, and first-run
- [x] Scenarios cover identity churn, approval states, outcomes, interruption, clamps, and degraded reads
- [x] Steps read deployed addresses lazily from local deployments at step time
- [x] Testing catalog records the new suite inventory; Gherkin remains flow-level with optional control-ID tags
- [x] Open Graph is one-bit wordmark composition with no invented metrics; per-route titles/descriptions and favicon set exist
- [ ] Metadata checklist verified in built output (absolute OG URL, titles per context, favicon); OG generation works under static export or falls back to a static image — `npx next build` compiled, then failed prerendering `/assets` with `NEXT_PUBLIC_CHAIN_ID is required in the production profile`. `opengraph-image.tsx` keeps `export const dynamic = "force-static"`.
- [ ] E2E suite parses and runs green on the seeded fork (`workers: 1`) — **parses:** `./node_modules/.bin/bddgen` exit 0, six `.features-gen/tests/e2e/*.feature.spec.js` files, 38 scenarios. **Not run:** `bootstrap:e2e` / `test:e2e` deferred to the orchestrator (shared fork).

## Plan unit

U13 in `docs/plans/2026-08-11-003-feat-watch-surface-markets-experience-plan.md`
