// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOLending} from "../../src/OVRFLOLending.sol";
import {TestERC20} from "../mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "../mocks/LendingMocks.sol";

/// @notice Shared mock wiring for the lending fuzz, attack, and gas suites.
/// @dev Mirrors the `VaultMockHelpers` convention: inherit instead of `Test` to get
///      a deployed v1-lite book plus stream/lender helpers. The deployment order is
///      the same one `test/OVRFLOLending.t.sol` uses, so these suites and the unit
///      suite exercise identical fixture semantics.
///
///      Timing is chosen so acceptance values are exact: `expiry` is 73 days out
///      (`YEAR / 5`), so at `APR = 1000` the accrual factor is exactly
///      `1 + 0.10 * 0.2 = 1.02e18`. A stream with face `1.02x` therefore prices at
///      gross `x` with no rounding, which is what lets the suites assert concrete
///      values instead of tolerances.
abstract contract LendingMockFixture is Test {
    /// @dev Named distinctly from the vault suites' `TREASURY` so both fixtures can
    ///      coexist in one file without shadowing.
    address internal constant LENDING_TREASURY = address(0xBEE5);
    address internal constant MARKET = address(0x5555);

    uint16 internal constant APR = 1000;
    uint16 internal constant SPACING = 25;

    MockLendingFactory internal factory;
    MockLendingCore internal core;
    MockLendingSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    OVRFLOLending internal lending;
    uint256 internal expiry;

    /// @notice Deploys the book against mock registry/Sablier and sets tick spacing.
    /// @dev The constructor transfers ownership to the `factory_` argument (the mock
    ///      registry), not the deploying test contract, so suites must call
    ///      `setAprBounds` / `setFee` / `setTickSpacing` / `setTreasury` as
    ///      `vm.prank(address(factory))`.
    function _deployLendingSystem() internal {
        factory = new MockLendingFactory();
        core = new MockLendingCore();
        sablier = new MockLendingSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO Token", "OVRFLO");

        expiry = block.timestamp + 73 days;
        factory.setInfo(address(core), LENDING_TREASURY, address(underlying), address(ovrfloToken));
        core.setSeries(MARKET, expiry, address(ovrfloToken), address(underlying));

        lending = new OVRFLOLending(address(factory), address(core), address(sablier), APR);
        vm.prank(address(factory));
        lending.setTickSpacing(MARKET, SPACING);
    }

    /// @notice Mints ovrfloToken to `who` and grants the book an unlimited allowance.
    /// @dev Supply, withdraw, and repay all move ovrfloToken after the denomination switch.
    function _fundLender(address who, uint256 amount) internal {
        ovrfloToken.mint(who, amount);
        vm.prank(who);
        ovrfloToken.approve(address(lending), type(uint256).max);
    }

    /// @notice Alias of `_fundLender` — repay uses the same ovrfloToken path.
    function _fundRepayer(address who, uint256 amount) internal {
        _fundLender(who, amount);
    }

    /// @notice Creates a `requireEligible`-passing stream owned by `owner`.
    /// @dev Sender is the core vault, asset is the series ovrfloToken, end time is the
    ///      cached expiry, cliff is absent (the mock maps `cliffTime == 0` onto
    ///      `startTime`), and the stream is non-cancelable — the five properties
    ///      `StreamPricing.requireEligible` checks. The book is approved for the NFT so
    ///      `borrow`'s plain `transferFrom` escrow succeeds.
    function _createStream(uint256 streamId, address owner, uint128 deposited) internal {
        sablier.setStream(
            streamId, owner, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, deposited, 0
        );
        vm.prank(owner);
        sablier.approve(address(lending), streamId);
    }

    /// @notice Face value whose discounted gross price is exactly `gross` at `APR`.
    /// @dev Inverse of `StreamPricing.grossPrice` at the fixture's pinned 1.02 factor.
    function _faceForGross(uint128 gross) internal pure returns (uint128) {
        return uint128((uint256(gross) * 102) / 100);
    }

    /// @notice The book's live outstanding for a loan.
    function _outstandingOf(uint256 loanId) internal view returns (uint128 outstanding) {
        (, outstanding) = lending.loanState(loanId);
    }
}
