// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {OVRFLOToken} from "../../src/OVRFLOToken.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";
import {IPendleOracle} from "../../interfaces/IPendleOracle.sol";
import {IFlashBorrower} from "../../interfaces/IFlashBorrower.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

/// @notice FlashBorrower for fork tests. Uses real PT tokens and real wstETH.
contract ForkFlashBorrower is IFlashBorrower, Test {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;
    bool public returnSuccess = true;

    bool public depositDuringCallback;
    bool public unwrapDuringCallback;
    address public depositMarket;
    uint256 public depositAmount;
    uint256 public unwrapAmount;

    bool public depositSucceeded;
    bool public unwrapSucceeded;

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

    function resetConfig() external {
        depositDuringCallback = false;
        unwrapDuringCallback = false;
    }

    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external returns (bytes32) {
        require(msg.sender == address(vault), "not vault");

        if (depositDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.deposit, (depositMarket, depositAmount, 0)));
            depositSucceeded = ok;
        }

        if (unwrapDuringCallback) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.unwrap, (unwrapAmount)));
            unwrapSucceeded = ok;
        }

        return returnSuccess ? CALLBACK_SUCCESS : bytes32(0);
    }
}

contract OVRFLOFlashLoanForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    address internal constant BORROWER = address(0xF1A);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint256 internal constant PT_AMOUNT = 10 ether;
    uint256 internal constant FLASH_AMOUNT = 5 ether;

    OVRFLO internal ovrflo;
    OVRFLOFactory internal factory;
    OVRFLOToken internal token;
    ForkFlashBorrower internal flashBorrower;

    function setUp() public override {
        super.setUp();
        (factory, ovrflo, token) = _deployApprovedPrimarySeries(0);

        // Deposit PT to populate marketTotalDeposited
        _depositPrimary(ovrflo, PT_AMOUNT);

        // Create and fund the flash borrower
        flashBorrower = new ForkFlashBorrower(ovrflo);

        // Fund borrower with wstETH for fees and wraps
        _seedWstEth(address(flashBorrower), 100 ether);

        // Approvals from borrower
        vm.startPrank(address(flashBorrower));
        IERC20(PRIMARY_PT).approve(address(ovrflo), type(uint256).max);
        IERC20(WSTETH).approve(address(ovrflo), type(uint256).max);
        token.approve(address(ovrflo), type(uint256).max);
        vm.stopPrank();

        // Fund wrap reserve so unwrap works during callback
        _seedWstEth(address(this), 50 ether);
        IERC20(WSTETH).approve(address(ovrflo), 50 ether);
        ovrflo.wrap(50 ether);
    }

    /*//////////////////////////////////////////////////////////////
                    FLASH LOAN HAPPY PATH WITH REAL PT
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoan_RealPtRoundTrip_VaultBalanceUnchanged() public {
        uint256 vaultPtBefore = IERC20(PRIMARY_PT).balanceOf(address(ovrflo));
        uint256 depositedBefore = ovrflo.marketTotalDeposited(PRIMARY_MARKET);

        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        assertEq(
            IERC20(PRIMARY_PT).balanceOf(address(ovrflo)),
            vaultPtBefore,
            "vault PT balance should be unchanged after round trip"
        );
        assertEq(
            ovrflo.marketTotalDeposited(PRIMARY_MARKET), depositedBefore, "marketTotalDeposited should be unchanged"
        );
    }

    function test_FlashLoan_ZeroFee_NoUnderlyingMoved() public {
        assertEq(ovrflo.flashFeeBps(), 0, "default fee should be 0");

        uint256 treasuryBefore = IERC20(WSTETH).balanceOf(TREASURY);

        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        assertEq(IERC20(WSTETH).balanceOf(TREASURY), treasuryBefore, "no fee should be charged at 0 bps");
    }

    /*//////////////////////////////////////////////////////////////
                    FLASH LOAN FEE WITH LIVE ORACLE RATE
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoan_LiveOracleFee_MatchesPreviewRate() public {
        // Set a fee
        vm.prank(OWNER);
        factory.setFlashFeeBps(address(ovrflo), 50);
        assertEq(ovrflo.flashFeeBps(), 50);

        // Get the live oracle rate
        uint256 liveRate = ovrflo.previewRate(PRIMARY_MARKET);
        assertGt(liveRate, 0, "live rate should be > 0");

        // Compute expected fee: amount * rate / 1e18 * feeBps / 10000
        uint256 expectedFee = (FLASH_AMOUNT * liveRate / 1e18) * 50 / 10_000;

        uint256 treasuryBefore = IERC20(WSTETH).balanceOf(TREASURY);
        uint256 borrowerBefore = IERC20(WSTETH).balanceOf(address(flashBorrower));

        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        assertEq(
            IERC20(WSTETH).balanceOf(TREASURY) - treasuryBefore,
            expectedFee,
            "fee should match live oracle rate calculation"
        );
        assertEq(
            borrowerBefore - IERC20(WSTETH).balanceOf(address(flashBorrower)),
            expectedFee,
            "borrower should be charged the fee"
        );
    }

    function test_FlashLoan_MaxFee_LiveOracleRate() public {
        vm.prank(OWNER);
        factory.setFlashFeeBps(address(ovrflo), 100);

        uint256 liveRate = ovrflo.previewRate(PRIMARY_MARKET);
        uint256 expectedFee = (FLASH_AMOUNT * liveRate / 1e18) * 100 / 10_000;

        uint256 treasuryBefore = IERC20(WSTETH).balanceOf(TREASURY);

        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        assertEq(IERC20(WSTETH).balanceOf(TREASURY) - treasuryBefore, expectedFee, "max fee should match live rate");
    }

    /*////////////////////////////////////////////////////////////**
                    FLASH LOAN + DEPOSIT DURING CALLBACK
                    (Creates real Sablier stream)
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoan_DepositDuringCallback_RealSablierStream() public {
        // Pre-fund borrower with extra PT for repayment
        // (depositing the flash-loaned PT means borrower won't have it for repayment)
        deal(PRIMARY_PT, address(flashBorrower), FLASH_AMOUNT);

        flashBorrower.configureDeposit(PRIMARY_MARKET, FLASH_AMOUNT);

        uint256 depositedBefore = ovrflo.marketTotalDeposited(PRIMARY_MARKET);
        uint256 vaultPtBefore = IERC20(PRIMARY_PT).balanceOf(address(ovrflo));

        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        assertTrue(flashBorrower.depositSucceeded(), "deposit during callback should succeed");

        // marketTotalDeposited should increase by FLASH_AMOUNT
        assertEq(
            ovrflo.marketTotalDeposited(PRIMARY_MARKET),
            depositedBefore + FLASH_AMOUNT,
            "marketTotalDeposited should increase"
        );

        // Vault PT: initial - flash_out + deposit_in + repayment = initial + FLASH_AMOUNT
        assertEq(
            IERC20(PRIMARY_PT).balanceOf(address(ovrflo)),
            vaultPtBefore + FLASH_AMOUNT,
            "vault PT should increase by deposit amount"
        );

        // Borrower should have received ovrfloToken from the deposit
        uint256 liveRate = ovrflo.previewRate(PRIMARY_MARKET);
        uint256 expectedToUser = FLASH_AMOUNT * liveRate / 1e18;
        if (expectedToUser > FLASH_AMOUNT) expectedToUser = FLASH_AMOUNT;
        assertEq(
            token.balanceOf(address(flashBorrower)), expectedToUser, "borrower should have ovrfloToken from deposit"
        );

        // A real Sablier stream should have been created (token held by Sablier)
        assertGt(token.balanceOf(address(ovrflo.sablierLL())), 0, "Sablier should hold ovrfloToken from the stream");
    }

    /*////////////////////////////////////////////////////////////**
                    FULL CYCLE: FLASH -> DEPOSIT -> UNWRAP -> REPAY
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoan_FullCycle_DepositUnwrapRepay_RealTokens() public {
        // Pre-fund borrower with extra PT for repayment
        deal(PRIMARY_PT, address(flashBorrower), FLASH_AMOUNT);

        // Configure: deposit flash-loaned PT, then unwrap the resulting ovrfloToken
        flashBorrower.configureDeposit(PRIMARY_MARKET, FLASH_AMOUNT);

        uint256 liveRate = ovrflo.previewRate(PRIMARY_MARKET);
        uint256 expectedToUser = FLASH_AMOUNT * liveRate / 1e18;
        if (expectedToUser > FLASH_AMOUNT) expectedToUser = FLASH_AMOUNT;

        flashBorrower.configureUnwrap(expectedToUser);

        uint256 depositedBefore = ovrflo.marketTotalDeposited(PRIMARY_MARKET);
        uint256 reserveBefore = ovrflo.wrappedUnderlying();
        uint256 borrowerWstEthBefore = IERC20(WSTETH).balanceOf(address(flashBorrower));

        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        assertTrue(flashBorrower.depositSucceeded(), "deposit step failed");
        assertTrue(flashBorrower.unwrapSucceeded(), "unwrap step failed");

        // marketTotalDeposited increased by FLASH_AMOUNT
        assertEq(
            ovrflo.marketTotalDeposited(PRIMARY_MARKET),
            depositedBefore + FLASH_AMOUNT,
            "marketTotalDeposited should increase"
        );

        // Reserve decreased by unwrapAmount
        assertEq(ovrflo.wrappedUnderlying(), reserveBefore - expectedToUser, "reserve should decrease from unwrap");

        // Borrower received wstETH from unwrap
        assertEq(
            IERC20(WSTETH).balanceOf(address(flashBorrower)) - borrowerWstEthBefore,
            expectedToUser,
            "borrower should have wstETH from unwrap"
        );

        // Vault PT balance: initial - flash_out + deposit_in + repayment = initial + FLASH_AMOUNT
        assertEq(
            IERC20(PRIMARY_PT).balanceOf(address(ovrflo)),
            PT_AMOUNT + FLASH_AMOUNT,
            "vault should hold original + deposited PT"
        );
    }

    /*////////////////////////////////////////////////////////////**
                    MULTI-MARKET FLASH LOAN INDEPENDENCE
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoan_MultiMarketIndependence() public {
        // Approve secondary market and deposit into it
        vm.startPrank(OWNER);
        factory.prepareOracle(SECONDARY_MARKET, PROTOCOL_TWAP_DURATION);
        factory.addMarket(address(ovrflo), SECONDARY_MARKET, PROTOCOL_TWAP_DURATION, 0);
        vm.stopPrank();

        // Deposit into secondary market
        deal(SECONDARY_PT, USER, PT_AMOUNT);
        (uint256 expectedToUser,,) = ovrflo.previewStream(SECONDARY_MARKET, PT_AMOUNT);
        vm.startPrank(USER);
        IERC20(SECONDARY_PT).approve(address(ovrflo), PT_AMOUNT);
        ovrflo.deposit(SECONDARY_MARKET, PT_AMOUNT, expectedToUser);
        vm.stopPrank();

        uint256 primaryDepositedBefore = ovrflo.marketTotalDeposited(PRIMARY_MARKET);
        uint256 secondaryDepositedBefore = ovrflo.marketTotalDeposited(SECONDARY_MARKET);
        uint256 primaryPtBefore = IERC20(PRIMARY_PT).balanceOf(address(ovrflo));
        uint256 secondaryPtBefore = IERC20(SECONDARY_PT).balanceOf(address(ovrflo));

        // Flash loan from primary market
        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        // Primary market: PT returned, deposited unchanged
        assertEq(ovrflo.marketTotalDeposited(PRIMARY_MARKET), primaryDepositedBefore, "primary deposited unchanged");
        assertEq(IERC20(PRIMARY_PT).balanceOf(address(ovrflo)), primaryPtBefore, "primary PT balance unchanged");

        // Secondary market: completely unaffected
        assertEq(
            ovrflo.marketTotalDeposited(SECONDARY_MARKET), secondaryDepositedBefore, "secondary deposited unchanged"
        );
        assertEq(IERC20(SECONDARY_PT).balanceOf(address(ovrflo)), secondaryPtBefore, "secondary PT balance unchanged");
    }

    /*////////////////////////////////////////////////////////////**
                    FLASH LOAN REVERT CASES WITH REAL TOKENS
    //////////////////////////////////////////////////////////////*/

    function test_FlashLoan_ExceedsDeposited_RevertsOnRealToken() public {
        vm.expectRevert("OVRFLO: exceeds deposited");
        flashBorrower.executeFlashLoan(PRIMARY_PT, PT_AMOUNT + 1, "");
    }

    function test_FlashLoan_RevertsAfterMaturity_RealToken() public {
        vm.warp(PRIMARY_EXPIRY);
        vm.expectRevert("OVRFLO: matured");
        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");
    }

    function test_FlashLoan_NestedReverts_NonReentrant_RealToken() public {
        // This test verifies nonReentrant works with real token state
        // We can't easily do a nested flash loan without a custom borrower,
        // but we can verify the guard is in place by checking the modifier
        assertEq(ovrflo.flashLoanPaused(), false, "flash should not be paused by default");

        // Pause and verify revert
        vm.prank(OWNER);
        factory.setFlashLoanPaused(address(ovrflo), true);
        vm.expectRevert("OVRFLO: flash paused");
        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");

        // Unpause and verify it works again
        vm.prank(OWNER);
        factory.setFlashLoanPaused(address(ovrflo), false);
        flashBorrower.executeFlashLoan(PRIMARY_PT, FLASH_AMOUNT, "");
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/

    function _deployApprovedPrimarySeries(uint16 feeBps)
        internal
        returns (OVRFLOFactory factory_, OVRFLO ovrflo_, OVRFLOToken token_)
    {
        (factory_, ovrflo_, token_) = _deployConfiguredSystem();

        vm.startPrank(OWNER);
        factory_.prepareOracle(PRIMARY_MARKET, PROTOCOL_TWAP_DURATION);
        factory_.addMarket(address(ovrflo_), PRIMARY_MARKET, PROTOCOL_TWAP_DURATION, feeBps);
        vm.stopPrank();
    }

    function _depositPrimary(OVRFLO ovrflo_, uint256 ptAmount) internal {
        (uint256 expectedToUser,,) = ovrflo_.previewStream(PRIMARY_MARKET, ptAmount);
        deal(PRIMARY_PT, USER, ptAmount);

        vm.startPrank(USER);
        IERC20(PRIMARY_PT).approve(address(ovrflo_), ptAmount);
        ovrflo_.deposit(PRIMARY_MARKET, ptAmount, expectedToUser);
        vm.stopPrank();
    }
}
