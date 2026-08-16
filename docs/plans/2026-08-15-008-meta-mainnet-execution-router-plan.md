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

**Wave 1A — Solidity and Foundry tests only (no `web/`), parallel (independent files and repos):**

- `002` in the fork (`/Users/jay/OVRFLO-Streams-u4`, `feat/u4-fork-deploy`): delete
  `ERC721Enumerable`, land the owner-only index **inline in `SablierV2Lockup.sol`, declared before
  `nextStreamId`** (the plan body's Key Decision; its older sweep bullet proposing a separate base
  contract is marked superseded in place). `tokensOfOwnerIn`'s signature and clamp semantics do not
  change. Carry OpenZeppelin's MIT notice as a full third-party notice (version and source), not
  only the source comment.
- `007` in OVRFLO core: enrich the existing `BelowMinAcceptable` error with
  `(actualBorrow, feeAmount, obligation)`; the quote is `eth_call borrow(..., type(uint128).max)`.
  **No dedicated quote branch and no `QuoteBorrow` error** — `007` rejects that by measurement
  (the sentinel-check branch is the byte cost the design exists to avoid).
- `005` in OVRFLO: the stream lens (Solidity and Foundry tests). It reads the lockup through its
  external interface, which `002` does not change, so it does not wait for `002`.

**Wave 1B — generated interfaces and protocol adapters (the `web/` halves of 1A, after 1A lands):**

- Lens creation-bytecode generation (`bytecode.object` → `web/lib/generated/lens-bytecode.ts`) and
  its drift gate (`005`).
- Quote decoder, `classifyBorrowError` payload, regenerated ABI, and the `ABI_VERSION` 1 → 2 bump
  (`007`).
- Protocol-client functions (`loadStreamPage`, `loadCompleteStreams`, quote read) — the layer wave 3
  consumes. No product UI changes in this wave.

**Wave 2 — deploy plumbing:** `006` (factory-only bootstrap). The lens is deployless, so no lens
address enters the config pipeline; `006` is fully independent and can run any time after its sweep.

**Wave 3 — frontend, one change:** `001` + `003` together, lens-shaped. Each page is one pinned
lens call. Lens before pager is binding: building the pager against per-id hydration first means
building the frontend twice.

