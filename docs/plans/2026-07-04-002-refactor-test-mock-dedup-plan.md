# Refactor: test suite mock deduplication

Date: 2026-07-04
Status: proposed
Scope: `test/*.t.sol` (Foundry unit/fuzz/invariant/attack suites)
Out of scope: `test/fork/` (already shares `OVRFLOForkBase` + `OVRFLOTestFixtures`), `test/fizz/` (Echidna/Medusa suite, must stay self-contained), `src/`, coverage gaps (tracked separately in `SOLIDITY_TEST_REVIEW.md`)

## Motivation

Full review of the 13 non-fork Foundry test files (~7,400 lines). Test logic and
assertions are strong (all-party balance checks per pattern #7, revert coverage,
invariants), but the support code is heavily copy-pasted. Roughly 900 lines are
near-verbatim duplicated mock contracts and helper functions. Concrete evidence
of drift risk already exists: the recent commit "test: add getOracleState mock to
all test helpers" (9685dec) had to patch the same `_mockRate` helper in four
files, and two files define contracts with the same name (`InvariantMockERC20`,
`InvariantOvrfloAdmin` in both `OVRFLOInvariant.t.sol` and
`OVRFLOWrapUnwrap.invariant.t.sol`), a forge artifact-collision hazard.

This is strictly a test-support refactor: no test contract names, test function
names, assertions, or revert expectations change. `forge test --match-contract`
filters documented in CLAUDE.md keep working.

## Duplication inventory

| Family | Copies | Lines each | Files |
|---|---|---|---|
| Book mock stack (MockFactory + MockCore + MockSablier + mintable ERC20) | 3 identical + 1 variant | ~210 | `OVRFLOBook.t.sol`, `OVRFLOBookInvariant.t.sol`, `OVRFLOAttackScenarios.t.sol`; variant in `StreamPricing.t.sol` |
| Mintable mock ERC20 | 9 | ~8-18 | `OVRFLOBook.t.sol`, `OVRFLOBookInvariant.t.sol`, `OVRFLOAttackScenarios.t.sol`, `OVRFLOInvariant.t.sol`, `OVRFLOWrapUnwrap.invariant.t.sol`, `OVRFLOWrapUnwrap.t.sol`, `OVRFLOFuzz.t.sol`, `OVRFLOFlashLoan.t.sol`, `OVRFLO.t.sol`/`OVRFLOFactory.t.sol` (decimals variant) |
| `_mockRate` / `_mockSablier` / `_computeFee` vm.mockCall helpers | 4 | ~40 | `OVRFLO.t.sol`, `OVRFLOFlashLoan.t.sol`, `OVRFLOFuzz.t.sol`, `OVRFLOAttackScenarios.t.sol` (plus inline copies in both invariant setUps) |
| Mock Ovrflo admin (`ovrfloInfo` registry stub) | 3 | ~20-50 | `OVRFLOWrapUnwrap.t.sol`, `OVRFLOInvariant.t.sol`, `OVRFLOWrapUnwrap.invariant.t.sol` |

## Item 1: Create `test/mocks/` with a shared mintable ERC20

New file `test/mocks/TestERC20.sol`:

```solidity
contract TestERC20 is ERC20 {
    uint8 private immutable CUSTOM_DECIMALS;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        CUSTOM_DECIMALS = 18;
    }

    constructor variant or second contract TestERC20Decimals for the 6-decimal
    ptMismatch case used by OVRFLO.t.sol / OVRFLOFactory.t.sol.

    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```

Implementation detail: Solidity has no constructor overloading, so ship two
contracts in the same file: `TestERC20` (fixed 18 decimals) and
`TestERC20Decimals` (constructor takes `decimals_`), matching the existing
`MockERC20Metadata` shape. All 9 inline copies are deleted; type references in
each test file switch to the shared names. `WrapMockERC20` subclasses
(`ReentrantUnderlying`, `ShortTransferUnderlying` in `OVRFLOWrapUnwrap.t.sol`)
re-parent onto `TestERC20` and stay in their file (single-use attack mocks).

## Item 2: Consolidate the Book mock stack into `test/mocks/BookMocks.sol`

`OVRFLOBookMockFactory` / `BookInvMockFactory` / `AttackMockFactory` /
`StreamPricingMockFactory` are four copies of the same ~30-line registry stub.
Same story for MockCore (~55 lines x4) and MockSablier (~120 lines x4). The
three Book-file copies are line-for-line identical apart from the name prefix
and revert-string prefixes; the StreamPricing copy is a strict subset plus two
extras.

New file `test/mocks/BookMocks.sol` with three contracts:

- `MockBookFactory`: as today (`setInfo`, `setMarketApproved`, `ovrfloInfo`,
  `isMarketApproved`).
- `MockBookCore`: keep the existing 5-arg `setSeries(market, approved, expiry,
  ovrfloToken, underlying)` used by the three Book files, and add the 7-arg
  overload from `StreamPricing.t.sol` (explicit `ptToken`/`oracle`) so all call
  sites compile unchanged.
- `MockBookSablier`: superset of the four copies — ownership + approvals +
  `withdraw`/`setWithdrawable` (Book files) plus `setStreamWithStartTime`
  (StreamPricing). The `setStream` overload without an `owner` param (StreamPricing
  shape) is added alongside the 9-arg owned version.

Pre-implementation check: grep `expectRevert` for mock revert strings
(`"MockSablier: ..."` vs unprefixed `"not owner"`) before unifying messages; if
any test asserts a mock revert string, keep that exact string in the shared mock.

Deletes ~640 duplicated lines across the four files.

