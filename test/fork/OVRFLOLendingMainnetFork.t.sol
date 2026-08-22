// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOLending} from "../../src/OVRFLOLending.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {StreamPricing} from "../../src/StreamPricing.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

/// @notice Recipient contract that records whether Sablier invoked its withdraw hook.
/// @dev Exists to make assumption row S5 in `docs/audit/sablier-interface-contract.md`
///      falsifiable rather than asserted. v1.1 calls `onStreamWithdrawn` only when the
///      recipient is a contract AND `msg.sender != recipient`; the book always withdraws
///      from a stream it currently owns, so that predicate is false at every OVRFLO call
///      site and the callback surface is empty. This probe checks both branches.
contract StreamHookProbe {
    bool public hookFired;

    function onStreamWithdrawn(uint256, address, address, uint128) external {
        hookFired = true;
    }

    function reset() external {
        hookFired = false;
    }

    function withdrawToSelf(address sablier, uint256 streamId, uint128 amount) external {
        ISablierV2LockupLinear(sablier).withdraw(streamId, address(this), amount);
    }

    /// @dev `ISablierV2LockupLinear` does not surface the ERC-721 `approve`, so the raw
    ///      call is the only route — same reason the suite's `_approveStream` uses one.
    function approveOperator(address sablier, address operator, uint256 streamId) external {
        (bool ok,) = sablier.call(abi.encodeWithSignature("approve(address,uint256)", operator, streamId));
        require(ok, "probe: approve failed");
    }
}

