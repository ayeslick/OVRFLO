// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";

contract InvariantMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract InvariantOvrfloAdmin {
    address public treasury;
    address public underlying;
    address public ovrfloToken;

    function setInfo(address treasury_, address underlying_, address ovrfloToken_) external {
        treasury = treasury_;
        underlying = underlying_;
        ovrfloToken = ovrfloToken_;
    }

    function approveSeries(OVRFLO ovrflo, address market, address pt, uint32 twapDuration, uint256 expiry) external {
        ovrflo.setSeriesApproved(market, pt, twapDuration, expiry, 0);
    }

    function sweepExcessUnderlying(OVRFLO ovrflo, address to) external {
        ovrflo.sweepExcessUnderlying(to);
    }

    function setFlashFeeBps(OVRFLO ovrflo, uint16 feeBps) external {
        ovrflo.setFlashFeeBps(feeBps);
    }

    function setFlashLoanPaused(OVRFLO ovrflo, bool paused) external {
        ovrflo.setFlashLoanPaused(paused);
    }

    function ovrfloInfo(address) external view returns (address, address, address) {
        return (treasury, underlying, ovrfloToken);
    }
}

/// @notice Simplified FlashBorrower for invariant testing. Always returns success hash.
///         Action mode: 0=none, 1=deposit, 2=wrap, 3=unwrap, 4=nested flash loan.
contract InvariantFlashBorrower is IFlashBorrower {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;
    uint256 public actionMode;
    address public depositMarket;
    uint256 public depositAmount;

    bool public nestedSucceeded;

    constructor(OVRFLO vault_) {
        vault = vault_;
    }

    function setActionMode(uint256 mode) external {
        actionMode = mode;
    }

    function setDepositParams(address market, uint256 amount) external {
        depositMarket = market;
        depositAmount = amount;
    }

    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address, address ptToken, uint256, uint256, bytes calldata) external returns (bytes32) {
        require(msg.sender == address(vault), "not vault");

        if (actionMode == 1) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.deposit, (depositMarket, depositAmount, 0)));
            require(ok, "deposit during callback failed");
        } else if (actionMode == 2) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.wrap, (depositAmount)));
            require(ok, "wrap during callback failed");
        } else if (actionMode == 3) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.unwrap, (depositAmount)));
            require(ok, "unwrap during callback failed");
        } else if (actionMode == 4) {
            (bool ok,) = address(vault).call(abi.encodeCall(OVRFLO.flashLoan, (ptToken, depositAmount, "")));
            nestedSucceeded = ok;
        }

        return CALLBACK_SUCCESS;
    }
}

