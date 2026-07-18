// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";

/// @notice Handler that randomly calls Lending operations to test loan/liquidity invariants.
contract OVRFLOLendingInvariantHandler is Test {
    OVRFLOLending internal lending;
    MockLendingSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    MockLendingFactory internal factory;
    MockLendingCore internal core;

    address internal constant MARKET = address(0x5555);
    uint256 internal expiry;
    uint16 internal constant APR = 1000;

    address[3] internal actors;
    uint256 internal nextStreamId = 10_000;

    // Ghost state: track escrowed liquidity availableLiquidity (unified liquidityPositions)
    uint256 public totalActiveLiquidityCapacity;

    // Ghost state for R6/R7/R8: per-loan tracking
    struct LoanGhost {
        uint128 obligation;
        uint128 remainingAtOrigination;
        uint128 lenderReceived;
        address borrower;
        address lender;
        uint256 streamId;
        bool closed;
    }
    mapping(uint256 => LoanGhost) public loanGhosts;

    constructor(
        OVRFLOLending lending_,
        MockLendingSablier sablier_,
        TestERC20 underlying_,
        TestERC20 ovrfloToken_,
        MockLendingFactory factory_,
        MockLendingCore core_,
        uint256 expiry_
    ) {
        lending = lending_;
        sablier = sablier_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
        factory = factory_;
        core = core_;
        expiry = expiry_;

        actors = [makeAddr("lendingActorA"), makeAddr("lendingActorB"), makeAddr("lendingActorC")];

        for (uint256 i = 0; i < 3; i++) {
            underlying.mint(actors[i], 10_000 ether);
            ovrfloToken.mint(actors[i], 10_000 ether);
            vm.startPrank(actors[i]);
            underlying.approve(address(lending), type(uint256).max);
            ovrfloToken.approve(address(lending), type(uint256).max);
            sablier.setApprovalForAll(address(lending), true);
            vm.stopPrank();
        }
    }

    /*//////////////////////////////////////////////////////////////
                            OFFERS
    //////////////////////////////////////////////////////////////*/

    function supplyLiquidity(uint256 actorSeed, uint256 capSeed) public {
        address actor = _actor(actorSeed);
        uint128 availableLiquidity = uint128(bound(capSeed, 1, 50 ether));

        vm.prank(actor);
        lending.supplyLiquidity(MARKET, APR, availableLiquidity);

        totalActiveLiquidityCapacity += availableLiquidity;
    }

    function withdrawLiquidity(uint256 liquidityIdSeed) public {
        if (lending.nextLiquidityId() == 1) return;
        uint256 liquidityId = bound(liquidityIdSeed, 1, lending.nextLiquidityId() - 1);
        (address lender,,, uint128 availableLiquidity, bool active) = lending.liquidityPositions(liquidityId);
        if (!active) return;

        vm.prank(lender);
        lending.withdrawLiquidity(liquidityId);

        totalActiveLiquidityCapacity -= availableLiquidity;
    }

    function sellStreamToLiquidity(uint256 liquidityIdSeed) public {
        if (lending.nextLiquidityId() == 1) return;
        uint256 liquidityId = bound(liquidityIdSeed, 1, lending.nextLiquidityId() - 1);
        (, address market, uint16 aprBps, uint128 availableLiquidity, bool active) =
            lending.liquidityPositions(liquidityId);
        if (!active || availableLiquidity == 0) return;

        address actor = _actor(liquidityIdSeed);
        uint256 streamId = _createStream(actor);

        (uint256 grossPrice,,,,) = lending.quote(market, streamId, aprBps, 0);
        if (grossPrice == 0 || grossPrice > availableLiquidity) return;

        vm.prank(actor);
        lending.sellStreamToLiquidity(liquidityId, streamId, 0);

        totalActiveLiquidityCapacity -= grossPrice;
    }

    /*//////////////////////////////////////////////////////////////
                        SALE LISTINGS
    //////////////////////////////////////////////////////////////*/

    function postSaleListing(uint256 actorSeed) public {
        address actor = _actor(actorSeed);
        uint256 streamId = _createStream(actor);

        vm.prank(actor);
        lending.postSaleListing(MARKET, streamId, APR);
    }

    function cancelSaleListing(uint256 listingIdSeed) public {
        if (lending.nextSaleListingId() == 1) return;
        uint256 listingId = bound(listingIdSeed, 1, lending.nextSaleListingId() - 1);
        (address lender,,,,, bool active) = lending.saleListings(listingId);
        if (!active) return;

        vm.prank(lender);
        lending.cancelSaleListing(listingId);
    }

    function buyListing(uint256 listingIdSeed, uint256 actorSeed) public {
        if (lending.nextSaleListingId() == 1) return;
        uint256 listingId = bound(listingIdSeed, 1, lending.nextSaleListingId() - 1);
        (,,,,, bool active) = lending.saleListings(listingId);
        if (!active) return;

        address buyer = _actor(actorSeed);
        vm.prank(buyer);
        try lending.buyListing(listingId, type(uint256).max) {} catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        BORROW POOLS
    //////////////////////////////////////////////////////////////*/

    /// @dev R13: posts liquidityPositions from a non-borrower actor, pledges an eligible stream,
    ///      and borrows against a subset. A different actor posts the liquidityPositions than the
    ///      one calling `createBorrowerLoanPool` to avoid the self-match guard (pattern #4).
    ///      LiquidityPosition IDs are strictly increasing by construction (pattern #11). Ghost
    ///      variables track escrowed liquidity availableLiquidity and total pool obligations.
    function createBorrowerLoanPool(
        uint256 borrowerSeed,
        uint256 numLiquiditysSeed,
        uint256 capSeed,
        uint256 targetSeed,
        uint256 minSeed
    ) public {
        address borrower = _actor(borrowerSeed);

        uint256[] memory liquidityIds;
        uint256 totalCapacity;
        {
            address lender = actors[((borrowerSeed % actors.length) + 1) % actors.length];
            uint256 numLiquiditys = bound(numLiquiditysSeed, 1, 3);
            uint128 availableLiquidity = uint128(bound(capSeed, 1, 50 ether));
            liquidityIds = new uint256[](numLiquiditys);
            for (uint256 i = 0; i < numLiquiditys; i++) {
                if (underlying.balanceOf(lender) < availableLiquidity) return;
                vm.prank(lender);
                liquidityIds[i] = lending.supplyLiquidity(MARKET, APR, availableLiquidity);
                totalCapacity += availableLiquidity;
                totalActiveLiquidityCapacity += availableLiquidity;
            }
        }

        uint256 streamId = _createStream(borrower);

        uint128 targetBorrow;
        uint128 minAcceptable;
        {
            (uint256 grossPrice,,,,) = lending.quote(MARKET, streamId, APR, 0);
            if (grossPrice == 0) return;
            uint256 maxBorrow = _min(totalCapacity, grossPrice);
            if (maxBorrow == 0) return;
            targetBorrow = uint128(bound(targetSeed, 1, maxBorrow));
            minAcceptable = uint128(bound(minSeed, 1, uint256(targetBorrow)));
        }

        vm.prank(borrower);
        try lending.createBorrowerLoanPool(liquidityIds, streamId, targetBorrow, minAcceptable) returns (
            uint256 loanPoolId
        ) {
            (,,, uint128 totalContributed) = lending.loanPools(loanPoolId);
            totalActiveLiquidityCapacity -= totalContributed;

            uint256 loanId = loanPoolId;
            (,, uint128 obligation,,,) = lending.loans(loanId);
            _recordLoanGhost(loanId, borrower, streamId, obligation);
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        LOAN SERVICING
    //////////////////////////////////////////////////////////////*/

    function repayLoan(uint256 loanIdSeed, uint256 amountSeed) public {
        if (lending.nextLoanId() == 1) return;
        uint256 loanId = bound(loanIdSeed, 1, lending.nextLoanId() - 1);
        (address borrower,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = lending.loans(loanId);
        if (borrower == address(0) || closed) return;

        uint128 outstanding = obligation - drawn - repaid;
        if (outstanding == 0) return;

        uint128 amount = uint128(bound(amountSeed, 1, outstanding));

        vm.prank(borrower);
        try lending.repayLoan(loanId, amount) {
            (,,,,, bool closed2) = lending.loans(loanId);
            if (closed2) {
                loanGhosts[loanId].closed = true;
            }
        } catch {}
    }

    function closeLoan(uint256 loanIdSeed) public {
        if (lending.nextLoanId() == 1) return;
        uint256 loanId = bound(loanIdSeed, 1, lending.nextLoanId() - 1);
        (address borrower, uint256 streamId, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) =
            lending.loans(loanId);
        if (borrower == address(0) || closed) return;

        uint128 outstanding = obligation - drawn - repaid;
        // Set withdrawable so close can succeed
        sablier.setWithdrawable(streamId, outstanding);

        try lending.closeLoan(loanId) {
            loanGhosts[loanId].closed = true;
            // Sync lenderReceived from actual contract state after close
            _syncLenderReceived(loanId);
        } catch {}
    }

    /// @dev Claims a share from an existing loan pool. Picks a pool, finds a contributor
    ///      from the known actors, sets withdrawable on the stream so harvest can succeed,
    ///      and calls claimLoanPoolShare. Syncs lenderReceived from actual contract state.
    function claimLoanPoolShare(uint256 poolIdSeed, uint256 amountSeed) public {
        if (lending.nextLoanId() == 1) return;
        uint256 loanPoolId = bound(poolIdSeed, 1, lending.nextLoanId() - 1);
        uint256 loanId = loanPoolId;
        if (loanId == 0) return;
        (, uint256 streamId,,,, bool closed) = lending.loans(loanId);
        if (closed) {
            // Closed loan: claims come from accumulated proceeds only
        } else {
            // Open loan: set withdrawable so harvest can succeed
            (,, uint128 obligation, uint128 drawn, uint128 repaid,) = lending.loans(loanId);
            uint128 outstanding = obligation - drawn - repaid;
            if (outstanding > 0) {
                sablier.setWithdrawable(streamId, outstanding);
            }
        }

        // Find a contributor among known actors
        address contributor = address(0);
        for (uint256 i = 0; i < 3; i++) {
            if (lending.loanPoolContributions(loanPoolId, actors[i]) > 0) {
                contributor = actors[i];
                break;
            }
        }
        if (contributor == address(0)) return;

        uint128 amount = uint128(bound(amountSeed, 1, 50 ether));
        vm.prank(contributor);
        try lending.claimLoanPoolShare(loanPoolId, amount) {
            _syncLenderReceived(loanId);
        } catch {}
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Syncs the ghost lenderReceived from actual contract loanPoolReceived state.
    function _syncLenderReceived(uint256 loanId) internal {
        uint256 loanPoolId = loanId;
        if (loanPoolId == 0) return;
        uint128 totalReceived;
        for (uint256 i = 0; i < 3; i++) {
            totalReceived += lending.loanPoolReceived(loanPoolId, actors[i]);
        }
        loanGhosts[loanId].lenderReceived = totalReceived;
    }

    function _recordLoanGhost(uint256 loanId, address borrower, uint256 streamId, uint128 obligation) internal {
        LoanGhost storage ghost = loanGhosts[loanId];
        ghost.obligation = obligation;
        ghost.remainingAtOrigination = sablier.getDepositedAmount(streamId) - sablier.getWithdrawnAmount(streamId);
        ghost.lenderReceived = 0;
        ghost.borrower = borrower;
        ghost.lender = address(lending);
        ghost.streamId = streamId;
        ghost.closed = false;
    }

    function _createStream(address owner) internal returns (uint256 streamId) {
        streamId = nextStreamId++;
        sablier.setStream(
            streamId, owner, address(core), IERC20(address(ovrfloToken)), uint40(expiry), 0, false, 100 ether, 0
        );
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function getActor(uint256 i) external view returns (address) {
        return actors[i];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract OVRFLOLendingInvariantTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x5555);

    MockLendingFactory internal factory;
    MockLendingCore internal core;
    MockLendingSablier internal sablier;
    TestERC20 internal underlying;
    TestERC20 internal ovrfloToken;
    OVRFLOLending internal lending;
    uint256 internal expiry;

    OVRFLOLendingInvariantHandler internal handler;

    function setUp() public {
        factory = new MockLendingFactory();
        core = new MockLendingCore();
        sablier = new MockLendingSablier();
        underlying = new TestERC20("Underlying", "UND");
        ovrfloToken = new TestERC20("OVRFLO", "ovrfloUND");
        expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(underlying), address(ovrfloToken));
        factory.setMarketApproved(address(core), MARKET, true);
        core.setSeries(MARKET, true, expiry, address(ovrfloToken), address(underlying));

        lending = new OVRFLOLending(address(factory), address(core), address(sablier));

        handler = new OVRFLOLendingInvariantHandler(lending, sablier, underlying, ovrfloToken, factory, core, expiry);
        targetContract(address(handler));
    }

    /*//////////////////////////////////////////////////////////////
                        INVARIANTS (R6-R9)
    //////////////////////////////////////////////////////////////*/

    /// @notice R6: loan obligation <= stream remaining at origination
    function invariant_ObligationNeverExceedsRemaining() public view {
        uint256 nextLoan = lending.nextLoanId();
        for (uint256 i = 1; i < nextLoan; i++) {
            (uint128 obligation, uint128 remainingAtOrigination,,,,,) = handler.loanGhosts(i);
            if (obligation == 0 && remainingAtOrigination == 0) continue;
            assertLe(obligation, remainingAtOrigination, "obligation exceeds remaining at origination");
        }
    }

    /// @notice R7: lender total received <= obligation
    function invariant_LenderReceivedNeverExceedsObligation() public view {
        uint256 nextLoan = lending.nextLoanId();
        for (uint256 i = 1; i < nextLoan; i++) {
            (uint128 obligation,, uint128 lenderReceived,,,,) = handler.loanGhosts(i);
            if (obligation == 0) continue;
            assertLe(lenderReceived, obligation, "lender received exceeds obligation");
        }
    }

    /// @notice R8: stream NFT with borrower when loan is closed
    function invariant_NftReturnedToBorrowerOnClose() public view {
        uint256 nextLoan = lending.nextLoanId();
        for (uint256 i = 1; i < nextLoan; i++) {
            (,,, address borrower,, uint256 streamId, bool closed) = handler.loanGhosts(i);
            if (!closed) continue;
            assertEq(sablier.ownerOf(streamId), borrower, "NFT not returned to borrower on close");
        }
    }

    /// @notice lending underlying balance == escrowed liquidity availableLiquidity
    function invariant_LendingBalanceEqualsEscrowedCapacity() public view {
        uint256 expected = handler.totalActiveLiquidityCapacity();
        assertEq(
            underlying.balanceOf(address(lending)), expected, "lending balance != escrowed liquidity availableLiquidity"
        );
    }

    /// @notice R10: For every loan pool, proceeds + sum(received) == drawn + repaid.
    ///         This verifies that recovered funds are fully accounted for: either still
    ///         in the pool's proceeds pot or already paid out to lenders.
    function invariant_PoolConservation() public view {
        uint256 nextPool = lending.nextLoanId();
        for (uint256 p = 1; p < nextPool; p++) {
            uint256 loanId = p;
            if (loanId == 0) continue;
            (,,, uint128 drawn, uint128 repaid,) = lending.loans(loanId);
            uint128 proceeds = lending.loanPoolProceeds(p);

            uint128 sumReceived;
            for (uint256 i = 0; i < 3; i++) {
                sumReceived += lending.loanPoolReceived(p, handler.getActor(i));
            }
            assertEq(
                uint256(proceeds) + uint256(sumReceived), uint256(drawn) + uint256(repaid), "pool conservation violated"
            );
        }
    }

    /// @notice R11: For every loan pool, each lender's received <= their pro-rata entitlement.
    ///         received[pool][lender] <= contribution * recovered / totalContributed.
    function invariant_ReceivedLeProRataEntitlement() public view {
        uint256 nextPool = lending.nextLoanId();
        for (uint256 p = 1; p < nextPool; p++) {
            uint256 loanId = p;
            if (loanId == 0) continue;
            (,, uint128 obligation, uint128 drawn, uint128 repaid, bool closed) = lending.loans(loanId);
            (,,, uint128 totalContributed) = lending.loanPools(p);
            if (totalContributed == 0) continue;

            uint256 recovered = uint256(drawn) + uint256(repaid);
            if (!closed) {
                uint128 outstanding = obligation - drawn - repaid;
                uint128 withdrawable = sablier.withdrawableAmountOf(loans_streamId(loanId));
                recovered += uint256(withdrawable < outstanding ? withdrawable : outstanding);
            }

            for (uint256 i = 0; i < 3; i++) {
                address lender = handler.getActor(i);
                uint128 contribution = lending.loanPoolContributions(p, lender);
                if (contribution == 0) continue;
                uint128 received = lending.loanPoolReceived(p, lender);
                uint256 entitlement = uint256(contribution) * recovered / uint256(totalContributed);
                assertLe(uint256(received), entitlement, "received exceeds pro-rata entitlement");
            }
        }
    }

    /// @dev Helper to read streamId from a loan without full destructuring.
    function loans_streamId(uint256 loanId) internal view returns (uint256) {
        (, uint256 streamId,,,,) = lending.loans(loanId);
        return streamId;
    }
}
