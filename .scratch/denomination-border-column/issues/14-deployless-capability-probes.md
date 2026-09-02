# 14 — Deployless capability probes

**What to build:** Deployless lenses run only on providers that pass a real probe. The hash-pin probe stays. A second provider-and-lens-keyed probe calls real viem-dlc `policy(...)` with state override. Unsupported or ambiguous responses use the same-pin plain read. Wallet prompts reacquire a fresh connected-wallet client and revalidate independently of the public-read cache. viem-dlc never transforms or retries a write.

**Blocked by:** 12 (parallel with 13)

**Status:** resolved
**Labels:** ready-for-agent

## Session prompt (paste into a new chat)

```text
/ce-work docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md

Scope: CS5-U3 only (= this ticket). Stop when this ticket's acceptance criteria are met.
Ticket: .scratch/denomination-border-column/issues/14-deployless-capability-probes.md
Spec/harness: .scratch/denomination-border-column/spec.md — follow its per-session rules.
Do not edit the plan. Do not start other units. 13 runs in parallel — do not rewrite
the discovery owner. Do not combine eth-compress with deployless code (21/22).
Before any code, read Required reading below and the plan sections: KD18 probe
bullets, AS7, ### CS5-U3, and CS5 Definition of Done.
Cache capability, not returned chain authority. A provider may pass the hash-pin
probe and fail one lens policy probe; only that provider/lens pair is disabled.
ce-work overrides (they win over the skill's defaults): skip ce-code-review.
Branch: work on ticket/14 in this worktree. Do not create another branch or
ask about branches. Commits: plumbing bypass per
.cursor/rules/no-commit-attribution.mdc; never run git commit. Review: dispatch
one read-only reviewer subagent with the slug from spec § Model routing;
reviewers report, this chat decides. No PR, no ce-commit-push-pr, no branding:
push the ticket branch then push it main locally not remote then stop.
After local verification, mark ticket checkboxes done and set Status: resolved.
```

**Required reading:**

- `docs/solutions/patterns/ovrflo-web-standard.md`
- this ticket's acceptance criteria

## Acceptance criteria

- [x] A provider that claims compatibility but rejects the real probe is capability-gated off
- [x] Support for one deployless lens does not enable a different lens on the same provider
- [x] Probe timeout or malformed response falls back to plain reads
- [x] A mid-session capability change recovers reads without changing write semantics
- [x] A wallet account or chain change after a public read makes the new wallet client and fresh authoritative state govern the prompt
- [x] Hash-pin success plus one failed `policy(...)` state-override probe disables only that provider/lens pair
- [x] Pin-probe and write-flow tests prove the public-read / write boundary

## Plan unit

CS5-U3 in `docs/plans/2026-08-22-001-refactor-denomination-switch-border-column-plan.md`

## Session notes

### Reuse audit

Reused:

- Existing `probeHashPin` and pin-probe bytecode. The hash-pin probe stays a separate call.
- Real `policy()` from `@morpho-org/viem-dlc/actions`. The probe does not wrap transport with `deployless()`.
- Existing `callPin` / same-pin lockup views in `streams.ts` for the unsupported path.
- Existing `useWriteFlow` simulate-then-write path. Prompts now call `getWalletClient` instead of a cached hook snapshot.

New cache: a boolean `Map` keyed by `providerKey::lens`. Needed because capability is not chain state and must not enter TanStack Query.

### Unit boundary

This ticket owns: hash-pin plus per-provider/lens `policy(...)` probes, capability cache, same-pin plain fallback for stream lenses, and fresh wallet reacquire at each prompt.

Ticket 13 owns: the named `getLogs` discovery owner. This ticket does not edit `portfolio-log-candidates.ts`.

Tickets 21/22 own: eth-compress. This ticket does not send `stateDiff` or mix compress with `policy()`.

### Deviations

- Plan Files list omitted `useStreams.ts` and `useCompleteStreams.ts`. Production callers now pass `providerKey: rpcUrl` so the cache keys the configured primary URL.
- Plan Files list omitted `web/tests/lib/protocol/deployless-capability.test.ts`. Same-pin plain fallback lives there so pin-probe tests stay probe-only.
- Capsule listed `lending.ts` as a read. The file gained a comment that market views stay on `readContract`.

### Reviewer findings applied

Read-only review (`gpt-5.6-sol-medium`) reported three items. This chat applied two and left one residual:

1. `getWalletClient` mock now accepts config and parameters so `typecheck` passes.
2. `authorize` reacquires `getWalletClient` inside each `send`, not once outside the zero-first loop.
3. Residual: failover URLs still share the primary `rpcUrl` key. A deployless miss already retries the same pin on the plain path. Unit tests do not open live per-URL HTTP probes.

### Verification

- `bash web/scripts/check-banned-patterns.sh` — clean
- Focused vitest (`pin-probe`, `deployless-capability`, `streams`, `useWriteFlow`, `rpc`, `performance-contract`, `useStreams.enumerable`) — 85 passed
- `npm --prefix web run typecheck` — pass
