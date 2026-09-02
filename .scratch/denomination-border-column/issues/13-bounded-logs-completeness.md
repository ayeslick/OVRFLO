# 13 — Bounded logs and progressive portfolio completeness

**What to build:** Portfolio log reads are bounded and owned by one discovery module. Stream and lending modules hydrate candidate IDs and never call `getLogs`. Missing pages and failed hydration return `partialOutcome` with `complete: false`. Factory and bootstrap discovery stay fail-closed. Logs never authorize a write. Scanner output is display-only.

**Blocked by:** 12

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS5-U2 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/13-bounded-logs-completeness.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add deployless probes (14).
Do not let logs enter action gating. CS4-U2 may consume this contract if 15 lands
later; this ticket must remain correct without CS4 routing.
Before any writes, write the scratch intent capsule per docs/maps/SCHEMAS.md §4.
Read Required reading below and the plan sections: KD18 logs bullets, AS7, AS10,
### CS5-U2, and Verification Contract successor *Read authority* / *Read policy
and ownership*.
Remove StreamBook.complete or derive it from the outer result so outer-ready and
inner-incomplete cannot coexist. Update the banned-pattern fixture to permit only
the named discovery owner.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/13 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/maps/SCHEMAS.md` §2 and §4
- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [x] Scratch intent capsule exists before the first state-touching edit
- [x] An oversized log range is divided and merged without duplicate or missing candidate identifiers
- [x] One provider failure mid-range yields explicitly partial portfolio output until fallback completes
- [x] A log that names an old owner loses to an authoritative current-owner read
- [x] Factory discovery fails closed on any required registration leg
- [x] A missing page or one failed candidate hydration yields `partialOutcome` and `complete: false`
- [x] Banned-pattern fixture rejects `getLogs` outside the named discovery owner
- [x] No result can be outer-ready while an inner stream book reports incomplete
- [x] Watch E2E never treats logs as ownership authority

## Plan unit

CS5-U2 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session notes

### Reuse audit

Reused:

- `logsDivider` from `@morpho-org/viem-dlc/transports` (already a CS5-U1 dependency). It already composes sieve, enricher, and rateLimiter, so the public-read wrap no longer stacks a second rateLimiter.
- `partialOutcome` / `readyOutcome` / `readFailure` from `web/lib/read-outcome.ts`.
- `protocolReady` / `protocolPartial` in stream hydration.
- Existing `ownerOf`, `loanState`, and `positionState` reads. Hydration does not add a new authority.
- Existing fail-closed `discoverProtocolBootstrap`. This ticket did not add a partial registry.
- Existing Enumerable watch wall (`useStreams` / `loadStreamPage`). Log candidates are not routed into Watch.

New module: `web/lib/discovery/portfolio-log-candidates.ts`. Needed because AS7 names one `getLogs` owner, and no existing discovery file called `getLogs` after U8 retired the log scan.

New helper: `presentBook` in `web/lib/stream-book.ts`. Needed because `readyOutcome({ complete: false })` was constructible in the hooks. Deriving completeness in one function closes that pair.

### Unit boundary

This ticket owns: bounded `eth_getLogs` on the public-read wrap, the named discovery owner, candidate hydration, progressive `partialOutcome`, StreamBook completeness derived from the outer result, and the banned-pattern fixture.

Ticket 14 owns: deployless `policy(...)` probes in `pin-probe.ts`. This ticket does not call `policy` or change pin-probe.

Ticket 15 owns: Your OVRFLO routing from a complete bounded scan. This ticket exports the candidate contract and `complete: false` on partial scans. Watch still lists from Enumerable. CS4-U2 must stay correct if it never imports this module.

### Deviations

- Capsule listed `web/lib/stream-book.ts` as a read. Implementation writes `presentBook` there so hooks cannot emit outer-ready with an incomplete book.
- Capsule did not list hook files as writers beyond `useStreams`. `useCompleteStreams`, `useLenderBook`, and `useBorrowerBook` also call `presentBook` so lending books follow the same outer/inner rule.
- `protocol-bootstrap.ts` is unchanged. Fail-closed coverage is tests only (`lendingCount` revert).

### Reviewer findings applied

Read-only review (`gpt-5.6-sol-medium`) reported three completeness defects. This chat applied all three:

1. Loan and position candidates now carry `{ lending, id }`. Same numeric id on two markets stays two candidates.
2. Truncated `loansOf` follow (cap 1,024) returns `partialOutcome` with fetched pairs kept.
3. A zero-row page with failures stays `partial`. Loading is only for unread pages with no failures.

### Verification

- `bash web/scripts/check-banned-patterns.sh` — clean
- Focused vitest (rpc, read-outcome, banned-patterns, discovery, streams, lending, stream-book, useStreams, useOvrflos, useBooks, loans-of pagination, watch-app) — 128 passed
- `npm --prefix web run typecheck` — pass
- Watch E2E scenario added: visible STREAM rows must match lockup `ownerOf`. Playwright not run in this session (no local e2e bootstrap).
