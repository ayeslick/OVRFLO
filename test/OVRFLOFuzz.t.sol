// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {StreamPricing} from "../src/StreamPricing.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";

contract FuzzMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FuzzFlashBorrower is IFlashBorrower {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;

    constructor(OVRFLO vault_) {
        vault = vault_;
    }

    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external returns (bytes32) {
        require(msg.sender == address(vault), "not vault");
        return CALLBACK_SUCCESS;
    }
}

contract OVRFLOFuzzTest is Test {
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    address internal constant SABLIER_LL = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x1001);

    uint32 internal constant TWAP_DURATION = 30 minutes;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    FuzzMockERC20 internal underlying;
    FuzzMockERC20 internal pt;
    FuzzFlashBorrower internal borrower;

    uint256 internal constant DEPOSIT_AMOUNT = 100 ether;
    uint256 internal constant RATE_95 = 0.95e18;

    function setUp() public {
        uint256 expiry = block.timestamp + 365 days;

        underlying = new FuzzMockERC20("Underlying", "UND");
        pt = new FuzzMockERC20("PT", "PT");

        ovrfloToken = new OVRFLOToken("OVRFLO UND", "ovrfloUND");
        ovrflo = new OVRFLO(ADMIN, TREASURY, address(underlying), address(ovrfloToken), PENDLE_ORACLE);
        ovrfloToken.transferOwnership(address(ovrflo));

        vm.prank(ADMIN);
        ovrflo.setSeriesApproved(MARKET, address(pt), TWAP_DURATION, expiry, 0);

        _mockRate(MARKET, RATE_95);
        vm.mockCall(
            SABLIER_LL, abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector), abi.encode(1)
        );

        // Deposit PT to populate marketTotalDeposited
        address user = makeAddr("user");
        pt.mint(user, DEPOSIT_AMOUNT);
        vm.startPrank(user);
        pt.approve(address(ovrflo), DEPOSIT_AMOUNT);
        ovrflo.deposit(MARKET, DEPOSIT_AMOUNT, 0);
        vm.stopPrank();

        borrower = new FuzzFlashBorrower(ovrflo);

        underlying.mint(address(borrower), 1_000 ether);
        vm.startPrank(address(borrower));
        pt.approve(address(ovrflo), type(uint256).max);
        underlying.approve(address(ovrflo), type(uint256).max);
        vm.stopPrank();

        // Fund wrap reserve
        underlying.mint(address(this), 200 ether);
        underlying.approve(address(ovrflo), 200 ether);
        ovrflo.wrap(200 ether);
    }

    /*//////////////////////////////////////////////////////////////
                    R10: DEPOSIT SPLIT INVARIANT
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_DepositSplit(uint256 rateSeed, uint256 ptAmountSeed) public {
        uint256 rateE18 = bound(rateSeed, 0.01e18, 0.99e18);
        uint256 ptAmount = bound(ptAmountSeed, ovrflo.MIN_PT_AMOUNT(), 1000 ether);

        _mockRate(MARKET, rateE18);

        (uint256 toUser, uint256 toStream,,) = ovrflo.previewDeposit(MARKET, ptAmount);

        assertEq(toUser + toStream, ptAmount, "split doesn't sum to ptAmount");
        assertLe(toUser, ptAmount, "toUser exceeds ptAmount");
        assertGt(toStream, 0, "toStream should be > 0 for rate < 1e18");
    }

    /*//////////////////////////////////////////////////////////////
                    R11: FLASH LOAN FEE CORRECTNESS
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_FlashLoanFee(uint256 amountSeed, uint256 rateSeed, uint16 feeBpsSeed) public {
        uint256 amount = bound(amountSeed, 1, DEPOSIT_AMOUNT);
        uint256 rateE18 = bound(rateSeed, 0, 1.5e18);
        uint16 feeBps = uint16(bound(uint256(feeBpsSeed), 0, 100));

        _mockRate(MARKET, rateE18);
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(feeBps);

        uint256 expectedFee = _computeFee(amount, rateE18, feeBps);
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), amount, "");

        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "fee mismatch");
    }

    /*//////////////////////////////////////////////////////////////
                    R12: STREAMPRICING BOUNDS
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_StreamPricing_Bounds(uint128 remainingSeed, uint16 aprBps, uint256 ttmSeed) public pure {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1, 1000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 10000));
        uint256 ttm = bound(ttmSeed, 0, 365 days);

        uint256 gp = StreamPricing.grossPrice(remaining, apr, ttm);
        assertLe(gp, remaining, "grossPrice exceeds remaining");

        if (gp > 0) {
            uint128 ob = StreamPricing.obligationForFill(gp, gp, remaining, apr, ttm);
            assertLe(ob, remaining, "obligation exceeds remaining");
        }
    }

    function test_Fuzz_StreamPricing_ObligationForFill(
        uint128 remainingSeed,
        uint16 aprBps,
        uint256 ttmSeed,
        uint256 borrowSeed
    ) public pure {
        uint128 remaining = uint128(bound(uint256(remainingSeed), 1 ether, 10_000 ether));
        uint16 apr = uint16(bound(uint256(aprBps), 0, 5000));
        uint256 ttm = bound(ttmSeed, 0, 2 * 365 days);

        uint256 gp = StreamPricing.grossPrice(remaining, apr, ttm);
        vm.assume(gp > 0);

        uint256 borrowAmount = bound(borrowSeed, 1, gp);
        uint128 ob = StreamPricing.obligationForFill(borrowAmount, gp, remaining, apr, ttm);
        assertLe(ob, remaining, "obligation exceeds remaining");
    }

    /*//////////////////////////////////////////////////////////////
                    R13: DUST AMOUNTS
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_DustWrapUnwrap(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, 1, 100);

        address user = makeAddr("dustUser");
        underlying.mint(user, amount);
        vm.startPrank(user);
        underlying.approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        assertEq(ovrfloToken.balanceOf(user), amount, "wrap dust failed");
        ovrflo.unwrap(amount);
        assertEq(underlying.balanceOf(user), amount, "unwrap dust failed");
        vm.stopPrank();
    }

    function test_Fuzz_DustFlashLoan(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, 1, 100);

        borrower.executeFlashLoan(address(pt), amount, "");

        assertEq(pt.balanceOf(address(ovrflo)), DEPOSIT_AMOUNT, "vault PT changed after dust flash");
    }

    function test_Fuzz_DepositMinAmount(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, ovrflo.MIN_PT_AMOUNT(), 100e6);

        address user = makeAddr("minDepositUser");
        pt.mint(user, amount);
        _mockSablier(user, uint128(amount * RATE_95 / 1e18), 365 days, 999);

        vm.startPrank(user);
        pt.approve(address(ovrflo), amount);
        (uint256 toUser, uint256 toStream,) = ovrflo.deposit(MARKET, amount, 0);
        vm.stopPrank();

        assertEq(toUser + toStream, amount, "deposit split wrong at min amount");
    }

    /*//////////////////////////////////////////////////////////////
                    R14: ORACLE EDGE RATES
    //////////////////////////////////////////////////////////////*/

    function test_OracleEdge_RateZero() public {
        _mockRate(MARKET, 0);

        (uint256 toUser, uint256 toStream,,) = ovrflo.previewDeposit(MARKET, 10 ether);
        assertEq(toUser, 0, "toUser should be 0 when rate is 0");
        assertEq(toStream, 10 ether, "toStream should be full amount when rate is 0");
    }

    function test_OracleEdge_RateAtPar_Reverts() public {
        _mockRate(MARKET, 1e18);
        vm.expectRevert("OVRFLO: nothing to stream");
        ovrflo.previewDeposit(MARKET, 10 ether);
    }

    function test_OracleEdge_RateAbovePar_Reverts() public {
        _mockRate(MARKET, 1.1e18);
        vm.expectRevert("OVRFLO: nothing to stream");
        ovrflo.previewDeposit(MARKET, 10 ether);
    }

    function test_OracleEdge_RateZero_FlashLoanFeeZero() public {
        _mockRate(MARKET, 0);
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(50);

        uint256 treasuryBefore = underlying.balanceOf(TREASURY);
        borrower.executeFlashLoan(address(pt), 10 ether, "");
        assertEq(underlying.balanceOf(TREASURY), treasuryBefore, "fee should be 0 when rate is 0");
    }

    function test_OracleEdge_FlashLoanFeeScalesWithRate(uint256 rateSeed) public {
        uint256 rateE18 = bound(rateSeed, 0.01e18, 1.5e18);
        uint16 feeBps = 50;

        _mockRate(MARKET, rateE18);
        vm.prank(ADMIN);
        ovrflo.setFlashFeeBps(feeBps);

        uint256 amount = 50 ether;
        uint256 expectedFee = _computeFee(amount, rateE18, feeBps);
        uint256 treasuryBefore = underlying.balanceOf(TREASURY);

        borrower.executeFlashLoan(address(pt), amount, "");

        assertEq(underlying.balanceOf(TREASURY) - treasuryBefore, expectedFee, "fee doesn't scale with rate");
    }

    /*//////////////////////////////////////////////////////////////
                    R10/R14: FLASH LOAN EXCEEDS DEPOSITED
    //////////////////////////////////////////////////////////////*/

    function test_Fuzz_FlashLoanExceedsDeposited_Reverts(uint256 amountSeed) public {
        uint256 amount = bound(amountSeed, DEPOSIT_AMOUNT + 1, DEPOSIT_AMOUNT + 100 ether);
        vm.expectRevert("OVRFLO: exceeds deposited");
        borrower.executeFlashLoan(address(pt), amount, "");
    }

    /*//////////////////////////////////////////////////////////////
                        HELPERS
    //////////////////////////////////////////////////////////////*/

    function _mockRate(address market, uint256 rateE18) internal {
        vm.mockCall(
            PENDLE_ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (market, TWAP_DURATION)), abi.encode(rateE18)
        );
    }

    function _mockSablier(address recipient, uint128 amount, uint256 duration, uint256 streamId) internal {
        ISablierV2LockupLinear.CreateWithDurations memory params = ISablierV2LockupLinear.CreateWithDurations({
            sender: address(ovrflo),
            recipient: recipient,
            totalAmount: amount,
            asset: IERC20(address(ovrfloToken)),
            cancelable: false,
            transferable: true,
            durations: ISablierV2LockupLinear.Durations({cliff: 0, total: uint40(duration)}),
            broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
        });
        bytes memory callData = abi.encodeCall(ISablierV2LockupLinear.createWithDurations, (params));
        vm.mockCall(SABLIER_LL, callData, abi.encode(streamId));
    }

    function _computeFee(uint256 amount, uint256 rateE18, uint16 feeBps) internal pure returns (uint256) {
        uint256 ptValueInUnderlying = (amount * rateE18) / 1e18;
        return (ptValueInUnderlying * feeBps) / 10_000;
    }
}
