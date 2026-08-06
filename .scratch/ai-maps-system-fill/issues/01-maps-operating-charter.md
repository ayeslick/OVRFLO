# 01 — Maps operating charter

**What to build:** An agent opening a fresh checkout can read the Maps charter and know authority order, six Markets regions, dual-agent review, Owner escalation triggers, control/scratch schemas, when an ADR summary is required, and where AI scratch YAML lives — without inventing process. Day-one stubs only: region bodies and state keys stay empty or header-only.

**Blocked by:** None — can start immediately.

**Status:** resolved

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md

Scope: U1 and U6 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/ai-maps-system-fill/issues/01-maps-operating-charter.md
Spec: .scratch/ai-maps-system-fill/spec.md
Do not edit the plan. Do not start other units. Do not fill region brief bodies or state keys.
Before any writes, read Required reading below and the plan sections: Goal Capsule, Product Contract Key Decisions, Verification Contract, Definition of Done, ### U1, ### U6.
Honor stop conditions. After verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `.scratch/ai-maps-system-fill/spec.md`
- Plan Goal Capsule stop conditions and D1–D10
- `PRODUCT.md` (product truth boundary)
- `docs/agents/domain.md` (expects `docs/adr/`)
- `docs/agents/issue-tracker.md` (`.scratch/` conventions)
- this ticket's acceptance criteria

- [x] `docs/maps/README.md` states AI-first ops, authority order, six regions, fill order, and out-of-scope (Clearing Ledger build, stack migration, Solidity x-ray)
- [x] `docs/maps/SCHEMAS.md` norms the seven control fields and scratch YAML keys from the plan Appendix
- [x] `docs/maps/REVIEW.md` documents review routing, pass/fail, one re-review, and Owner escalation list **without** a standing stack-change trigger — **amended by Owner during implementation:** review runs through the `ce-code-review` / `ce-doc-review` skills rather than a hand-rolled contract, and the reviewer roster is *not* capped at two lenses (`ce-code-review` self-sizes a risk-driven roster). The state/trust and product/brief concerns survive as OVRFLO-specific review criteria layered on that roster.
- [x] `docs/maps/ui/README.md` and `docs/maps/state/README.md` exist as indexes/stubs
- [x] `docs/adr/README.md` states when a summary ADR is required vs PR-only
- [x] `.scratch/decisions/README.md` plus a scratch template matching SCHEMAS — **amended by Owner during implementation:** `.scratch/` stays untracked in its entirety, so the README and template are local too. The normative scratch schema therefore lives in the tracked `docs/maps/SCHEMAS.md` §4, which a fresh clone does have.
- [x] An agent can restate gates and escalation from charter alone (AE1)

## Plan unit

U1 + U6 in `docs/plans/2026-08-03-001-feat-ai-maps-system-fill-plan.md`
