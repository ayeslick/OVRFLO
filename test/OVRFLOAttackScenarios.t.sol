// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";
import {VaultMockHelpers} from "./helpers/VaultMockHelpers.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";

// --- Attack FlashBorrower with configurable callbacks ---

contract AttackFlashBorrower is IFlashBorrower, Test {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;
    bool public returnSuccess = true;

    bool public depositDuringCallback;
    bool public unwrapDuringCallback;
    bool public claimDuringCallback;
    bool public changeOracleDuringCallback;
    address public depositMarket;
    uint256 public depositAmount;
    uint256 public unwrapAmount;
    address public claimPtToken;
    uint256 public claimAmount;
    address public oracleAddr;
    address public oracleMarket;
    uint32 public oracleTwapDuration;
    uint256 public newRate;

    bool public depositSucceeded;
    bool public unwrapSucceeded;
    bool public claimSucceeded;
    address public lastInitiator;

    constructor(OVRFLO vault_) {
        vault = vault_;
    }

    function setReturnSuccess(bool success) external {
        returnSuccess = success;
    }

    function configureDeposit(address market, uint256 amount) external {
        depositDuringCallback = true;
        depositMarket = market;
        depositAmount = amount;
    }

    function configureUnwrap(uint256 amount) external {
        unwrapDuringCallback = true;
        unwrapAmount = amount;
    }

    function configureClaim(address ptToken, uint256 amount) external {
        claimDuringCallback = true;
        claimPtToken = ptToken;
        claimAmount = amount;
    }

    function configureOracleChange(address addr, address market, uint32 twap, uint256 rate) external {
        changeOracleDuringCallback = true;
        oracleAddr = addr;
        oracleMarket = market;
        oracleTwapDuration = twap;
        newRate = rate;
    }

    function resetConfig() external {
        depositDuringCallback = false;
        unwrapDuringCallback = false;
        claimDuringCallback = false;
        changeOracleDuringCallback = false;
    }

    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address initiator, address, uint256, uint256, bytes calldata) external returns (bytes32) {
        require(msg.sender == address(vault), "not vault");
        lastInitiator = initiator;

        if (changeOracleDuringCallback) {
            vm.mockCall(
                oracleAddr,
                abi.encodeCall(IPendleOracle.getPtToSyRate, (oracleMarket, oracleTwapDuration)),
                abi.encode(newRate)
            );
        }

        if (depositDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.deposit, (depositMarket, depositAmount, 0)));
            depositSucceeded = ok;
        }

        if (unwrapDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.unwrap, (unwrapAmount)));
            unwrapSucceeded = ok;
        }

        if (claimDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.claim, (claimPtToken, claimAmount)));
            claimSucceeded = ok;
        }

        return returnSuccess ? CALLBACK_SUCCESS : bytes32(0);
    }
}

