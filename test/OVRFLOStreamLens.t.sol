// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {OVRFLO} from "../src/OVRFLO.sol";
import {OVRFLOFactory} from "../src/OVRFLOFactory.sol";
import {OVRFLOStreamLens} from "../src/OVRFLOStreamLens.sol";
import {ISablierV2LockupLinear} from "../interfaces/ISablierV2LockupLinear.sol";
import {OVRFLOTestFixtures} from "../script/lib/OVRFLOTestFixtures.sol";
import {TestERC20} from "./mocks/TestERC20.sol";

/// @dev Artifact-ABI scalar. The hand-kept lockup interface exposes `isDepleted`
///      but not `wasCanceled(uint256)`.
interface ILockupWasCanceled {
    function wasCanceled(uint256 streamId) external view returns (bool);
}

/// @notice Standalone lens suite against committed OVRFLOStream bytecode.
/// @dev Never MockSablier: that mock's `getStream` never reverts, the opposite
///      of the fork. Streams are minted by pranking the registered vault so
///      `createWithDurations` is admitted.
contract OVRFLOStreamLensTest is OVRFLOTestFixtures, Test {
    uint256 internal constant EIP3860_INITCODE_CAP = 49_152;
    uint128 internal constant DEPOSIT = 1 ether;
    uint40 internal constant DURATION = 30 days;
    uint256 internal constant FIXTURE_COUNT = 5;
    bytes4 internal constant INVALID_QUERY_RANGE = bytes4(keccak256("SablierV2Lockup_InvalidQueryRange()"));

    OVRFLOStreamLens internal lens;
    ISablierV2LockupLinear internal lockup;
    OVRFLO internal vault;
    TestERC20 internal asset;
    address internal holder;
    uint256[] internal fixtureIds;

    function setUp() public {
        holder = makeAddr("holder");
        asset = new TestERC20("Lens Asset", "LAST");

        vm.startPrank(OWNER);
        OVRFLOFactory factory = new OVRFLOFactory(OWNER, address(ORACLE));
        (,, address stream) = _deployStreamLayer(address(factory));
        factory.setOvrfloStream(stream);
        vault = new OVRFLO(
            address(factory), TREASURY, address(asset), "OVRFLO Lens Asset", "ovrfloLAST", address(ORACLE), stream
        );
        factory.registerOvrflo(address(vault));
        vm.stopPrank();

        lockup = ISablierV2LockupLinear(stream);
        lens = new OVRFLOStreamLens();
        fixtureIds = _mintStreams(holder, FIXTURE_COUNT);
    }

    /*//////////////////////////////////////////////////////////////
                          FIELD AGREEMENT
    //////////////////////////////////////////////////////////////*/

    function test_Hydrate_AgreesWithDirectLockupReads() public view {
        uint256 id = fixtureIds[0];
        OVRFLOStreamLens.StreamView memory row = lens.hydrateOne(lockup, id);
        _assertAgreesWithDirect(row, id, holder);
    }

    /// @notice A withdrawn-to-empty stream is DEPLETED. The lens copies the
    ///         lockup's own `isDepleted` / `wasCanceled` getters, not a local formula.
    function test_Hydrate_DepletedStream_IsDepletedTrueWasCanceledFalse() public {
        uint256 id = fixtureIds[0];
        _deplete(id, holder);
        assertEq(uint8(lockup.statusOf(id)), uint8(ISablierV2LockupLinear.Status.DEPLETED));
        assertTrue(lockup.isDepleted(id));
        assertFalse(ILockupWasCanceled(address(lockup)).wasCanceled(id));

        OVRFLOStreamLens.StreamView memory row = lens.hydrateOne(lockup, id);
        _assertAgreesWithDirect(row, id, holder);
        assertTrue(row.isDepleted);
        assertFalse(row.wasCanceled);
        assertEq(uint256(row.status), uint256(uint8(ISablierV2LockupLinear.Status.DEPLETED)));
    }

    function test_StreamsByIds_AgreesWithEnumeration() public view {
        uint256[] memory ids = lockup.tokensOfOwnerIn(holder, 0, FIXTURE_COUNT);
        OVRFLOStreamLens.StreamView[] memory byIds = lens.streamsByIds(lockup, ids);
        OVRFLOStreamLens.StreamView[] memory byOwner = lens.streamsOfOwner(lockup, holder);
        assertEq(byIds.length, byOwner.length);
        for (uint256 i; i < byIds.length; ++i) {
            _assertRowsEqual(byIds[i], byOwner[i]);
        }
    }

    function test_StreamsOfOwner_EqualsWindowConcatenation() public view {
        OVRFLOStreamLens.StreamView[] memory full = lens.streamsOfOwner(lockup, holder);
        OVRFLOStreamLens.StreamView[] memory a = lens.streamsOfOwnerIn(lockup, holder, 0, 2);
        OVRFLOStreamLens.StreamView[] memory b = lens.streamsOfOwnerIn(lockup, holder, 2, 4);
        OVRFLOStreamLens.StreamView[] memory c = lens.streamsOfOwnerIn(lockup, holder, 4, 5);
        assertEq(full.length, a.length + b.length + c.length);
        _assertRowsEqual(full[0], a[0]);
        _assertRowsEqual(full[1], a[1]);
        _assertRowsEqual(full[2], b[0]);
        _assertRowsEqual(full[3], b[1]);
        _assertRowsEqual(full[4], c[0]);
    }

    /*//////////////////////////////////////////////////////////////
                               ok:false
    //////////////////////////////////////////////////////////////*/

    /// @notice Mixed `streamsByIds`: valid neighbours stay hydrated; unminted and
    ///         burned ids degrade to `ok: false` with `streamId` preserved.
    /// @dev `0` and `type(uint256).max` share the unminted path. A duplicate
    ///      valid id hydrates twice; the lens does not unique the input.
    function test_StreamsByIds_MixedValidUnmintedBurned_DegradesOnlyBadRows() public {
        uint256 burnedId = fixtureIds[1];
        uint256 leftId = fixtureIds[0];
        uint256 rightId = fixtureIds[2];
        uint256 unmintedId = 999;
        _depleteAndBurn(burnedId, holder);

        uint256[] memory ids = new uint256[](7);
        ids[0] = leftId;
        ids[1] = unmintedId;
        ids[2] = burnedId;
        ids[3] = rightId;
        ids[4] = 0;
        ids[5] = type(uint256).max;
        ids[6] = leftId;

        OVRFLOStreamLens.StreamView[] memory rows = lens.streamsByIds(lockup, ids);
        assertEq(rows.length, 7);
        _assertAgreesWithDirect(rows[0], leftId, holder);
        _assertFailedRow(rows[1], unmintedId);
        _assertFailedRow(rows[2], burnedId);
        _assertAgreesWithDirect(rows[3], rightId, holder);
        _assertFailedRow(rows[4], 0);
        _assertFailedRow(rows[5], type(uint256).max);
        _assertAgreesWithDirect(rows[6], leftId, holder);
    }

    /// @notice Owner-scoped forms never emit `ok: false` after a burn.
    /// @dev Burn removes the NFT from ERC-721 enumeration in the same block.
    ///      `tokensOfOwnerIn` reads `tokenOfOwnerByIndex`, so a burned id never
    ///      appears in the owner-scoped path. `ownerOf` therefore cannot revert
    ///      for an enumerated id at that block. Do not stage `ok: false` through
    ///      a burn on `streamsOfOwner` / `streamsOfOwnerIn`.
    function test_StreamsOfOwner_AfterBurn_NeverEmitsOkFalse() public {
        uint256 burnedId = fixtureIds[1];
        _depleteAndBurn(burnedId, holder);

        OVRFLOStreamLens.StreamView[] memory rows = lens.streamsOfOwner(lockup, holder);
        assertEq(rows.length, FIXTURE_COUNT - 1);
        for (uint256 i; i < rows.length; ++i) {
            assertTrue(rows[i].ok, "owner-scoped row is ok:false after burn");
            assertTrue(rows[i].streamId != burnedId, "burned id remained in enumeration");
        }

        OVRFLOStreamLens.StreamView[] memory page = lens.streamsOfOwnerIn(lockup, holder, 0, FIXTURE_COUNT);
        assertEq(page.length, FIXTURE_COUNT - 1);
        for (uint256 i; i < page.length; ++i) {
            assertTrue(page[i].ok, "windowed owner-scoped row is ok:false after burn");
        }
    }

    /*//////////////////////////////////////////////////////////////
                          RANGE SEMANTICS
    //////////////////////////////////////////////////////////////*/

    function test_StreamsOfOwner_EmptyOwner_ReturnsEmptyArray() public {
        OVRFLOStreamLens.StreamView[] memory rows = lens.streamsOfOwner(lockup, makeAddr("empty"));
        assertEq(rows.length, 0);
    }

    /// @notice Exact-page and clamped-window behavior follow the lockup, not the lens.
    function test_StreamsOfOwnerIn_ExactPageAndClampedWindow() public view {
        OVRFLOStreamLens.StreamView[] memory exact = lens.streamsOfOwnerIn(lockup, holder, 0, FIXTURE_COUNT);
        assertEq(exact.length, FIXTURE_COUNT);

        OVRFLOStreamLens.StreamView[] memory first = lens.streamsOfOwnerIn(lockup, holder, 0, 2);
        assertEq(first.length, 2);
        assertEq(first[0].streamId, fixtureIds[0]);
        assertEq(first[1].streamId, fixtureIds[1]);

        OVRFLOStreamLens.StreamView[] memory rest = lens.streamsOfOwnerIn(lockup, holder, 2, FIXTURE_COUNT);
        assertEq(rest.length, 3);
        assertEq(rest[0].streamId, fixtureIds[2]);

        // Lockup clamps `stop` to balanceOf. A window past the end still returns the tail.
        OVRFLOStreamLens.StreamView[] memory clamped = lens.streamsOfOwnerIn(lockup, holder, 0, 100);
        assertEq(clamped.length, FIXTURE_COUNT);

        // Lockup returns empty when start is at or past balance (and start < stop).
        OVRFLOStreamLens.StreamView[] memory pastEnd =
            lens.streamsOfOwnerIn(lockup, holder, FIXTURE_COUNT, FIXTURE_COUNT + 5);
        assertEq(pastEnd.length, 0);
    }

    function test_StreamsOfOwnerIn_InvalidRange_BubblesLockupRevert() public {
        vm.expectRevert(INVALID_QUERY_RANGE);
        lens.streamsOfOwnerIn(lockup, holder, 1, 1);

        vm.expectRevert(INVALID_QUERY_RANGE);
        lens.streamsOfOwnerIn(lockup, holder, 5, 2);
    }

    /*//////////////////////////////////////////////////////////////
                            DEPLOYLESS SHAPE
    //////////////////////////////////////////////////////////////*/

    /// @notice CREATE from creation bytecode, then call. Mirrors viem `call({ code })`.
    function test_StreamsByIds_CreateFromInitcode_MatchesNew() public {
        bytes memory initcode = vm.getCode("OVRFLOStreamLens");
        address created;
        assembly {
            created := create(0, add(initcode, 0x20), mload(initcode))
        }
        assertTrue(created != address(0), "CREATE from lens initcode failed");
        assertTrue(created.code.length > 0, "CREATE installed no runtime");

        uint256[] memory ids = new uint256[](2);
        ids[0] = fixtureIds[0];
        ids[1] = fixtureIds[2];

        OVRFLOStreamLens createdLens = OVRFLOStreamLens(created);
        OVRFLOStreamLens.StreamView[] memory rows = createdLens.streamsByIds(lockup, ids);
        assertEq(rows.length, 2);
        _assertAgreesWithDirect(rows[0], fixtureIds[0], holder);
        _assertAgreesWithDirect(rows[1], fixtureIds[2], holder);
    }

    /// @notice The initcode return is runtime bytecode, not `StreamView[]`.
    /// @dev A constructor-return misuse must fail loudly, not decode garbage.
    function test_InitcodeReturn_DoesNotDecodeAsStreamViewArray() public {
        bytes memory initcode = vm.getCode("OVRFLOStreamLens");
        address created;
        assembly {
            created := create(0, add(initcode, 0x20), mload(initcode))
        }
        assertTrue(created != address(0), "CREATE from lens initcode failed");

        (bool ok,) = address(this).staticcall(abi.encodeCall(this.decodeStreamViews, (created.code)));
        assertFalse(ok, "constructor-return decoded as StreamView[]");
    }

    function decodeStreamViews(bytes calldata data) external pure returns (OVRFLOStreamLens.StreamView[] memory) {
        return abi.decode(data, (OVRFLOStreamLens.StreamView[]));
    }

    /*//////////////////////////////////////////////////////////////
                         SIZE AND GAS GATES
    //////////////////////////////////////////////////////////////*/

    /// @notice deliberate-ceiling: EIP-3860 initcode cap 49,152 B. Measured 3,929 B
    ///         under solc 0.8.36, optimizer_runs=200, via_ir=false. The deployless
    ///         payload is creation bytecode (`bytecode.object`). Revisit when this
    ///         assertion fires — shrink the lens or record a new ceiling. EIP-170
    ///         does not apply: the lens is never deployed.
    function test_Initcode_FitsEip3860() public {
        uint256 size = vm.getCode("OVRFLOStreamLens.sol:OVRFLOStreamLens").length;
        emit log_named_uint("OVRFLOStreamLens initcode bytes", size);
        assertLe(size, EIP3860_INITCODE_CAP);
    }

    /// @dev Measured 2026-08-15 under solc 0.8.36, optimizer_runs=200, via_ir=false
    ///      (this worktree). Figures are `gasleft` deltas around the lens call,
    ///      not whole-test snapshot gas. Feeds STREAM_PAGE_SIZE derivation (plan 004).
    ///
    ///      | n   | gas     | per stream |
    ///      | 1   | 33,251  | 33,251     |
    ///      | 25  | 610,685 | 24,427     |
    ///      | 50  | 1,240,030 | 24,800   |
    ///      | 500 | 15,737,977 (`streamsByIds`) | 31,476 |
    ///
    ///      Linear cost is ~24.4k–24.8k per stream at pager-sized windows. The
    ///      n=1 figure includes cold-call overhead. Memory expansion shows up
    ///      at n=500 (~31.5k per stream).
    function test_Gas_WindowSizes_OneTwentyFiveFifty() public {
        uint256 g1 = _measureOwnerWindow(makeAddr("gas1"), 1);
        uint256 g25 = _measureOwnerWindow(makeAddr("gas25"), 25);
        uint256 g50 = _measureOwnerWindow(makeAddr("gas50"), 50);
        emit log_named_uint("lens gas n=1", g1);
        emit log_named_uint("lens gas n=25", g25);
        emit log_named_uint("lens gas n=50", g50);
        emit log_named_uint("lens gas per stream n=25", g25 / 25);
        emit log_named_uint("lens gas per stream n=50", g50 / 50);
        assertGt(g1, 0);
        assertGt(g25, g1);
        assertGt(g50, g25);
    }

    function test_StreamsOfOwner_MemoryAtFiveHundredIds() public {
        address whale = makeAddr("whale");
        uint256[] memory ids = _mintStreams(whale, 500);
        OVRFLOStreamLens.StreamView[] memory rows = lens.streamsOfOwner(lockup, whale);
        assertEq(rows.length, 500);
        assertTrue(rows[0].ok);
        assertTrue(rows[499].ok);
        assertEq(rows[0].owner, whale);
        assertEq(rows[499].owner, whale);
        assertEq(rows[0].streamId, ids[0]);
        assertEq(rows[499].streamId, ids[499]);

        uint256 start = gasleft();
        OVRFLOStreamLens.StreamView[] memory byIds = lens.streamsByIds(lockup, ids);
        uint256 gasUsed = start - gasleft();
        emit log_named_uint("lens gas n=500 streamsByIds", gasUsed);
        assertEq(byIds.length, 500);
        assertTrue(byIds[0].ok);
        assertTrue(byIds[499].ok);
    }

    /*//////////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////////*/

    function _mintStreams(address recipient, uint256 n) internal returns (uint256[] memory ids) {
        ids = new uint256[](n);
        asset.mint(address(vault), n * uint256(DEPOSIT));
        vm.startPrank(address(vault));
        asset.approve(address(lockup), type(uint256).max);
        for (uint256 i; i < n; ++i) {
            ids[i] = lockup.createWithDurations(
                ISablierV2LockupLinear.CreateWithDurations({
                    sender: address(vault),
                    recipient: recipient,
                    totalAmount: DEPOSIT,
                    asset: IERC20(address(asset)),
                    cancelable: false,
                    transferable: true,
                    durations: ISablierV2LockupLinear.Durations({cliff: 0, total: DURATION}),
                    broker: ISablierV2LockupLinear.Broker({account: address(0), fee: 0})
                })
            );
        }
        vm.stopPrank();
    }

    function _deplete(uint256 streamId, address nftOwner) internal {
        vm.warp(lockup.getEndTime(streamId));
        uint128 amount = lockup.withdrawableAmountOf(streamId);
        vm.prank(nftOwner);
        lockup.withdraw(streamId, nftOwner, amount);
    }

    function _depleteAndBurn(uint256 streamId, address nftOwner) internal {
        _deplete(streamId, nftOwner);
        vm.prank(nftOwner);
        lockup.burn(streamId);
    }

    function _measureOwnerWindow(address recipient, uint256 n) internal returns (uint256 gasUsed) {
        _mintStreams(recipient, n);
        uint256 start = gasleft();
        OVRFLOStreamLens.StreamView[] memory rows = lens.streamsOfOwner(lockup, recipient);
        gasUsed = start - gasleft();
        assertEq(rows.length, n);
        assertTrue(rows[n - 1].ok);
    }

    function _assertAgreesWithDirect(OVRFLOStreamLens.StreamView memory row, uint256 id, address expectedOwner)
        internal
        view
    {
        ISablierV2LockupLinear.Stream memory stream = lockup.getStream(id);
        uint8 status = uint8(lockup.statusOf(id));
        assertEq(row.streamId, id);
        assertEq(row.owner, expectedOwner);
        assertEq(row.owner, lockup.ownerOf(id));
        assertEq(row.sender, stream.sender);
        assertEq(address(row.asset), address(stream.asset));
        assertEq(uint256(row.startTime), uint256(stream.startTime));
        assertEq(uint256(row.cliffTime), uint256(stream.cliffTime));
        assertEq(uint256(row.endTime), uint256(stream.endTime));
        assertEq(uint256(row.deposited), uint256(stream.amounts.deposited));
        assertEq(uint256(row.withdrawn), uint256(stream.amounts.withdrawn));
        assertEq(uint256(row.refunded), uint256(stream.amounts.refunded));
        assertEq(uint256(row.withdrawableAmount), uint256(lockup.withdrawableAmountOf(id)));
        assertEq(uint256(row.status), uint256(status));
        assertEq(row.isCancelable, stream.isCancelable);
        assertEq(row.isDepleted, lockup.isDepleted(id));
        assertEq(row.wasCanceled, ILockupWasCanceled(address(lockup)).wasCanceled(id));
        assertTrue(row.ok);
    }

    function _assertFailedRow(OVRFLOStreamLens.StreamView memory row, uint256 id) internal pure {
        assertEq(row.streamId, id);
        assertFalse(row.ok);
        assertEq(row.owner, address(0));
        assertEq(row.sender, address(0));
        assertEq(address(row.asset), address(0));
        assertEq(uint256(row.startTime), 0);
        assertEq(uint256(row.cliffTime), 0);
        assertEq(uint256(row.endTime), 0);
        assertEq(uint256(row.deposited), 0);
        assertEq(uint256(row.withdrawn), 0);
        assertEq(uint256(row.refunded), 0);
        assertEq(uint256(row.withdrawableAmount), 0);
        assertEq(uint256(row.status), 0);
        assertFalse(row.isCancelable);
        assertFalse(row.isDepleted);
        assertFalse(row.wasCanceled);
    }

    function _assertRowsEqual(OVRFLOStreamLens.StreamView memory a, OVRFLOStreamLens.StreamView memory b)
        internal
        pure
    {
        assertEq(a.streamId, b.streamId);
        assertEq(a.owner, b.owner);
        assertEq(a.sender, b.sender);
        assertEq(address(a.asset), address(b.asset));
        assertEq(uint256(a.startTime), uint256(b.startTime));
        assertEq(uint256(a.cliffTime), uint256(b.cliffTime));
        assertEq(uint256(a.endTime), uint256(b.endTime));
        assertEq(uint256(a.deposited), uint256(b.deposited));
        assertEq(uint256(a.withdrawn), uint256(b.withdrawn));
        assertEq(uint256(a.refunded), uint256(b.refunded));
        assertEq(uint256(a.withdrawableAmount), uint256(b.withdrawableAmount));
        assertEq(uint256(a.status), uint256(b.status));
        assertEq(a.isCancelable, b.isCancelable);
        assertEq(a.isDepleted, b.isDepleted);
        assertEq(a.wasCanceled, b.wasCanceled);
        assertEq(a.ok, b.ok);
    }
}
