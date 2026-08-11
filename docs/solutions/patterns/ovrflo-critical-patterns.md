---
kind: required_reading
scope: ovrflo
last_updated: 2026-07-29
audience: [lenders, ai-agents]
---

## Settled security findings — read before raising one

Three findings have been raised, disproven, and then re-raised by a later reviewer who followed the documented entry points but did not take the second hop into the record. They are enumerated here, inline, so the collision is visible without opening another file. If your finding matches one, the record is your starting point — bring new evidence or move on.

- **Third-party Sablier withdrawal diverging lending accounting.** Raised as `H-2` by the internal review, again as `H-1` by the 2026-07-28 audit (where it was the lead blocker behind a "do not ship" conclusion). **Disproven both times.** The deployed Sablier at `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` is v2-core `v1.1`, whose `withdraw` reverts `SablierV2Lockup_Unauthorized` unless the caller is the stream sender, NFT owner, or approved operator. `src/OVRFLO.sol` has no withdraw path; `src/OVRFLOLending.sol` approves no operator. Newer Sablier Lockup docs describe a public withdraw-to-recipient path — **a different version than the one deployed here.** Reproducible: `test_LendingEscrow_StrangerCannotWithdrawFromEscrowedStream` in `test/fork/OVRFLOLendingMainnetFork.t.sol` includes the `to = address(lending)` case that discriminates the two ACLs.
- **R-01 — on-chain 18-decimal enforcement for PT.** Declined by design (see below). Re-raised as the 2026-07-28 audit's `L-1`.
- **Pattern #4 — address-scoped self-match prevention.** A correctness guard against an irrational self-loan state, not a security boundary (see below). Re-raised as the 2026-07-28 audit's `L-12`.

**Finding IDs collide across audits.** The internal review and the 2026-07-28 audit both use `H-1`, `H-2`, `L-1`, `L-2`, and `I-4` for unrelated findings — notably, the internal review's `L-1` (uint128/uint40 narrowing) is **still active** while the 2026-07-28 `L-1` is rejected. Always qualify an ID with its audit.

Full disproofs: `docs/audit/rejected-findings-record.md`. Sablier ACL table: `docs/audit/sablier-interface-contract.md`.

---

<!--
  Refresh log:
  - 2026-08-11: Refreshed patterns #8 and #9 for the factory-size fix
    (register, don't construct — docs/plans/2026-08-11-001-fix-factory-
    mainnet-code-size-registry-plan.md). OVRFLOFactory no longer embeds child
    creation code; OVRFLO and OVRFLOLending are deployed externally and
    registered via registerOvrflo()/registerLending() after on-chain
    verification. Pattern #8's detection grep is shape-changed from
    "deployLending must not call transferOwnership" to asserting
    OVRFLOLending's constructor calls `_transferOwnership(factory_)`
    (src/OVRFLOLending.sol:337) and registerLending checks `owner() ==
    address(this)` (src/OVRFLOFactory.sol:176, OwnerMismatch). Pattern #9's
    guard moved from configureDeployment (deleted) to registerOvrflo
    (src/OVRFLOFactory.sol:148, UnderlyingAlreadyDeployed); rewrote the
    "mapping is set at deploy() time" timing paragraph — deployment is now
    external and permissionless, so competing unregistered candidates for one
    underlying can coexist, and the registry still admits exactly one. Both
    patterns now cite their guarding tests in test/OVRFLOFactory.t.sol.
  - 2026-07-27: Fixed pattern #3's detection script — it scoped to a
    `*Modal*.tsx` filename glob, which silently missed `MarketDetail.tsx`
    (the component actually rendered by MarketsApp; `ActionModal`'s own
    wrapper was dead code). Rescoped to the `modal-scrim` marker + usage
    instead of filename. Also fixed a latent bug in patterns #3 and #6's
    detection scripts: both used `rg -L` intending "files without match",
    but `-L` is ripgrep's `--follow` (symlinks) flag, not a
    files-without-match shorthand — the scripts as written did not detect
    what their comments claimed. Replaced with `--files-without-match`.
    See docs/solutions/runtime-errors/market-detail-missing-error-boundary-WebUI-20260727.md.
    Appended pattern #20 (prefer battle-tested libraries/stdlib/framework
    primitives over hand-rolled reimplementations), prompted by the
    `useNowSeconds` de-duplication finding from a `/ce-simplify-code` pass
    over `web/*`. Count is now 20.
  - 2026-07-27: Added a caveat to pattern #20 cross-linking
    docs/solutions/architecture-patterns/wagmi-read-batching-requires-matching-enabled-predicates.md
    — consolidating useReadContract calls into useReadContracts is a
    special case of pattern #20 that additionally requires every merged
    call's query.enabled predicate to match exactly, which the general
    "prefer battle-tested/consolidated code" rule doesn't call out on its
    own. Found via /ce-compound-refresh after documenting that learning.
  - 2026-07-27: Added a second caveat to pattern #20 cross-linking
    docs/solutions/architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md
    — pattern #20's "consolidate duplicated logic" spirit does not extend
    to two components calling the same wagmi/TanStack-Query-backed hook
    with matching args; that already dedupes by query key for free, so
    building a shared-cache/context layer to "fix" it adds a real seam to
    solve a zero-cost non-problem. Found via an /improve-codebase-
    architecture pass over web/* (RatesCell/PositionList both call
    useLending/useLendingLiquidity for the same lending address).
  - 2026-07-18: Rewrote pattern #7 (auto-getter zero-return is now the
    operative contract; old hand-rolled-revert principle moved to R-07 in
    "Considered and rejected"). Removed stale fuzz enforcement refs
    (property_loanState_view / property_liquidityState_view /
    property_saleListingState_view — deleted from Properties.sol). Updated
    detection greps. Fixed stale code snippets in #4, #6, #10, #16 after
    U2 (capacity -> availableLiquidity, active removed) and U3
    (liquidityState -> liquidityPositions auto-getter, 4-tuple). Appended
    patterns #17 (auto-getter zero-return contract), #18 (empirical ABI
    verification for external struct returns), #19 (mocks implement the
    interface, not redeclare it). Count is now 19.
  - 2026-07-15: Renumbered from 17 to 16 patterns. Removed gap at #6
    (Sablier binding verification in standalone script, obsolete). Patterns
    #7-#17 shifted down by 1. Fixed stale function names: _validateLiquidityPositions
    -> _validateLiquidity (#4), _consumeLiquidityPositions -> _consumeLiquidity (#16).
    Updated #5 detection grep and code examples for _validateTwapBounds helper.
    Fixed #13 detection grep (local `proceeds` var). Added cross-link from #6
    to new test-quality antipatterns catalog. Stale function name references
    in #4 and #16 corrected.
  - 2026-07-14: Added fuzz enforcement note to pattern #8 (view function coverage
    via properties and handlers). Updated pattern #7 fuzz enforcement note with
    SP-100 (borrow disbursement conservation, treasury-as-actor false positive)
    and second GL-57 false positive (ghost start-value after setup mint). Fixed
    pattern #8 code examples: `capacity` -> `availableLiquidity` after rebrand.
    91.8% -> 98.7% coverage campaign (151/151 Medusa, 362/362 Forge).
  - 2026-07-05: Added fuzz enforcement references to patterns #5, #7, #11,
    #13 after the fizz gap closure campaign (GL-57, GL-61, GL-62, SP-62, SP-77).
  - 2026-07-05: Fixed pattern #7 code examples — `saleLiquidityPositions` → `liquidityState`
    after the unified liquidity merge renamed the view function.
  - 2026-07-01: Appended pattern #13 (sweepExcessPt must validate ptToken is
    a registered PT) from the fuzz campaign GL-02 violation. The guard
    prevents draining the wrap reserve when a non-PT address is passed.
  - 2026-06-29: Appended R-05 (protocol-level PT redemption rejected) from
    the claim redesign fork-test findings. Updated pattern #4 and #7 to
    reference pool-only functions after single-party lending removal.
  - 2026-06-29: Appended patterns #11 (strictly-increasing IDs in batch
    arrays) and #12 (pro-rata share of cumulative recovery) from the OVRFLOLending
    Pool feature review (commits 91df170, ca8e248). Pattern #12 was later
    rewritten twice: M-01 audit fix (FCFS min(remaining, proceeds)), then
    2026-07-13 (cumulative-recovered pro-rata formula).
  - 2026-06-28: Updated R-02 to note natspec codification. Appended patterns
    #9 (factory owns all deployed lending markets) and #10 (one vault per underlying)
    from the factory deployment/management pattern review.
  - 2026-06-28: Appended patterns #4 (self-match prevention), #5 (TWAP bound
    consistency in prepareOracle), #6 (Sablier binding verification in
    standalone script), and a "Considered and rejected" section (R-01 through
    R-04) from the 2026-06-28 full-contract review.
  - 2026-06-27: Appended patterns #7 (assert all-party token balances in
    money-movement tests) and #8 (view functions revert on non-existent IDs).
  - 2026-04-21: Appended pattern #2 (avoid forge script --broadcast against Anvil
    mainnet forks) from docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md.
  - 2026-04-21: Appended pattern #3 (modal bodies wrapped in a class-component
    error boundary with an onReset contract) from docs/solutions/runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md.
-->


# OVRFLO Critical Patterns (Required Reading)

Short, enforceable rules extracted from real OVRFLO problems. Each entry is
pulled from a full writeup under `docs/solutions/<category>/`. If you are
about to touch the area a pattern covers, you are expected to follow it or
have a documented reason not to.

New patterns are appended in order. Pattern #6 was removed (obsolete Sablier binding rule) and subsequent patterns renumbered on 2026-07-15; the current count is 20.

---

## 1. ERC-721 current ownership comes from the token, not from derived protocol events (ALWAYS REQUIRED)

### ❌ WRONG (transferred NFTs silently disappear from the UI)

```typescript
// Reconstruct Sablier stream ownership from OVRFLO's Deposited event.
// Deposited records the *initial* recipient at mint time, not the current holder.
const logs = await publicClient.getLogs({
  address: ovrflo,
  event: parseAbiItem(
    "event Deposited(address indexed user, address indexed market, uint256 ptAmount, uint256 toUser, uint256 toStream, uint256 streamId)"
  ),
  fromBlock: FACTORY_FROM_BLOCK,
  toBlock: "latest",
  args: { user },
});
// If the NFT has been transferred since mint, `user` is stale and the real
// current recipient will never see this stream in their dashboard.
```

### ✅ CORRECT (discover candidates, then ask the token for current ownership)

```typescript
// Candidate discovery may use verified OVRFLO Deposited logs intersected with
// Sablier Transfer logs to the connected wallet (web/lib/discovery/).
// That answers "which ids might be mine?" — never "who owns this now?"
const candidateIds = discoverHeldStreamCandidates({ origins, transfers, account });

// Authority for ownership / eligibility is always Sablier hydration:
const owner = await publicClient.readContract({
  address: SABLIER_LOCKUP,
  abi: sablierLockupAbi,
  functionName: "ownerOf",
  args: [tokenId],
});
// Drop any candidate whose ownerOf is not the connected address. Gate fields
// (sender, asset, endTime, canceled, depleted) come from getStream, not from
// the discovery projection.
```

**Why:** ERC-721 tokens carry mutable ownership. The only canonical source of
"who owns token `X` right now" is the NFT contract itself (via `ownerOf`).
Events from *upstream* protocols — OVRFLO's `Deposited`, Pendle's `PTBought`,
anything that records a recipient at mint time — answer a different question:
"who did the protocol first pay out to?". Using mint events alone as a proxy
for current ownership breaks silently the moment the NFT is transferred.

Browser-side discovery may still *scan* `Deposited` and `Transfer` logs to
build a candidate id set. That scan is a hint/candidate generator, not an
ownership authority — see
`docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`
and `web/lib/discovery/live-projection.ts`.

**Placement/Context:** Any UI code path that discovers, lists, or gates on
NFTs the user currently owns. Applies to Sablier stream NFTs (OVRFLO's primary
case), Pendle YT/PT positions if we ever tokenize them, or any ERC-721 we
surface in a user-facing view. Also applies to access-control checks that want
"is this wallet the current holder?" — always use `ownerOf(tokenId) == user`
or equivalent, never derived protocol state.

**How to detect violation:**

- Grep for paths that treat OVRFLO `Deposited` (or other mint-time) fields as
  current ownership / eligibility without a following `ownerOf` (and related
  Sablier hydration) filter:

  ```bash
  rg "Deposited|ownerOf" web/lib/discovery web/hooks/useHeldStreams.ts
  ```

- Unit / projection tests: a transferred stream must appear for the new owner
  and disappear for the old one; a candidate whose `ownerOf` is not the
  connected address must be dropped. See `web/tests/lib/discovery/` and
  `docs/solutions/security-issues/indexer-is-a-discovery-hint-not-an-authority.md`.

**Documented in:** [`docs/solutions/integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md`](../integration-issues/transferred-sablier-nfts-invisible-WebUI-20260421.md)

---

## 2. Do not use `forge script --broadcast` against an Anvil mainnet fork (ALWAYS REQUIRED)

### ❌ WRONG (hits foundry#11714 — "lack of funds (0) for max fee")

```bash
anvil --fork-url "$MAINNET_RPC_URL" &

forge script script/SeedLocal.s.sol:SeedLocal \
  --rpc-url http://127.0.0.1:8545 \
  --private-key "$PRIVATE_KEY" \
  --broadcast
# ⇒ Error: Internal EVM error during simulation
#    Context: - transaction validation error: lack of funds (0) for max fee (...)
# …even after vm.deal / anvil_setBalance set the broadcaster to 1000 ether.
```

### ✅ CORRECT (use `forge create` + `cast send` + `cast rpc` in a shell driver)

```bash
anvil --fork-url "$MAINNET_RPC_URL" &

# Fund the dev wallet via Anvil's own RPC — preflight-safe.
cast rpc anvil_setBalance "$DEV_WALLET" "0x3635c9adc5dea00000" \
  --rpc-url http://127.0.0.1:8545 >/dev/null

FACTORY=$(forge create \
  --rpc-url http://127.0.0.1:8545 \
  --private-key "$PRIVATE_KEY" \
  --json \
  src/OVRFLOFactory.sol:OVRFLOFactory \
  --constructor-args "$SABLIER_LL" "$DEV_WALLET" \
  | jq -r .deployedTo)

cast send "$FACTORY" 'approveMarket(address,uint256)' "$PT" 100 \
  --rpc-url http://127.0.0.1:8545 --private-key "$PRIVATE_KEY"
```

**Why:** `forge script --broadcast` runs a preflight balance check via the
non-standard `eth_getAccountInfo` RPC, which on an Anvil mainnet fork is
answered from the *upstream* (real mainnet) state — not from Anvil's local
state. A freshly-derived dev key therefore shows `{balance: 0, nonce: 0}`,
and the signer aborts with "lack of funds" regardless of how many `vm.deal`
or `anvil_setBalance` calls have run. `forge create` and `cast send` don't
use that preflight path; they read balances via standard `eth_getBalance`,
which Anvil answers correctly. Upstream tracking:
[foundry-rs/foundry#11714](https://github.com/foundry-rs/foundry/issues/11714).

**Placement/Context:** Any local-devnet deploy or seed script that targets
an Anvil fork. The canonical entrypoint is [`script/seed-local.sh`](../../../script/seed-local.sh).
**Exception:** Tenderly Virtual Testnets (e.g. `script/SeedDevnet.s.sol`)
are fine with `forge script --broadcast` because their RPCs return correct
broadcaster state. Do not generalize the Tenderly path to Anvil.

**How to detect violation:**

- Grep check that no Forge script is invoked with `--broadcast` against
  `http://127.0.0.1` or `localhost`:

  ```bash
  rg -n "forge script.*--broadcast" script/ tools/ | \
    rg "127\\.0\\.0\\.1|localhost"
  ```

  (expected: no matches outside the Tenderly VTN path)

- Grep check that a `script/SeedLocal.s.sol` has not been re-introduced:

  ```bash
  ls script/SeedLocal.s.sol 2>/dev/null && echo "VIOLATION: re-introduced" || echo "ok"
  ```

- CI smoke: `anvil --fork-url "$MAINNET_RPC_URL" & bash script/seed-local.sh`
  must succeed end-to-end and produce `deployments/local.json` with non-zero
  `$DEV_WALLET` balance.

**Documented in:** [`docs/solutions/integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md`](../integration-issues/anvil-forge-script-broadcast-out-of-funds-LocalSeeding-20260421.md)

---

## 3. Modal bodies — and only modal bodies — are wrapped in a class-component error boundary (ALWAYS REQUIRED)

### ❌ WRONG (a render-time throw in the body crashes the whole dashboard)

```tsx
// web/components/NewOvrfloModal.tsx — no scoped boundary.
export function NewOvrfloModal(...) {
  return (
    <div className="nb-modal">
      <ModalHeader onClose={onClose} />
      <div className="nb-modal-body">
        {/* useReadContracts / usePublicClient throwing here propagates to
            app/error.tsx and unmounts the dashboard + user form state */}
        {step === "underlying" ? <UnderlyingStep /> : <ReviewStep />}
      </div>
    </div>
  );
}
```

### ❌ ALSO WRONG (wrapping the whole modal hides the close button on a body throw)

```tsx
// Boundary swallows the header too — a thrown child can now replace the
// close button with the fallback, trapping the user inside a broken modal.
<ModalErrorBoundary>
  <div className="nb-modal">
    <ModalHeader onClose={onClose} />
    <div className="nb-modal-body">{body}</div>
  </div>
