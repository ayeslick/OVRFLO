---
kind: required_reading
scope: ovrflo
last_updated: 2026-06-27
audience: [contributors, ai-agents]
---

<!--
  Refresh log:
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

New patterns are appended in order. Do not renumber existing entries.

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

## 4. Prevent self-matched loans in OVRFLOBook (ALWAYS REQUIRED)

### ❌ WRONG (borrower == lender breaks `repayLoan`)

```solidity
// borrowAgainstOffer — no self-match guard.
LendOffer storage offer = lendOffers[offerId];
require(offer.active, "OVRFLOBook: lend offer inactive");
// msg.sender could be offer.lender, creating a loan where from == to
// in _pullExact, which reverts on the balance-delta check.
```

### ✅ CORRECT (reject at loan creation)

```solidity
LendOffer storage offer = lendOffers[offerId];
require(offer.active, "OVRFLOBook: lend offer inactive");
require(msg.sender != offer.lender, "OVRFLOBook: self-match");
```

**Why:** If `borrower == lender`, `repayLoan`'s `_pullExact` does a
self-transfer (`from == to`), the ERC20 balance doesn't change, and the
balance-delta check reverts. `closeLoan` (permissionless) still works once
the stream accrues, and the borrower can repay from another address, so
nothing is permanently stranded — but the `repayLoan` path is broken for
this state. Self-matching is economically irrational (you pay a treasury
fee to yourself), so this is a correctness guard, not a value-loss
prevention.

**Placement/Context:** Both loan-creation entry points that pair a borrower
with a lender: `borrowAgainstOffer` (borrower = `msg.sender`, lender =
`offer.lender`) and `lendAgainstListing` (borrower = `listing.borrower`,
lender = `msg.sender`).

**How to detect violation:**

```bash
rg -n "self-match" src/OVRFLOBook.sol
# expected: 2 matches (one per loan-creation path)
```

**Documented in:** [`docs/solutions/security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md`](../security-issues/repayloan-equality-rounding-no-brick-OVRFLOBook-20260624.md) — companion finding section.

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

### ✅ CORRECT (same bounds in both functions)

```solidity
function prepareOracle(address market, uint32 twapDuration) external onlyOwner {
    require(twapDuration >= MIN_TWAP_DURATION, "OVRFLOFactory: twap too short");
    require(twapDuration <= MAX_TWAP_DURATION, "OVRFLOFactory: twap too long");
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
rg -A2 "function prepareOracle" src/OVRFLOFactory.sol | rg "MAX_TWAP"
# expected: 1 match
```

---

## 6. Standalone OVRFLOBook deployment must verify Sablier matches the vault's canonical immutable (ALWAYS REQUIRED)

### ❌ WRONG (blindly trusts env var)

```solidity
address sablier = vm.envOr("SABLIER_ADDRESS", DEFAULT_SABLIER_LL);
// no verification that sablier matches the core vault's sablierLL
```

### ✅ CORRECT (assert against the vault immutable)

```solidity
address sablier = vm.envOr("SABLIER_ADDRESS", DEFAULT_SABLIER_LL);
require(sablier == address(OVRFLO(core).sablierLL()), "OVRFLOBookScript: sablier mismatch");
```

**Why:** The canonical production path is `OVRFLOFactory.deployBook()`, which
reads `address(OVRFLO(ovrflo).sablierLL())` (an immutable hardcoded constant)
and passes it to the `OVRFLOBook` constructor. The standalone
`OVRFLOBook.s.sol` script allows a `SABLIER_ADDRESS` override for flexibility.
Without a verification assertion, a misconfigured env var could bind the book
to the wrong Sablier instance, breaking all stream eligibility checks. The
assert ensures even the standalone path self-verifies.

**Placement/Context:** `script/OVRFLOBook.s.sol` — the standalone deployment
script. The factory path (`OVRFLOFactory.deployBook`) is already safe by
construction.

**How to detect violation:**

```bash
rg "sablier mismatch" script/OVRFLOBook.s.sol
# expected: 1 match
```

---

## 7. Assert all-party token balances in every money-movement test (ALWAYS REQUIRED)

### ❌ WRONG (state flags and NFT ownership pass while value misroutes silently)

```solidity
// test/OVRFLOBook.t.sol — proves the offer was consumed and the stream moved,
// not that the underlying left the book, the fee was paid, or the buyer
// (who posted liquidity upfront) is back to zero.
(,,, uint128 capacity,) = book.saleOffers(offerId);
assertEq(capacity, 0);
assertEq(underlying.balanceOf(SELLER), 100 ether);
assertEq(sablier.ownerOf(28), BUYER);
// missing: balanceOf(TREASURY), balanceOf(address(book)), balanceOf(BUYER)
```

