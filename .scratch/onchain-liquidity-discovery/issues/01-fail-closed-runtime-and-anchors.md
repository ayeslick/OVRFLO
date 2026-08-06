# 01 — Fail-closed runtime and verified deployment anchors

**What to build:** Production and local builds reject a missing, malformed, or unverified factory/chain/deployment anchor and deprecated RPC hosts before a deployable bundle exists. Writes stay latched to Ethereum mainnet. Static-export recovery surfaces (route/global errors and explicit loading) work without starting browser discovery during prerender. CSP/header packaging stays on the verified prebuilt-artifact contract. Before any scanner lands, freeze the R39 p95 user-task ceilings, valid-churn attacker threshold, and constrained-client profile against named production-like fixtures.

**Blocked by:** None — can start immediately.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md

Scope: U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/onchain-liquidity-discovery/issues/01-fail-closed-runtime-and-anchors.md
Do not edit the plan. Do not start other units.
Before any code, read Required reading below and the plan sections: Goal Capsule, Verification Contract, Definition of Done, and ### U1.
Honor stop conditions. Prefer the unit's Execution note (characterization / failing tests first where specified).
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `BASE_SECURITY.md`
- `docs/solutions/patterns/ovrflo-critical-patterns.md`
- Goal Capsule stop conditions in the plan
- `docs/solutions/best-practices/fail-the-build-on-missing-security-config.md`
- this ticket's acceptance criteria


- [x] Production config fails closed on invalid factory, chain, deployment anchor, RPC URL, Reown config, or deprecated Alchemy host; local-only paths cannot activate in production
- [x] Deployment artifacts record factory (and derived lending) deployment block/hash and projection schema/ABI version for a fresh factory/lending generation
- [x] Ordinary reads keep operator-ordered fallbacks; one discovery synchronization never mixes heads or ranges across historical transports; execution reverts never trigger provider fallback
- [x] Caller-supplied fields cannot override chain ID 1 at type or runtime boundaries
- [x] Static-export-compatible error boundaries exist; browser-only discovery does not run during prerender
- [x] CSP packaging includes approved production origins, excludes localhost in production, and leaves committed inputs unchanged
- [x] Quota/credential/historical-capability failures are classified; forward-roll procedure is documented and redacts credentials from evidence
- [x] R50 ceilings, R49 churn/attacker stop decision, and R58 client profiles are committed before ticket 03 starts (AE28–AE29, AE37)

## Plan unit

U1 in `docs/plans/2026-07-29-005-feat-onchain-liquidity-discovery-plan.md`
