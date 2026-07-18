---
kind: required_reading
scope: ovrflo
last_updated: 2026-07-18
audience: [lenders, ai-agents]
---

<!--
  Refresh log:
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

New patterns are appended in order. Pattern #6 was removed (obsolete Sablier binding rule) and subsequent patterns renumbered on 2026-07-15; the current count is 19.

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

### ✅ CORRECT (ask whatever is authoritative for current ownership)

```typescript
// Option A — indexer that tracks current recipient (preferred for dashboards):
const { data } = await fetch(SABLIER_ENVIO_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    query: GET_USER_STREAMS,
    variables: {
      user: user.toLowerCase(),
      senders: ovrfloAddresses.map((a) => a.toLowerCase()),
    },
  }),
}).then((r) => r.json());

// Option B — ask the token contract directly (preferred for single-stream views):
const owner = await publicClient.readContract({
  address: SABLIER_LOCKUP,
  abi: sablierLockupAbi,
  functionName: "ownerOf",
  args: [tokenId],
});
```

**Why:** ERC-721 tokens carry mutable ownership. The only canonical source of
"who owns token `X` right now" is the NFT contract itself (via `ownerOf`, or
an indexer that tracks the `Transfer` events it emits). Events from *upstream*
protocols — OVRFLO's `Deposited`, Pendle's `PTBought`, anything that records a
recipient at mint time — answer a different question: "who did the protocol
first pay out to?". Using them as a proxy for current ownership breaks silently
the moment the NFT is transferred, which is exactly what NFTs are designed to
support.

**Placement/Context:** Any UI code path that discovers, lists, or gates on
NFTs the user currently owns. Applies to Sablier stream NFTs (OVRFLO's primary
case), Pendle YT/PT positions if we ever tokenize them, or any ERC-721 we
surface in a user-facing view. Also applies to access-control checks that want
"is this wallet the current holder?" — always use `ownerOf(tokenId) == user`
or equivalent, never derived protocol state.

**How to detect violation:**

- Grep check that `eth_getLogs`-style discovery of user-owned NFTs is
  absent from `web/lib/**`:

  ```bash
  rg "event Deposited|watchContractEvent|getLogs.*Deposited" web/lib
  ```

- Unit test: given a mocked indexer response where `recipient != originalMinter`,
  the UI MUST still show the stream. `web/tests/lib/sablier.test.ts` covers this
  for Sablier today; extend it for any future NFT integration.

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

- Any modal component importing `useReadContract`/`useReadContracts`/`usePublicClient`
  must also import `ModalErrorBoundary`:

  ```bash
  rg -l "useReadContract|useReadContracts|usePublicClient" web/components/*Modal*.tsx \
    | xargs -I{} sh -c 'rg -L "ModalErrorBoundary" "{}" && echo "VIOLATION: {}"'
  ```

  (expected: no "VIOLATION" lines)

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

- Unit test contract — see `web/tests/components/ModalErrorBoundary.test.tsx` (T-WEB-ERRBOUND-1..3): renders children when no throw, renders fallback on throw, recovers on reset with `vi.spyOn(console, "error").mockImplementation(() => {})` to silence React's own boundary log.

**Documented in:** [`docs/solutions/runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md`](../runtime-errors/modal-render-error-crashes-dashboard-WebUI-20260421.md)

---

## 4. Prevent self-matched loans in OVRFLOLending (ALWAYS REQUIRED)

### ❌ WRONG (borrower == lender breaks `repayLoan`)

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

**Fuzz enforcement:** The `_oVRFLO_prepareOracle` handler in `test/fizz/` exercises both valid and invalid TWAP durations against `prepareOracle`, hitting both bound checks in coverage.

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
# for treasury or the lending contract:
rg -l "sellStreamToLiquidity|buyListing|createBorrowerLoanPool|claimLoanPoolShare|closeLoan|repayLoan" \
  test/OVRFLOLending.t.sol | \
  xargs -I{} sh -c 'rg -L "balanceOf\(TREASURY\)|balanceOf\(address\(lending\)\)" "{}" && echo "REVIEW: {}"'