### ✅ CORRECT (every party that touched value is checked)

```solidity
(,,, uint128 capacity,) = book.saleOffers(offerId);
assertEq(capacity, 0);
assertEq(underlying.balanceOf(SELLER), 100 ether);
assertEq(underlying.balanceOf(TREASURY), 0);
assertEq(underlying.balanceOf(address(book)), 0);
assertEq(underlying.balanceOf(BUYER), 0);
assertEq(sablier.ownerOf(28), BUYER);
```

**Why:** The highest-severity bug class in `OVRFLOBook` is a misrouted
payment: value sent to the wrong address, a fee skipped or double-charged,
or funds stranded in the contract after teardown. State flags (`capacity ==
0`, `active == false`, `loan.closed == true`) and NFT ownership
(`sablier.ownerOf(...) == X`) are necessary but not sufficient — they prove
an entry changed hands, not that the money moved correctly. A refactor that
breaks `_payUnderlying` (wrong payee, skipped fee, stranded value) would
pass every flag and ownership assertion and ship a fund-loss bug.

**Placement/Context:** Any non-fork or fork test that calls a function
transferring `underlying`, `ovrfloToken`, or a Sablier stream NFT:
`sellIntoOffer`, `buyListing`, `borrowAgainstOffer`, `lendAgainstListing`,
`cancel*` functions, `claimLoan`, `closeLoan`, `repayLoan`. The four-party
check (actor, counterparty, treasury, book) is the minimum. For loan
servicing, also assert `ovrfloToken.balanceOf`, `sablier.getWithdrawnAmount`,
and `sablier.ownerOf` for the lender and borrower.

**How to detect violation:**

```bash
# Find settlement tests that assert state/ownership but skip balanceOf
# for treasury or the book contract:
rg -l "sellIntoOffer|buyListing|borrowAgainstOffer|lendAgainstListing|claimLoan|closeLoan|repayLoan" \
  test/OVRFLOBook.t.sol | \
  xargs -I{} sh -c 'rg -L "balanceOf\(TREASURY\)|balanceOf\(address\(book\)\)" "{}" && echo "REVIEW: {}"'
```

**Documented in:** [`docs/solutions/best-practices/verify-token-balance-movement-not-just-ownership.md`](../best-practices/verify-token-balance-movement-not-just-ownership.md)

---

## 8. View functions that resolve by ID must revert on non-existent IDs (ALWAYS REQUIRED)

### ❌ WRONG (silent zero defaults for a non-existent ID)

```solidity
function saleOfferState(uint256 offerId) external view returns (...) {
    SaleOffer storage offer = saleOffers[offerId];
    // no existence check — returns (address(0), address(0), 0, 0, false)
    // for an ID that was never created
    return (offer.maker, offer.market, offer.aprBps, offer.capacity, offer.active);
}
```

### ✅ CORRECT (revert with a sentinel check)

```solidity
function saleOfferState(uint256 offerId) external view returns (...) {
    SaleOffer storage offer = saleOffers[offerId];
    require(offer.maker != address(0), "OVRFLOBook: unknown offer");
    return (offer.maker, offer.market, offer.aprBps, offer.capacity, offer.active);
}
```

**Why:** Returning zero defaults for a non-existent ID is silent garbage. An
indexer or frontend cannot distinguish "this offer was cancelled" (real entry,
`active == false`) from "this ID was never created" (no entry, default
struct). Reverting makes the distinction explicit. The sentinel is the
`maker`/`lender`/`borrower` field, which is `address(0)` in a
default-initialized struct and always non-zero for a real entry. Torn-down
entries (cancelled/filled) retain `maker`/`lender`/`borrower` (only
`capacity`/`active` are zeroed), so the sentinel succeeds for dead entries
and fails only for non-existent ones.

**Placement/Context:** Every view function in `OVRFLOBook` that resolves a
struct by ID: `saleOfferState`, `saleListingState`, `lendOfferState`,
`borrowListingState`, `loanState`. Also applies to any future view function
added to the book or vault that resolves by ID.

**How to detect violation:**

```bash
# Find view functions that return a struct from a mapping without a sentinel check:
rg -A5 "function .*State\(.*\) external view" src/OVRFLOBook.sol | \
  rg -L "require.*address\(0\)|unknown" && echo "REVIEW: missing existence check"
```

**Documented in:** [`docs/solutions/architecture-patterns/view-functions-revert-on-nonexistent-ids.md`](../architecture-patterns/view-functions-revert-on-nonexistent-ids.md)

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
