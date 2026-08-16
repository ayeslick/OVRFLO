# 06 — Reconciliation re-sweep of `004`

**What to do:** `004` (E2E) predates the lens, the pager rework, and the pagination invariant.
This ticket reconciles it: update stale scenario text in place (this ticket may edit the plan),
then sweep. 008 names what must land: page-size derivation through production RPC class, reorg
fault-injection (`anvil_reorg` / snapshot-revert), cross-source disappearance (owner book ready +
borrower book failed → degraded Borrowed lens, never a vanished stream), source-coordinate
pagination regression cases (resume at first unconsumed index; empty window still advances).

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** — (must resolve before ticket 15 starts) | **Status:** cancelled — sweep track retired 2026-08-15 by user directive (no convergence gate); collected lens findings folded into implementation dispatch prompts

**Pinned models:** reconciliation + lens pass `gemini-3.7-flash-high` (2, parallel), critic
`cursor-grok-4.6-xhigh`. Orchestrator folds.

## Sweep contract

- First reconcile: every scenario that references 4-per-id hydration, `MAX_ENUMERATION_IDS` as
  refusal, unpinned reads, or a single `count` field is rewritten against the amended 001/003/005.
- Then lenses: (a) **adversarial** — which composed failures have no scenario (mid-enumeration
  reorg, provider failure mid-snapshot, pledged-stream disappearance); (b) **verifier** — E2E
  fixture page size 2, `STREAM_PAGE_SIZE` re-derivation from measured lens cost.
- **Settled:** E2E is the only seam that can see a mid-enumeration reorg; fail-closed on
  incomplete; degraded-not-vanished for cross-source.

## Acceptance criteria

- [ ] Stale scenarios reconciled in place with dated notes
- [ ] Lens reports + critic verdict returned; `### Sweep Contracts` appended
- [ ] Reorg, cross-source, and pagination-regression scenarios present and specific

## Plan unit

`004` reconciliation re-sweep, gates ticket 15.
