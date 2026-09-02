// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LendingMockFixture} from "./helpers/LendingMockFixture.sol";
import {OVRFLOLending} from "../src/OVRFLOLending.sol";
import {TestERC20} from "./mocks/TestERC20.sol";
import {MockLendingFactory, MockLendingCore, MockLendingSablier} from "./mocks/LendingMocks.sol";

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
///      Sale-path scenarios are deleted outright. PT flash attack scenarios are
///      gone with the vault flash surface. What is ported forward is the *shape*
///      of the reentrancy proof and the
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

        book = new OVRFLOLending(address(bookFactory), address(bookCore), address(bookSablier), APR);
        vm.prank(address(bookFactory));
        book.setTickSpacing(MARKET, SPACING);
    }
}
