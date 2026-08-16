# 09 — `005` stream lens: Solidity + Foundry tests

**What to build:** `OVRFLOStreamLens` — a stateless read-only periphery contract, never deployed
(deployless `eth_call` with embedded creation bytecode), with three reads: `streamsOfOwner`,
`streamsOfOwnerIn`, `streamsByIds`, each returning `StreamView[]`. Plan:
`docs/plans/2026-08-15-005-feat-stream-lens-plan.md`, post-sweep (ticket 03).

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** — (sweep gate removed) | **Status:** resolved — merged at 2b21200 (impl 03222d25 + hardening 89045e27). Review: approved. Suite 380/0/6 pre-08 (via_ir=false). via-IR re-run at 08 merge `738bed7`: **430 passed, 0 failed, 0 skipped**. | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.6-xhigh`

## Session prompt

```text
Implement the Solidity half of docs/plans/2026-08-15-005-feat-stream-lens-plan.md (contract +
Foundry tests only; bytecode generation into web/ is ticket 11).
Ticket: .scratch/mainnet-execution-router/issues/09-005-lens-solidity.md
Spec: .scratch/mainnet-execution-router/spec.md. Repo /Users/jay/OVRFLO, feat/008-mainnet-campaign.

Before first write: echo branch + HEAD; forge test baseline totals.

Binding (do not reopen):
- Deployless is settled. No deploy script, no address, no factory registry entry, no config.
- Reads the lockup through its EXTERNAL interface only (so it does not wait on 002's internals).
- StreamView per the plan: full getStream surface plus owner, withdrawableAmount, status-derived
  isDepleted (status == DEPLETED) and wasCanceled (status == CANCELED), and ok:bool.
- Per-id try/catch: a reverting id yields ok:false, never a whole-call revert. Owner-scoped forms
  cannot produce ok:false via burn (burn leaves enumeration same-block) — the ok:false surface is
  streamsByIds with burned/unknown ids, and tests live there.
- Ownership invariant: an ok row whose owner differs from the requested owner is an invariant
  failure the client maps to unavailable — the lens itself returns what it read; document this in
  NatSpec so ticket 11 enforces it client-side.
- Gates: EIP-3860 initcode limit (deployless payload is creation bytecode), memory expansion
  measured at 500 ids, per-window gas measured and pasted (feeds STREAM_PAGE_SIZE derivation).
- Tests standalone; include a 500-id window, empty owner, clamped windows, burned id via
  streamsByIds, and a gas table.

Intent record before first write. Do not touch web/. Do not edit the plan. Do not push. Return
the envelope with pasted gas/size figures and suite totals.
```

## Owns / does not own

**Owns:** `src/periphery/OVRFLOStreamLens.sol` (or the plan's named path), its Foundry tests, gas
measurements.
**Does not own:** bytecode generation/drift gate/protocol client (11), pager (14), fork changes.

## Do not

- Add a deploy script or an address anywhere
- Compute any borrow quote (previewBorrow lives on OVRFLOLending, ticket 08)
- Import fork sources; use the external interface

## Acceptance criteria

- [ ] Baseline pasted; intent record posted
- [ ] Three reads implemented; StreamView matches the plan's struct exactly
- [ ] ok:false covered via streamsByIds; owner-form burn impossibility documented
- [ ] EIP-3860 + memory + gas figures pasted; suite green
- [ ] Deviations recorded; Final diff filled

## Deviations from the plan

## Final diff

Implement: `03222d25` `feat(lens): Add deployless OVRFLOStreamLens`
(`src/OVRFLOStreamLens.sol`, `test/OVRFLOStreamLens.t.sol`, interface + MockSablier).

Review follow-up (tests only, no `src/` change):

- `test_StreamsByIds_CreateFromInitcode_MatchesNew` — CREATE from
  `vm.getCode("OVRFLOStreamLens")`, then `streamsByIds`.
- `test_InitcodeReturn_DoesNotDecodeAsStreamViewArray` — initcode return
  (runtime) does not `abi.decode` as `StreamView[]`.
- `test_Hydrate_DepletedStream_IsDepletedTrueWasCanceledFalse` — warp +
  withdraw max; assert `isDepleted` / `wasCanceled` against lockup getters.
- Mixed `streamsByIds` now includes `0`, `type(uint256).max`, and a
  duplicate valid id.
- Stale MockSablier `statusOf` comment removed.

## Plan unit

`005` Solidity, wave 1A. Gates ticket 11.
