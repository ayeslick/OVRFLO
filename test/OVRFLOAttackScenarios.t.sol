// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";

contract AttackMockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// --- Book mocks (minimal copies for R17) ---

contract AttackMockFactory {
    struct Info {
        address treasury;
        address underlying;
        address ovrfloToken;
    }

    mapping(address => Info) internal infos;
    mapping(address => mapping(address => bool)) public isMarketApproved;

    function setInfo(address core, address treasury, address underlying, address ovrfloToken) external {
        infos[core] = Info({treasury: treasury, underlying: underlying, ovrfloToken: ovrfloToken});
    }

    function setMarketApproved(address core, address market, bool approved) external {
        isMarketApproved[core][market] = approved;
    }

    function ovrfloInfo(address core) external view returns (address, address, address) {
        Info memory info = infos[core];
        return (info.treasury, info.underlying, info.ovrfloToken);
    }
}

contract AttackMockCore {
    struct Series {
        bool approved;
        uint32 twapDurationFixed;
        uint16 feeBps;
        uint256 expiryCached;
        address ptToken;
        address ovrfloToken;
        address underlying;
        address oracle;
    }

    mapping(address => Series) internal seriesInfo;

    function setSeries(address market, bool approved, uint256 expiryCached, address ovrfloToken, address underlying)
        external
    {
        seriesInfo[market] = Series({
            approved: approved,
            twapDurationFixed: 30 minutes,
            feeBps: 0,
            expiryCached: expiryCached,
            ptToken: address(0xAAAA),
            ovrfloToken: ovrfloToken,
            underlying: underlying,
            oracle: address(0xBBBB)
        });
    }

    function series(address market)
        external
        view
        returns (bool, uint32, uint16, uint256, address, address, address, address)
    {
        Series memory info = seriesInfo[market];
        return (
            info.approved,
            info.twapDurationFixed,
            info.feeBps,
            info.expiryCached,
            info.ptToken,
            info.ovrfloToken,
            info.underlying,
            info.oracle
        );
    }
}

contract AttackMockSablier {
    struct Stream {
        address sender;
        IERC20 asset;
        uint40 startTime;
        uint40 endTime;
        uint40 cliffTime;
        bool cancelable;
        uint128 deposited;
        uint128 withdrawn;
        uint128 withdrawable;
    }

    mapping(uint256 => Stream) internal streams;
    mapping(uint256 => address) internal owners;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function setStream(
        uint256 streamId,
        address owner,
        address sender,
        IERC20 asset,
        uint40 endTime,
        uint40 cliffTime,
        bool cancelable,
        uint128 deposited,
        uint128 withdrawn
    ) external {
        uint40 startTime = uint40(block.timestamp);
        if (cliffTime == 0) cliffTime = startTime;
        owners[streamId] = owner;
        streams[streamId] = Stream({
            sender: sender,
            asset: asset,
            startTime: startTime,
            endTime: endTime,
            cliffTime: cliffTime,
            cancelable: cancelable,
            deposited: deposited,
            withdrawn: withdrawn,
            withdrawable: 0
        });
    }

    function setWithdrawable(uint256 streamId, uint128 withdrawable) external {
        streams[streamId].withdrawable = withdrawable;
    }

    function approve(address to, uint256 streamId) external {
        require(owners[streamId] == msg.sender, "not owner");
        getApproved[streamId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 streamId) external {
        address owner = owners[streamId];
        require(owner == from, "wrong from");
        require(
            msg.sender == from || getApproved[streamId] == msg.sender || isApprovedForAll[from][msg.sender],
            "not approved"
        );
        require(to != address(0), "zero to");
        owners[streamId] = to;
        delete getApproved[streamId];
    }

    function ownerOf(uint256 streamId) external view returns (address) {
        return owners[streamId];
    }

    function getSender(uint256 streamId) external view returns (address) {
        return streams[streamId].sender;
    }

    function getAsset(uint256 streamId) external view returns (IERC20) {
        return streams[streamId].asset;
    }

    function getEndTime(uint256 streamId) external view returns (uint40) {
        return streams[streamId].endTime;
    }

    function getStartTime(uint256 streamId) external view returns (uint40) {
        return streams[streamId].startTime;
    }

    function getCliffTime(uint256 streamId) external view returns (uint40) {
        return streams[streamId].cliffTime;
    }

    function isCancelable(uint256 streamId) external view returns (bool) {
        return streams[streamId].cancelable;
    }

    function getDepositedAmount(uint256 streamId) external view returns (uint128) {
        return streams[streamId].deposited;
    }

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128) {
        return streams[streamId].withdrawn;
    }

    function withdrawableAmountOf(uint256 streamId) external view returns (uint128) {
        Stream memory stream = streams[streamId];
        uint128 remaining = stream.deposited - stream.withdrawn;
        return stream.withdrawable < remaining ? stream.withdrawable : remaining;
    }

    function withdraw(uint256 streamId, address to, uint128 amount) external {
        require(amount > 0, "amount zero");
        uint128 withdrawable = this.withdrawableAmountOf(streamId);
        require(amount <= withdrawable, "amount too high");
        streams[streamId].withdrawn += amount;
        streams[streamId].withdrawable = withdrawable - amount;
        AttackMockERC20(address(streams[streamId].asset)).mint(to, amount);
    }
}

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