/// @title OVRFLOLendingMainnetForkTest
/// @notice Sablier V2 v1.1 custody assertions for the v1-lite book, against real mainnet
///         Pendle markets and the pinned Sablier deployment.
/// @dev PORTED, not rewritten (plan risk #8). The pre-rewrite suite encoded v1.1 ACL edge
///      cases that a delete-and-rewrite would silently lose — in particular the
///      version-discriminating "push a withdrawal TO the recipient" probe, which is the
///      only one of the four negative cases that actually distinguishes v1.1 from the
///      later permissionless-withdraw ACL described in newer Sablier docs. Those probes
///      are carried over verbatim in substance; only the escrow entry point changed,
///      because `postSaleListing` no longer exists and `borrow` is now the sole path that
///      moves a stream NFT into the book.
///
///      Defines no `setUp()` — it inherits `OVRFLOForkBase`'s, which is where the
///      `MAINNET_RPC_URL` skip gate lives. Overriding it without `super.setUp()` would
///      silently drop that gate. Stream-layer bytecode is the committed OVRFLOStream
///      artifact (`Covers AE4.` against real fork bytecode, not the mock).
contract OVRFLOLendingMainnetForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    address internal constant LENDER = address(0xCAFE);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint256 internal constant PT_AMOUNT = 10 ether;

    /// @dev 1000 bps is the book's launch APR and both default bounds; 25 divides it, so
    ///      the tick is valid without widening the bounds.
    uint16 internal constant APR = 1000;
    uint16 internal constant SPACING = 25;

    /*//////////////////////////////////////////////////////////////
        SABLIER V2 v1.1 WITHDRAW ACL DURING BOOK ESCROW
    //////////////////////////////////////////////////////////////*/

    /// @notice No third party can withdraw from a stream escrowed by the book.
    /// @dev Covers AE4 against real OVRFLOStream bytecode. The four negative cases
    ///      below are the ported core of this suite. The first
    ///      three all pass `to == caller`, which reverts under v1.1 AND under the later
    ///      ACL that made `to == recipient` permissionless — so on their own they cannot
    ///      tell the two versions apart. The fourth pushes a withdrawal TO the recipient
    ///      (the book), which is exactly what audit-2026-07-28 H-1 claims a third party
    ///      can do: permitted post-v1.1, refused by the v1.1 bytecode deployed here. That
    ///      case is the whole reason this test exists; do not drop it as redundant.
    function test_LendingEscrow_StrangerCannotWithdrawFromEscrowedStream() public {
        (OVRFLOLending lending, ISablierV2LockupLinear sablier, uint256 streamId,) = _escrowStreamViaBorrow();

        assertEq(sablier.ownerOf(streamId), address(lending), "book should hold the NFT");

        uint256 claimTimestamp = block.timestamp + (PRIMARY_EXPIRY - block.timestamp) / 4;
        vm.warp(claimTimestamp);
        uint128 withdrawable = sablier.withdrawableAmountOf(streamId);
        assertGt(withdrawable, 0, "stream should have accrual");

        address stranger = makeAddr("stranger");

        vm.prank(stranger);
        (bool ok,) =
            address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, stranger, withdrawable)));
        assertFalse(ok, "stranger should not be able to withdraw");

        // The borrower no longer owns the NFT while the loan is open.
        vm.prank(USER);
        (ok,) = address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, USER, withdrawable)));
        assertFalse(ok, "borrower should not be able to withdraw during escrow");

        // A lender is not the NFT owner either — lenders are paid through `claim`.
        vm.prank(LENDER);
        (ok,) = address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, LENDER, withdrawable)));
        assertFalse(ok, "lender should not be able to withdraw");

        // The version-discriminating case. See the doc comment above.
        vm.prank(stranger);
        (ok,) = address(sablier)
            .call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, address(lending), withdrawable)));
        assertFalse(ok, "stranger must not push a withdrawal to the recipient (v1.1 ACL, disproves H-1)");

        assertEq(sablier.getWithdrawnAmount(streamId), 0, "no withdrawal should have succeeded");
    }

    /*//////////////////////////////////////////////////////////////
                        NFT OWNER TRANSITIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice NFT ownership walks user -> book -> borrower across the permissionless close.
    /// @dev The custody half of the self-repaying-loan design: the book takes the stream
    ///      at `borrow`, draws the outstanding from it once the accrual covers the debt,
    ///      and hands it straight back. Balances are asserted alongside ownership
    ///      (pattern #6) because ownership alone would pass even if the drawn value
    ///      never reached the book.
    function test_LendingLoan_NftOwnerTransitionsThroughClose() public {
        (OVRFLOLending lending, ISablierV2LockupLinear sablier, uint256 streamId, uint256 loanId) =
            _escrowStreamViaBorrow();

        assertEq(sablier.ownerOf(streamId), address(lending), "book should hold the NFT during the loan");
        (, uint128 outstandingBefore) = lending.loanState(loanId);
        assertGt(outstandingBefore, 0, "loan should carry an obligation");

        // At maturity the whole remaining face is withdrawable, so the loan is coverable.
        vm.warp(PRIMARY_EXPIRY);
        assertGe(sablier.withdrawableAmountOf(streamId), outstandingBefore, "stream should cover the outstanding");

        uint256 bookTokenBefore = IERC20(lending.ovrfloToken()).balanceOf(address(lending));
        lending.close(loanId);

        (OVRFLOLending.Loan memory loan, uint128 outstandingAfter) = lending.loanState(loanId);
        assertTrue(loan.closed, "loan should be closed");
        assertEq(outstandingAfter, 0, "outstanding should be settled");
        assertEq(loan.drawn, outstandingBefore, "drawn should equal what was owed");
        assertEq(
            IERC20(lending.ovrfloToken()).balanceOf(address(lending)) - bookTokenBefore,
            outstandingBefore,
            "drawn value did not reach the book"
        );
        assertEq(sablier.ownerOf(streamId), USER, "stream should return to the borrower");
    }

    /// @notice NFT ownership walks user -> book -> borrower across a full repayment.
    /// @dev The other closure path. `Closed` fires on both, and the stream returns on
    ///      both — the 2026-08-08 uniform-closure decision. Repayment is funded by
    ///      wrapping wstETH into ovrfloToken, which is the route a real borrower takes.
    function test_LendingLoan_NftOwnerTransitionsThroughFullRepay() public {
        (OVRFLOLending lending, ISablierV2LockupLinear sablier, uint256 streamId, uint256 loanId) =
            _escrowStreamViaBorrow();
        OVRFLO ovrflo = OVRFLO(lending.core());
        OVRFLOToken token = OVRFLOToken(lending.ovrfloToken());

        assertEq(sablier.ownerOf(streamId), address(lending), "book should hold the NFT during the loan");
        (, uint128 outstanding) = lending.loanState(loanId);

        _seedWstEth(USER, outstanding);
        vm.startPrank(USER);
        IERC20(WSTETH).approve(address(ovrflo), outstanding);
        ovrflo.wrap(outstanding);
        token.approve(address(lending), outstanding);
        lending.repay(loanId, outstanding);
        vm.stopPrank();

        (OVRFLOLending.Loan memory loan, uint128 outstandingAfter) = lending.loanState(loanId);
        assertTrue(loan.closed, "full repay should close the loan");
        assertEq(outstandingAfter, 0, "outstanding should be zero after full repay");
        assertEq(loan.drawn, 0, "repay must not draw from the stream");
        assertEq(loan.repaid, outstanding, "repaid should equal the outstanding");
        assertEq(sablier.ownerOf(streamId), USER, "stream should return to the borrower");
        assertEq(sablier.getWithdrawnAmount(streamId), 0, "repay path must leave the stream untouched");
    }

    /*//////////////////////////////////////////////////////////////
            S5 — WITHDRAW FIRES NO HOOK WHEN CALLER IS RECIPIENT
    //////////////////////////////////////////////////////////////*/

    /// @notice Pins assumption row S5: v1.1 skips the recipient hook when caller == recipient.
    /// @dev This is what makes the book's callback surface empty, and it is stated in the
    ///      interface contract as a falsifiable claim rather than a guarantee. Both
    ///      branches are exercised so the test cannot pass vacuously: an approved
    ///      operator withdrawing on the probe's behalf MUST fire the hook (proving the
    ///      probe's hook works at all), and the probe withdrawing for itself MUST NOT.
    ///      Every OVRFLO `withdraw` call site is the second shape.
    function test_SablierV1_1_WithdrawHookSkippedWhenCallerIsRecipient() public {
        (, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        ISablierV2LockupLinear sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, uint256 streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        StreamHookProbe probe = new StreamHookProbe();
        vm.prank(USER);
        sablier.transferFrom(USER, address(probe), streamId);
        assertEq(sablier.ownerOf(streamId), address(probe), "probe should hold the NFT");

        vm.warp(block.timestamp + (PRIMARY_EXPIRY - block.timestamp) / 4);
        uint128 accrued = sablier.withdrawableAmountOf(streamId);
        assertGt(accrued, 0, "stream should have accrual");
        uint128 slice = accrued / 4;
        assertGt(slice, 0, "slice must be non-zero for the probe to be meaningful");

        // Positive control: caller != recipient, so the hook MUST fire. Without this the
        // negative assertion below would pass even if the probe's hook were unreachable.
        address operator = makeAddr("operator");
        probe.approveOperator(address(sablier), operator, streamId);
        vm.prank(operator);
        sablier.withdraw(streamId, address(probe), slice);
        assertTrue(probe.hookFired(), "v1.1 should call onStreamWithdrawn when caller != recipient");

        // The OVRFLO shape: the recipient withdraws to itself, so the hook is skipped.
        probe.reset();
        probe.withdrawToSelf(address(sablier), streamId, slice);
        assertFalse(probe.hookFired(), "v1.1 must not call onStreamWithdrawn when caller == recipient");
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Full path to an escrowed stream: approved series, configured book, resting
    ///      lender liquidity, and a borrow that moves the NFT into the book.
    function _escrowStreamViaBorrow()
        internal
        returns (OVRFLOLending lending, ISablierV2LockupLinear sablier, uint256 streamId, uint256 loanId)
    {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployApprovedPrimarySeries(0);
        lending = _deployLending(factory, ovrflo);
        sablier = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        (,, streamId) = _depositPrimary(ovrflo, PT_AMOUNT);

        // Size the fill off the stream's own discounted value so the borrow is never
        // silently truncated by the price cap. Half the gross price keeps the loan a
        // genuine partial fill, which is the interesting case for the close path.
        uint128 target = _halfGrossPriceUnitAligned(sablier, streamId);

        _seedWstEth(LENDER, target);
        vm.startPrank(LENDER);
        IERC20(WSTETH).approve(address(lending), target);
        lending.supply(PRIMARY_MARKET, APR, target);
        vm.stopPrank();

        vm.prank(USER);
        _approveStream(address(sablier), address(lending), streamId);
        vm.prank(USER);
        loanId = lending.borrow(PRIMARY_MARKET, APR, target, streamId, 0);
    }

    /// @dev Half the stream's discounted gross price, floored onto the UNIT lattice and
    ///      above the book's minimum. Uses the same `StreamPricing` the book uses, so the
    ///      test never re-derives pricing math the plan forbids re-deriving.
    function _halfGrossPriceUnitAligned(ISablierV2LockupLinear sablier, uint256 streamId)
        internal
        view
        returns (uint128)
    {
        ISablierV2LockupLinear.Stream memory stream = sablier.getStream(streamId);
        uint128 remaining = stream.amounts.deposited - stream.amounts.withdrawn;
        uint256 gross = StreamPricing.grossPrice(remaining, APR, PRIMARY_EXPIRY - block.timestamp);

        uint256 unit = 1e12; // OVRFLOLending.UNIT
        // forge-lint: disable-next-line(divide-before-multiply) — flooring to a UNIT multiple is the point.
        uint128 target = uint128((gross / 2 / unit) * unit);
        require(target >= 1e15, "fork fixture: stream too small to borrow against");
        return target;
    }

    function _deployApprovedPrimarySeries(uint16 feeBps)
        internal
        returns (OVRFLOFactory factory, OVRFLO ovrflo, OVRFLOToken token)
    {
        (factory, ovrflo, token) = _deployConfiguredSystem();

        vm.startPrank(OWNER);
        factory.prepareOracle(PRIMARY_MARKET, PROTOCOL_TWAP_DURATION);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, PROTOCOL_TWAP_DURATION, feeBps);
        vm.stopPrank();
    }

    /// @dev The constructor transfers ownership to the `factory` argument, not the
    ///      deploying test contract, so setting spacing must be pranked as the factory.
    function _deployLending(OVRFLOFactory factory, OVRFLO ovrflo) internal returns (OVRFLOLending lending) {
        lending = new OVRFLOLending(address(factory), address(ovrflo), address(ovrflo.sablierLL()), APR);
        vm.prank(address(factory));
        lending.setTickSpacing(PRIMARY_MARKET, SPACING);
    }

    function _depositPrimary(OVRFLO ovrflo, uint256 ptAmount)
        internal
        returns (uint256 toUser, uint256 toStream, uint256 streamId)
    {
        (uint256 expectedToUser,,,) = ovrflo.previewDeposit(PRIMARY_MARKET, ptAmount);
        deal(PRIMARY_PT, USER, ptAmount);

        vm.startPrank(USER);
        IERC20(PRIMARY_PT).approve(address(ovrflo), ptAmount);
        (toUser, toStream, streamId) = ovrflo.deposit(PRIMARY_MARKET, ptAmount, expectedToUser);
        vm.stopPrank();
    }

    /// @dev `ISablierV2LockupLinear` does not expose the ERC-721 `approve`, so this goes
    ///      through a raw call rather than the typed interface.
    function _approveStream(address sablier, address spender, uint256 streamId) internal {
        (bool success,) = sablier.call(abi.encodeWithSignature("approve(address,uint256)", spender, streamId));
        assertTrue(success);
    }
}
