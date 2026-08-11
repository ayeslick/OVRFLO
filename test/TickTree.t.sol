// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TickTree} from "../src/TickTree.sol";

/// @dev Storage harness for TickTree's internal library surface. Raw mutation
///      methods exist only to place the tree at otherwise impractical capacity
///      boundaries and to make the growth read-before-write ordering observable.
contract TickTreeHarness {
    using TickTree for TickTree.Tree;

    TickTree.Tree internal tree;

    function append(uint256 value) external returns (uint32 leafIndex) {
        return tree.append(value);
    }

    function setLeaf(uint32 leafIndex, uint256 value) external {
        tree.setLeaf(leafIndex, value);
    }

    function prefix(uint32 leafIndex) external view returns (uint64) {
        return tree.prefix(leafIndex);
    }

    function leaf(uint32 leafIndex) external view returns (uint64) {
        return tree.leaf(leafIndex);
    }

    function root() external view returns (uint64) {
        return tree.root();
    }

    function atCapacity() external view returns (bool) {
        return tree.atCapacity();
    }

    function height() external view returns (uint8) {
        return tree.height;
    }

    function leaves() external view returns (uint32) {
        return tree.leaves;
    }

    /// @dev Marks zero-valued leaves as appended without paying millions of
    ///      writes. Tests then use setLeaf to add sparse, independently known data.
    function seedMetadata(uint8 height_, uint32 leaves_) external {
        tree.height = height_;
        tree.leaves = leaves_;
    }

    /// @dev Poisons the prospective new root. Correct growth reads the old root
    ///      before changing height, then overwrites this node with that old root.
    function poisonNextRoot(uint64 value) external {
        tree.nodes[tree.height][0] = uint256(value);
    }

    /// @dev Corrupts the current top segment so its computed sum exceeds uint64.
    ///      This makes the otherwise unreachable growth-copy overflow path testable.
    function seedCurrentRootOverflow() external {
        tree.nodes[tree.height - 1][0] = uint256(type(uint64).max) | (uint256(1) << 64);
    }

    function rawNode(uint8 level, uint32 nodeIndex) external view returns (uint64) {
        uint256 word = tree.nodes[level][uint256(nodeIndex) >> 2];
        return uint64(word >> ((uint256(nodeIndex) & 3) * 64));
    }
}