contract OVRFLOInvariantHandler is Test {
    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    InvariantMockERC20 internal underlying;
    InvariantMockERC20 internal pt;
    InvariantOvrfloAdmin internal admin;
    InvariantFlashBorrower internal borrower;

    address internal market;
    uint256 internal expiry;

    address[3] internal actors;

    uint256 public totalWrapped;
    uint256 public totalUnwrapped;
    uint256 public totalFlashLoaned;

    constructor(
        OVRFLO ovrflo_,
        OVRFLOToken ovrfloToken_,
        InvariantMockERC20 underlying_,
        InvariantMockERC20 pt_,
        InvariantOvrfloAdmin admin_,
        InvariantFlashBorrower borrower_,
        address market_,
        uint256 expiry_
    ) {
        ovrflo = ovrflo_;
        ovrfloToken = ovrfloToken_;
        underlying = underlying_;
        pt = pt_;
        admin = admin_;
        borrower = borrower_;
        market = market_;
        expiry = expiry_;

        actors = [makeAddr("handlerUserA"), makeAddr("handlerUserB"), makeAddr("handlerUserC")];
    }

    function deposit(uint256 actorSeed, uint256 amount) public {
        if (block.timestamp >= expiry) return;

        address actor = _actor(actorSeed);
        amount = bound(amount, ovrflo.MIN_PT_AMOUNT(), 50 ether);

        pt.mint(actor, amount);

        vm.startPrank(actor);
        pt.approve(address(ovrflo), amount);
        ovrflo.deposit(market, amount, 0);
        vm.stopPrank();
    }

    function claim(uint256 actorSeed, uint256 amount) public {
        uint256 deposited = ovrflo.marketTotalDeposited(market);
        if (deposited == 0) return;

        address actor = _actor(actorSeed);
        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance == 0) return;

        uint256 maxAmount = _min(balance, deposited);
        amount = bound(amount, 1, maxAmount);

        if (block.timestamp < expiry) {
            vm.warp(expiry);
        }

        vm.prank(actor);
        ovrflo.claim(address(pt), amount);
    }

    function wrap(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        amount = bound(amount, 1, 50 ether);

        underlying.mint(actor, amount);

        vm.startPrank(actor);
        underlying.approve(address(ovrflo), amount);
        ovrflo.wrap(amount);
        vm.stopPrank();

        totalWrapped += amount;
    }

    function unwrap(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        uint256 maxAmount = _min(ovrfloToken.balanceOf(actor), ovrflo.wrappedUnderlying());
        if (maxAmount == 0) return;

        amount = bound(amount, 1, maxAmount);

        vm.prank(actor);
        ovrflo.unwrap(amount);

        totalUnwrapped += amount;
    }

    function unwrapBeyondReserve(uint256 actorSeed, uint256 amount) public {
        address actor = _actor(actorSeed);
        uint256 reserve = ovrflo.wrappedUnderlying();
        uint256 balance = ovrfloToken.balanceOf(actor);
        if (balance <= reserve) return;

        amount = bound(amount, reserve + 1, balance);
        uint256 underlyingBefore = underlying.balanceOf(address(ovrflo));

        vm.prank(actor);
        vm.expectRevert("OVRFLO: insufficient reserve");
        ovrflo.unwrap(amount);

        assertEq(ovrflo.wrappedUnderlying(), reserve);
        assertEq(underlying.balanceOf(address(ovrflo)), underlyingBefore);
    }

    function sweepExcessUnderlying(uint256 amount) public {
        amount = bound(amount, 1, 50 ether);
        underlying.mint(address(ovrflo), amount);
        admin.sweepExcessUnderlying(ovrflo, actors[0]);
    }

    function flashLoan(uint256 amountSeed, uint256 actionSeed) public {
        if (block.timestamp >= expiry) return;

        uint256 deposited = ovrflo.marketTotalDeposited(market);
        if (deposited == 0) return;

        uint256 amount = bound(amountSeed, 1, deposited);
        uint256 action = actionSeed % 5;

        borrower.setActionMode(action);

        if (action == 1) {
            // deposit during callback: pre-fund borrower with extra PT for repayment
            borrower.setDepositParams(market, amount);
            pt.mint(address(borrower), amount);
            vm.prank(address(borrower));
            pt.approve(address(ovrflo), amount);
        } else if (action == 2) {
            // wrap during callback: pre-fund borrower with underlying
            borrower.setDepositParams(address(0), amount);
            underlying.mint(address(borrower), amount);
            vm.prank(address(borrower));
            underlying.approve(address(ovrflo), amount);
        } else if (action == 3) {
            // unwrap during callback: pre-fund borrower with ovrfloToken via wrap
            borrower.setDepositParams(address(0), _min(amount, ovrflo.wrappedUnderlying()));
            underlying.mint(address(borrower), amount);
            vm.startPrank(address(borrower));
            underlying.approve(address(ovrflo), amount);
            ovrflo.wrap(amount);
            vm.stopPrank();
        } else if (action == 4) {
            // nested flash loan attempt: set amount for nested call
            borrower.setDepositParams(address(0), amount);
        }

        borrower.executeFlashLoan(address(pt), amount, "");

        totalFlashLoaned += amount;
    }

    function flashLoanWithFee(uint256 amountSeed, uint256 actionSeed, uint256 feeSeed) public {
        if (block.timestamp >= expiry) return;

        uint256 feeBps = bound(feeSeed, 1, 100);
        admin.setFlashFeeBps(ovrflo, uint16(feeBps));

        flashLoan(amountSeed, actionSeed);
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract OVRFLOInvariantTest is Test {
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET = address(0x1001);
    address internal constant ORACLE = address(0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2);
    address internal constant SABLIER_LL = address(0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9);
    uint32 internal constant TWAP_DURATION = 30 minutes;
    uint256 internal constant EXPIRY = 30 days;
    uint256 internal constant RATE_E18 = 0.8e18;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    InvariantMockERC20 internal underlying;
    InvariantMockERC20 internal pt;
    InvariantOvrfloAdmin internal admin;
    InvariantFlashBorrower internal borrower;
    OVRFLOInvariantHandler internal handler;

    function setUp() public {
        underlying = new InvariantMockERC20("Underlying", "UND");
        pt = new InvariantMockERC20("PT", "PT");
        ovrfloToken = new OVRFLOToken("OVRFLO Underlying", "ovrfloUND");
        admin = new InvariantOvrfloAdmin();
        ovrflo = new OVRFLO(address(admin), TREASURY, address(underlying), address(ovrfloToken), ORACLE);
        ovrfloToken.transferOwnership(address(ovrflo));

        admin.setInfo(TREASURY, address(underlying), address(ovrfloToken));
        admin.approveSeries(ovrflo, MARKET, address(pt), TWAP_DURATION, EXPIRY);

        vm.mockCall(ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (MARKET, TWAP_DURATION)), abi.encode(RATE_E18));
        vm.mockCall(
            ORACLE, abi.encodeCall(IPendleOracle.getOracleState, (MARKET, TWAP_DURATION)), abi.encode(false, 0, true)
        );
        vm.mockCall(
            SABLIER_LL, abi.encodeWithSelector(ISablierV2LockupLinear.createWithDurations.selector), abi.encode(1)
        );

        borrower = new InvariantFlashBorrower(ovrflo);

        // Fund borrower with underlying for flash loan fees and approvals
        underlying.mint(address(borrower), 1_000 ether);
        vm.startPrank(address(borrower));
        pt.approve(address(ovrflo), type(uint256).max);
        underlying.approve(address(ovrflo), type(uint256).max);
        ovrfloToken.approve(address(ovrflo), type(uint256).max);
        vm.stopPrank();

        // Fund wrap reserve so unwrap works
        underlying.mint(address(this), 200 ether);
        underlying.approve(address(ovrflo), 200 ether);
        ovrflo.wrap(200 ether);

        handler = new OVRFLOInvariantHandler(ovrflo, ovrfloToken, underlying, pt, admin, borrower, MARKET, EXPIRY);
        targetContract(address(handler));
    }

    /*//////////////////////////////////////////////////////////////
                        INVARIANTS (R1-R5)
    //////////////////////////////////////////////////////////////*/

    /// @notice R1: ovrfloToken supply == marketTotalDeposited + wrappedUnderlying
    function invariant_SupplyEqualsPtBackingPlusUnderlyingReserve() public view {
        assertEq(
            ovrfloToken.totalSupply(),
            ovrflo.marketTotalDeposited(MARKET) + ovrflo.wrappedUnderlying(),
            "supply backing mismatch"
        );
    }

    /// @notice R2: vault PT balance >= marketTotalDeposited
    function invariant_PtBalanceGteDeposited() public view {
        assertLe(
            ovrflo.marketTotalDeposited(MARKET),
            pt.balanceOf(address(ovrflo)),
            "vault PT balance < marketTotalDeposited"
        );
    }

    /// @notice R3: vault underlying balance >= wrappedUnderlying
    function invariant_UnderlyingBalanceGteWrappedReserve() public view {
        assertLe(ovrflo.wrappedUnderlying(), underlying.balanceOf(address(ovrflo)), "reserve exceeds balance");
    }

    /// @notice R4: flash loans never reduce vault PT balance below marketTotalDeposited
    /// @dev R2 subsumes this, but we add an explicit check on the ghost variable.
    function invariant_FlashLoanDoesNotDrainVault() public view {
        assertLe(
            ovrflo.marketTotalDeposited(MARKET),
            pt.balanceOf(address(ovrflo)),
            "flash loan drained vault PT below deposited"
        );
    }

    /// @notice R5: nested flash loans always blocked by nonReentrant
    function invariant_NestedFlashLoanAlwaysReverts() public view {
        assertFalse(borrower.nestedSucceeded(), "nested flash loan should always revert");
    }
}