contract OVRFLOAttackScenariosTest is VaultMockHelpers {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET_A = address(0x1001);
    address internal constant MARKET_B = address(0x1002);
    address internal constant BOOK_MARKET = address(0x5555);

    uint256 internal constant RATE_95 = 0.95e18;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    TestERC20 internal underlying;
    TestERC20 internal ptA;
    TestERC20 internal ptB;
    AttackFlashBorrower internal borrower;

    uint256 internal constant DEPOSIT_AMOUNT = 100 ether;

    function setUp() public {
        uint256 expiry = block.timestamp + 365 days;

        underlying = new TestERC20("Underlying", "UND");
        ptA = new TestERC20("PT-A", "PTA");
        ptB = new TestERC20("PT-B", "PTB");

        ovrfloToken = new OVRFLOToken("OVRFLO UND", "ovrfloUND");
        ovrflo = new OVRFLO(ADMIN, TREASURY, address(underlying), address(ovrfloToken), PENDLE_ORACLE);
        ovrfloToken.transferOwnership(address(ovrflo));

        // Approve market A
        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(MARKET_A, address(ptA), TWAP_DURATION, expiry, 0);

        // Approve market B
        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(MARKET_B, address(ptB), TWAP_DURATION, expiry, 0);

        // Mock oracle for both markets
        _mockRate(MARKET_A, RATE_95);
        _mockRate(MARKET_B, RATE_95);
        vm.mockCall(
            SABLIER_LL, abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector), abi.encode(1)
        );

        // Deposit PT-A to populate market A
        address user = makeAddr("user");
        ptA.mint(user, DEPOSIT_AMOUNT);
        vm.startPrank(user);
        ptA.approve(address(ovrflo), DEPOSIT_AMOUNT);
        ovrflo.deposit(MARKET_A, DEPOSIT_AMOUNT, 0);
        vm.stopPrank();

        // Deposit PT-B to populate market B
        ptB.mint(user, DEPOSIT_AMOUNT);
        vm.startPrank(user);
        ptB.approve(address(ovrflo), DEPOSIT_AMOUNT);
        ovrflo.deposit(MARKET_B, DEPOSIT_AMOUNT, 0);
        vm.stopPrank();

        // Create borrower
        borrower = new AttackFlashBorrower(ovrflo);

        // Fund borrower
        underlying.mint(address(borrower), 1_000 ether);
        vm.startPrank(address(borrower));
        ptA.approve(address(ovrflo), type(uint256).max);
        ptB.approve(address(ovrflo), type(uint256).max);
        underlying.approve(address(ovrflo), type(uint256).max);
        ovrfloToken.approve(address(ovrflo), type(uint256).max);
        vm.stopPrank();

        // Fund wrap reserve
        underlying.mint(address(this), 200 ether);
        underlying.approve(address(ovrflo), 200 ether);
        ovrflo.wrap(200 ether);
    }

    /*//////////////////////////////////////////////////////////////
                    R15 / AE4: FULL OVRFLO CYCLE
    //////////////////////////////////////////////////////////////*/

    function test_AE4_FullOvrfloCycle() public {
        uint256 flashAmount = 50 ether;

        // Pre-fund borrower with extra PT for repayment
        ptA.mint(address(borrower), flashAmount);

        // Configure: deposit flash-loaned PT, then unwrap the received ovrfloToken
        borrower.configureDeposit(MARKET_A, flashAmount);
        uint256 expectedToUser = (flashAmount * RATE_95) / 1e18;
        borrower.configureUnwrap(expectedToUser);

        uint256 depositedBefore = ovrflo.marketTotalDeposited(MARKET_A);
        uint256 reserveBefore = ovrflo.wrappedUnderlying();
        uint256 borrowerUnderlyingBefore = underlying.balanceOf(address(borrower));

        borrower.executeFlashLoan(address(ptA), flashAmount, "");

        assertTrue(borrower.depositSucceeded(), "deposit step failed");
        assertTrue(borrower.unwrapSucceeded(), "unwrap step failed");

        // vault PT balance: 100 (initial) - 50 (flash out) + 50 (deposit in) + 50 (repayment) = 150
        assertEq(ptA.balanceOf(address(ovrflo)), 150 ether, "vault PT balance should be 150");
        assertEq(
            ovrflo.marketTotalDeposited(MARKET_A), depositedBefore + flashAmount, "marketTotalDeposited should be 150"
        );
        assertEq(ovrflo.wrappedUnderlying(), reserveBefore - expectedToUser, "reserve not decremented");
        assertEq(
            underlying.balanceOf(address(borrower)) - borrowerUnderlyingBefore,
            expectedToUser,
            "borrower should have underlying from unwrap"
        );
    }

    /*//////////////////////////////////////////////////////////////
                    R16 / AE5: ORACLE MANIPULATION
    //////////////////////////////////////////////////////////////*/

    function test_AE5_OracleManipulation_FeeUsesPreCallbackRate() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(50);

        uint256 flashAmount = 50 ether;
        uint256 expectedFee = _computeFee(flashAmount, RATE_95, 50);

        // Configure callback to change oracle rate
        borrower.configureOracleChange(PENDLE_ORACLE, MARKET_A, TWAP_DURATION, 0.01e18);

        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(ptA), flashAmount, "");

        // Fee should be calculated at 0.95e18 (rate read before callback), not 0.01e18
        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "fee should use pre-callback rate");
    }

    /*//////////////////////////////////////////////////////////////
                    R17: STREAM WITHDRAWAL DURING ACTIVE LOAN
    //////////////////////////////////////////////////////////////*/

    function test_R17_StreamWithdrawalDuringActiveLoan() public {
        // Set up Lending with its own mock tokens (separate from vault's ovrfloToken)
        MockLendingFactory factory = new MockLendingFactory();
        MockLendingCore core = new MockLendingCore();
        MockLendingSablier lendingSablier = new MockLendingSablier();
        TestERC20 lendingUnderlying = new TestERC20("LendingUnderlying", "BUND");
        TestERC20 lendingOvrfloToken = new TestERC20("LendingOvrflo", "bovRFLO");
        uint256 expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(lendingUnderlying), address(lendingOvrfloToken));
        core.setSeries(BOOK_MARKET, expiry, address(lendingOvrfloToken), address(lendingUnderlying));

        OVRFLOLending lending = new OVRFLOLending(address(factory), address(core), address(lendingSablier));

        address lender = makeAddr("lender");
        address borrowerAddr = makeAddr("loanBorrower");

        // Fund actors
        lendingUnderlying.mint(lender, 200 ether);
        lendingOvrfloToken.mint(borrowerAddr, 200 ether);

        vm.startPrank(lender);
        lendingUnderlying.approve(address(lending), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(borrowerAddr);
        lendingOvrfloToken.approve(address(lending), type(uint256).max);
        lendingSablier.setApprovalForAll(address(lending), true);
        vm.stopPrank();

        // Create an eligible stream
        uint256 streamId = 1;
        lendingSablier.setStream(
            streamId,
            borrowerAddr,
            address(core),
            IERC20(address(lendingOvrfloToken)),
            uint40(expiry),
            0,
            false,
            100 ether,
            0
        );

        // Post liquidity
        vm.prank(lender);
        uint256 liquidityId = lending.supplyLiquidity(BOOK_MARKET, 1000, 50 ether);

        // Create borrow pool with single liquidity
        vm.startPrank(borrowerAddr);
        lendingSablier.approve(address(lending), streamId);
        uint256 loanPoolId = lending.createBorrowerLoanPool(_singletonArray(liquidityId), streamId, 50 ether, 0);
        vm.stopPrank();
        uint256 loanId = 1;

        // Read loan state
        (,, uint128 obligation,,,) = lending.loans(loanId);

        // Borrower repays partial via repayLoan (increases recovered, loanPoolProceeds, loan stays open)
        uint128 partialRepay = obligation / 2;
        vm.prank(borrowerAddr);
        lending.repayLoan(loanId, partialRepay);

        // Lender claims partial from loanPoolProceeds
        vm.prank(lender);
        lending.claimLoanPoolShare(loanPoolId, partialRepay);

        // Set withdrawable to full, closeLoan draws remaining (loan closes, NFT returned)
        lendingSablier.setWithdrawable(streamId, 100 ether);
        lending.closeLoan(loanId);

        // Loan should be closed and NFT returned
        (,,,,, bool closed) = lending.loans(loanId);
        assertTrue(closed, "loan should be closed after closeLoan");

        assertEq(lendingSablier.ownerOf(streamId), borrowerAddr, "NFT should be returned to borrower");

        // Lender claims remaining via claimLoanPoolShare
        uint128 remaining = obligation - partialRepay;
        vm.prank(lender);
        lending.claimLoanPoolShare(loanPoolId, remaining);

        // Lender total received: partialRepay (from loanPoolProceeds) + remaining (from closeLoan proceeds) == obligation
        uint128 lenderOvrfloReceived = uint128(lendingOvrfloToken.balanceOf(lender));
        assertEq(lenderOvrfloReceived, obligation, "lender total should equal obligation");
    }

    /*//////////////////////////////////////////////////////////////
                    R18: MULTI-MARKET CROSS-CONTAMINATION
    //////////////////////////////////////////////////////////////*/

    function test_R18_MultiMarketIndependence() public {
        uint256 flashAmount = 50 ether;

        uint256 marketADepositedBefore = ovrflo.marketTotalDeposited(MARKET_A);
        uint256 marketBDepositedBefore = ovrflo.marketTotalDeposited(MARKET_B);
        uint256 marketAPtBefore = ptA.balanceOf(address(ovrflo));
        uint256 marketBPtBefore = ptB.balanceOf(address(ovrflo));

        // Flash loan market B's PT
        borrower.executeFlashLoan(address(ptB), flashAmount, "");

        // Market A should be unchanged
        assertEq(ovrflo.marketTotalDeposited(MARKET_A), marketADepositedBefore, "market A deposited changed");
        assertEq(ptA.balanceOf(address(ovrflo)), marketAPtBefore, "market A PT balance changed");

        // Market B should be unchanged (flash loan returns PT)
        assertEq(ovrflo.marketTotalDeposited(MARKET_B), marketBDepositedBefore, "market B deposited changed");
        assertEq(ptB.balanceOf(address(ovrflo)), marketBPtBefore, "market B PT balance changed");
    }

    /*//////////////////////////////////////////////////////////////
                    R19: REENTRANCY VIA CALLBACK THEN CLAIM
    //////////////////////////////////////////////////////////////*/

    function test_R19_ReentrancyCallbackThenClaim_Reverts() public {
        uint256 flashAmount = 50 ether;

        // Pre-fund borrower with extra PT for repayment
        ptA.mint(address(borrower), flashAmount);

        // Configure: deposit during callback, then attempt claim (should fail - not matured)
        borrower.configureDeposit(MARKET_A, flashAmount);
        borrower.configureClaim(address(ptA), 10 ether);

        uint256 depositedBefore = ovrflo.marketTotalDeposited(MARKET_A);

        borrower.executeFlashLoan(address(ptA), flashAmount, "");

        assertTrue(borrower.depositSucceeded(), "deposit should succeed during callback");
        assertFalse(borrower.claimSucceeded(), "claim should revert during callback (not matured)");

        // Verify state: deposit succeeded but claim didn't change anything
        assertEq(
            ovrflo.marketTotalDeposited(MARKET_A),
            depositedBefore + flashAmount,
            "marketTotalDeposited should reflect deposit only"
        );
    }

    /*//////////////////////////////////////////////////////////////
                    EDGE: MAX FEE + MAX AMOUNT
    //////////////////////////////////////////////////////////////*/

    function test_MaxFeeMaxAmountFlashLoan() public {
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(100);

        uint256 flashAmount = DEPOSIT_AMOUNT;
        uint256 expectedFee = _computeFee(flashAmount, RATE_95, 100);
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(ptA), flashAmount, "");

        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "max fee mismatch");
        assertEq(ptA.balanceOf(address(ovrflo)), DEPOSIT_AMOUNT, "vault PT should be returned");
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/

    function _singletonArray(uint256 id) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = id;
    }
}
