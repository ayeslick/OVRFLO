// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISablierV2LockupLinear} from "../../../interfaces/ISablierV2LockupLinear.sol";
import {MockFlashBorrower} from "../mocks/MockFlashBorrower.sol";

/// @notice Handles the interaction with OVRFLO
abstract contract OVRFLOHandler is Properties {

    MockFlashBorrower public mockFlashBorrower;

    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function oVRFLO_deposit_clamped(address, uint256 ptAmount, uint256) public {
        ptAmount = clampBetween(ptAmount, vault.MIN_PT_AMOUNT(), ptToken.balanceOf(actor));
        if (ptAmount < vault.MIN_PT_AMOUNT()) return;
        oVRFLO_deposit(market, ptAmount, 0);
    }

    function oVRFLO_claim_clamped(address, uint256 amount) public {
        uint256 bal = ovrfloToken.balanceOf(actor);
        amount = clampBetween(amount, 1, bal);
        if (amount == 0) return;
        oVRFLO_claim(address(ptToken), amount);
    }

    function oVRFLO_wrap_clamped(uint256 amount) public {
        amount = clampBetween(amount, 1, underlying.balanceOf(actor));
        if (amount == 0) return;
        oVRFLO_wrap(amount);
    }

    function oVRFLO_unwrap_clamped(uint256 amount) public {
        amount = clampBetween(amount, 1, ovrfloToken.balanceOf(actor));
        if (amount == 0) return;
        oVRFLO_unwrap(amount);
    }

    function oVRFLO_flashLoan_clamped(address, uint256 amount, bytes memory data) public {
        uint256 vaultPt = ptToken.balanceOf(address(vault));
        amount = clampBetween(amount, 1, vaultPt);
        if (amount == 0) return;

        if (address(mockFlashBorrower) == address(0)) {
            mockFlashBorrower = new MockFlashBorrower(
                address(vault), address(ptToken), address(underlying), market
            );
            mockFlashBorrowerAddr = address(mockFlashBorrower);
        }

        // Seed borrower with underlying for fee and PT for reentrancy deposit
        underlying.deal(address(mockFlashBorrower), 1e18);
        ptToken.deal(address(mockFlashBorrower), 1e6);

        // Use non-reentrancy mode for clamped handler; reentrancy is exercised
        // only in scenario_flashLoanReentrancy which has its own assertions
        bytes memory flashData = abi.encode(false);

        snapshotBefore();
        vm.prank(actor);
        mockFlashBorrower.executeFlashLoan(amount, flashData);
        snapshotAfter();

        ghosts.ghost_flashFeePaid = 0;
        property_flashLoanAtomicRepay();
        property_flashLoanMtdUnchanged();
        property_flashLoanPreMaturity();
        property_flashLoanWrappedUnchanged();
        property_flashLoanNoFreeProfit();
    }

    function fizz_skipTime(uint256 amount) public {
        skipTime(amount % 365 days);
    }

    function oVRFLO_transfer(uint256 toSeed, uint256 amount) public asActor {
        address to = toActor(address(uint160(toSeed)));
        uint256 balBefore = ovrfloToken.balanceOf(actor);
        uint256 supplyBefore = ovrfloToken.totalSupply();

        // GL-62: zero-amount transfer is a no-op
        if (amount == 0) {
            require(ovrfloToken.transfer(to, 0), "transfer failed");
            property_zero_transfer_noop(balBefore, supplyBefore);
            return;
        }

        amount = clampBetween(amount, 1, balBefore);
        if (amount == 0) return;

        require(ovrfloToken.transfer(to, amount), "transfer failed");

        // GL-61: self-transfer is a no-op
        if (to == actor) {
            property_self_transfer_noop(balBefore, supplyBefore);
        }
    }

    function oVRFLO_secondary(uint8 selector, uint256 arg0, address arg1, address arg2) public {
        selector = uint8(selector % 7);
        if (selector == 0) _oVRFLO_setMarketDepositLimit(arg1, arg0);
        else if (selector == 1) _oVRFLO_setFlashFeeBps(uint16(arg0));
        else if (selector == 2) _oVRFLO_setFlashLoanPaused(arg0 > 0);
        else if (selector == 3) _oVRFLO_sweepExcessPt(arg1, arg2);
        else if (selector == 4) _oVRFLO_sweepExcessUnderlying(arg1);
        else if (selector == 5) _oVRFLO_setOracleRate(arg0);
        else _oVRFLO_prepareOracle(uint32(arg0));
        // SP-69: Non-admin cannot call vault admin functions
        property_nonAdminCannotCallVaultAdmin();
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function oVRFLO_deposit(address _market, uint256 ptAmount, uint256 minToUser) public asActor {
        snapshotBefore();
        (uint256 toUser, uint256 toStream, uint256 streamId) = vault.deposit(_market, ptAmount, minToUser);
        ghosts.ghost_lastStreamId = streamId;
        snapshotAfter();
        // Ghost updates
        uint256 prevToUser = ghosts.ghost_lastToUser;
        uint256 prevPtAmount = ghosts.ghost_lastDepositPtAmount;
        uint256 prevRate = ghosts.ghost_lastOracleRate;
        ghosts.ghost_lastToUser = toUser;
        ghosts.ghost_lastDepositPtAmount = ptAmount;
        ghosts.ghost_lastOracleRate = mockOracle.rate();
        ghost_hasDeposited[actor] = true;
        (, , uint16 feeBps, , , , , ) = vault.series(_market);
        uint256 feeAmount = feeBps == 0 ? 0 : toUser * feeBps / 10_000;
        ghosts.ghost_depositFeePaid = feeAmount;
        ghosts.ghost_totalDepositFees += feeAmount;
        // Property assertions
        property_depositConservesSplit(toUser, toStream, ptAmount);
        property_depositToUserCapped(toUser, ptAmount);
        property_depositFeeFloored(feeAmount, toUser, feeBps);
        property_depositIncreasesMtd(ptAmount);
        property_depositWrappedUnchanged();
        property_depositPreMaturity(_market);
        property_noShareInflation(prevToUser, prevPtAmount, toUser, ptAmount, prevRate);
        property_previewDepositMatches(toUser, toStream, feeAmount, _market, ptAmount);
        property_previewStreamMatches(toUser, toStream, _market, ptAmount);
        property_depositFloorsToUser(toUser, ptAmount, _market);
        property_deposit_liveness(ptAmount);
    }

    function oVRFLO_claim(address ptToken_, uint256 amount) public asActor {
        snapshotBefore();
        vault.claim(ptToken_, amount);
        snapshotAfter();
        // Property assertions
        property_claimDecreasesMtd(amount);
        property_claimPostMaturity(ptToken_);
        property_claimWrappedUnchanged();
        property_claimExactOneToOne(amount);
        property_lowLimitNoBrickClaim();
    }

    function oVRFLO_wrap(uint256 amount) public asActor {
        snapshotBefore();
        vault.wrap(amount);
        snapshotAfter();
        // Ghost updates
        ghost_hasWrapped[actor] = true;
        // Property assertions
        property_wrapIncreasesWrapped(amount);
        property_wrapMtdUnchanged();
    }

    function oVRFLO_unwrap(uint256 amount) public asActor {
        snapshotBefore();
        vault.unwrap(amount);
        snapshotAfter();
        // Property assertions
        property_unwrapDecreasesWrapped(amount);
        property_unwrapMtdUnchanged();
    }

    function oVRFLO_flashLoan(address ptToken_, uint256 amount, bytes memory data) public asActor {
        snapshotBefore();
        // Approve vault for PT repayment and underlying fee before flash
        IERC20(ptToken_).approve(address(vault), type(uint256).max);
        underlying.approve(address(vault), type(uint256).max);
        vault.flashLoan(ptToken_, amount, data);
        snapshotAfter();
        // Ghost updates
        uint256 fee = stateBefore.actorUnderlying - stateAfter.actorUnderlying;
        ghosts.ghost_flashFeePaid = fee;
        ghosts.ghost_totalFlashFees += fee;
        // Property assertions
        property_flashLoanAtomicRepay();
        property_flashLoanFeeFloored(fee, amount);
        property_flashLoanMtdUnchanged();
        property_flashLoanPreMaturity();
        property_flashLoanWrappedUnchanged();
        property_flashLoanNoFreeProfit();
    }

    // ――――――――――――――――――― Admin (via factory) ―――――――――――――――――――

    function _oVRFLO_setMarketDepositLimit(address _market, uint256 limit) internal asAdmin {
        factory.setMarketDepositLimit(address(vault), _market, limit);
    }

    function _oVRFLO_setFlashFeeBps(uint16 feeBps) internal asAdmin {
        snapshotBefore();
        try factory.setFlashFeeBps(address(vault), feeBps) {
            snapshotAfter();
            property_setFlashFeeBpsCorrect(feeBps);
        } catch {}
    }

    function _oVRFLO_setFlashLoanPaused(bool paused) internal asAdmin {
        snapshotBefore();
        factory.setFlashLoanPaused(address(vault), paused);
        snapshotAfter();
        property_setFlashLoanPausedCorrect(paused);
    }

    function _oVRFLO_sweepExcessPt(address ptToken_, address to) internal asAdmin {
        snapshotBefore();
        try factory.sweepExcessPt(address(vault), ptToken_, to) {
            snapshotAfter();
            property_sweepExcessPtMtdUnchanged();
        } catch {}
        property_sweepExcessPt_reverts_non_pt();
    }

    function _oVRFLO_sweepExcessUnderlying(address to) internal asAdmin {
        snapshotBefore();
        try factory.sweepExcessUnderlying(address(vault), to) {
            snapshotAfter();
            property_sweepExcessUnderlyingWrappedUnchanged();
        } catch {}
    }

    function _oVRFLO_setOracleRate(uint256 rateRaw) internal {
        uint256 rate = clampBetween(rateRaw, 0.8e18, 1.02e18);
        mockOracle.setRate(rate);
    }

    function _oVRFLO_prepareOracle(uint32 twapDuration) internal asAdmin {
        try factory.prepareOracle(market, twapDuration) {} catch {}
    }

    // ―――――――――――――――――――― Round-trip handlers ――――――――――――――――――――

    /// @notice SP-01, SP-06: wrap -> unwrap returns exactly same underlying
    function roundTrip_wrapUnwrap(uint256 amount) public {
        amount = clampBetween(amount, 1, underlying.balanceOf(actor));
        if (amount == 0) return;

        uint256 underlyingBefore = underlying.balanceOf(actor);

        vm.prank(actor);
        vault.wrap(amount);

        vm.prank(actor);
        vault.unwrap(amount);

        uint256 underlyingAfter = underlying.balanceOf(actor);
        property_wrapUnwrapRoundTrip(underlyingBefore, underlyingAfter);
    }

    /// @notice SP-02: unwrap -> wrap returns exactly same ovrfloToken
    function roundTrip_unwrapWrap(uint256 amount) public {
        amount = clampBetween(amount, 1, underlying.balanceOf(actor));
        if (amount == 0) return;

        // First wrap to get ovrfloToken
        vm.prank(actor);
        vault.wrap(amount);

        uint256 ovrfloBefore = ovrfloToken.balanceOf(actor);

        vm.prank(actor);
        vault.unwrap(amount);

        vm.prank(actor);
        vault.wrap(amount);

        uint256 ovrfloAfter = ovrfloToken.balanceOf(actor);
        property_unwrapWrapRoundTrip(ovrfloBefore, ovrfloAfter);
    }

    /// @notice SP-05, SP-61: deposit -> claim cycle conserves value, MTD returns to pre-deposit
    function roundTrip_depositClaim(uint256 ptAmount) public {
        ptAmount = clampBetween(ptAmount, vault.MIN_PT_AMOUNT(), ptToken.balanceOf(actor));
        if (ptAmount < vault.MIN_PT_AMOUNT()) return;

        uint256 ptBefore = ptToken.balanceOf(actor);
        uint256 ovrfloBefore = ovrfloToken.balanceOf(actor);

        // Deposit as actor
        vm.startPrank(actor);
        (,, uint256 streamId) = vault.deposit(market, ptAmount, 0);
        vm.stopPrank();

        // Skip to maturity
        (, , , uint256 expiry, , , , ) = vault.series(market);
        if (block.timestamp < expiry) {
            skipTime(expiry - block.timestamp + 1);
        }

        // Withdraw from stream (actor is the recipient/owner)
        bool streamWithdrawn = false;
        uint128 withdrawable = ISablierV2LockupLinear(SABLIER_ADDR).withdrawableAmountOf(streamId);
        if (withdrawable > 0) {
            vm.prank(actor);
            try ISablierV2LockupLinear(SABLIER_ADDR).withdraw(streamId, actor, withdrawable) {
                streamWithdrawn = true;
            } catch {}
        }

        // Claim all ovrfloToken
        bool claimSucceeded = false;
        uint256 ovrfloBal = ovrfloToken.balanceOf(actor);
        uint256 claimAmount = ovrfloBal > ovrfloBefore ? ovrfloBal - ovrfloBefore : 0;
        if (claimAmount > 0) {
            vm.startPrank(actor);
            try vault.claim(address(ptToken), claimAmount) {
                claimSucceeded = true;
            } catch {}
            vm.stopPrank();
        }

        uint256 ptAfter = ptToken.balanceOf(actor);

        // Only check conservation if full round-trip completed
        if (streamWithdrawn && claimSucceeded) {
            property_depositClaimRoundTrip(ptBefore, ptAfter, 0, 0, 0);
        }
    }

    /// @notice R16: Flash loan reentrancy scenario - exercises deposit during flash loan callback
    function scenario_flashLoanReentrancy(uint256 amount) public {
        uint256 vaultPt = ptToken.balanceOf(address(vault));
        if (vaultPt == 0) return;
        amount = clampBetween(amount, 1, vaultPt);
        if (amount == 0) return;

        if (address(mockFlashBorrower) == address(0)) {
            mockFlashBorrower = new MockFlashBorrower(
                address(vault), address(ptToken), address(underlying), market
            );
            mockFlashBorrowerAddr = address(mockFlashBorrower);
        }

        underlying.deal(address(mockFlashBorrower), 1e18);
        ptToken.deal(address(mockFlashBorrower), 1e6);

        uint256 mtdBefore = vault.marketTotalDeposited(market);
        uint256 wrappedBefore = vault.wrappedUnderlying();
        uint256 supplyBefore = ovrfloToken.totalSupply();

        snapshotBefore();
        vm.prank(actor);
        try mockFlashBorrower.executeFlashLoan(amount, abi.encode(true)) {
            snapshotAfter();
            // Assert vault state consistency after reentrant deposit
            eq(ovrfloToken.totalSupply(), vault.marketTotalDeposited(market) + vault.wrappedUnderlying(),
               "R16: totalSupply != MTD + wrapped after reentrancy");
            // MTD may increase from the reentrant deposit, wrappedUnderlying should not change
            eq(vault.wrappedUnderlying(), wrappedBefore, "R16: wrappedUnderlying changed in reentrancy");
        } catch {}
    }
}