```

**Documented in:** [`docs/solutions/best-practices/verify-token-balance-movement-not-just-ownership.md`](../best-practices/verify-token-balance-movement-not-just-ownership.md). See also [Test Quality Antipatterns](../best-practices/solidity-foundry-test-quality-antipatterns.md) for the general "green is lying" catalog this rule is a specific case of.

**Fuzz enforcement:** `property_no_free_profit` (GL-57) in `test/fizz/Properties.sol` extends this discipline to the stateful fuzz suite by checking that total actor value (underlying + PT + ovrfloToken across all actors) never exceeds the total start value, catching misrouted payments across the full actor set. GL-57 fired a second false positive during the 91.8% to 98.7% coverage campaign when a scenario handler minted tokens via `underlying.deal()` without updating `ghost_actorStartValue` — fix: mirror any test-only mint in the ghost tracker. SP-100 (borrow disbursement conservation) also extends this discipline, verifying the borrower's underlying increase equals `actualBorrow - fee`; it required gating on `lending.treasury() != actor` when an admin handler can set the treasury to an actor address.

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

**Why:** `OVRFLOLending` exposes its state structs via the Solidity
compiler's auto-getters on the public mappings — `liquidityPositions`,
`saleListings`, `loans`, `loanPools`. An auto-getter for a
`mapping(uint256 => Struct)` returns a default-initialized (zero-valued)
struct for any ID that was never written; it does not revert. This is the
operative contract after U3 of the 2026-07 simplification refactor deleted
the hand-rolled `*State` wrappers (`liquidityState`, `saleListingState`,
`loanState`) that previously reverted on unknown IDs via a `lender !=
address(0)` sentinel. Tests that still call `vm.expectRevert` against the
auto-getter views are stale and silently wrong — the revert never fires, so
the assertion proves nothing and masks regressions. The correct shape is to
destructure the returned struct and `assertEq` each field against its zero
value (`address(0)` for address fields, `0` for uints).

This reversal is intentional and documented. Do not re-introduce hand-rolled
`*State` wrappers with sentinel reverts — the auto-getter contract is the
post-refactor design. The old "hand-rolled views must revert on unknown IDs"
principle is preserved in the **Considered and rejected** section (R-07)
for any future hand-rolled view that is *not* an auto-getter.

**Placement/Context:** Every test in `test/**` that resolves a lending
state struct by ID via `liquidityPositions`, `saleListings`, `loans`, or
`loanPools` to assert "this ID does not exist / was never created". Also
applies to any future public mapping exposed only via its auto-getter. If
a hand-rolled wrapper is ever re-introduced, the revert principle from
R-07 applies to *that* wrapper, not to the auto-getter.

**How to detect violation:**

```bash
# Find stale tests that expect a revert from an auto-getter view that
# actually returns zeros:
rg "vm.expectRevert.*unknown|vm.expectRevert.*nonexistent" test/
# expected: 0 matches against liquidityPositions / saleListings / loans / loanPools

# The old grep against hand-rolled *State wrappers now returns nothing,
# which is expected (the wrappers were deleted in U3):
rg -A5 "function .*State\(.*\) external view" src/OVRFLOLending.sol
# expected: 0 matches — auto-getters have no explicit function body
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

### ❌ WRONG (multisig calls the lending directly, bypassing the factory)

```solidity
// deployLending transfers ownership to the multisig
b.transferOwnership(owner());

// multisig calls OVRFLOLending.setAprBounds directly
OVRFLOLending(lending).setAprBounds(500, 2000);
// Now a factory ownership transfer does NOT move lending governance.
// Lending markets stay owned by the old multisig address.
```

### ✅ CORRECT (factory stays the owner; admin flows through forwarders)

```solidity
// deployLending — no transferOwnership call; factory is the lending's owner
OVRFLOLending b = new OVRFLOLending(address(this), ovrflo, sablierAddr);
// factory remains owner

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
operational incident in a timelocked-multisig context, not a refactor.

**Placement/Context:** `OVRFLOFactory.deployLending` (must not transfer
ownership away from the factory) and every admin action on `OVRFLOLending`
(`setAprBounds`, `setFee`, `setTreasury` — must be forwarded through a
factory function, not called directly on the lending).

**How to detect violation:**

```bash
# deployLending must NOT call transferOwnership
rg "transferOwnership" src/OVRFLOFactory.sol | rg -v "token.transferOwnership(ovrflo)"
# expected: no matches (the only transferOwnership is for OVRFLOToken -> vault)

# Lending admin functions must not be called directly by the multisig
rg "setAprBounds|setFee|setTreasury" src/OVRFLOFactory.sol
# expected: 3 forwarding functions (setLendingAprBounds, setLendingFee, setLendingTreasury)
```

**Documented in:** [`docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md`](../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md)

---

## 9. One vault per underlying — `configureDeployment` must reject duplicates (ALWAYS REQUIRED)

### ❌ WRONG (no guard, silently creates a non-fungible second token)

```solidity
function configureDeployment(...) external onlyOwner {
    // no check — a second vault for the same underlying is allowed
    pendingDeployment = DeploymentConfig({ underlying: underlying, ... });
}
// deploy() creates a second OVRFLOToken for the same underlying.
// The two tokens are NOT fungible with each other, breaking the
// "cross-market ovrfloToken fungibility under one underlying" invariant.
```

### ✅ CORRECT (reject at configure time, before any deployment)

```solidity
function configureDeployment(...) external onlyOwner {
    require(
        underlyingToOvrflo[underlying] == address(0),
        "OVRFLOFactory: underlying already deployed"
    );
    pendingDeployment = DeploymentConfig({ underlying: underlying, ... });
}

function deploy() external onlyOwner returns (address ovrflo) {
    // ...deploy vault...
    underlyingToOvrflo[config.underlying] = ovrflo; // lock after deploy
}
```

**Why:** The documented design feature "cross-market `ovrfloToken` fungibility
under one underlying" only holds **within** a single vault. Two vaults for the
same underlying mint two distinct `OVRFLOToken` contracts that are not
fungible with each other. A user who deposits into the second vault expecting
parity with the first gets a different token. The guard turns a silent
invariant violation into a loud revert at the earliest possible point
(configure, not deploy).

The mapping is set at `deploy()` time, not `configureDeployment()` time, so
reconfiguring a pending (never-deployed) config is still allowed — the guard
only fires when a vault already exists for that underlying.

**Placement/Context:** `OVRFLOFactory.configureDeployment` (the guard) and
`OVRFLOFactory.deploy` (the mapping write). The `underlyingToOvrflo` mapping
is the single source of truth for which underlyings have live vaults.

**How to detect violation:**

```bash
rg "underlying already deployed" src/OVRFLOFactory.sol
# expected: 1 match in configureDeployment

rg "underlyingToOvrflo\[config.underlying\]" src/OVRFLOFactory.sol
# expected: 1 match in deploy()
```

**Documented in:** [`docs/solutions/architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md`](../architecture-patterns/ovrflo-factory-deployment-admin-management-pattern.md)

---

## 10. Require strictly-increasing IDs in batch functions that accept ID arrays (ALWAYS REQUIRED)

### ❌ WRONG (duplicate IDs double-count capacity or create double loans)

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
    require(ptToMarket[ptToken] != address(0), "OVRFLO: unknown PT");
    uint256 balance = IERC20(ptToken).balanceOf(address(this));
    uint256 deposited = marketTotalDeposited[ptToMarket[ptToken]];
    uint256 excess = balance > deposited ? balance - deposited : 0;
    require(excess > 0, "OVRFLO: no excess");
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
rg "unknown PT" src/OVRFLO.sol
# expected: 1 match in sweepExcessPt
```

**Documented in:** Fuzz campaign 2026-07-01 (GL-02 violation), `fizz_data/report.md`

**Fuzz enforcement:** `property_sweepExcessPt_reverts_non_pt` (SP-77) in `test/fizz/Properties.sol` calls `sweepExcessPt` with the underlying token address and asserts it reverts, continuously validating the guard in the stateful fuzz campaign.

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

**Placement/Context:** `claimLoanPoolShare` / `_claimFair` — the shared-pot
claim channel for borrower loan pools.

**How to detect violation:**

```bash
rg "proRataShare" src/OVRFLOLending.sol
# expected: 0 matches — old pro-rata cap removed
rg "contribution.*recovered.*totalContributed" src/OVRFLOLending.sol
# expected: 1 match in _claimFair
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

**Placement/Context:** `_claimFair` in `src/OVRFLOLending.sol` — the harvest
branch that draws from the stream when `loanPoolProceeds < requestAmount`.

**How to detect violation:**

```bash
rg "loan.closed && loanPoolProceeds < requestAmount" src/OVRFLOLending.sol
# expected: 0 matches (harvest guard uses !loan.closed, not loan.closed)
rg "proceeds < requestAmount" src/OVRFLOLending.sol
# expected: 1 match in _claimFair harvest branch
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

**Placement/Context:** `createBorrowerLoanPool` in `src/OVRFLOLending.sol` — parameters
`targetBorrow` and `minAcceptable`.

**How to detect violation:**

```bash
rg "function createBorrowerLoanPool" src/OVRFLOLending.sol
# expected: 1 match — verify targetBorrow and minAcceptable are uint128, not uint256
```

**Documented in:** OVRFLOLending cleanup refactor (2026-07-07), pool claim fairness brainstorm

---

## 15. uint256/uint128 switching (ALWAYS REQUIRED)

**Why:** The contract uses a deliberate uint256/uint128 switching pattern.
Storage structs use `uint128` for packed slots (fitting multiple fields in a
single storage slot). Intermediate math uses `uint256` to avoid overflow on
multiplication (e.g., `contribution * (drawn + repaid)` could overflow
`uint128`). `_toUint128` is the overflow-checked narrowing gate that safely
converts back to `uint128` after math completes, reverting on overflow. This
pattern is inherent to the design — storage size and math safety have
different optimal types.

**Placement/Context:** `src/OVRFLOLending.sol` — storage structs, intermediate
math, and `_toUint128`.

**How to detect violation:**

```bash
rg "_toUint128" src/OVRFLOLending.sol
# expected: matches at every uint256 -> uint128 narrowing gate
rg "uint128\(uint256" src/OVRFLOLending.sol
# expected: 0 matches — raw casts should use _toUint128 instead
```

**Documented in:** [`docs/solutions/best-practices/avoid-unnecessary-type-widening-with-invariant-guarantees.md`](../best-practices/avoid-unnecessary-type-widening-with-invariant-guarantees.md), OVRFLOLending cleanup refactor (2026-07-07)

---

## 16. _consumeLiquidity early-break behavior (ALWAYS REQUIRED)

**Why:** The `_consumeLiquidity` loop breaks when `toBorrow == 0`, meaning
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
uninitialized slots return a zero-valued struct, not a revert. This is the
post-U3 operative contract for `OVRFLOLending`'s `liquidityPositions`,
`saleListings`, `loans`, and `loanPools` (see pattern #7). Tests must
assert zero values (e.g. `assertEq(lender, address(0))`), not
`vm.expectRevert`. Do NOT re-add hand-rolled wrapper functions with
sentinel checks — the auto-getter contract is intentional; re-adding the
wrappers would resurrect the deleted `*State` surface and the stale test
shape that goes with it (see R-07).

**Placement/Context:** Any public mapping on `OVRFLOLending` (and any
future contract) that is exposed only via its compiler-generated
auto-getter, with no hand-rolled `*State` wrapper. If a hand-rolled
wrapper is later introduced for a different reason, the revert-on-unknown
principle from R-07 applies to *that* wrapper — not to the auto-getter.

**How to detect violation:**

```bash
# Stale tests expecting a revert from an auto-getter that returns zeros:
rg "vm.expectRevert.*unknown|vm.expectRevert.*nonexistent" test/
# expected: 0 matches against liquidityPositions / saleListings / loans / loanPools

# Re-introduction of hand-rolled *State wrappers (should stay deleted):
rg -n "function .*State\(.*\) external view" src/OVRFLOLending.sol
# expected: 0 matches
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
rg "struct.*View\b" test/
# expected: 0 matches after migration — mock struct divergence is a bug

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
rg "struct.*View\b" test/
# expected: 0 matches

# Mocks should import the interface they implement, not redefine it:
rg -l "import.*interfaces/" test/mocks/
# expected: every mock file imports its interface
```

**Documented in:** Mock struct divergence review (2026-07-18), companion to pattern #18 (empirical ABI verification).

---
