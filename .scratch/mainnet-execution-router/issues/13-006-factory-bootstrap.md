# 13 — `006` factory-only bootstrap

**What to build:** The factory becomes the only static protocol anchor in the frontend: bootstrap
config carries `{chainId, factory}` required-not-nullable; stream lockup, vaults, lendings,
markets are discovered from the factory asynchronously with discriminated-union states; boot
fails loudly on wrong chain id or empty `eth_getCode(factory)`. Plan:
`docs/plans/2026-08-15-006-fix-factory-canonical-stream-anchor-plan.md`, post-sweep (ticket 04).

**Repo:** `/Users/jay/OVRFLO`, branch `feat/008-mainnet-campaign`.

**Blocked by:** — (sweep gate removed) | **Status:** claimed | **Labels:** ready-for-agent

**Pinned model:** `cursor-grok-4.5-high`, subagent_type `generalPurpose`

## Session prompt

```text
Implement docs/plans/2026-08-15-006-fix-factory-canonical-stream-anchor-plan.md (post-sweep).
Ticket: .scratch/mainnet-execution-router/issues/13-006-factory-bootstrap.md
Spec: .scratch/mainnet-execution-router/spec.md.

Before first write: echo branch + HEAD; web test baseline totals.

Binding:
- Factory is the single trust root. No lens address exists anywhere (deployless). Derived
  addresses (stream lockup, vaults, lendings, markets) never appear in env/config.
- Bootstrap hardening (008 queue, promoted): verify chain id and eth_getCode(factory) non-empty
  at boot; a mismatch is a loud boot failure, never a silent empty UI.
- Atomic bootstrap discovery: registry count, entries, and bindings in ONE multicall (coherent at
  one block). Registries are append-only/slow-dynamic — refreshed on the read interval, never
  permanently cached after first load.
- Discovery states are discriminated unions (loading / ready / unavailable with cause); no
  nullable address types leak into consumers.
- Signing-destination verification (008 queue): before any write, the to-address is re-derived
  from the factory registry in the same session, not read from component state.

Intent record before first write. Do not edit plans. Do not push. Return the envelope with test
totals and the list of env vars removed.
```

## Owns / does not own

**Owns:** bootstrap config shape, discovery layer, boot checks, signing-destination check,
env-var removals, their tests.
**Does not own:** wall pager (14), stream reads (11), any Solidity.

## Acceptance criteria

- [x] `{chainId, factory}` is the entire static config; derived addresses removed from env
- [x] Wrong-chain and codeless-factory boots fail loudly (tested)
- [x] One-multicall bootstrap; refresh policy tested; unions typed, no nullables
- [x] Signing destination re-derived at write time (tested)
- [x] Web suite green, totals pasted; deviations recorded; Final diff filled

## Deviations from the plan

1. Pass 2 is two multicalls at the same block B (`ovrflos`, then `ovrfloInfo` +
   `ovrfloToLending`) because bindings need vault addresses first. Fail-closed; never
   partial ready.
2. Watch book scope still uses `markets[0]?.lending` as a temporary single-market
   fallback — **ticket 14 owns factory-wide Watch aggregation** and rebuilds that seam
   (comment left in `WatchApp.tsx`). Not fixed in this ticket.
3. Review fix round (on `6fde2b5`): Watch surfaces bootstrap unavailable (never
   CHECKING…); `useOvrflos` publishes vaults/stream only in ready; signing verification
   is required for market-scoped writes (approve spender checked); vault-only writes
   allowed when `registered.lending` is null; restored local+deployable-build config
   gate; query key lowercases factory; added lending/stream mismatch and binding-revert
   tests.

## Final diff

- Initial: `6fde2b57c54b9c1007253e3c5bdc7ace6b6e6eb6` —
  `feat(web): Discover protocol from factory only`
- Review fixes: `ceada0fd26f51e4b53359015d3a5a9fd0ad24bd6` —
  `fix(web): Surface bootstrap failures at Watch`

Web suite after review fixes: **107** files / **825** tests passed; `tsc --noEmit` clean.

## Plan unit

`006`, wave 2. Gates ticket 14 (orchestrator-added edge: Watch is factory-wide and must build on
this bootstrap, not the pre-006 env shape).