**Wave 4 — test:** `004`, including the reorg fault-injection scenario below. `004` gets a
reconciliation pass at its re-sweep first — it still derives the page size from the four-reads
model `005` deletes, and its reorg-coverage language predates this router's fault-injection
requirement. The E2E fixture injects a tiny page size (2) to create page boundaries cheaply; the
production `STREAM_PAGE_SIZE` is re-derived separately from measured lens cost (`005`'s sweep).

## Binding cross-plan decisions

- **The lens is in the launch set.** Precedent: Aave `UiPoolDataProvider`, Compound `CompoundLens` —
  the standard periphery for indexer-free frontends (R12 forbids subgraphs).
- **The lens ships deployless** (decision 2026-08-15): bytecode embedded in the frontend bundle,
  executed via viem `call({ code })` — no deploy, no address, no explorer verification, no config
  plumbing. A drift gate keeps the embedded bytecode honest against `src/OVRFLOStreamLens.sol`.
  Deploying the same bytecode later for third parties remains open.
- **Page size is `STREAM_PAGE_SIZE` (25), owned by `004`.** `MAX_ENUMERATION_IDS` (500) is retired
  when the pager lands. Any plan text calling 500 a page size is stale.
- **Complete-set mechanism:** routed by the already-known `balanceOf` (refined 2026-08-15). Below a
  frontend threshold constant, one `streamsOfOwner` call; above it, go directly to merging
  `streamsOfOwnerIn` windows at one pinned block — do not issue an unbounded call that is known to
  exceed the provider ceiling (~2,000–2,500 streams per `005`'s sizing) just to watch it fail.
  Either path is complete by construction and bounded per call. The threshold is mutable frontend
  policy, never a Solidity constant. `claim-all` and BorrowFlow eligibility use this mechanism,
  never the wall's paged query.
- **Work rate is bounded, ownership is not** (added 2026-08-15). Removing the 500-id refusal must
  not turn whale wallets into recurring RPC storms: page loads are sequential and cancellable,
  obsolete loads are cancelled on re-pin, refresh cadence backs off for huge books, and complete
  sets are rebuilt only when a consumer needs one — not on every poll. Writes still simulate at
  latest.
- **Re-pin policy (003):** when a pinned call fails with a block-not-found class error (pruned or
  reorged pin), re-pin to a fresh block and restart enumeration from page one. A stale tab must
  recover, not die.
- **Provider capability (003):** block-hash pinning is EIP-1898 and unevenly implemented. The
  runtime probe must exercise the **production primitive, not a proxy** (upgraded 2026-08-15): a
  deployless call (`code` + calldata) pinned to a known past block, returning a block-dependent
  value — a tiny probe returning `block.number` is the clean shape, since a provider that silently
  ignored the pin returns the latest height instead of the pinned one. A pinned probe whose return
  is block-independent can pass on a non-compliant provider. Per-provider result feeds the pin
  fallback choice in `003`.
- **Snapshots are provider-affine (added 2026-08-15, supersedes request-level fallback inside
  snapshots):** capture `{blockNumber, blockHash}` from provider P and run every call of that
  logical snapshot through P. If P fails, discard the snapshot and restart from page one on the
  next provider. The ordered fallback transport stays for ordinary single reads; it must never
  split one snapshot across providers with different heads or different EIP-1898 behavior.
- **`003`'s "hydration batch carries the same pin" rule is satisfied by construction** once the
  lens lands (one call carries ids and data). `005` already documents this kill.
- **Reorg fault injection (004):** anvil can simulate reorgs (snapshot/revert, `anvil_reorg`). One
  scenario: reorg the pinned block, assert pinned pages fail closed under `requireCanonical`, the
  book goes `unavailable`, and a re-pin recovers.
- **`007`'s enriched `BelowMinAcceptable` fields and the `type(uint128).max` sentinel are public
  ABI** once deployed. Documented as interface, not implementation.
- **`002`'s outward-facing break:** `supportsInterface(0x780e9d63)` goes false; explorers and
  marketplaces see vanilla ERC721. Deliberate. One line in the fork README deviation table.
- **Size budget:** after `007`, `OVRFLOLending` has ~188 bytes under the canary. That is the repair
  budget for audit findings. Re-measure `forge build --sizes` after any core change.
- **Wave 3 builds below React (adopted from the rewrite brief) — with a precise boundary.** The
  protocol client owns the *page operation* and the *complete-set operation*: `loadStreamPage(client,
  owner, start, stop, pin)`, `loadCompleteStreams(client, owner, pin)` (which may loop windows), lens
  result decoding, and outcome normalization — plain async functions over a viem `PublicClient`,
  unit-testable without rendering. TanStack keeps the wall's interactive infinite-query state
  machine: `pageParams`, `hasNextPage`, `fetchNextPage`, cache, dedup, and in-flight ownership —
  per `001`'s "do not hand-roll a pager" rule, which stands. The complete-set path is a bounded
  produce-the-set operation, not the UI pager, so its plain async window loop does not violate that
  rule. This changes where wave 3's code lives, not what `001`/`003` specify.
- **Every successful protocol read is stamped with `fetchedAtMs`, `blockNumber`, and `blockHash`**
  in those protocol-client functions. This is `003`'s pin identity and the brief's neutral metadata
  as one field — do not also keep a framework-specific timestamp like `dataUpdatedAt` as truth.
- **Read classification (corrected 2026-08-15 — the registries are not static):**
  **STATIC** (read once): factory address, chain identity, the canonical stream binding once bound,
  the immutable identity of a discovered child.
  **APPEND-ONLY / SLOW DYNAMIC** (periodic or event-driven refresh — a long-lived tab must not
  permanently miss a later registration): the vault registry (`ovrfloCount` grows on
  `registerOvrflo`), the lending registry (`registerLending`), approved markets (`addMarket`), and
  the vault→lending binding until established (`ovrfloToLending` can start zero and populate later).
  **DYNAMIC** (block-driven or modest polling, refreshed after relevant receipts): tick depth,
  streams, withdrawable amounts, loans, positions, allowances.
  Visual interpolation never generates RPC calls. Recorded in
  `docs/maps/state/keys/chain-reads.md` when wave 3 lands.
- **Watch is factory-wide (decided 2026-08-15).** Multiple OVRFLOs/lendings will exist, so Watch
  aggregates its Borrowed and Supplied books across **all distinct lending contracts discovered
  from the factory**, not one. "First lending in the array" must not ship as implicit protocol
  semantics — once `006` removes the configured lending address, `markets[0].lending` is a silent
  wrong-scope bug. The book state model and query keys carry the lending address per row so
  aggregation is explicit.

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
- Do-not-touch applies per wave: wave 1A does not touch `web/`; wave 1B touches only generated
  output and protocol-client code, never product UI; `002` does not change `tokensOfOwnerIn`
  semantics or `_afterTokenTransfer`.
- Swept plans end with their Sweep Contracts list, each item marked satisfied-with-evidence or
  not-applicable-with-reason.
- Tests move with behavior. Dependency or code reduction never pays for itself by deleting
  behavioral coverage; any test killed by an architecture change names its successor scenario in
  the same commit (precedent: `005`'s rule for `useStreams.enumerable.test.ts`).

## Investigation queue — prove irrelevant or promote, never assume

Unproven concerns from the 2026-08-15 external review, evaluated against the tree. Items the
evaluation collapsed are recorded so they are not re-raised: version coexistence and migration
(nothing is deployed anywhere; fresh deployments only, per the mainnet gates), packed-index hazards
(packing was rejected — `002` uses two separate mappings), hostile lens targets (the only target is
the factory-bound lockup), external Enumerable consumers (none can exist pre-deploy), a Solidity
range cap on `tokensOfOwnerIn` (deliberately rejected in `002`), and fee-on-transfer underlyings
(**impossible by contract**: `_pullExact` balance-diff checks revert `TransferMismatch` in both
`OVRFLO.sol` and `OVRFLOLending.sol`).

The open items, each owned by a plan:

- **Owner-index invariant fuzzing (`002`).** The index is derived truth with no rediscovery path,
  so it earns more than the 8 unit cases: invariant runs over random sequences of mint, transfer,
  self-transfer, safe-transfer, and burn proving (a) `balanceOf(owner)` equals the indexed count,
  (b) every indexed id has `ownerOf(id) == owner`, (c) every owned id appears exactly once,
  (d) forward and reverse indices agree. Include the index-zero trap (a missing reverse entry reads
  as legitimate index 0), index-zero removals, only-item and last-item moves, repeated
  swap-and-pop, and receiver-callback transfers. Add a standing deviation guard:
  `supportsInterface(0x780e9d63)` must stay false, so an upstream merge cannot silently
  reintroduce Enumerable.
- **Emergency rediscovery procedure (`002`, documentation).** `nextStreamId` bounds the id
  universe, so ownership is reconstructable off-chain by an `ownerOf` sweep over `[1, nextStreamId)`
  if the index is ever suspect in production. Record it as a diagnostic runbook before the index
  ships immutable.
- **Pin `solc_version` (`002`/`007`/`005` builds).** Verified: `foundry.toml` pins
  `optimizer_runs = 200` but **no compiler version**. The `007` canary margin, the lens drift
  gate, and the fork size table are all stable only under a pinned compiler. Pin it, then run the
  final EIP-170 gate on the merged source, not per-change deltas.
- **Descriptor-slot assertion (`002`).** Beyond deriving `NFT_DESCRIPTOR_SLOT` from
  `forge inspect` (already required), add a deploy-time check that writing the descriptor does not
  mutate neighboring slots, so the next layout change fails loudly instead of corrupting state.
- **Factory bootstrap hardening (`006`).** The factory is the single trust root: at bootstrap
  assert the expected chain id and non-empty `eth_getCode(factory)`. Threat-model a poisoned or
  misconfigured anchor; add identity checks only if that model shows real benefit.
- **Signing-destination verification (`006` / wave 3).** Factory-discovered addresses feed
  transactions, so RPC honesty crosses from display into signing safety. The display/signing split
  extends to **addresses**: immediately before signing, re-establish the destination through the
  wallet-facing provider or through the transaction simulation itself.
- **Atomic bootstrap discovery (`006` / wave 3).** Registry count, entries, and bindings are
  multiple reads over appendable state — take them in one multicall (atomic at one block by
  construction). Stale-but-coherent beats mixed-block topology.
- **Composite identity keys (wave 3).** Factory-wide Watch means loan ids, position ids, React
  keys, and caches key on `(chainId, lendingAddress, id)`, never bare `id`. Extends the
  factory-wide decision above.
- **Quote revert through the transport (`007` tests).** The quote's success *is* a revert; verify
  the fallback transport neither retries nor rewrites it before the decoder sees the payload, and
  test against the real target providers, not only anvil. The decoder strict-matches the enriched
  `BelowMinAcceptable` shape; any other revert is a quote failure, never a decoded quote.
- **Approval-flow semantics (wave 3).** Fee-on-transfer is contract-rejected, but verify the
  approval path against the actual admitted assets for zero-before-nonzero approval requirements
  (USDT-class) before assuming standard `approve` behavior.
- **Page-size derivation through production RPC class (`005` sweep, strengthens existing rule).**
  Derive `STREAM_PAGE_SIZE` against the real provider class — `eth_call` caps, response size,
  latency, JSON decode, mobile memory — not anvil alone.
- **Receipt and finality wording (wave 3).** Pinned-snapshot metadata must not imply stronger
  finality than established; verify the receipt pipeline's confirmation/replacement behavior under
  reorg.
- **Cross-source disappearance (`004`).** A pledged stream leaves owner enumeration and reappears
  via the borrower book. Test the composed failure: owner book ready + borrower book failed must
  render as a degraded Borrowed lens, never as the stream vanishing from existence.

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