contract OVRFLOAttackScenariosTest is Test {
    address internal constant PENDLE_ORACLE = 0x9a9Fa8338dd5E5B2188006f1Cd2Ef26d921650C2;
    address internal constant SABLIER_LL = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET_A = address(0x1001);
    address internal constant MARKET_B = address(0x1002);
    address internal constant BOOK_MARKET = address(0x5555);

    uint32 internal constant TWAP_DURATION = 30 minutes;
    uint256 internal constant RATE_95 = 0.95e18;

    OVRFLO internal ovrflo;
    OVRFLOToken internal ovrfloToken;
    AttackMockERC20 internal underlying;
    AttackMockERC20 internal ptA;
    AttackMockERC20 internal ptB;
    AttackFlashBorrower internal borrower;

    uint256 internal constant DEPOSIT_AMOUNT = 100 ether;

    function setUp() public {
        uint256 expiry = block.timestamp + 365 days;

        underlying = new AttackMockERC20("Underlying", "UND");
        ptA = new AttackMockERC20("PT-A", "PTA");
        ptB = new AttackMockERC20("PT-B", "PTB");

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
        // Set up Book with its own mock tokens (separate from vault's ovrfloToken)
        AttackMockFactory factory = new AttackMockFactory();
        AttackMockCore core = new AttackMockCore();
        AttackMockSablier bookSablier = new AttackMockSablier();
        AttackMockERC20 bookUnderlying = new AttackMockERC20("BookUnderlying", "BUND");
        AttackMockERC20 bookOvrfloToken = new AttackMockERC20("BookOvrflo", "bovRFLO");
        uint256 expiry = block.timestamp + 365 days;

        factory.setInfo(address(core), TREASURY, address(bookUnderlying), address(bookOvrfloToken));
        factory.setMarketApproved(address(core), BOOK_MARKET, true);
        core.setSeries(BOOK_MARKET, true, expiry, address(bookOvrfloToken), address(bookUnderlying));

        OVRFLOBook book = new OVRFLOBook(address(factory), address(core), address(bookSablier));

        address lender = makeAddr("lender");
        address borrowerAddr = makeAddr("loanBorrower");

        // Fund actors
        bookUnderlying.mint(lender, 200 ether);
        bookOvrfloToken.mint(borrowerAddr, 200 ether);

        vm.startPrank(lender);
        bookUnderlying.approve(address(book), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(borrowerAddr);
        bookOvrfloToken.approve(address(book), type(uint256).max);
        bookSablier.setApprovalForAll(address(book), true);
        vm.stopPrank();

        // Create an eligible stream
        uint256 streamId = 1;
        bookSablier.setStream(
            streamId,
            borrowerAddr,
            address(core),
            IERC20(address(bookOvrfloToken)),
            uint40(expiry),
            0,
            false,
            100 ether,
            0
        );

        // Post offer
        vm.prank(lender);
        uint256 offerId = book.postOffer(BOOK_MARKET, 1000, 50 ether);

        // Create borrow pool with single offer
        vm.startPrank(borrowerAddr);
        bookSablier.approve(address(book), streamId);
        uint256 poolId = book.createBorrowPool(_singletonArray(offerId), streamId, 50 ether, 0);
        vm.stopPrank();
        uint256 loanId = 1;

        // Read loan state
        (,,, uint128 obligation,,,) = book.loans(loanId);

        // Set partial withdrawable
        uint128 partialClaim = obligation / 2;
        bookSablier.setWithdrawable(streamId, partialClaim);

        // Lender claims partial via pool
        vm.prank(lender);
        book.poolClaimLoan(poolId, partialClaim);

        // Borrower repays remainder
        uint128 outstanding = obligation - partialClaim;
        vm.prank(borrowerAddr);
        book.repayLoan(loanId, outstanding);

        // Loan should be closed and NFT returned
        (,,,,,, bool closed) = book.loans(loanId);
        assertTrue(closed, "loan should be closed after full repayment");

        assertEq(bookSablier.ownerOf(streamId), borrowerAddr, "NFT should be returned to borrower");

        // Lender withdraws repaid portion from pool proceeds
        vm.prank(lender);
        book.claimPoolShare(poolId, outstanding);

        // Lender total received: partialClaim (from stream) + outstanding (from pool proceeds) == obligation
        uint128 lenderOvrfloReceived = uint128(bookOvrfloToken.balanceOf(lender));
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

    function _mockRate(address market, uint256 rateE18) internal {
        vm.mockCall(
            PENDLE_ORACLE, abi.encodeCall(IPendleOracle.getPtToSyRate, (market, TWAP_DURATION)), abi.encode(rateE18)
        );
        vm.mockCall(
            PENDLE_ORACLE,
            abi.encodeCall(IPendleOracle.getOracleState, (market, TWAP_DURATION)),
            abi.encode(false, 0, true)
        );
    }

    function _computeFee(uint256 amount, uint256 rateE18, uint16 feeBps) internal pure returns (uint256) {
        uint256 ptValueInUnderlying = (amount * rateE18) / 1e18;
        return (ptValueInUnderlying * feeBps) / 10_000;
    }

    function _singletonArray(uint256 id) internal pure returns (uint256[] memory arr) {
        arr = new uint256[](1);
        arr[0] = id;
    }
}