</ModalErrorBoundary>
```

### ✅ CORRECT (scoped to the body; header stays outside; reset + onReset is the contract)

```tsx
// web/components/NewOvrfloModal.tsx
import { ModalErrorBoundary } from "./ModalErrorBoundary";

export function NewOvrfloModal(...) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="nb-modal">
      {/* Header is OUTSIDE the boundary so close always works. */}
      <ModalHeader onClose={onClose} />
      <div className="nb-modal-body">
        <ModalErrorBoundary onReset={() => setReloadKey((k) => k + 1)}>
          <div key={reloadKey}>
            {step === "underlying" ? <UnderlyingStep /> : <ReviewStep />}
          </div>
        </ModalErrorBoundary>
      </div>
    </div>
  );
}
```

`ModalErrorBoundary` is `web/components/ModalErrorBoundary.tsx` — a
~50-line class component with `getDerivedStateFromError` +
`componentDidCatch` (no-op; telemetry hook point) + a `reset()` that clears
state **and** calls `onReset?.()`. Fallback uses `role="alert"`.

**Why:** React 19 still has no hooks API for catching render-time errors;
class components are the only supported primitive. Without a scoped
boundary, the nearest ancestor is the route-level `app/error.tsx`, which by
design unmounts the whole route. A component-level boundary flips only the
failing subtree to a fallback while siblings — and everything above the
boundary — stay mounted. Keeping the header outside guarantees a dismiss
path even when the body cannot render. `onReset` must bump a key or
refetch; otherwise "Try again" re-renders the same failing subtree and
immediately re-throws.

**Placement/Context:** every modal in `web/components/**` whose body
performs data fetches (`useReadContract`, `useReadContracts`,
`usePublicClient`, GraphQL queries) or derives state from potentially
malformed market/stream data. Applies equally to future modals; do **not**
substitute with a single top-level `error.tsx` boundary — that's a
complementary safety net, not a replacement. Do **not** pull in
`react-error-boundary` or similar 3P libs for this use case.

**How to detect violation:**

- Any component that renders the `modal-scrim` wrapper (i.e. is an actual
  modal, not just a table row or panel that happens to read on-chain data)
  and either fetches via `useReadContract`/`useReadContracts`/`usePublicClient`
  or renders `FormBody` from `ActionModal.tsx` must also import
  `ModalErrorBoundary`. Scope by the `modal-scrim` marker and by usage, not
  by a `*Modal*` **filename** glob — a 2026-07-27 regression (see
  [`docs/solutions/runtime-errors/market-detail-missing-error-boundary-WebUI-20260727.md`](../runtime-errors/market-detail-missing-error-boundary-WebUI-20260727.md))
  showed the filename-scoped version silently misses any wrapper (e.g.
  `MarketDetail.tsx`) that renders `FormBody` without "Modal" in its name,
  and an unscoped usage-only version (no `modal-scrim` filter) over-fires on
  ordinary components that read on-chain data outside any modal (e.g.
  `MarketsTable.tsx`, `MarketRowDetail.tsx`):

  ```bash
  for f in $(rg -l "modal-scrim" web/components/*.tsx); do
    rg -q "useReadContract|useReadContracts|usePublicClient|<FormBody\b" "$f" \
      && rg --files-without-match "ModalErrorBoundary" "$f" \
      && echo "VIOLATION: $f"
  done
  ```

  (expected: no "VIOLATION" lines)
- Confirm every component that renders `FormBody` is reachable from the app
  entry point (no fully-wired-but-unmounted "twin" wrapper sitting next to
  the real one):

  ```bash
  rg -n "<FormBody\b" web/components/*.tsx
  # expected: exactly one render site (MarketDetail.tsx) plus FormBody's own
  # definition in ActionModal.tsx; a second render site is a new modal
  # wrapper that must also be checked for ModalErrorBoundary
  ```

- The boundary must not wrap the modal header:

  ```bash
  rg -nU "ModalErrorBoundary>[^<]*<[^<]*ModalHeader|ModalErrorBoundary>\s*<div className=\"nb-modal\"" \
    web/components
  ```

  (expected: no matches)

- `componentDidCatch` must not call `console.*` — the repo's `no-console` rule + Unit 10 banned-patterns check will fail the build. The sanctioned implementation is:

  ```tsx
  componentDidCatch(error: Error, info: ErrorInfo): void { void error; void info; }
  ```

- Unit test contract — see `web/tests/components/modal-error-boundary.test.tsx` (2 tests, no ID scheme): renders children untouched when nothing throws; swaps a throwing body for the fallback and recovers via onReset remount, with `vi.spyOn(console, "error").mockImplementation(() => {})` to silence React's own boundary log. (Citation refreshed 2026-08-10: file is kebab-case, the old `T-WEB-ERRBOUND-1..3` IDs never existed in it.)

**Documented in:** [`docs/solutions/runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md`](../runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md)

---

## 4. Prevent self-matched loans in OVRFLOLending (SUPERSEDED-BY-DESIGN)

> **Superseded 2026-08 by the v1-lite tick order book** (`docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`,
> Key Decisions: "Self-match prevention is dropped"). `borrow` is a blind fill against a cumulative tape counter —
> it never enumerates or reads lender positions, so there is no `liquidity.lender` to compare `msg.sender`
> against; the guard this rule describes is structurally unenforceable under the new fill mechanism. Per the
> `docs/audit/rejected-findings-record.md` L-12 reasoning this pattern also cites: the guard was a correctness
> nicety against an irrational self-loan state, not a security boundary — a self-fill is self-neutral minus the
> protocol fee, and bypassing it with a second EOA gains nothing. Kept below for history; do not re-add this
> guard to the v1-lite contract.

### ❌ WRONG (borrower == lender breaks `repayLoan`) — pre-rewrite contract, historical

```solidity
// createBorrowerLoanPool — no self-match guard on liquidity lenders.
LiquidityPosition storage liquidity = liquidityPositions[liquidityIds[i]];
require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
// msg.sender could be liquidity.lender, creating a loan where from == to
// in _pullExact, which reverts on the balance-delta check.
```

### ✅ CORRECT (reject at loan creation)

```solidity
LiquidityPosition storage liquidity = liquidityPositions[liquidityIds[i]];
require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
require(liquidity.lender != borrower, "OVRFLOLending: self-match");
```

**Why:** If `borrower == lender`, `repayLoan`'s `_pullExact` does a
self-transfer (`from == to`), the ERC20 balance doesn't change, and the
balance-delta check reverts. `closeLoan` (permissionless) still works once
the stream accrues, and the borrower can repay from another address, so
nothing is permanently stranded — but the `repayLoan` path is broken for
this state. Self-matching is economically irrational (you pay a treasury
fee to yourself), so this is a correctness guard, not a value-loss
prevention.

**Placement/Context:** The pool-creation entry point that pairs a borrower
with an liquidity lender: `createBorrowerLoanPool` (borrower = `msg.sender`, checked
against each `liquidity.lender` in `_validateLiquidity`).

**How to detect violation:**

```bash
rg -n "self-match" src/OVRFLOLending.sol
# expected: match in createBorrowerLoanPool (_validateLiquidity); createLenderPool removed
```

**Documented in:** [`docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md`](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOLending-20260624.md) — companion finding section.

---

## 5. TWAP duration bounds must be consistent across `prepareOracle` and `addMarket` (ALWAYS REQUIRED)

### ❌ WRONG (prepareOracle accepts a TWAP that addMarket will reject)

```solidity
function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
    require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
    // missing: require(twapDuration <= MAX_TWAP_DURATION, ...)
    // operator can prepare with 1h, then addMarket rejects at 15min
}
```

### ✅ CORRECT (shared bounds helper called by both functions)

```solidity
function _validateTwapBounds(uint32 twapDuration) internal pure {
    require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
    require(twapDuration <= MAX_TWAP_DURATION, "OVRFLOFactory: twap too long");
}

function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
    _validateTwapBounds(twapDuration);
    ...
}

function addMarket(address vault, address market, uint32 twapDuration, uint16 feeBps)
    external onlyOwner
{
    _validateTwapBounds(twapDuration);
    ...
}
```

**Why:** `prepareOracle` over-provisions cardinality if called with a longer
TWAP than `addMarket` will use — harmless but wastes a tx. The real footgun
is the operator calling `prepareOracle` with a value `addMarket` will reject,
then wondering why `addMarket` fails. Aligning the bounds eliminates the
mismatch. No security impact; this is an operational consistency rule.

**Placement/Context:** `OVRFLOFactory.prepareOracle` and
`OVRFLOFactory.addMarket` — the two onlyOwner functions that take a
`twapDuration` parameter.

**How to detect violation:**

```bash
rg "_validateTwapBounds" src/OVRFLOFactory.sol
# expected: 1 definition + 2 call sites (prepareOracle and addMarket)
```

**Fuzz enforcement:** none since the ticket-07 fizz regeneration — the regenerated harness calls `factory.prepareOracle` exactly once in `test/fizz/Base.sol` setup with a fixed `TWAP_DURATION` and never fuzzes invalid durations. Coverage is the two unit tests only: `test_PrepareOracle_RevertsWhenTwapTooLong` and `test_AddMarket_RevertsWhenTwapTooLong` (`test/OVRFLOFactory.t.sol`). (Refreshed 2026-08-10; the previously cited `_oVRFLO_prepareOracle` handler no longer exists.)

---

## 6. Assert all-party token balances in every money-movement test (ALWAYS REQUIRED)

### ❌ WRONG (state flags and NFT ownership pass while value misroutes silently)

```solidity
// test/OVRFLOLending.t.sol — proves the liquidity was consumed and the stream moved,
// not that the underlying left the lending, the fee was paid, or the buyer
// (who posted liquidity upfront) is back to zero.
(,, , uint128 availableLiquidity) = lending.liquidityPositions(liquidityId);
assertEq(availableLiquidity, 0);
assertEq(underlying.balanceOf(SELLER), 100 ether);
assertEq(sablier.ownerOf(28), BUYER);
// missing: balanceOf(TREASURY), balanceOf(address(lending)), balanceOf(BUYER)
```

### ✅ CORRECT (every party that touched value is checked)

```solidity
(,, , uint128 availableLiquidity) = lending.liquidityPositions(liquidityId);
assertEq(availableLiquidity, 0);
assertEq(underlying.balanceOf(SELLER), 100 ether);
assertEq(underlying.balanceOf(TREASURY), 0);
assertEq(underlying.balanceOf(address(lending)), 0);
assertEq(underlying.balanceOf(BUYER), 0);
assertEq(sablier.ownerOf(28), BUYER);
```

**Why:** The highest-severity bug class in `OVRFLOLending` is a misrouted
payment: value sent to the wrong address, a fee skipped or double-charged,
or funds stranded in the contract after teardown. State flags (`availableLiquidity
== 0`, `loan.closed == true`) and NFT ownership
(`sablier.ownerOf(...) == X`) are necessary but not sufficient — they prove
an entry changed hands, not that the money moved correctly. A refactor that
breaks `_payUnderlying` (wrong payee, skipped fee, stranded value) would
pass every flag and ownership assertion and ship a fund-loss bug.

Note: `availableLiquidity == 0` is the post-U2 single signal for "consumed
or never-created". The `active` boolean was removed in U2 of the 2026-07
simplification refactor; do not re-introduce a separate active flag.

**Placement/Context:** Any non-fork or fork test that calls a function
transferring `underlying`, `ovrfloToken`, or a Sablier stream NFT:
`sellStreamToLiquidity`, `buyListing`, `createBorrowerLoanPool`,
`cancel*` functions, `claimLoanPoolShare`, `closeLoan`, `repayLoan`. The four-party
check (actor, counterparty, treasury, lending) is the minimum. For loan
servicing, also assert `ovrfloToken.balanceOf`, `sablier.getWithdrawnAmount`,
and `sablier.ownerOf` for the lender and borrower.

**How to detect violation:**

```bash
# Find settlement tests that assert state/ownership but skip balanceOf
# for treasury or the lending contract. Note: use --files-without-match, not
# `-L` (which is --follow, not files-without-match, in ripgrep) — an `-L`
# version of this check silently inverts and never flags real gaps.
rg -l "supply|withdraw|borrow|repay|close|claim" \
  test/OVRFLOLending.t.sol | \
  while read -r f; do rg --files-without-match "balanceOf\(TREASURY\)|balanceOf\(address\(lending\)\)" "$f" && echo "REVIEW: $f"; done
```

(Identifiers refreshed 2026-08-10 to the v1-lite money-movement surface —
`supply`/`withdraw`/`borrow`/`repay`/`close`/`claim` in `src/OVRFLOLending.sol`;
the previous grep named only deleted sale/pool functions and matched nothing.)

**Documented in:** [`docs/solutions/best-practices/verify-token-balance-movement-not-just-ownership.md`](../best-practices/verify-token-balance-movement-not-just-ownership.md). See also [Test Quality Antipatterns](../best-practices/solidity-foundry-test-quality-antipatterns.md) for the general "green is lying" catalog this rule is a specific case of.

**Fuzz enforcement:** `property_underlying_flow_ghosts` (GL-04) in the regenerated `test/fizz/Properties.sol` carries this discipline in the stateful fuzz suite — it conserves `underlying.balanceOf(lending) + refunded + borrowedOut == supplied + donated` from realized actor/treasury balance deltas tracked in handler-side ghosts, catching misrouted payments independently of the contract's own counters. (Refreshed 2026-08-10: the previously cited GL-57/SP-100 belong to the pre-rewrite property set and no longer exist; their historical false-positive lessons — mirror test-only mints in the ghost tracker, gate on treasury-reassigned-to-actor — carried forward into the regenerated harness's `_accountUnderlyingFlow` classification.)

---

## 7. Auto-getters return zero-valued structs for non-existent IDs — tests must assert zeros, not expect reverts (ALWAYS REQUIRED)

### ❌ WRONG (stale test expects a revert from an auto-getter that returns zeros)

```solidity
// test/OVRFLOLending.t.sol — U3 of the 2026-07 simplification refactor deleted
// the hand-rolled `*State` wrappers. `liquidityPositions` is now the
// compiler-generated auto-getter for the public mapping; it does NOT revert
// on unknown IDs, it returns a zero-valued struct.
vm.expectRevert();                       // ❌ never reverts
(address lender,,,) = lending.liquidityPositions(999);
```

### ✅ CORRECT (assert the zero-valued struct returned by the auto-getter)

```solidity
// test/OVRFLOLending.t.sol — auto-getter returns zeros for an uninitialized ID.
(address lender, address market, uint16 aprBps, uint128 availableLiquidity) =
    lending.liquidityPositions(999);
assertEq(lender, address(0));
assertEq(market, address(0));
assertEq(aprBps, 0);
assertEq(availableLiquidity, 0);
```

**Why:** `OVRFLOLending` exposes its raw state structs via the Solidity
compiler's auto-getters on the public mappings — in v1-lite these are
`positions` and `loans` (identifiers refreshed 2026-08-10; the previously
listed `liquidityPositions`/`saleListings`/`loanPools` were deleted by the
rewrite). An auto-getter for a `mapping(uint256 => Struct)` returns a
default-initialized (zero-valued) struct for any ID that was never written;
it does not revert. Tests that call `vm.expectRevert` against the raw
auto-getters are stale and silently wrong — the revert never fires, so the
assertion proves nothing and masks regressions. The correct shape is to
destructure the returned struct and `assertEq` each field against its zero
value.

**v1-lite coexistence note (2026-08-10):** three hand-rolled named views —
`tickState`, `positionState`, `loanState` — now exist alongside the raw
auto-getters and DO revert on missing entities
(`SpacingUnset`/`PositionMissing`/`LoanMissing`), per the plan's KTD8
convention. This is exactly R-07's carve-out: the revert principle applies to
hand-rolled wrappers, the zero-return contract applies to raw auto-getters,
and the two deliberately coexist. Neither is a violation of the other.
The current suite's existence checks go through the reverting named views
(`test_StateViews_DeriveFieldsAndRevertOnMissing`); the raw auto-getters
retain the zero-return contract for any caller that wants it.

**Placement/Context:** Every test in `test/**` that resolves a lending state
struct by ID via the raw auto-getters `positions` or `loans` to assert "this
ID does not exist". The named views `tickState`/`positionState`/`loanState`
follow R-07 (revert), not this pattern.

**How to detect violation:**

```bash
# Find stale tests that expect a revert from a raw auto-getter that
# actually returns zeros:
rg "vm.expectRevert.*unknown|vm.expectRevert.*nonexistent" test/
# expected: 0 matches against the raw `positions` / `loans` auto-getters

# Count the hand-rolled reverting wrappers R-07 explicitly permits
# (multi-line signatures, so use -U):
rg -U "function (tickState|positionState|loanState)\(" src/OVRFLOLending.sol
# expected: exactly 3 — these are R-07 wrappers, NOT pattern-7 violations
```

**Documented in:** [`docs/solutions/architecture-patterns/view-functions-revert-on-nonexistent-ids.md`](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md) (historical principle for hand-rolled views), [`docs/solutions/architecture-patterns/behavior-preserving-simplification-refactor.md`](../architecture-patterns/behavior-preserving-simplification-refactor.md) §9 (U3 deletion of `*State` wrappers).

---

## Considered and rejected (2026-06-28 full-contract review)

The following findings were raised during a full-contract review and
explicitly rejected. They are documented here so future reviewers do not
re-raise them without new context.

### R-01: No on-chain 18-decimal underlying validation

**Finding:** `configureDeployment` accepts any `underlying` without checking
`decimals() == 18`, but `wrap`/`unwrap` and `OVRFLOToken` assume 18-decimal
semantics.

**Rejected because:** `addMarket` already requires
`IStandardizedYield(sy).yieldToken() == info.underlying`, binding the
underlying to a Pendle SY yield token. The multisig governs which underlyings
are configured. Per AGENTS.md: "do not duplicate what the timelocked multisig
already validates" and "keep code Pendle-specific." Adding an on-chain decimal
check contradicts the project's simplicity preference.

### R-02: Sweep functions do not reject `to = address(0)`

**Finding:** `sweepExcessPt` and `sweepExcessUnderlying` in both `OVRFLO` and
`OVRFLOFactory` don't guard against `to = address(0)`.

**Rejected because:** These are multisig-only admin functions. The multisig is
trusted to provide a correct recipient. A zero-address guard is
defense-in-depth that the project explicitly does not want per the "prefer
off-chain multisig verification over redundant on-chain checks" preference.
This trust assumption is now explicitly documented in `@dev` natspec on both
the factory and vault sweep functions.

### R-03: Unchecked downcasts in `OVRFLO.deposit` (`uint128(toStream)`, `uint40(duration)`)

**Finding:** `toStream` is cast to `uint128` and `duration` to `uint40`
without `SafeCast` bounds checks.

**Rejected because:** `toStream` is bounded by `ptAmount` (itself bounded by
deposit limits and `MIN_PT_AMOUNT`), and `duration = expiryCached -
block.timestamp` is at most ~1-2 years of seconds (~63M), well within
`type(uint40).max` (~1.1e12). Both casts are safe given protocol constraints.
Adding `SafeCast` would be redundant.

### R-04: `registeredToken` not checked against series `ovrfloToken` in `requireEligible`

**Finding:** `StreamPricing.requireEligible` fetches `registeredToken` from
`registry.ovrfloInfo(core)` but doesn't assert it equals the series
`ovrfloToken` from `marketActive`.

**Rejected because:** Both values derive from the same vault immutable:
`registeredToken` = vault-level `ovrfloToken` (set at factory deploy), and
the series `ovrfloToken` = `OVRFLO.series(market).ovrfloToken` which returns
the same vault immutable. They are identical by construction. An equality
check would be a no-op invariant that contradicts the "don't add redundant
checks" preference.

### R-05: Protocol-level PT redemption in `claim()` (replacing per-user PT transfer)

**Finding:** A redesign proposed replacing the per-user `claim()` (burn
ovrfloToken, transfer PT 1:1, user redeems on Pendle themselves) with a
permissionless protocol-level PT-to-SY-to-underlying redemption that sends
the underlying asset directly to the user.

**Rejected because:** Fork testing against real Pendle mainnet markets
revealed that PT redemption through the SY is 1:1 for the **accounting
asset** (stETH), not the **yield token** (wstETH). For a wstETH market, 10 PT
redeems to 10 stETH, which at the variable stETH-to-wstETH rate (~1.2x) is
only ~8.138 wstETH. This breaks the fundamental 1:1 supply invariant between
ovrfloToken and the underlying (wstETH) that the wrap/unwrap reserve and all
vault accounting depend on. Additional issues: `redeemPY` lives on the YT not
the PT, `burnFromInternalBalance` must be `false`, stETH rebasing variance
would complicate vault accounting, and `minTokenOut` estimation would need
fuzzy slippage handling. The current per-user claim is simpler, preserves the
1:1 invariant, and users handle PT-to-underlying conversion on their own
terms.

**Documented in:** [`docs/solutions/architecture-patterns/ovrflo-claim-per-user-pt-transfer-not-protocol-redemption.md`](../architecture-patterns/ovrflo-claim-per-user-pt-transfer-not-protocol-redemption.md)

### R-06: Claim-time fee on posters (lenders/lenders) in OVRFLOLending

**Finding:** A proposal to charge lenders a fee when their position is
claimed/settled (i.e. when a lender calls `claimLoanPoolShare` to recover pool
proceeds), in addition to the existing fill-time fee.

**Rejected because:** The lending's fee model is already coherent and optimally
placed. `feeBps` is taken once, in underlying, at fill time, and consistently
taxes the side extracting liquidity or immediacy:
- `sellStreamToLiquidity` — the seller pays (net of `grossPrice`)
- `buyListing` — the seller pays (net of `grossPrice`, at the listing's
  snapshotted `feeBps`)
- `createBorrowerLoanPool` — the borrower pays (net of proceeds)

Lenders and claimants never pay; the fee taxes demand for capital, not the
provision of it. A claim-time fee on the poster is worse on every axis:

1. **Taxes resting liquidity.** LiquidityPosition depth is the whole market. Charging
   lenders on recovery lowers their realized APR below the posted `aprBps`,
   so either lending markets thin out or lenders demand wider APRs to compensate. The
   protocol earns roughly the same either way, with worse UX.
2. **Breaks rate transparency.** Today "posted APR = lender's realized yield"
   is exactly true — a rare, marketable property the UI relies on (one BOOK
   APR column, no supply/borrow spread). A claim fee turns every displayed
   rate into "10%, but actually 9.85% depending on when you claim."
3. **Lands inside `_claimFair`.** That function is the most delicate
   accounting in the lending (pro-rata caps, deficit harvesting from open
   streams, `loanPoolProceeds` conservation; see patterns #12 and #13). Threading
   fee extraction through `recovered`/`entitled`/`loanPoolReceived` adds rounding
   dust across many small pro-rata claims and new invariants to fuzz — large
   audit surface for a second-order revenue stream. Contradicts the
   "this is Solidity, not Python" simplicity preference.
4. **Retroactivity.** Listings already snapshot `feeBps` at post time to
   protect lenders from fee changes. A claim-time fee is inherently exposed to
   governance changing the fee between fill and claim unless it is snapshotted
   per pool — more state, no new capability.
5. **Double taxation of the same notional.** The borrow fee at origination
   already priced the protocol's take on that principal. Taxing the lender's
   recovery of the same principal charges the same flow twice.

**If more fee surface is ever wanted**, the one defensible variant is a
performance fee on the lender's *interest only* (`obligation - principal`),
taken once at pool settlement rather than per claim. That preserves principal
integrity and leaves `_claimFair`'s per-claim math untouched. Even that is
deferred: at 10% APR and 25bps fill fees the spread is thin, and the simpler
pitch ("lenders keep every bps they post") is worth more than the revenue.

### R-07: Hand-rolled `*State` view wrappers that revert on unknown IDs (2026-07-18 reversal)

**Finding:** The original pattern #7 (2026-06-27) required that every
`OVRFLOLending` view resolving a struct by ID revert on non-existent IDs via
a `lender != address(0)` sentinel. The contract had hand-rolled
`liquidityState`, `saleListingState`, and `loanState` wrappers enforcing
this.

**Rejected because:** The codebase previously had hand-rolled `*State`
wrappers that reverted on unknown IDs (see
[`view-functions-revert-on-nonexistent-ids.md`](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md)).
U3 of the 2026-07 simplification refactor deleted these wrappers in favor of
auto-getters, which return zeros. The hand-rolled-revert principle remains
valid for future hand-rolled views but is no longer the operative contract.
The current operative contract is documented in pattern #7 above (assert
zeros, do not `vm.expectRevert`); see also
[`behavior-preserving-simplification-refactor.md`](../architecture-patterns/behavior-preserving-simplification-refactor.md)
§9. Do not re-raise "add a sentinel-revert wrapper" without new context,
and do not re-add the deleted wrappers — the auto-getter contract is
intentional.

---

## 8. The factory owns every deployed lending — lending admin is forwarded, not direct (ALWAYS REQUIRED)

**Refreshed 2026-08-11** (factory-size fix, `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md`): `OVRFLOLending` is now deployed externally (any EOA/script) and *registered* by the factory, not constructed by it. The enforcement mechanism moved from "`deployLending` must not call `transferOwnership`" to two load-bearing pieces: the lending's own constructor sets the factory as owner from birth, and `registerLending` refuses to admit a candidate whose owner isn't the factory.

### ❌ WRONG (owner set to the deploying EOA; registration doesn't check it)

```solidity
// OVRFLOLending constructor omits _transferOwnership(factory_) — OZ Ownable's
// default leaves owner() == msg.sender, i.e. whichever EOA deployed it.
constructor(address factory_, address core_, address sablier_) {
    // ...factory/core/sablier wiring...
    // no _transferOwnership(factory_) call
}

// registerLending admits it anyway (no owner check)
function registerLending(address lending) external onlyOwner {
    // ...no `if (lendingMarket.owner() != address(this)) revert ...` check...
    ovrfloToLending[ovrflo] = lending;
}
// The deployer EOA — not the factory — now owns a registered lending market.
// A factory ownership transfer does NOT move its governance, and the EOA can
// call setAprBounds/setFee/setTreasury directly, bypassing every forwarder.
```

### ✅ CORRECT (factory is the owner from construction; registration verifies it; admin flows through forwarders)

```solidity
// OVRFLOLending's constructor sets the factory as owner from birth
constructor(address factory_, address core_, address sablier_) {
    // ...factory/core/sablier wiring...
    _transferOwnership(factory_); // src/OVRFLOLending.sol:337
}

// registerLending refuses any candidate whose owner isn't this factory
function registerLending(address lending) external onlyOwner {
    // ...core/factory/sablier checks...
    if (lendingMarket.owner() != address(this)) revert OwnerMismatch(); // src/OVRFLOFactory.sol:176
    ovrfloToLending[ovrflo] = lending;
    // ...
}

// factory exposes forwarding functions
function setLendingAprBounds(address lending, uint16 aprMinBps_, uint16 aprMaxBps_)
    external onlyOwner
{
    _requireKnownLending(lending);
    OVRFLOLending(lending).setAprBounds(aprMinBps_, aprMaxBps_);
    emit LendingAprBoundsSet(lending, aprMinBps_, aprMaxBps_);
}
```

**Why:** The factory is the single admin hub. If it owns every vault and
every lending, a single factory ownership transfer moves governance for all
dependents atomically. If lending markets are owned directly by the multisig, a factory
ownership rotation silently abandons lending governance — the lending markets stay owned by
the old multisig address while the factory moves to the new one. This is an
operational incident in a timelocked-multisig context, not a refactor. Under
external deployment the risk shifts one step earlier: without the constructor
setting the owner and registration checking it, a deployer EOA could hold
control of a market between deployment and registration (or forever, if
registration didn't check).

**Placement/Context:** `OVRFLOLending`'s constructor (must call
`_transferOwnership(factory_)`), `OVRFLOFactory.registerLending` (must check
`owner() == address(this)` before admitting a candidate), and every admin
action on `OVRFLOLending` (`setAprBounds`, `setFee`, `setTreasury` — must be
forwarded through a factory function, not called directly on the lending).

**How to detect violation:**

```bash
# OVRFLOLending's constructor must set the factory as owner from birth
rg -c '_transferOwnership\(factory_\)' src/OVRFLOLending.sol
# expected: 1

# registerLending must verify the candidate's owner is this factory
rg -c 'revert OwnerMismatch' src/OVRFLOFactory.sol
# expected: 1 (the check inside registerLending; the error declaration itself is separate)

# Lending admin functions must not be called directly by the multisig
rg "setAprBounds|setFee|setTreasury" src/OVRFLOFactory.sol
# expected: 3 forwarding functions (setLendingAprBounds, setLendingFee, setLendingTreasury)
```

**Guarding tests** (`test/OVRFLOFactory.t.sol`): `test_RegisterLending_RevertsForOwnerMismatch` (mock lookalike
whose `owner()` isn't the factory) and `test_RegisterLending_SucceedsFromEoaDeployedLending` (end-to-end happy
path with the lending deployed by a plain EOA, no pranks-as-factory — the shape that exposes ownership-model
regressions that owner-pranked fixtures mask).

**Documented in:** [`docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md`](../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md)

---

## 9. One vault per underlying — `registerOvrflo` must reject duplicates (ALWAYS REQUIRED)

**Refreshed 2026-08-11** (factory-size fix, `docs/plans/2026-08-11-001-fix-factory-mainnet-code-size-registry-plan.md`): `OVRFLO` vaults are now deployed externally and *registered* by the factory, not constructed by it. The guard moved from `configureDeployment` to `registerOvrflo`.

### ❌ WRONG (no guard, silently creates a non-fungible second token)

```solidity
function registerOvrflo(address ovrflo) external onlyOwner {
    // no duplicate-underlying check — a second vault for an underlying that
    // already has a registered vault is admitted
    ovrfloInfo[ovrflo] = OvrfloInfo({treasury: treasury, underlying: underlying, ovrfloToken: ovrfloToken});
}
// A second, distinct OVRFLOToken for the same underlying is now registered.
// The two tokens are NOT fungible with each other, breaking the
// "cross-market ovrfloToken fungibility under one underlying" invariant.
```

### ✅ CORRECT (reject at registration, before any binding is recorded)

```solidity
function registerOvrflo(address ovrflo) external onlyOwner {
    // ...zero-address, already-registered, factory, and oracle checks...
    address underlying = vault.underlying();
    if (underlyingToOvrflo[underlying] != address(0)) revert UnderlyingAlreadyDeployed(); // src/OVRFLOFactory.sol:148

    // ...
    underlyingToOvrflo[underlying] = ovrflo; // locked at registration
}
```

**Why:** The documented design feature "cross-market `ovrfloToken` fungibility
under one underlying" only holds **within** a single vault. Two vaults for the
same underlying mint two distinct `OVRFLOToken` contracts that are not
fungible with each other. A user who deposits into the second vault expecting
parity with the first gets a different token. The guard turns a silent
invariant violation into a loud revert at the earliest possible point
(registration, before the candidate is admitted).

**Pattern #9 timing.** Because child deployment is now permissionless and happens outside the factory
entirely (any EOA/script can `new OVRFLO(...)` for the same underlying), multiple unregistered *candidate*
vaults for one underlying can coexist — deployment itself creates no state the factory tracks. The registry
still admits exactly one: the guard fires at `registerOvrflo` time against the first candidate the multisig
registers, and every later candidate for that underlying reverts `UnderlyingAlreadyDeployed`, permanently
protocol-disconnected (see the plan's Security analysis). This is the same end state the old
configure-time guard produced — only the point in time where competing candidates can exist has moved earlier,
from "pending, unconfigured" to "deployed, unregistered."

**Placement/Context:** `OVRFLOFactory.registerOvrflo` (the guard, check 5) and its effects (the
`underlyingToOvrflo` write). The mapping is the single source of truth for which underlyings have registered
vaults.

**How to detect violation:**

```bash
rg -c 'revert UnderlyingAlreadyDeployed' src/OVRFLOFactory.sol
# expected: 1 (the check inside registerOvrflo; the error declaration itself is separate)

rg -c 'underlyingToOvrflo\[underlying\] = ovrflo' src/OVRFLOFactory.sol
# expected: 1 (the write, inside registerOvrflo)
```

**Guarding test:** `test_RegisterOvrflo_RevertsForDuplicateUnderlying` — `test/OVRFLOFactory.t.sol`.

**Documented in:** [`docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md`](../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md)

---

## 10. Require strictly-increasing IDs in batch functions that accept ID arrays (SUPERSEDED-BY-DESIGN)

> **Superseded 2026-08 by the v1-lite tick order book** (`docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`,
> R9). `borrow` takes no `liquidityIds` array at all — it is a single blind fill against one tick's cumulative
> `filled` counter, so the double-count vector this rule guards against (duplicate IDs inflating a validation-loop
> total, then double-executing in a fill loop) no longer exists structurally: there is no array to duplicate IDs
> in. Kept below for history; do not port this pattern into any new batch-shaped v1-lite entrypoint without first
> checking whether the underlying array-of-IDs shape it guards against even applies.

### ❌ WRONG (duplicate IDs double-count capacity or create double loans) — pre-rewrite contract, historical

```solidity
// createBorrowerLoanPool — no ordering check
for (uint256 i = 0; i < liquidityIds.length; i++) {
    LiquidityPosition storage liquidity = liquidityPositions[liquidityIds[i]];
    require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
    totalAvailable += liquidity.availableLiquidity; // duplicate ID => counted twice
}
// Borrower receives more underlying than was actually consumed from any
// single liquidity — fund theft from other liquidityPositions' escrowed funds.
```

### ✅ CORRECT (strict-increasing guard rejects duplicates and unsorted input)

```solidity
for (uint256 i = 0; i < liquidityIds.length; i++) {
    if (i > 0) require(liquidityIds[i] > liquidityIds[i - 1], "OVRFLOLending: duplicate or unsorted ids");
    LiquidityPosition storage liquidity = liquidityPositions[liquidityIds[i]];
    require(liquidity.availableLiquidity > 0, "OVRFLOLending: liquidity inactive");
    totalAvailable += liquidity.availableLiquidity;
}
```

**Why:** When a batch function iterates IDs in a validation loop then a
separate fill loop, duplicate IDs cause double-counting in validation
(inflated `totalAvailable` or `totalDeployable`) and double-execution in the
fill (two loans against the same escrowed stream, or funds drawn twice from
the same liquidity). `require(ids[i] > ids[i-1])` rejects both duplicates and
unsorted input in a single check. As defense-in-depth, also re-assert
`availableLiquidity > 0` inside the fill loop (the `active` boolean was
removed in U2 of the 2026-07 simplification refactor; `availableLiquidity > 0`
is the single consumability signal).

**Placement/Context:** Any function that accepts an array of IDs and
iterates them more than once: `createBorrowerLoanPool` (liquidity IDs), and any
future batch primitive.

**How to detect violation:**

```bash
rg "duplicate or unsorted ids" src/OVRFLOLending.sol
# expected: 1 match (createBorrowerLoanPool only; createLenderPool removed)
```

**Documented in:** [`docs/solutions/design-patterns/solidity-batch-function-safety-patterns.md`](../design-patterns/solidity-batch-function-safety-patterns.md)

**Fuzz enforcement:** The multi-liquidity `createBorrowerLoanPool` handler in `test/fizz/` generates 1-3 liquidity arrays with strictly-increasing IDs by construction, and `property_liquidityIdsStrictlyIncreasing` asserts the ordering invariant after each pool creation.

---

## 11. `sweepExcessPt` must validate that the passed address is a registered PT (ALWAYS REQUIRED)

### ❌ WRONG (non-PT address drains the wrap reserve)

```solidity
function sweepExcessPt(address ptToken, address to) external onlyAdmin {
    uint256 balance = IERC20(ptToken).balanceOf(address(this));
    // ptToMarket[underlying] == address(0), so deposited == 0
    uint256 deposited = marketTotalDeposited[ptToMarket[ptToken]];
    uint256 excess = balance > deposited ? balance - deposited : 0;
    // excess == entire underlying balance — wrap reserve drained
    IERC20(ptToken).safeTransfer(to, excess);
}
```

### ✅ CORRECT (reject non-PT addresses before computing excess)

```solidity
function sweepExcessPt(address ptToken, address to) external onlyAdmin {
    if (ptToMarket[ptToken] == address(0)) revert UnknownPT();
    uint256 balance = IERC20(ptToken).balanceOf(address(this));
    uint256 deposited = marketTotalDeposited[ptToMarket[ptToken]];
    uint256 excess = balance > deposited ? balance - deposited : 0;
    if (excess == 0) revert NoExcess();
    IERC20(ptToken).safeTransfer(to, excess);
}
```

**Why:** `sweepExcessPt` uses `ptToMarket[ptToken]` to look up the deposited
amount. If a non-PT address is passed (e.g. the underlying token), the lookup
returns `address(0)` and `marketTotalDeposited[address(0)]` is 0, so the
entire balance of that token is treated as "excess" and swept out. This
drains the wrap reserve if the underlying address is passed. Note the
asymmetry with `sweepExcessUnderlying`, which uses the immutable `underlying`
address and correctly subtracts `wrappedUnderlying` — it cannot be
mis-targeted.

This is input validation on a token-transfer function, not redundant multisig
checking. The multisig validates intent (should we sweep?); the contract
validates input (is this actually a PT?). This is distinct from R-02 (rejected
`to = address(0)` guard), which concerns the sweep *destination* — that remains
trusted to the multisig.

**Placement/Context:** `OVRFLO.sweepExcessPt` — the only sweep function that
accepts a fuzzed token address. `sweepExcessUnderlying` is safe by construction
(it uses the immutable `underlying`).

**How to detect violation:**

```bash
rg -n "revert UnknownPT\(\)" src/OVRFLO.sol
# expected: 4 matches — sweepExcessPt, claim, flashLoan, claimablePt all reuse
# this error for the analogous market-lookup check; sweepExcessPt is one of
# four call sites, not the sole one. (Migrated from the "OVRFLO: unknown PT"
# require-string form to the UnknownPT() custom error, dated user decision
# 2026-08-10; call-site count unchanged.)
```

**Documented in:** Fuzz campaign 2026-07-01 (GL-02 violation), `fizz_data/report.md`

**Fuzz enforcement:** none since the ticket-07 fizz regeneration — the previously cited `property_sweepExcessPt_reverts_non_pt` (SP-77) belongs to the pre-rewrite property set, and the regenerated `OVRFLOFactoryHandler` always sweeps the real `ptToken`. Current coverage is unit-test only: `test/OVRFLO.t.sol` (rejects the underlying address; rejects a fake PT). A fuzz re-add is a candidate for the next harness iteration.

---

## 12. Cap shared-pool claims at pro-rata share of cumulative recovery (ALWAYS REQUIRED)

### ❌ WRONG (FCFS on shrinking pot — no pro-rata guarantee)

```solidity
// claimLoanPoolShare — min(remaining, loanPoolProceeds) with no pro-rata
uint256 available = remaining;
if (uint256(loanPoolProceeds[poolId]) < available) available = uint256(loanPoolProceeds[poolId]);
// First claimant can drain the entire pot, leaving later claimants with
// nothing even though they contributed equally.
```

### ❌ WRONG (pro-rata cap on shrinking pot strands minority lenders)

```solidity
// claimLoanPoolShare — pro-rata share of current (shrinking) loanPoolProceeds
uint256 proRataShare =
    uint256(loanPoolProceeds[poolId]) * loanPoolContributions[poolId][msg.sender]
        / pools[poolId].totalContributed;
uint256 available = proRataShare;
if (remaining < available) available = remaining;
// After a majority lender drains the pot, minority pro-rata floors to 0.
// totalContributed=100, A=99, B=1, loanPoolProceeds=1 after A claims:
//   B's proRataShare = 1 * 1 / 100 = 0 → permanently stranded.
```

### ✅ CORRECT (pro-rata share of total recovery minus prior receipts)

```solidity
uint256 recovered = uint256(loan.drawn) + uint256(loan.repaid);
if (!loan.closed) {
    recovered += uint256(_minUint128(sablier.withdrawableAmountOf(loan.streamId), _outstanding(loan)));
}
uint256 claimable = uint256(contribution) * recovered / uint256(totalContributed)
    - loanPoolReceived[loanPoolId][account];
```

**Why:** Two prior approaches both failed. The pro-rata cap on the *current*
pot stranded minorities when the pot shrank. The FCFS approach
(`min(remaining, loanPoolProceeds)`) let the first claimant drain everything.
The cumulative-recovered formula solves both: `recovered` includes all drawn
plus repaid plus stream-accrual for open loans, so `claimable` is the lender's
pro-rata share of *total* recovery minus what they've already received. This
is order-independent — every lender can claim up to their pro-rata share
regardless of when they claim. `loanPoolReceived` prevents over-claiming.

**Placement/Context (v1-lite):** `claim` in `src/OVRFLOLending.sol` — the same cumulative-recovered
formula now attributes by tape interval overlap (`_overlapUnits`) instead of a stored per-lender
`totalContributed`/`loanPoolContributions` pair, but the pro-rata-of-total-recovery shape is
unchanged (KTD9). Historical identifiers below (`claimLoanPoolShare`, `_claimFair`,
`loanPoolProceeds`, `totalContributed`) do not exist in the current contract.

**How to detect violation:**

```bash
rg "proRataShare" src/OVRFLOLending.sol
# expected: 0 matches — old pro-rata cap removed
rg "Math.mulDiv\(_overlapUnits" src/OVRFLOLending.sol
# expected: 1 match in claim (the entitlement formula)
```

**Documented in:** [`docs/solutions/architecture-patterns/cumulative-recovered-pro-rata-pool-claims.md`](../architecture-patterns/cumulative-recovered-pro-rata-pool-claims.md)

**Last updated:** 2026-07-14

---

## 13. Harvest branch for stream-accrued claims (ALWAYS REQUIRED)

**Why:** The `claimable` formula in `_claimFair` includes `min(withdrawable, outstanding)`
for open loans, so a lender can claim their pro-rata share of stream accrual
even when `loanPoolProceeds == 0` and `drawn == 0`. The harvest branch draws the deficit
(`requestAmount - loanPoolProceeds`) from the stream, depositing it into `loanPoolProceeds`
before paying the lender. This is the primary mechanism for claiming accrued
stream value from open pool loans — not a defense-in-depth fallback. Without it,
lenders could only claim after `closeLoan` or `repayLoan`, not from live accrual.

**Placement/Context (v1-lite):** `claim` in `src/OVRFLOLending.sol` — the harvest branch that draws
`harvestAmount` from the stream when the shared `pot` (formerly `loanPoolProceeds`) falls short of
`requestAmount`, gated by `!loan.closed` (`harvestCap` computed only inside that branch).

**How to detect violation:**

```bash
rg "loan.closed &&.*pot < requestAmount" src/OVRFLOLending.sol
# expected: 0 matches (harvest guard uses !loan.closed, not loan.closed)
rg "if \(pot < requestAmount\)" src/OVRFLOLending.sol
# expected: 1 match in claim's harvest branch
```

**Documented in:** OVRFLOLending pool claim fairness fix (2026-07-06), `_claimFair` harvest fix (2026-07-07)

---

## 14. uint128 parameter types as implicit ABI-decoder bounds checks (ALWAYS REQUIRED)

**Why:** The `uint128` parameter types serve as implicit ABI-decoder bounds
checks. Values exceeding `type(uint128).max` are rejected at the ABI level
before any contract code runs. This is a deliberate choice — the contract's
storage structs use `uint128` for packed slots, so accepting `uint256` would
require an explicit overflow check inside the function. The `uint128` parameter
type moves the check to the ABI decoder, which is cheaper and catches invalid
inputs earlier.

**Placement/Context (v1-lite):** `borrow` in `src/OVRFLOLending.sol` — parameters `targetBorrow`
and `minAcceptable` are still `uint128` (the identifiers carried over unchanged from the
pre-rewrite `createBorrowerLoanPool`, which no longer exists).

**How to detect violation:**

```bash
rg "function borrow" src/OVRFLOLending.sol
# expected: 1 match — verify targetBorrow and minAcceptable are uint128, not uint256
```

**Documented in:** OVRFLOLending cleanup refactor (2026-07-07), pool claim fairness brainstorm

---

## 15. uint256/uint128 switching (ALWAYS REQUIRED)

**Why:** The contract uses a deliberate uint256/uint128 switching pattern.
Storage structs use `uint128` for packed slots (fitting multiple fields in a
single storage slot). Intermediate math uses `uint256` to avoid overflow on
multiplication (e.g., `contribution * (drawn + repaid)` could overflow
`uint128`). OZ `SafeCast.toUint128`/`SafeCast.toUint64` (v1-lite's checked
narrowing gates — KTD10; the hand-rolled `_toUint128` helper this rule was
originally written against no longer exists) safely convert back after math
completes, reverting on overflow. This pattern is inherent to the design —
storage size and math safety have different optimal types.

**Placement/Context (v1-lite):** `src/OVRFLOLending.sol` — storage structs, intermediate
math, and `SafeCast.toUint128`/`SafeCast.toUint64` (plus the two local UNIT-conversion
helpers `_toUnits`/`_toWei`, which route through the same `SafeCast` gates).

**How to detect violation:**

```bash
rg "SafeCast.toUint128|SafeCast.toUint64" src/OVRFLOLending.sol
# expected: matches at every uint256 -> uint128/uint64 narrowing gate
rg "uint128\(uint256|uint64\(uint256" src/OVRFLOLending.sol
# expected: 0 matches — raw casts should use SafeCast instead
```

**Documented in:** [`docs/solutions/best-practices/avoid-unnecessary-type-widening-with-invariant-guarantees.md`](../best-practices/avoid-unnecessary-type-widening-with-invariant-guarantees.md), OVRFLOLending cleanup refactor (2026-07-07)

---

## 16. _consumeLiquidity early-break behavior (SUPERSEDED-BY-DESIGN)

> **Superseded 2026-08 by the v1-lite tick order book** (`docs/plans/2026-08-05-001-feat-lending-v1-lite-plan.md`,
> R3). `_consumeLiquidity` and its per-position consumption loop are deleted; `_fillTick` advances one tick
> epoch's monotone `filled` counter with a single SSTORE regardless of how many lender positions the fill's
> interval eventually overlaps (attribution is computed lazily, later, by interval overlap — see "Blind fill" and
> "Frozen history" in `CONCEPTS.md`). There is no loop to early-break out of, and no `availableLiquidity` per
> position to leave untouched. Kept below for history.

**Why (pre-rewrite contract, historical):** The `_consumeLiquidity` loop breaks when `toBorrow == 0`, meaning
trailing liquidityPositions past the break point are never touched. This retains residual
`availableLiquidity` for unconsumed liquidityPositions. The caller
(`createBorrowerLoanPool`) may pass more liquidityPositions than needed to fill `targetBorrow`;
the excess liquidityPositions are left untouched and available for future consumption.
This is intentional — it allows borrowers to include backup liquidityPositions without
committing to all of them. (U2 of the 2026-07 simplification refactor removed the
separate `active` boolean; `availableLiquidity > 0` is now the single signal
for "consumable".)

**Placement/Context:** `_consumeLiquidity` in `src/OVRFLOLending.sol`.

**How to detect violation:**

```bash
rg "toBorrow == 0" src/OVRFLOLending.sol
# expected: 1 match in _consumeLiquidity loop break condition
```

**Documented in:** [`docs/solutions/design-patterns/solidity-batch-function-safety-patterns.md`](../design-patterns/solidity-batch-function-safety-patterns.md), OVRFLOLending cleanup refactor (2026-07-07)

---

## 17. Auto-getter zero-return contract (ALWAYS REQUIRED)

**Why:** When a state struct is exposed via the Solidity compiler's
auto-getter (i.e. the public mapping has no hand-rolled wrapper function),
uninitialized slots return a zero-valued struct, not a revert. In v1-lite the
raw auto-getters are `positions` and `loans` (identifiers refreshed
2026-08-10; `liquidityPositions`/`saleListings`/`loanPools` were deleted by
the rewrite — see pattern #7). Tests must assert zero values (e.g.
`assertEq(lender, address(0))`), not `vm.expectRevert`.

**v1-lite coexistence note (2026-08-10):** the named views `tickState`,
`positionState`, and `loanState` are hand-rolled wrappers that DO revert on
missing entities — that is R-07's carve-out operating as designed, not a
violation of this pattern. The zero-return contract governs the raw
auto-getters only.

**Placement/Context:** Any public mapping on `OVRFLOLending` (and any
future contract) that is exposed only via its compiler-generated
auto-getter. The revert-on-unknown principle from R-07 applies to the
hand-rolled `*State` wrappers — not to the auto-getters.

**How to detect violation:**

```bash
# Stale tests expecting a revert from a raw auto-getter that returns zeros:
rg "vm.expectRevert.*unknown|vm.expectRevert.*nonexistent" test/
# expected: 0 matches against the raw `positions` / `loans` auto-getters

# The three R-07 wrappers (multi-line signatures — use -U); their presence
# is by design, not a re-introduction violation:
rg -U "function (tickState|positionState|loanState)\(" src/OVRFLOLending.sol
# expected: exactly 3
```

**Documented in:** [`docs/solutions/architecture-patterns/behavior-preserving-simplification-refactor.md`](../architecture-patterns/behavior-preserving-simplification-refactor.md) §9 (U3 deletion of `*State` wrappers), [`docs/solutions/architecture-patterns/view-functions-revert-on-nonexistent-ids.md`](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md) (historical principle for hand-rolled views).

---

## 18. Empirical ABI verification for external struct returns (ALWAYS REQUIRED)

### ❌ WRONG (trust the interface doc without probing the deployed contract)

```solidity
// Mocking Sablier's getStream from the interface ABI alone, without
// decoding a real mainnet return word layout. A field like `isCancelable`
// can sit at a different word offset than the interface declares, or the
// live contract can return a narrower/wider struct than the interface
// advertises. Tests pass against the mock and fail (or pass wrongly) on mainnet.
struct LockupLinearStreamView {
    uint128 depositAmount; uint128 withdrawnAmount;
    ... bool isCancelable;  // position assumed from interface doc
}
```

### ✅ CORRECT (probe the deployed contract, decode against live layout)

```bash
# Probe a real mainnet stream ID and decode the return words against
# the interface struct layout. Security-critical fields (e.g. isCancelable)
# must be cross-checked against an individual getter on the same ID.
cast call "$SABLIER_LL" "getStream(uint256)" "$STREAM_ID" \
  --rpc-url "$MAINNET_RPC_URL"
cast call "$SABLIER_LL" "isCancelable(uint256)" "$STREAM_ID" \
  --rpc-url "$MAINNET_RPC_URL"
```

**Why:** Interface ABIs for deployed external contracts (Sablier
`getStream`, Pendle views) are documentation, not ground truth. The live
contract's return word layout is what the call actually returns, and a
mock that redeclares the struct under a different name can silently drift
from the interface shape — fields shift offsets, booleans pack into
different words, or the live contract returns a struct the interface does
not advertise. Doc-reading is not sufficient: a mock that matches the
interface doc but not the live word layout will pass every test and then
misbehave (or pass wrongly) against mainnet. Probing with `cast call`
against a real RPC and decoding the return against the live layout is the
only way to catch this before a fork test or a mainnet deployment.
Security-critical fields (e.g. `isCancelable`, which gates
`closeLoan`/`cancel*` paths) must be cross-checked against individual
getters on real mainnet IDs, not just the aggregate struct return.

**Placement/Context:** Any test, mock, or integration that models a struct
returned by a deployed external contract — Sablier V2 `getStream` /
`getWithdrawnAmount`, Pendle PT/SY/market views, oracle returns. Applies
to fork tests, fuzz harnesses that mock external calls, and any off-chain
indexer that decodes return data.

**How to detect violation:**

```bash
# Mock structs that redeclare an interface struct under a different name
# (silently drifting from the interface shape):
rg "struct.*View\b" test/mocks/
# expected (scope refreshed 2026-08-10 to test/mocks/ — own-contract
# destructuring helpers like LoanView in test/OVRFLOLending.t.sol are out of
# scope): 2 known matches, the ACCEPTED-EXCEPTION AmountsView/StreamView in
# MockLendingSablier (duck-typed to serve two setStream call shapes from one
# shared mock; the fizz MockSablier implements the interface properly).
# Any NEW match beyond those two is a violation. after migration — mock struct divergence is a bug

# Mocks that import the interface struct directly are fine; redeclarations
# with a *View suffix are the smell. Also grep for cast-call probes as
# positive evidence the layout was verified empirically:
rg "cast call.*getStream|cast call.*isCancelable" test/ docs/ script/
```

**Documented in:** Empirical ABI verification practice established during the 2026-07-18 simplification refactor review of mock struct divergence against Sablier V2 `getStream`.

---

## 19. Mocks implement the interface, not redeclare it (ALWAYS REQUIRED)

### ❌ WRONG (mock redeclares the interface struct under a different name)

```solidity
// test/mocks/SablierMock.sol — redeclares ISablierV2LockupLinear.Stream
// as LockupLinearStreamView. The mock's field order / types can drift
// silently from the interface; tests pass against the mock and fail (or
// pass wrongly) against mainnet.
struct LockupLinearStreamView {
    uint128 depositAmount;
    uint128 withdrawnAmount;
    uint40 startTime;
    uint40 endTime;
    bool isCancelable;   // ← position can drift from interface
    bool wasCanceled;
}
```

### ✅ CORRECT (mock imports and implements the interface struct directly)

```solidity
// test/mocks/SablierMock.sol — implement ISablierV2LockupLinear.Stream
// directly. The mock's storage shape cannot drift from the interface
// because it IS the interface struct.
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";

contract SablierMock is ISablierV2LockupLinear {
    mapping(uint256 => ISablierV2LockupLinear.Stream) internal _streams;
    // ... implement getStream to return the interface struct ...
}
```

**Why:** When a mock redeclares an interface struct under a different name
(e.g. `Stream` → `StreamView`), the mock's shape can silently drift from
the interface: field order shifts, types widen/narrow, booleans pack into
different words. Tests pass against the mock because the mock and the test
agree on the redeclared shape, but they fail (or pass wrongly) against
mainnet where the real contract returns the interface shape. Implementing
the interface struct directly eliminates the divergence vector — the mock
and the interface share one definition, so they cannot drift. This is the
mock-side complement to pattern #18 (probe the deployed contract for the
live word layout): #18 catches divergence at the mainnet boundary, #19
prevents it from being introduced at the mock boundary.

**Placement/Context:** Every mock in `test/mocks/**` that stands in for a
deployed external contract (Sablier, Pendle, oracle, ERC20 variants).
Mocks must `import` the interface and implement its structs directly; do
not redeclare interface structs under `*View` or `*Mock` aliases.

**How to detect violation:**

```bash
# Mock structs that redeclare an interface struct under a different name:
rg "struct.*View\b" test/mocks/
# expected: 2 known accepted-exception matches (MockLendingSablier) —
# see pattern #18's refreshed note; any NEW match is a violation.

# Mocks should import the interface they implement, not redefine it:
rg -l "import.*interfaces/" test/mocks/
# expected: every mock file imports its interface
```

**Documented in:** Mock struct divergence review (2026-07-18), companion to pattern #18 (empirical ABI verification).

---

## 20. Prefer battle-tested libraries and stdlib/framework primitives over hand-rolled reimplementations (ALWAYS REQUIRED)

### ❌ WRONG (two independent hand-rolled wall clocks instead of the existing hook)

```tsx
// MarketRowDetail.tsx
const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);

// MarketsTable.tsx — same pattern, hand-rolled again in a second file
const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
useEffect(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), []);
```

### ✅ CORRECT (delegate to the shared hook; extend it if one shape doesn't fit every call site)

```tsx
// web/hooks/useNowSeconds.ts exports both shapes callers actually need:
export function useNowSeconds(live = false): bigint { /* eager init */ }
export function useNowSecondsHydrationSafe(): bigint | null { /* null-then-effect */ }

