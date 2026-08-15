# Mainnet execution router for plans 001–007

Status: coordination document, 2026-08-15. This plan builds nothing itself.
Precedence rule for the implementing agent: **when a plan and this router disagree on ordering or
ownership, the router wins; on implementation detail, the plan wins.**

## Execution order

Sweeps first: `005` (post-split), `006` (post-reframe), and `007` (new) have not had an
ignorance-lens sweep. `001` needs a sweep after its 2026-08-15 amendments. `002`, `003`, `004` are
swept. No unswept plan starts its build.

Every pending sweep also applies the review questions adopted from the rewrite brief (see
"Campaign two" below): *Does Solidity already own this? Can the Factory or another canonical
contract tell us this? Is this protocol truth, analytics, or convenience? Is this cache merely a
copy of recoverable chain state? Does current Solidity still hold the assumption this code was
written for?*

**Wave 0 — independent cleanup, any time:** audit and delete the stale route-oriented borrow model
in `web/lib/actions/borrow.ts` and its callers (`borrow` blind-fills ticks and takes no lender
position ids, so route projection code is dead — verify, then delete), and remove
`NEXT_PUBLIC_HISTORICAL_RPC_URL` from **browser** config if the audit confirms no live consumer.
The historical RPC URL stays available to the fork's mainnet-fork tests; this is a browser-config
deletion only. Dead code encoding a retired contract model is what a future implementer resurrects
by accident.

**Wave 1 — contracts, parallel (independent files and repos):**

- `002` in the fork (`/Users/jay/OVRFLO-Streams-u4`, `feat/u4-fork-deploy`): delete
  `ERC721Enumerable`, land the owner-only index. `tokensOfOwnerIn`'s signature and clamp semantics
  do not change.
- `007` in OVRFLO core: `QuoteBorrow` error plus guarded revert in `borrow`.
- `005` in OVRFLO: the stream lens. It reads the lockup through its external interface, which `002`
  does not change, so it does not wait for `002`.

**Wave 2 — deploy plumbing:** `006` (factory-only bootstrap). The lens is deployless, so no lens
address enters the config pipeline; `006` is fully independent and can run any time after its sweep.

**Wave 3 — frontend, one change:** `001` + `003` together, lens-shaped. Each page is one pinned
lens call. Lens before pager is binding: building the pager against per-id hydration first means
building the frontend twice.

**Wave 4 — test:** `004`, including the reorg fault-injection scenario below.

## Binding cross-plan decisions

- **The lens is in the launch set.** Precedent: Aave `UiPoolDataProvider`, Compound `CompoundLens` —
  the standard periphery for indexer-free frontends (R12 forbids subgraphs).
- **The lens ships deployless** (decision 2026-08-15): bytecode embedded in the frontend bundle,
  executed via viem `call({ code })` — no deploy, no address, no explorer verification, no config
  plumbing. A drift gate keeps the embedded bytecode honest against `src/OVRFLOStreamLens.sol`.
  Deploying the same bytecode later for third parties remains open.
- **Page size is `STREAM_PAGE_SIZE` (25), owned by `004`.** `MAX_ENUMERATION_IDS` (500) is retired
  when the pager lands. Any plan text calling 500 a page size is stale.
- **Complete-set mechanism:** `streamsOfOwner` in one call. Past the RPC provider's `eth_call`
  ceiling, the fallback is merging `streamsOfOwnerIn` windows at one pinned block — complete by
  construction, bounded per call. `005` adds this fallback as a sweep item; `claim-all` and
  BorrowFlow eligibility use this mechanism, never the wall's paged query.
- **Re-pin policy (003):** when a pinned call fails with a block-not-found class error (pruned or
  reorged pin), re-pin to a fresh block and restart enumeration from page one. A stale tab must
  recover, not die.
- **Provider capability (003):** block-hash pinning is EIP-1898 and unevenly implemented. One-time
  runtime probe (pinned call against a known block, verify the result) or a documented list of
  supported providers. A provider that silently ignores the pin degrades to exactly the unpinned
  behavior `003` exists to prevent, and no local test catches it.
- **`003`'s "hydration batch carries the same pin" rule is satisfied by construction** once the
  lens lands (one call carries ids and data). `005` already documents this kill.
- **Reorg fault injection (004):** anvil can simulate reorgs (snapshot/revert, `anvil_reorg`). One
  scenario: reorg the pinned block, assert pinned pages fail closed under `requireCanonical`, the
  book goes `unavailable`, and a re-pin recovers.
- **`007`'s `QuoteBorrow` error fields and the `type(uint128).max` sentinel are public ABI** once
  deployed. Documented as interface, not implementation.
- **`002`'s outward-facing break:** `supportsInterface(0x780e9d63)` goes false; explorers and
  marketplaces see vanilla ERC721. Deliberate. One line in the fork README deviation table.
- **Size budget:** after `007`, `OVRFLOLending` has ~188 bytes under the canary. That is the repair
  budget for audit findings. Re-measure `forge build --sizes` after any core change.
