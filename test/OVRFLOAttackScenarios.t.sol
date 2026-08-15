// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";
import {IPendleOracle} from "../interfaces/IPendleOracle.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {IFlashBorrower} from "../interfaces/IFlashBorrower.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultMockHelpers} from "./helpers/VaultMockHelpers.sol";
import {LendingMockFixture} from "./helpers/LendingMockFixture.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";

// --- Attack FlashBorrower with configurable callbacks ---

contract AttackFlashBorrower is IFlashBorrower, Test {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    OVRFLO public vault;

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

    constructor(OVRFLO vault_) {
        vault = vault_;
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

    function executeFlashLoan(address ptToken, uint256 amount, bytes calldata data) external {
        vault.flashLoan(ptToken, amount, data);
    }

    function onFlashLoan(address, address, uint256, uint256, bytes calldata) external returns (bytes32) {
        require(msg.sender == address(vault), "not vault");

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

        return CALLBACK_SUCCESS;
    }
}

contract OVRFLOAttackScenariosTest is VaultMockHelpers {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant TREASURY = address(0xBEEF);
    address internal constant MARKET_A = address(0x1001);
    address internal constant MARKET_B = address(0x1002);

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

        _stubLockup();
        ovrflo = new OVRFLO(ADMIN, TREASURY, address(underlying), "OVRFLO UND", "ovrfloUND", PENDLE_ORACLE, SABLIER_LL);
        ovrfloToken = OVRFLOToken(ovrflo.ovrfloToken());

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
}

/// @notice Malicious ERC20 that re-enters the book on an outbound transfer.
/// @dev Ported from the pre-rewrite suite's mock of the same name. The token is
///      deliberately ARTIFICIAL: neither production token has a transfer hook — the
///      underlying is a plain ERC20 (wstETH) and ovrfloToken is a plain OZ ERC20 — and
///      Sablier NFTs move by plain `transferFrom` precisely so `onERC721Received` never
///      fires. There is no raw ETH and no callback surface anywhere in the book, so
///      reentrancy is not a live attack surface here (consistent with the
///      rejected-findings record). This mock exists for one purpose: to prove the
///      `nonReentrant` modifiers are present and correctly placed, by manufacturing the
///      only condition under which they could ever matter.
///
///      The `msg.sender == target` clause is half the arming condition: funding
///      transfers INTO the book go through `transferFrom` (OZ routes that via `_transfer`,
///      never this override) and are untouched. Only an outbound `transfer` initiated BY
///      the book trips the attack. `!reentered` makes it one-shot per `configureAttack`,
///      and `super.transfer` still runs, so the token behaves normally and the outer call
///      succeeds — only the inner reentrant call is expected to fail.
contract ReentrantLendingUnderlying is TestERC20 {
    address public target;
    bytes public payload;
    bool public attackOnTransfer;
    bool public reentered;
    bool public reenterSucceeded;

    constructor(string memory name_, string memory symbol_) TestERC20(name_, symbol_) {}

    function configureAttack(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        attackOnTransfer = true;
        reentered = false;
        reenterSucceeded = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (attackOnTransfer && msg.sender == target && !reentered) {
            reentered = true;
            (reenterSucceeded,) = target.call(payload);
        }
        return super.transfer(to, amount);
    }
}

/// @title OVRFLOAttackScenariosLendingTest
/// @notice Adversarial scenarios against the v1-lite book.
/// @dev The pre-rewrite suite carried exactly one lending scenario
///      (`test_R17_StreamWithdrawalDuringActiveLoan`), which died with the loan-pool API.
///      Sale-path scenarios are deleted outright. Vault-side scenarios above are
///      untouched. What is ported forward is the *shape* of the reentrancy proof and the
///      discipline of asserting all-party balances (pattern #6) rather than state flags.
///
///      Weighting follows the real threat model: the economically live surfaces here are
///      tape-spam griefing and self-fill, not reentrancy.
contract OVRFLOAttackScenariosLendingTest is LendingMockFixture {
    address internal constant LENDER = address(0xA11CE);
    address internal constant BORROWER = address(0xD0C);
    address internal constant GRIEFER = address(0x6816);
    address internal constant SELF_FILLER = address(0x5E1F);

    function setUp() public {
        _deployLendingSystem();
    }

    /*//////////////////////////////////////////////////////////////
        TAPE SPAM — THE ATOM IS THE FLOOR, THE COST IS GAS (RISK #4)
    //////////////////////////////////////////////////////////////*/

    /// @notice Tape-spam economics are bounded by `MIN_LIQUIDITY_AMOUNT`.
    /// @dev Two halves of one claim. First, the atom is a hard floor: no leaf can be
    ///      appended for less, so an attacker cannot manufacture arbitrarily cheap
    ///      coordinates. Second, the atom bounds the attacker's STAKE and not their
    ///      spend — one atom cycles indefinitely because `withdraw` refunds it in full,
    ///      which is exactly why the plan prices this grief in gas rather than capital.
    ///      The gas figure itself is measured in `OVRFLOLendingGas`.
    function test_Attack_TapeSpamIsFlooredByAtomAndCapitalNeutral() public {
        uint128 atom = lending.MIN_LIQUIDITY_AMOUNT();
        uint128 unit = lending.UNIT();

        // Half one: a UNIT-aligned amount one granule below the atom is refused, so the
        // floor is real and not merely conventional.
        _fundLender(GRIEFER, 100 ether);
        vm.prank(GRIEFER);
        vm.expectRevert(OVRFLOLending.BelowMinimum.selector);
        lending.supply(MARKET, APR, atom - unit);

        // Half two: one atom, recycled. The attacker never needs a second one.
        uint256 cycles = 10;
        uint256 startBalance = underlying.balanceOf(GRIEFER);
        uint256 firstId = lending.nextPositionId();

        for (uint256 i = 0; i < cycles; ++i) {
            vm.prank(GRIEFER);
            uint256 positionId = lending.supply(MARKET, APR, atom);
            // Exactly one atom is escrowed per leaf — never less.
            assertEq(underlying.balanceOf(address(lending)), atom, "escrow is not one atom");
            vm.prank(GRIEFER);
            lending.withdraw(positionId);
        }

        assertEq(underlying.balanceOf(GRIEFER), startBalance, "spam consumed capital");
        assertEq(underlying.balanceOf(address(lending)), 0, "escrow residue after spam");

        // The state cost is permanent: every cycle left a leaf behind that no withdraw
        // reclaims. This is the damage the gas price is buying, and it is why the
        // borrow-side cursor carries a hard cap.
        assertEq(lending.nextPositionId(), firstId + cycles, "leaves were reclaimed");
        (OVRFLOLending.Position memory last,,, uint128 unfilled) = lending.positionState(firstId + cycles - 1);
        assertEq(uint256(last.leafIndex), cycles - 1, "leaf indexes were reused");
        assertEq(unfilled, 0, "withdrawn leaf still reports unfilled depth");
    }

    /*//////////////////////////////////////////////////////////////
              SELF-FILL YIELDS NOTHING BEYOND THE FEE (AE7)
    //////////////////////////////////////////////////////////////*/

    /// @notice Covers AE7: self-filling is permitted and strictly self-harming.
    /// @dev Critical pattern #4's self-match guard was dropped by design — blind fills
    ///      cannot enumerate positions, and per the L-12 reasoning the guard was a
    ///      correctness nicety rather than a security boundary. This test is the
    ///      evidence for that call: an actor who lends to themselves ends the round
    ///      down exactly the protocol fee, holding a debt and an escrowed stream. There
    ///      is no free profit and no state the actor could not have reached honestly.
    function test_Attack_SelfFillYieldsNothingBeyondFeeLoss() public {
        vm.prank(address(factory));
        lending.setFee(100); // 1%

        uint128 stake = 10 ether;
        _fundLender(SELF_FILLER, stake);
        uint256 startBalance = underlying.balanceOf(SELF_FILLER);

        vm.prank(SELF_FILLER);
        uint256 positionId = lending.supply(MARKET, APR, stake);

        // The same actor pledges a stream and consumes its own resting liquidity.
        _createStream(1, SELF_FILLER, _faceForGross(100 ether));
        vm.prank(SELF_FILLER);
        uint256 loanId = lending.borrow(MARKET, APR, stake, 1, 0);

        (OVRFLOLending.Loan memory loan, uint128 outstanding) = lending.loanState(loanId);
        uint128 actualBorrow = uint128(uint256(loan.fillEnd - loan.fillStart) * lending.UNIT());
        assertEq(actualBorrow, stake, "self-fill did not consume the full stake");

        uint256 feePaid = underlying.balanceOf(LENDING_TREASURY);
        assertGt(feePaid, 0, "fee-zero market makes this test vacuous");

        // All-party balances (pattern #6): the round trip cost exactly the fee.
        assertEq(underlying.balanceOf(SELF_FILLER), startBalance - feePaid, "self-fill was not fee-neutral");
        assertEq(underlying.balanceOf(address(lending)), 0, "underlying stranded in the book");
        assertEq(underlying.balanceOf(SELF_FILLER) + feePaid, startBalance, "underlying created or destroyed");

        // And the actor is strictly worse off in every other dimension: the stream is
        // escrowed and a debt is outstanding against it.
        assertEq(sablier.ownerOf(1), address(lending), "stream was not escrowed");
        assertGt(outstanding, 0, "self-fill produced no obligation");
        assertGe(outstanding, actualBorrow, "obligation undershot the principal advanced");

        // The lender leg is a real position, not a special case — it is simply their own.
        (OVRFLOLending.Position memory position,,,) = lending.positionState(positionId);
        assertEq(position.lender, SELF_FILLER, "self-filled position lost its lender");
        assertEq(lending.contributionOf(loanId, positionId), stake, "self-contribution was not attributed");
    }

    /*//////////////////////////////////////////////////////////////
                REENTRANCY GUARDS ARE PRESENT AND PLACED
    //////////////////////////////////////////////////////////////*/

    /// @notice The `nonReentrant` guard blocks reentry through `borrow`'s payout transfer.
    /// @dev The two-part assertion is load-bearing: `reentered` proves the attack path was
    ///      actually reached (a test asserting only `!reenterSucceeded` would pass
    ///      vacuously if the hook never fired), and `!reenterSucceeded` proves the guard
    ///      rejected it.
    ///
    ///      The reentry TARGET is chosen to make the guard the only thing that can refuse
    ///      the call. `advanceEpochCursor` is permissionless and succeeds as a no-op when
    ///      nothing qualifies, so an unguarded book would accept it. That matters: the
    ///      obvious choice — re-entering `withdraw(positionId)` — is silently vacuous,
    ///      because during reentry `msg.sender` is the hostile token rather than the
    ///      lender, so `NotLender` rejects it whether or not the guard exists. A mutation
    ///      run confirmed the vacuity directly: with `borrow`'s `nonReentrant` stripped,
    ///      the `withdraw`-targeted version of this test still passed. It fails as it
    ///      should against the target below.
    function test_Attack_ReentrancyBlockedOnBorrowPayoutPath() public {
        ReentrantLendingUnderlying hostileUnderlying = new ReentrantLendingUnderlying("Hostile UND", "hUND");
        (OVRFLOLending book, MockLendingSablier bookSablier, TestERC20 bookOvrflo) =
            _deployBookWith(address(hostileUnderlying), address(0));

        hostileUnderlying.mint(LENDER, 100 ether);
        vm.startPrank(LENDER);
        hostileUnderlying.approve(address(book), type(uint256).max);
        book.supply(MARKET, APR, 100 ether);
        vm.stopPrank();

        // Arm only now: the supply above must not trip it (that path is `transferFrom`).
        hostileUnderlying.configureAttack(
            address(book), abi.encodeCall(OVRFLOLending.advanceEpochCursor, (MARKET, APR, 1))
        );

        bookSablier.setStream(
            500, BORROWER, address(bookCore), IERC20(address(bookOvrflo)), uint40(expiry), 0, false, 102 ether, 0
        );
        vm.prank(BORROWER);
        bookSablier.approve(address(book), 500);

        // `_payUnderlying` calls `transfer` with the book as msg.sender — the attack fires.
        vm.prank(BORROWER);
        book.borrow(MARKET, APR, 10 ether, 500, 0);

        assertTrue(hostileUnderlying.reentered(), "reentry was never attempted - test is vacuous");
        assertFalse(hostileUnderlying.reenterSucceeded(), "reentry succeeded - guard failed");
    }

    /// @notice The `nonReentrant` guard blocks reentry through `claim`'s harvest payout.
    /// @dev Same shape, different token: claims pay ovrfloToken, so the hostile token
    ///      takes the ovrfloToken slot. This is also the stream's payout asset, which is
    ///      what puts the reentry immediately after the just-in-time Sablier harvest —
    ///      the deepest point of the claim path. The reentry target is permissionless for
    ///      the same non-vacuity reason documented on the borrow-path test above.
    function test_Attack_ReentrancyBlockedOnClaimHarvestPath() public {
        ReentrantLendingUnderlying hostileOvrflo = new ReentrantLendingUnderlying("Hostile OVRFLO", "hOVR");
        TestERC20 plainUnderlying = new TestERC20("Underlying", "UND");
        (OVRFLOLending book, MockLendingSablier bookSablier,) =
            _deployBookWith(address(plainUnderlying), address(hostileOvrflo));

        plainUnderlying.mint(LENDER, 100 ether);
        vm.startPrank(LENDER);
        plainUnderlying.approve(address(book), type(uint256).max);
        uint256 positionId = book.supply(MARKET, APR, 100 ether);
        vm.stopPrank();

        bookSablier.setStream(
            500, BORROWER, address(bookCore), IERC20(address(hostileOvrflo)), uint40(expiry), 0, false, 102 ether, 0
        );
        vm.prank(BORROWER);
        bookSablier.approve(address(book), 500);
        vm.prank(BORROWER);
        uint256 loanId = book.borrow(MARKET, APR, 10 ether, 500, 0);

        // Vest some accrual so the claim has a deficit to harvest.
        bookSablier.setWithdrawable(500, 5 ether);

        hostileOvrflo.configureAttack(address(book), abi.encodeCall(OVRFLOLending.advanceEpochCursor, (MARKET, APR, 1)));

        vm.prank(LENDER);
        book.claim(loanId, positionId, type(uint128).max);

        assertTrue(hostileOvrflo.reentered(), "reentry was never attempted - test is vacuous");
        assertFalse(hostileOvrflo.reenterSucceeded(), "reentry succeeded - guard failed");
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    MockLendingCore internal bookCore;

    /// @dev Stands up an isolated book so a single token slot can be made hostile
    ///      without disturbing the shared fixture. Pass `address(0)` for the ovrfloToken
    ///      to have a plain one minted.
    function _deployBookWith(address underlying_, address ovrfloToken_)
        internal
        returns (OVRFLOLending book, MockLendingSablier bookSablier, TestERC20 bookOvrflo)
    {
        MockLendingFactory bookFactory = new MockLendingFactory();
        bookCore = new MockLendingCore();
        bookSablier = new MockLendingSablier();
        bookOvrflo = ovrfloToken_ == address(0) ? new TestERC20("Book OVRFLO", "bOVR") : TestERC20(ovrfloToken_);

        bookFactory.setInfo(address(bookCore), LENDING_TREASURY, underlying_, address(bookOvrflo));
        bookCore.setSeries(MARKET, expiry, address(bookOvrflo), underlying_);

        book = new OVRFLOLending(address(bookFactory), address(bookCore), address(bookSablier));
        vm.prank(address(bookFactory));
        book.setTickSpacing(MARKET, SPACING);
    }
}
