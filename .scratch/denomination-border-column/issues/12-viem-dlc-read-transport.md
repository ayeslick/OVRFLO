# 12 — Pin viem-dlc public-read transport

**What to build:** Public reads gain pinned `@morpho-org/viem-dlc` 0.0.16 behind the existing RPC seam. Each RPC URL has ordered `maxBlockRange`, `maxRequestsPerSecond`, `maxBurstRequests`, and `maxConcurrentRequests`. Custom `shouldThrow` keeps the stop set for `execution_reverted` and `unknown_block`. TanStack Query stays the only UI chain-state store. Wallet clients and writes never import, wrap, or invoke viem-dlc.

**Blocked by:** 07

**Status:** ready-for-agent
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS5-U1 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/12-viem-dlc-read-transport.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. Do not add logsDivider portfolio
work (13) or deployless probes (14). Do not transform wallet writes.
Before any code, read Required reading below and the plan sections: KD18, AS7,
AS10 write-boundary, ### CS5-U1, and CS5 stop conditions.
Pin npm 0.0.16; release tag provenance is full commit
0df02a9a79bce8ed0a98974034d34cf5c8de7e11. Keep 7ea8e70… as documentation context
only. Record the package as an explicit runtime-dependency exception.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/12 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch and stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-web-standard.md`
- https://ethskills.com/SKILL.md (frontend-playbook)
- this ticket's acceptance criteria

## Acceptance criteria

- [ ] Installed dependency resolves to npm `0.0.16` and commit `0df02a9a79bce8ed0a98974034d34cf5c8de7e11`
- [ ] Public reads fail over to the next configured provider after a retryable provider failure
- [ ] Per-provider rate limiting prevents one endpoint from consuming another endpoint's budget
- [ ] Each configured RPC URL applies the four policy values in order and does not share concurrency or burst budget with another URL
- [ ] `shouldThrow` preserves stop behavior for `execution_reverted` and `unknown_block`
- [ ] Wallet client creation and writes do not import, wrap, or invoke viem-dlc
- [ ] Query cache ownership remains in the existing query-client module; transport enrichment does not expose a parallel observable store
- [ ] RPC and performance-contract tests prove bounded failover and dependency isolation

## Plan unit

CS5-U1 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`