contract TickTreeTest is Test {
    TickTreeHarness internal tree;
    uint64[] internal model;

    function setUp() public {
        tree = new TickTreeHarness();
    }

    /*//////////////////////////////////////////////////////////////
                         DIFFERENTIAL MODEL
    //////////////////////////////////////////////////////////////*/

    /// @dev Differential fuzz against an independent O(n) array model. Every
    ///      operation checks every extant leaf and prefix, not a sampled subset.
    function testFuzz_DifferentialRandomizedAppendShrink(bytes32 seed, uint8 requestedSteps) public {
        uint256 steps = bound(uint256(requestedSteps), 1, 64);

        for (uint256 step = 0; step < steps; ++step) {
            uint256 entropy = uint256(keccak256(abi.encode(seed, step, model.length)));
            bool shouldAppend = model.length == 0 || entropy % 3 != 0;

            if (shouldAppend) {
                uint64 value = uint64(entropy % 1e12);
                assertEq(tree.append(value), model.length, "append index");
                model.push(value);
            } else {
                uint32 leafIndex = uint32((entropy >> 64) % model.length);
                uint64 oldValue = model[leafIndex];
                uint64 newValue = uint64((entropy >> 128) % (uint256(oldValue) + 1));
                tree.setLeaf(leafIndex, newValue);
                model[leafIndex] = newValue;
            }

            _assertMatchesModel();
        }
    }

    function test_AppendAndShrinkMatchReference() public {
        _appendModel(7);
        _appendModel(11);
        _appendModel(0);
        _appendModel(19);

        tree.setLeaf(1, 3);
        model[1] = 3;
        _assertMatchesModel();

        tree.setLeaf(3, 0);
        model[3] = 0;
        _assertMatchesModel();
    }

    /*//////////////////////////////////////////////////////////////
                        GROWTH AND CAPACITY
    //////////////////////////////////////////////////////////////*/

    function test_GrowthBoundary_Height4To5() public {
        _assertGrowthBoundary(4);
    }

    function test_GrowthBoundary_Height5To6() public {
        _assertGrowthBoundary(5);
    }

    function test_GrowthBoundary_Height6To7() public {
        _assertGrowthBoundary(6);
    }

    function test_Height7CapacityBoundary() public {
        uint32 capacity = _capacity(7);
        tree.seedMetadata(7, capacity - 1);
        tree.setLeaf(0, 13);

        assertFalse(tree.atCapacity(), "capacity - 1 must not be full");
        assertEq(tree.append(17), capacity - 1, "last valid index");
        assertTrue(tree.atCapacity(), "capacity must be full");
        assertEq(tree.root(), 30);

        vm.expectRevert(TickTree.AtCapacity.selector);
        tree.append(1);

        assertEq(tree.height(), 7);
        assertEq(tree.leaves(), capacity);
        assertEq(tree.root(), 30);
    }

    function test_GrowthReadsOldRootBeforeWritingNewHeight() public {
        uint32 capacity = _capacity(4);
        tree.seedMetadata(4, capacity);
        tree.setLeaf(0, 41);
        tree.poisonNextRoot(99);

        assertEq(tree.append(7), capacity);

        assertEq(tree.height(), 5);
        assertEq(tree.rawNode(4, 0), 41, "old root must overwrite poison");
        assertEq(tree.rawNode(4, 1), 7, "new leaf occupies next top subtree");
        assertEq(tree.root(), 48);
        assertEq(tree.prefix(0), 0);
        assertEq(tree.prefix(capacity - 1), 41);
    }

    /*//////////////////////////////////////////////////////////////
                          ERROR BOUNDARIES
    //////////////////////////////////////////////////////////////*/

    function test_ZeroLeafIsDistinctFromMissingLeaf() public {
        assertEq(tree.append(0), 0);
        assertEq(tree.leaf(0), 0);
        assertEq(tree.prefix(0), 0);

        vm.expectRevert(TickTree.LeafMissing.selector);
        tree.leaf(1);

        vm.expectRevert(TickTree.LeafMissing.selector);
        tree.prefix(1);

        vm.expectRevert(TickTree.LeafMissing.selector);
        tree.setLeaf(1, 0);
    }

    function test_AppendLeafValueOverflowRevertsNodeOverflow() public {
        vm.expectRevert(TickTree.NodeOverflow.selector);
        tree.append(uint256(type(uint64).max) + 1);
    }

    function test_SetLeafValueOverflowRevertsNodeOverflow() public {
        tree.append(0);

        vm.expectRevert(TickTree.NodeOverflow.selector);
        tree.setLeaf(0, uint256(type(uint64).max) + 1);
    }

    function test_RootSumOverflowRevertsAtomically() public {
        tree.append(type(uint64).max);

        vm.expectRevert(TickTree.NodeOverflow.selector);
        tree.append(1);

        assertEq(tree.leaves(), 1);
        assertEq(tree.root(), type(uint64).max);
    }

    function test_GrowthRootCopyOverflowRevertsNodeOverflow() public {
        uint32 capacity = _capacity(4);
        tree.seedMetadata(4, capacity);
        tree.seedCurrentRootOverflow();

        vm.expectRevert(TickTree.NodeOverflow.selector);
        tree.append(1);

        assertEq(tree.height(), 4);
        assertEq(tree.leaves(), capacity);
    }

    /*//////////////////////////////////////////////////////////////
                              HELPERS
    //////////////////////////////////////////////////////////////*/

    function _assertGrowthBoundary(uint8 oldHeight) internal {
        uint32 capacity = _capacity(oldHeight);
        uint32 middle = capacity / 2;
        tree.seedMetadata(oldHeight, capacity - 1);
        tree.setLeaf(0, 11);
        tree.setLeaf(middle, 17);
        tree.setLeaf(capacity - 2, 23);

        assertFalse(tree.atCapacity(), "capacity - 1 must not be full");
        assertEq(tree.append(29), capacity - 1, "append at capacity - 1");
        assertTrue(tree.atCapacity(), "capacity must be full");
        vm.pauseGasMetering();
        _assertAllSparsePrefixes(capacity, middle);
        vm.resumeGasMetering();

        uint64 oldRoot = tree.root();
        assertEq(oldRoot, 80);
        assertEq(tree.append(31), capacity, "append at capacity");
        assertEq(tree.height(), oldHeight + 1);
        assertEq(tree.root(), uint256(oldRoot) + 31);
        vm.pauseGasMetering();
        _assertAllSparsePrefixes(capacity, middle);
        vm.resumeGasMetering();

        assertEq(tree.append(37), uint256(capacity) + 1, "append at capacity + 1");
        assertEq(tree.root(), uint256(oldRoot) + 68);
        assertFalse(tree.atCapacity(), "grown tree has spare capacity");
    }

    /// @dev Checks every prefix that existed immediately before growth against
    ///      sparse values known independently of the tree implementation.
    function _assertAllSparsePrefixes(uint32 count, uint32 middle) internal view {
        uint256 expectedPrefix;
        for (uint32 i = 0; i < count; ++i) {
            assertEq(tree.prefix(i), expectedPrefix, "pre-growth prefix changed");
            if (i == 0) expectedPrefix += 11;
            if (i == middle) expectedPrefix += 17;
            if (i == count - 2) expectedPrefix += 23;
            if (i == count - 1) expectedPrefix += 29;
        }
    }

    function _appendModel(uint64 value) internal {
        assertEq(tree.append(value), model.length);
        model.push(value);
        _assertMatchesModel();
    }

    function _assertMatchesModel() internal view {
        uint256 expectedPrefix;
        assertEq(tree.leaves(), model.length, "leaf count");

        for (uint32 i = 0; i < model.length; ++i) {
            assertEq(tree.prefix(i), expectedPrefix, "prefix");
            assertEq(tree.leaf(i), model[i], "leaf");
            expectedPrefix += model[i];
        }

        assertEq(tree.root(), expectedPrefix, "root");
        assertEq(tree.atCapacity(), model.length == _capacity(tree.height()), "atCapacity");
    }

    function _capacity(uint8 height_) internal pure returns (uint32) {
        return uint32(1) << (uint32(height_) * 3);
    }
}