// MarketRowDetail.tsx
const nowSeconds = useNowSeconds();

// MarketsTable.tsx
const nowSeconds = useNowSecondsHydrationSafe();
```

**Why:** Before writing new logic for a problem that is not protocol-specific
domain logic (Pendle/Sablier/OVRFLO math and state), check in order: (1) an
existing hook/util in this codebase (`web/hooks/`, `web/lib/`), (2) the
language/runtime stdlib (`structuredClone`, `Intl`, `URL`, `AbortController`,
etc.), (3) an already-installed dependency (`viem`, `wagmi`,
`@tanstack/react-query`, `next`) before adding logic on top of it, and only
then (4) write new code — and only if the problem is genuinely
protocol-specific. Hand-rolled reimplementations accumulate silent edge-case
bugs that battle-tested code has already paid down, and every duplicate copy
is a second place a future fix has to be applied. This is a
behavior-preservation-first rule, not a line-count-first rule: only swap to an
existing utility/primitive when it is behavior-equivalent for every input
actually in play (do not swap in a native UI control, a locale-dependent
formatter, or a different sort-stability/serialization behavior than what is
already relied upon).

**Placement/Context:** Any new logic in `web/**` (or Solidity utility code)
that is not protocol-specific business logic — clock/time reads, debounce/
throttle, deep clone/equality, URL/query-string parsing, retry/backoff, focus
trapping, formatting. Protocol-specific math (Sablier stream pricing,
OVRFLO fee/obligation math) stays hand-rolled and owned in `StreamPricing`/
`lib/*` — there is no generic library for that.

**How to detect violation:**

```bash
# Duplicated hand-rolled clock/timer state across components — a proxy for
# "this pattern exists more than once and should delegate to one shared hook":
rg -l "useState.*null.*useEffect|setTimeout|setInterval" web/components/*.tsx
# then manually check whether each hit reimplements something already in
# web/hooks/ (useNowSeconds, useFocusTrap, useDebounce, etc.) instead of
# importing it.
```

**Caveat — consolidating on-chain reads is a special case that needs its own check.** Merging duplicated `useReadContract` calls into one `useReadContracts` batch is this same "don't hand-roll/duplicate what already exists" impulse applied to data fetching, but it carries an extra precondition this pattern doesn't cover on its own: every call being merged must share an *identical* `query.enabled` predicate, or the batch silently changes when each read fires. See [`docs/solutions/architecture-patterns/wagmi-read-batching-requires-matching-enabled-predicates.md`](../architecture-patterns/wagmi-read-batching-requires-matching-enabled-predicates.md).

**Second caveat — apparent duplication *across* components calling the same read hook is often not real duplication.** This pattern's spirit ("don't reimplement what already exists") does not mean "eliminate every case where two components call the same hook with the same args" — when that hook is built on wagmi/TanStack Query, the caching layer already dedupes by query key, so two call sites resolve to one cache entry and one request. Building a context/shared-cache layer to "fix" this adds a real seam to solve a cost that's already zero. Check the query key equality before assuming the duplication is real. See [`docs/solutions/architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md`](../architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md).

**Documented in:** [`docs/solutions/best-practices/prefer-battle-tested-libraries-over-hand-rolled-code.md`](../best-practices/prefer-battle-tested-libraries-over-hand-rolled-code.md), [`docs/solutions/architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md`](../architecture-patterns/shared-hook-safety-depends-on-render-tree-position.md) (2026-07-27 `useNowSeconds` de-duplication), [`docs/solutions/architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md`](../architecture-patterns/wagmi-query-key-dedup-makes-cross-component-hook-duplication-free.md) (2026-07-27 `RatesCell`/`PositionList` review).

---

## 21. Errors and events come from the closed catalog — selectors carry semantics (ALWAYS REQUIRED)

**Why:** The v1-lite plan governs errors/events as a closed catalog: amended
only by dated user decision, never invented locally. One selector maps to one
semantic class — a size floor (`BelowMinimum`) is never shared with a temporal
condition (`NotCovered` was minted for exactly this reason, 2026-08-08), and
the governance binds reviewers/coordinators identically to builders (the
`ZeroSteps` reversal). Events are log-complete for owner-mutable parameters:
any payout-affecting quantity derived from one (e.g. `feeAmount` from
`feeBps`) is emitted explicitly, and terminal signals are uniform across every
exit path (`Closed` fires on both closure routes).

**Placement/Context:** Every new `error`/`event` declaration in `src/`; every
review of one.

**How to detect violation:**

```bash
# Errors present in code but absent from the plan's pinned catalog:
rg -n "^\s*error [A-Z]" src/OVRFLOLending.sol src/TickTree.sol src/StreamPricing.sol
# expected: every name listed in the plan's error catalog (docs/plans/
# 2026-08-05-001-feat-lending-v1-lite-plan.md); a name missing there needs a
# dated user decision, not a local mint.
```

**Documented in:** [`docs/solutions/design-patterns/error-event-catalog-governance-20260808.md`](../design-patterns/error-event-catalog-governance-20260808.md)

---

## 22. Uncheatable-test requirements — plan-derived literals, discriminating boundaries, mutation kills (ALWAYS REQUIRED)

**Why:** A test that would pass against a subtly wrong implementation is a
defect. Assertions use plan-derived or hand-derived literals (never the
implementation's own arithmetic mirrored back), boundary tests sit at the
discriminating distance (`UNIT-1`, net-of-fee, concrete non-aligned rounding
fixtures), invariant campaigns carry liveness gates (a campaign that never
executes claim/repay/close proves nothing about them), and test-only suites
are reviewed by mutation campaigns, not by reading. Citations to tests are
claims — verify by opening the cited test.

**Placement/Context:** Every test PR; every invariant-suite change; every
"covered by" claim in a disposition table.

**How to detect violation:**

```bash
# Invariant handlers whose ghosts are never read by an assertion (decoration):
rg -o "ghost_[A-Za-z0-9_]+" test/OVRFLOLendingInvariant.t.sol test/fizz/ -h | sort -u | \
  while read -r g; do n=$(rg -c "$g" test/ -g '*.sol' | awk -F: '{s+=$2} END{print s}'); \
  [ "$n" -le 1 ] && echo "UNREAD GHOST: $g"; done
# expected: no output — every ghost is read at least once beyond its declaration
```

**Documented in:** [`docs/solutions/best-practices/uncheatable-test-discipline-20260810.md`](../best-practices/uncheatable-test-discipline-20260810.md)

---

## 23. Frozen-history / monotone-counter safety arguments — test across structural transitions (ALWAYS REQUIRED)

**Why:** v1-lite's safety case decomposes into monotonicity + frozen history +
tiling; big behavioral claims (no double-attribution, claim-order
independence) follow by construction. When a design carries such a guarantee,
its tests are EVIDENCE the premises hold, and they must span the structure's
own transitions — a gas-flatness or attribution claim verified only in steady
state (same tree height, same epoch) does not pin the guarantee through
growth or rollover.

**Placement/Context:** Any change to `TickTree`, epoch machinery, or the fill
path; any new claim of the form "X is constant/frozen/monotone".

**How to detect violation:**

```bash
rg -n "AcrossTreeHeightGrowth|across.*growth|rollover" test/OVRFLOLendingGas.t.sol test/OVRFLOLendingInvariant.t.sol
# expected: at least the OVRFLOLendingGas across-growth pair remains; a
# refactor that deletes it un-pins the blind-fill design guarantee.
```

**Documented in:** [`docs/solutions/architecture-patterns/frozen-history-monotone-counter-safety-argument-20260810.md`](../architecture-patterns/frozen-history-monotone-counter-safety-argument-20260810.md)

---

## 24. Agents in a shared checkout commit by explicit path only (ALWAYS REQUIRED)

**Why:** The U4 commit collision: `git add -A` in a shared checkout scooped a
concurrent agent's in-progress files into an unrelated commit. Commits name
their paths; `-A`/`-u` are reserved for a coordinator that has just verified
`git status` against its own change inventory.

**Placement/Context:** Every agent brief that includes commit rights; every
coordinator commit in a session with live background agents.

**How to detect violation:**

```bash
# In agent briefs and skill docs that grant commit rights:
rg -n "git add -A|git add \." .scratch/ docs/agents/ 2>/dev/null
# expected: no instruction tells an agent to use unscoped adds
```

**Documented in:** [`docs/solutions/developer-experience/shared-checkout-and-trust-boundaries-20260810.md`](../developer-experience/shared-checkout-and-trust-boundaries-20260810.md)

---

## 25. Log-completeness for owner-mutable parameters (ALWAYS REQUIRED)

**Why:** If a payout depends on an owner-mutable parameter with no per-entity
snapshot, the applied value must be in the event, or history becomes
unreconstructable from logs the moment the parameter changes. `Borrowed`
carries `feeAmount` (not just `actualBorrow`) for exactly this reason —
`feeBps` can change under the loan's feet and logs are the only durable record
of what was actually charged.

**Placement/Context:** Every event on a path whose amounts depend on
`setFee`/`setAprBounds`/`setTreasury`-class parameters; review of any new
owner setter.

**How to detect violation:**

```bash
# Owner-mutable params feeding money paths:
rg -n "onlyOwner" src/OVRFLOLending.sol | rg "set"
# for each setter's parameter, confirm the event on the affected money path
# emits the APPLIED value (e.g. Borrowed includes feeAmount):
rg -n "event Borrowed" src/OVRFLOLending.sol
# expected: feeAmount present in the event signature
```

**Documented in:** [`docs/solutions/design-patterns/error-event-catalog-governance-20260808.md`](../design-patterns/error-event-catalog-governance-20260808.md) (rule 4)
