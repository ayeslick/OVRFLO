# 08 — `007` Solidity: via-IR flip + `previewBorrow` + safety net

**What to build:** One indivisible commit in OVRFLO core: `via_ir = true` in `foundry.toml`,
commit-flag threading through `_fillTick`/`_selectEpoch`, external `previewBorrow`, and the via-IR
safety net (storage-layout golden, raw-slot packing tests, dual-pipeline gate). Plan:
`docs/plans/2026-08-15-007-feat-borrow-quote-by-revert-plan.md` — the BODY (previewBorrow) is
authoritative; the filename is stale. Reference implementation: `.scratch/preview-probe/` diff.

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** — (sweep gate removed) | **Status:** resolved — merged at 738bed7 (impl 7e723ad). Review: approve. Residuals (non-blocking): StorageLayout.t.sol compares top-level only; DeploySize comment cites stale 22,806/24,149 vs measured 22,827/24,193. | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.6-xhigh`

## Session prompt

```text
Implement the Solidity half of docs/plans/2026-08-15-007-feat-borrow-quote-by-revert-plan.md
(body = direct previewBorrow under via-IR; ignore the stale filename; quote-by-revert is a
recorded fallback, NOT work — implementing it is a hard stop).
Ticket: .scratch/mainnet-execution-router/issues/08-007-previewborrow-viair.md
Spec: .scratch/mainnet-execution-router/spec.md. Repo /Users/jay/OVRFLO, feat/008-mainnet-campaign.

Before first write: echo branch + HEAD; baseline forge test totals under BOTH pipelines
(via_ir=false as committed, and a local via_ir=true run) — paste both.

Binding (do not reopen):
- One commit carries via_ir = true AND previewBorrow. Splitting them is a hard stop.
- previewBorrow(market, aprBps, targetBorrow, streamId) external returns (actualBorrow, feeAmount,
  obligation) — deliberately NON-VIEW. Do not build a view/write split.
- _fillTick(..., bool commit): the packed epochState.filled/loanCount writes execute only when
  commit. _selectEpoch(..., bool commit): cursor advance only when commit; selection logic and
  EpochBacklog at CURSOR_CAP identical either way. borrow calls _fillTick(..., true) and changes
  in no other way — same error, same seam, same event.
- BelowMinAcceptable keeps its zero-argument signature. No ABI_VERSION bump.
- Safety net in scope: commit forge inspect storage-layout goldens for every production contract
  with a CI assertion of byte-identity under both pipelines; vm.load raw-slot tests on the packed
  Epoch slot after real borrows; dual-pipeline gate (full suite + invariant campaigns green under
  legacy AND via-IR); no new assembly/transient storage/recursion.
- Reference numbers to reproduce (solc 0.8.36 pinned): via-IR + previewBorrow runtime 22,806
  bytes, 1,258 under the 24,064 canary; borrow gas ≈261,348. Re-measure and paste; small drift is
  reportable, exceeding the canary is a hard stop.
- Tests: the differential (preview == subsequent borrow's Borrowed event) across partial fill,
  price-capped fill, full sale, UNIT flooring, zero/non-zero fee, dust, dead-epoch skip,
  CURSOR_CAP, EpochBacklog, maturity boundary; state-unchanged-after-preview incl. vm.load;
  preview-then-borrow-same-block agreement. Existing BelowMinAcceptable tests must pass unchanged.

Intent record before first write. Do not touch web/ (ticket 12). Do not edit the plan. Do not
push. Return the envelope with pasted size/gas/suite totals under both pipelines.
```

## Owns / does not own

**Owns:** `foundry.toml` flip, `src/OVRFLOLending.sol` threading + function, all new Foundry
tests, storage goldens, dual-pipeline CI wiring.
**Does not own:** `web/` (ticket 12), lens (09), any other contract's logic.

## Do not

- Implement quote-by-revert or touch `BelowMinAcceptable`
- Split the commit; add view variants; widen `FillOutcome`
- Change `optimizer_runs` (measured dead) or the solc pin

## Acceptance criteria

- [x] Both-pipeline baselines pasted before first write; intent record posted
- [x] Size ≤ canary under via-IR, figure pasted; borrow gas pasted
- [x] Differential + state-unchanged + same-block tests green; existing suite green both pipelines
- [x] Storage goldens committed; vm.load packed-slot tests green
- [x] One commit; deviations recorded; Final diff filled

## Deviations from the plan

- Runtime 22,827 bytes (1,237 under 24,064 canary) vs plan/probe 22,806 / 1,258. Inner-scope refactor for legacy stack-too-deep added ~21 bytes. Under canary.
- Isolated warm `gasleft` borrow 194,335 via-IR / 201,656 same-source legacy (via-IR 7,321 cheaper). Probe ~261,348 was a different meter.
- `fs_permissions` gained `./out`; `[profile.invariant-legacy]` added. No CI wiring (user runs no CI).
- Review residual: `_assertMatchesGolden` compares top-level label/slot/offset only; nested Epoch packing is covered by the shell script + `vm.load`, not by `forge test`. Not blocking.

## Final diff

Implement: `7e723ad` `feat(lending): Add previewBorrow under via-IR`
(`src/OVRFLOLending.sol`, `foundry.toml` via_ir=true + legacy profile, `test/OVRFLOLending.t.sol` differentials, `test/StorageLayout.t.sol`, `test/DeploySize.t.sol` canary carve-out, goldens, `tools/scripts/check-storage-layout.sh`).

Merge: `738bed7` onto `feat/008-mainnet-campaign` (clean; no overlapping paths with 09/10/13).

Review (Grok, fresh): approve. via-IR 387/0/6, legacy 386/0/7 on 7e723ad. Merged-tree via-IR re-run (lens + previewBorrow together) recorded in ticket 09.

## Plan unit

`007` Solidity, wave 1A. Gates ticket 12; re-baselines 09/11 bytecode.