## Item 3: Shared `MockOvrfloAdmin` in `test/mocks/MockOvrfloAdmin.sol`

Merge the three admin stubs into one contract that is the superset:
constructor-initialized info (from `OVRFLOWrapUnwrap.t.sol`) plus `setInfo`, plus
the forwarders `approveSeries`, `sweepExcessUnderlying`, `setFlashFeeBps`,
`setFlashLoanPaused` (from `OVRFLOInvariant.t.sol`). The
`OVRFLOWrapUnwrap.invariant.t.sol` copy (a subset) is deleted. This also removes
the duplicate `InvariantOvrfloAdmin` / `InvariantMockERC20` contract names that
exist in two compilation units today.

## Item 4: Shared vault mock helpers base in `test/helpers/VaultMockHelpers.sol`

Abstract contract inheriting forge-std `Test`, holding the vm.mockCall
boilerplate currently copied in four suites:

```solidity
abstract contract VaultMockHelpers is Test {
    address internal constant PENDLE_ORACLE = 0x9a9F...50C2;
    address internal constant SABLIER_LL = 0xAFb9...dCC9;
    uint32 internal constant TWAP_DURATION = 30 minutes;

    function _mockRate(address market, uint256 rateE18) internal { ... }
    function _mockSablierCreate(address vault, address token, address recipient,
        uint128 amount, uint256 duration, uint256 streamId) internal returns (bytes memory callData) { ... }
    function _computeFee(uint256 amount, uint256 rateE18, uint16 feeBps) internal pure returns (uint256) { ... }
}
```

Notes:

- `_mockSablier` today closes over each file's `ovrflo`/`ovrfloToken` state
  variables; the shared version takes them as parameters. Each suite keeps a
  thin private `_mockSablier(recipient, amount, duration, streamId)` wrapper
  forwarding its own vault/token, so the ~30 call sites do not change.
- `OVRFLO.t.sol`'s copy additionally does `vm.expectCall`; the shared helper
  returns `callData` so that file's wrapper adds `vm.expectCall(SABLIER_LL, callData)`
  itself. Behavior per suite is unchanged.
- `OVRFLOProtocolTest`, `OVRFLOFlashLoanTest`, `OVRFLOFuzzTest`,
  `OVRFLOAttackScenariosTest` switch from `is Test` to `is VaultMockHelpers` and
  drop their local constants/helpers. The two invariant handlers keep their
  inline setUp mockCalls (different structure, handler-based; not worth forcing).

## Considered and rejected

- **Reusing `test/fizz/mocks/` for the unit suites:** the fizz suite must stay
  Echidna/Medusa-compatible and self-contained (no forge-std), and its
  `MockSablier` has different (time-based) semantics. Keep the two worlds
  separate; do not import across the boundary in either direction.
- **Consolidating the FlashBorrower variants** (`FlashBorrower`,
  `FuzzFlashBorrower`, `InvariantFlashBorrower`, `AttackFlashBorrower`,
  `ForkFlashBorrower`): each encodes a genuinely different behavior surface
  (full-featured repay control, action modes, configurable attack callbacks,
  fork semantics). Merging them means one config-flag monster; contrary to the
  simplicity preference. Leave as-is.
- **A common `BaseTest` with shared setUp/actors:** the suites intentionally
  build different worlds (mock-contract Book world vs vm.mockCall vault world).
  A shared setUp would obscure what each suite actually deploys.
- **Deduplicating event re-declarations** in test files: emitting
  `Contract.Event` style references depends on solc version guarantees beyond
  `^0.8.20`; not worth the churn for expectEmit declarations.
- **Single-use attack mocks** (`ReentrantUnderlying`, `ShortTransferUnderlying`,
  `MockPrincipalToken`, `MockPendleMarket` in `OVRFLOFactory.t.sol`,
  harnesses in `StreamPricing*.t.sol`): one consumer each, not duplication.
- **Fork suites:** already properly factored through `OVRFLOForkBase` /
  `script/lib/OVRFLOTestFixtures.sol`. No changes.
- **Adding missing tests (G-01..G-08):** coverage work, tracked in
  `SOLIDITY_TEST_REVIEW.md`, not part of this refactor.

## Migration order (one commit per step is fine)

1. Add `test/mocks/TestERC20.sol`, `test/mocks/BookMocks.sol`,
   `test/mocks/MockOvrfloAdmin.sol`, `test/helpers/VaultMockHelpers.sol`.
2. Migrate `OVRFLOBook.t.sol`, then `OVRFLOBookInvariant.t.sol`, then
   `OVRFLOAttackScenarios.t.sol`, then `StreamPricing.t.sol` onto the shared
   mocks, deleting local copies.
3. Migrate the vault suites onto `VaultMockHelpers`.
4. Migrate the admin mock users and delete duplicate-named contracts.

## Verification

1. `forge build` after each step (build first, per workflow preference).
2. `forge fmt` on touched files.
3. On approval, full pass: `forge test` (unit + fuzz 1000 runs + invariant 500
   runs depth 25 + attack scenarios). Fork and fizz suites untouched.
4. Test inventory must be identical before/after:
   `forge test --list | sort` diff shows zero added/removed tests.
5. Grep checks:
   - `rg "contract .*Mock(Factory|Core|Sablier)" test/*.t.sol` -> 0 matches
     (all moved to `test/mocks/`).
   - `rg "function _mockRate" test/*.t.sol` -> 0 matches outside
     `test/helpers/VaultMockHelpers.sol`.
   - `rg "InvariantOvrfloAdmin|InvariantMockERC20" test/` -> 0 matches
     (collision-prone names removed).
