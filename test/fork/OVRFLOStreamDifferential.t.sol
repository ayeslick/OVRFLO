// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OVRFLO} from "../../src/OVRFLO.sol";
import {OVRFLOFactory} from "../../src/OVRFLOFactory.sol";
import {ISablierV2LockupLinear} from "../../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOForkBase} from "./OVRFLOForkBase.t.sol";

interface IComptrollerAdmin {
    function admin() external view returns (address);
}

/// @notice Recipient contract that records whether Lockup invoked its withdraw hook.
contract DifferentialHookProbe {
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

    function approveOperator(address sablier, address operator, uint256 streamId) external {
        (bool ok,) = sablier.call(abi.encodeWithSignature("approve(address,uint256)", operator, streamId));
        require(ok, "probe: approve failed");
    }
}

/// @dev Qualitative S1–S5 outcomes. Amounts differ across deployments; booleans must match.
struct S1S5Probe {
    bool cancelable;
    bool cliffEqualsStart;
    bool withdrawableIncreased;
    bool transferMovesOwner;
    bool strangerWithdrawReverts;
    bool strangerPushToRecipientReverts;
    bool operatorHookFires;
    bool selfWithdrawSkipsHook;
}

/// @title OVRFLOStreamDifferentialForkTest
/// @notice Fork tests against committed OVRFLOStream bytecode, plus one S1–S5
///         differential probe against canonical Sablier still resident at the
///         pinned fork block.
contract OVRFLOStreamDifferentialForkTest is OVRFLOForkBase {
    address internal constant USER = address(0xB0B);
    uint32 internal constant PROTOCOL_TWAP_DURATION = 30 minutes;
    uint256 internal constant PT_AMOUNT = 10 ether;
    uint256 internal constant CANONICAL_DEPOSIT = 1 ether;

    function test_DeployedStream_IsNotCanonicalAndFactoryIsAdmin() public {
        (OVRFLOFactory factory, OVRFLO ovrflo,) = _deployConfiguredSystem();
        address stream = address(ovrflo.sablierLL());
        ISablierV2LockupLinear lockup = ISablierV2LockupLinear(stream);

        assertTrue(stream != CANONICAL_SABLIER, "seeded vault must not bind canonical Sablier");
        assertEq(lockup.admin(), address(factory), "lockup admin must be the factory");
        assertEq(lockup.factory(), address(factory), "lockup factory must be the factory");
        assertEq(
            IComptrollerAdmin(lockup.comptroller()).admin(), address(factory), "comptroller admin must be the factory"
        );
        assertEq(factory.ovrfloStream(), stream, "factory.ovrfloStream must equal the seeded stream");
        assertTrue(CANONICAL_SABLIER.code.length > 0, "canonical Sablier must still be resident");
    }

    function test_UnregisteredCreate_RevertsUnknownOvrflo() public {
        (, OVRFLO ovrflo,) = _deployConfiguredSystem();
        ISablierV2LockupLinear lockup = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        address stranger = makeAddr("unregistered");

        ISablierV2LockupLinear.CreateWithDurations memory params = ISablierV2LockupLinear.CreateWithDurations({
            sender: stranger,
            recipient: stranger,
            totalAmount: 1 ether,
            asset: IERC20(WSTETH),
            cancelable: false,
            transferable: true,
            durations: ISablierV2LockupLinear.Durations({cliff: 0, total: 30 days}),
            broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
        });

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSignature("SablierV2Lockup_UnknownOvrflo(address)", stranger));
        lockup.createWithDurations(params);
    }

    /// @notice S1–S5 against both our lockup and canonical Sablier at the pinned block.
    /// @dev Outcomes must match. Otherwise the audit record's falsifier is our code
    ///      asserting against itself.
    function test_S1S5_ForkMatchesCanonicalSablier() public {
        (, OVRFLO ovrflo) = _deployApprovedPrimarySeries();
        ISablierV2LockupLinear ours = ISablierV2LockupLinear(address(ovrflo.sablierLL()));
        uint256 ourId = _depositPrimary(ovrflo);

        ISablierV2LockupLinear canonical = ISablierV2LockupLinear(CANONICAL_SABLIER);
        uint256 canonicalId = _createCanonicalStream();

        S1S5Probe memory ourProbe = _probeS1S5(ours, ourId);
        S1S5Probe memory canonicalProbe = _probeS1S5(canonical, canonicalId);

        assertEq(ourProbe.cancelable, canonicalProbe.cancelable, "S1 cancelable");
        assertEq(ourProbe.cliffEqualsStart, canonicalProbe.cliffEqualsStart, "S1 cliff");
        assertEq(ourProbe.withdrawableIncreased, canonicalProbe.withdrawableIncreased, "S2 withdrawable");
        assertEq(ourProbe.transferMovesOwner, canonicalProbe.transferMovesOwner, "S3 transferFrom");
        assertEq(ourProbe.strangerWithdrawReverts, canonicalProbe.strangerWithdrawReverts, "S4 stranger");
        assertEq(
            ourProbe.strangerPushToRecipientReverts,
            canonicalProbe.strangerPushToRecipientReverts,
            "S4 push-to-recipient"
        );
        assertEq(ourProbe.operatorHookFires, canonicalProbe.operatorHookFires, "S5 operator hook");
        assertEq(ourProbe.selfWithdrawSkipsHook, canonicalProbe.selfWithdrawSkipsHook, "S5 self hook");

        assertFalse(ourProbe.cancelable, "S1: stream is non-cancelable");
        assertTrue(ourProbe.cliffEqualsStart, "S1: no cliff");
        assertTrue(ourProbe.withdrawableIncreased, "S2: withdrawable grows");
        assertTrue(ourProbe.transferMovesOwner, "S3: transferFrom moves the NFT");
        assertTrue(ourProbe.strangerWithdrawReverts, "S4: stranger cannot withdraw");
        assertTrue(ourProbe.strangerPushToRecipientReverts, "S4: stranger cannot push to recipient");
        assertTrue(ourProbe.operatorHookFires, "S5: operator fires the hook");
        assertTrue(ourProbe.selfWithdrawSkipsHook, "S5: recipient caller skips the hook");
    }

    function _deployApprovedPrimarySeries() internal returns (OVRFLOFactory factory, OVRFLO ovrflo) {
        (factory, ovrflo,) = _deployConfiguredSystem();
        vm.startPrank(OWNER);
        factory.prepareOracle(PRIMARY_MARKET, PROTOCOL_TWAP_DURATION);
        factory.addMarket(address(ovrflo), PRIMARY_MARKET, PROTOCOL_TWAP_DURATION, 0);
        vm.stopPrank();
    }

    function _depositPrimary(OVRFLO ovrflo) internal returns (uint256 streamId) {
        (uint256 expectedToUser,,,) = ovrflo.previewDeposit(PRIMARY_MARKET, PT_AMOUNT);
        deal(PRIMARY_PT, USER, PT_AMOUNT);
        vm.startPrank(USER);
        IERC20(PRIMARY_PT).approve(address(ovrflo), PT_AMOUNT);
        (,, streamId) = ovrflo.deposit(PRIMARY_MARKET, PT_AMOUNT, expectedToUser);
        vm.stopPrank();
    }

    function _createCanonicalStream() internal returns (uint256 streamId) {
        _seedWstEth(USER, CANONICAL_DEPOSIT);
        vm.startPrank(USER);
        IERC20(WSTETH).approve(CANONICAL_SABLIER, CANONICAL_DEPOSIT);
        streamId = ISablierV2LockupLinear(CANONICAL_SABLIER)
            .createWithDurations(
                ISablierV2LockupLinear.CreateWithDurations({
                    sender: USER,
                    recipient: USER,
                    totalAmount: uint128(CANONICAL_DEPOSIT),
                    asset: IERC20(WSTETH),
                    cancelable: false,
                    transferable: true,
                    durations: ISablierV2LockupLinear.Durations({cliff: 0, total: 30 days}),
                    broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
                })
            );
        vm.stopPrank();
    }

    function _probeS1S5(ISablierV2LockupLinear sablier, uint256 streamId) internal returns (S1S5Probe memory probe) {
        ISablierV2LockupLinear.Stream memory stream = sablier.getStream(streamId);
        probe.cancelable = stream.isCancelable;
        probe.cliffEqualsStart = stream.cliffTime == stream.startTime;

        uint128 beforeAmt = sablier.withdrawableAmountOf(streamId);
        vm.warp(block.timestamp + 1 days);
        probe.withdrawableIncreased = sablier.withdrawableAmountOf(streamId) > beforeAmt;

        address holder = sablier.ownerOf(streamId);
        DifferentialHookProbe hookProbe = new DifferentialHookProbe();
        vm.prank(holder);
        sablier.transferFrom(holder, address(hookProbe), streamId);
        probe.transferMovesOwner = sablier.ownerOf(streamId) == address(hookProbe);

        uint128 withdrawable = sablier.withdrawableAmountOf(streamId);
        require(withdrawable > 0, "probe: need accrual");
        uint128 slice = withdrawable / 4;
        require(slice > 0, "probe: slice");

        address stranger = makeAddr("s1s5-stranger");
        vm.prank(stranger);
        (bool ok,) = address(sablier).call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, stranger, slice)));
        probe.strangerWithdrawReverts = !ok;

        vm.prank(stranger);
        (ok,) = address(sablier)
            .call(abi.encodeCall(ISablierV2LockupLinear.withdraw, (streamId, address(hookProbe), slice)));
        probe.strangerPushToRecipientReverts = !ok;

        address operator = makeAddr("s1s5-operator");
        hookProbe.approveOperator(address(sablier), operator, streamId);
        vm.prank(operator);
        sablier.withdraw(streamId, address(hookProbe), slice);
        probe.operatorHookFires = hookProbe.hookFired();

        hookProbe.reset();
        hookProbe.withdrawToSelf(address(sablier), streamId, slice);
        probe.selfWithdrawSkipsHook = !hookProbe.hookFired();
    }
}