- **Wave 3 builds below React (adopted from the rewrite brief).** The pager loop, the pin
  lifecycle, the complete-set window merge, and the deployless lens call are written as plain async
  functions taking a viem `PublicClient` and returning the book's outcome shape; the wagmi/TanStack
  hooks become thin wrappers. None of that logic is React-shaped, it becomes unit-testable without
  rendering, and the eventual framework migration becomes deletion instead of rewrite. This changes
  where wave 3's code lives, not what `001`/`003` specify.
- **Every successful protocol read is stamped with `fetchedAtMs`, `blockNumber`, and `blockHash`**
  in those protocol-client functions. This is `003`'s pin identity and the brief's neutral metadata
  as one field — do not also keep a framework-specific timestamp like `dataUpdatedAt` as truth.
- **Read classification (adopted from the rewrite brief):** reads are classed static (factory
  identity, stream binding, vault registry, token identity — read once), slow-changing (APR bounds,
  tick spacing, fees), or dynamic (tick depth, streams, withdrawable, books, allowances —
  block-driven or modest polling, refreshed after relevant receipts). Visual interpolation never
  generates RPC calls. Recorded in `docs/maps/state/keys/chain-reads.md` when wave 3 lands.

## Integration gate (after 002 merges in the fork)

The OVRFLO repo consumes the fork as a pinned artifact: `artifacts/OVRFLOStream.json` feeds the
deploy script (`script/OVRFLO.s.sol`), test fixtures, `script/seed-local.sh`, and the frontend ABI
via `web/wagmi.config.ts`. The guard (`web/scripts/check-ovrflo-stream-bytecode.mjs`) verifies the
artifact against the commit stamped in `artifacts/OVRFLOStream.provenance.md` — it cannot detect a
forgotten bump. So, in order, as an explicit gate:

1. Rebuild the fork at the new commit; replace `artifacts/OVRFLOStream.json`.
2. Update the `Fork commit:` stamp in `artifacts/OVRFLOStream.provenance.md`.
3. Re-run `check-ovrflo-stream-bytecode.mjs` — must pass against the new stamp.
4. Regenerate the frontend ABI (wagmi codegen) and redeploy local anvil.

Skipping this ships the old `ERC721Enumerable` lockup from a green pipeline.

## Mainnet gates

- `002` and `007` live in immutable core: final before the deploy transaction, no exceptions.
- The lens is deployless — it ships inside the frontend bundle with no deploy transaction, so it
  gates the UI launch, not the contract deploy. Claim-all correctness depends on it being in the
  launch build.
- `001`/`003`/`004`/`006` gate the UI launch, not the contract deploy.

## Contract for the implementing agent

- One plan per session, plus this router. Echo back repo path, branch, HEAD commit, and the
  baseline test state before touching anything; if the baseline does not reproduce, stop.
  Fork baseline: 605 passed / 11 known failures.
- Evidence, not claims: every "done" carries the command and its pasted output — test totals,
  `forge build --sizes`, the specific new tests green. "Should work" is not a status.
- The plan's Verification section is the definition of done, bullet by bullet, with evidence per
  bullet.
- Do-not-touch applies per wave: wave 1 does not touch `web/`; `002` does not change
  `tokensOfOwnerIn` semantics or `_afterTokenTransfer`.
- Swept plans end with their Sweep Contracts list, each item marked satisfied-with-evidence or
  not-applicable-with-reason.
- Tests move with behavior. Dependency or code reduction never pays for itself by deleting
  behavioral coverage; any test killed by an architecture change names its successor scenario in
  the same commit (precedent: `005`'s rule for `useStreams.enumerable.test.ts`).

## Campaign two — the frontend rewrite brief

A frontend rewrite brief ("Implementation Brief V2": protocol client below React, then remove
Next/Wagmi/TanStack/Reown, plus a framework-free permanent interface) was evaluated 2026-08-15.
Disposition:

- **Adopted into this campaign now:** the protocol-client shape for wave 3, the wave 0 cleanup,
  the read classification, the neutral read metadata, the sweep review questions, and the
  tests-move-with-behavior rule — all folded in above. The brief's config-shrink items were
  already in `006`.
- **Deferred until after mainnet:** removing Next, Wagmi, TanStack, and Reown; the Vite migration;
  migrating the existing hooks (`useOvrflos`, `useLadder`, `useAllMarkets`, the books) below React;
  and the permanent HTML/JS interface (its own product, its own plan — note the deployless lens is
  its natural read primitive). Framework removal mid-campaign mixes migration bugs into the pinning
  and paging work and voids swept plans that cite wagmi internals.
- **Superseded — do not implement from the brief:** its §3 stream-architecture semantics (it
  preserves the refusal threshold `001` retires, the four-call hydration fan-out `005` deletes,
  unpinned hydration `003` forbids, and the `ERC721Enumerable` dependency `002` removes) and its
  §12 previewBorrow investigation (`007` decided it, measured). An implementer holding the brief
  and this router follows the router.
- **Unresolved, deliberately:** `001` says "do not hand-roll a pager"; the brief's endgame
  hand-rolls a read scheduler. That contradiction is settled in campaign two, after the protocol
  client has made TanStack thin enough to price its removal honestly.
