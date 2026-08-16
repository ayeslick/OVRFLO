# 11 — Wave 1B: lens bytecode + drift gate + protocol client + pin capability probe

**What to build:** The web half of `005` below React: generated lens creation bytecode with a
drift gate, the protocol-client read layer (`loadStreamPage`, `loadCompleteStreams`, decode,
ReadOutcome normalization), and the **pin capability probe** (this ticket owns it — orchestrator
fix; the source prompt left it unowned).

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** 09 (and regenerate bytecode after 08's via-IR flip if 09 landed first)

**Status:** resolved — merged at 86ffcb7 (impl 8f5a7b1 + pin-selector fix 8501f1b). Review: approve-with-fixes, fix landed. Web 845/845 in t11. Residual: pin-capability.md is Anvil-only (ticket 14). | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.5-high`, subagent_type `generalPurpose`

## Session prompt

```text
Implement the web half of docs/plans/2026-08-15-005-feat-stream-lens-plan.md (post-sweep) plus
the pin capability probe from 008's binding decisions.
Ticket: .scratch/mainnet-execution-router/issues/11-wave1b-lens-bytecode-protocol-client.md
Spec: .scratch/mainnet-execution-router/spec.md.

CWD: all forge/npm/vitest/typegen/git run in /Users/jay/OVRFLO-t11 (web tests: that path/web,
local vitest binary). Echo pwd + git toplevel + HEAD in the same command as the test. Wrong-tree
totals are void.

Before first write: echo branch + HEAD; web test baseline totals; confirm via_ir=true is already
committed (ticket 08) — if not, STOP: bytecode must be generated under shipping settings.

Binding:
- Generation step emits CREATION bytecode (bytecode.object) to web/lib/generated/lens-bytecode.ts
  with a provenance stamp (source hash, solc, settings, via-IR); drift gate compares creation
  bytecode and runs in pretest so npx vitest cannot skip it.
- Protocol client is plain viem below React: loadStreamPage(client, owner, start, stop, pin),
  loadCompleteStreams(client, owner, pin) (balanceOf-routed: one streamsOfOwner below threshold,
  merged streamsOfOwnerIn windows above, all at one pin), decode StreamView[], normalize to
  ReadOutcome (ready / partial / unavailable with structured failures). Ownership invariant:
  an ok row with the wrong owner → unavailable, never rendered.
- Every successful read stamps {fetchedAtMs, blockNumber, blockHash}. All calls in one snapshot
  go through one provider; pin is {blockNumber, blockHash} with hash verification per 003.
- Pin capability probe: deployless call pinned to a KNOWN PAST block returning block.number,
  asserted to equal the pinned height — a block-independent probe passes on non-compliant
  providers and is wrong. Run per configured provider; result recorded where ticket 14 and the
  CREATE2 flip trigger can read it.
- No React hooks, no wall pager, no UI in this ticket (ticket 14). No lens address anywhere.

Intent record before first write. Do not edit plans. Do not push. Return the envelope with test
totals and per-provider probe results.
```

## Owns / does not own

**Owns:** bytecode generation + drift gate, protocol client for streams, ReadOutcome, pin probe.
**Does not own:** `useInfiniteQuery` wall pager and UI (14), previewBorrow client (12), lens
Solidity (09).

## Acceptance criteria

- [x] Drift gate demonstrably fails on stale bytecode; wired into pretest
- [x] Page + complete-set operations tested without React; balanceOf routing tested both sides of
      the threshold; partial/unavailable paths tested
- [x] Pin probe correct-by-construction (past-block assertion) and recorded per provider
- [x] Web suite green, totals pasted; deviations recorded; Final diff filled

## Deviations from the plan

- Lens ABI lives in `web/lib/generated/lens-bytecode.ts`, not `web/lib/generated.ts` (12 owns typegen).
- Pin probe recorded against local Anvil for all three provider roles. Ticket 14 must not treat that table as production-RPC evidence. CREATE2 flip not triggered.
- Production reads originally used `blockNumber` + post-hoc hash; fix `8501f1b` sends `{blockHash, requireCanonical: true}` and omits `blockNumber` on the same call.
- `streamsByIds` is in the ABI, not in the client (008 named only page + complete-set).

## Final diff

Implement: `8f5a7b1` `feat(web): Embed lens bytecode and protocol client`
Fix: `8501f1b` `fix(web): Pin lens reads by block hash`
Merge: `86ffcb7` onto `feat/008-mainnet-campaign`.

Review: approve-with-fixes; pin selector was the merge blocker; Anvil pin table residual for 14.

## Plan unit

`005` web half + 008 probe, wave 1B. Gates ticket 14 (with 05, 13).
