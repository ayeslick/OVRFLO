// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title TickTree
/// @notice Packed prefix-sum tree for an append-only coordinate tape whose
///         existing leaves may later be replaced (normally shrunk).
/// @dev Each stored node is a uint64 subtotal. Four adjacent nodes share one
///      uint256 storage word, while eight nodes form a logical segment whose
///      parent subtotal is stored at the next level. Internal nodes inside an
///      eight-way segment are derived during reads rather than stored, so an
///      update writes exactly one packed node per active height. All values are
///      integral; the tree performs no rounding.
library TickTree {
    /// @notice Initial tree height, supporting 8^4 = 4,096 leaves.
    uint8 public constant MIN_HEIGHT = 4;
    /// @notice Maximum tree height, supporting 8^7 = 2,097,152 leaves.
    uint8 public constant MAX_HEIGHT = 7;
    /// @notice Number of child subtrees represented by each logical segment.
    uint8 public constant BRANCHING_FACTOR = 8;

    /// @dev The requested leaf index has never been appended.
    error LeafMissing();
    /// @dev The height-7 tree has no remaining leaf slots.
    error AtCapacity();
    /// @dev A leaf, subtree, root, or copied root does not fit in uint64.
    error NodeOverflow();

    /// @notice Mutable packed-tree storage.
    /// @param leaves Number of permanently allocated leaf coordinates.
    /// @param height Current tree height; zero means an empty, uninitialized tree.
    /// @param nodes Packed node words keyed first by level, then by four-node word index.
    struct Tree {
        uint32 leaves;
        uint8 height;
        mapping(uint8 level => mapping(uint256 wordIndex => uint256 packedNodes)) nodes;
    }

    /// @notice Appends a leaf and returns its permanent index.
    /// @dev Grows by one level exactly when `leaves == capacity(height)`. Growth
    ///      reads the old root before changing height, then initializes the first
    ///      node of the new level through the same checked packed-write path used
    ///      for ordinary leaf and ancestor updates.
    /// @param self Tree storage.
    /// @param value Leaf value; reverts if it or any resulting sum exceeds uint64.
    /// @return leafIndex Permanent zero-based index assigned to the new leaf.
    function append(Tree storage self, uint256 value) internal returns (uint32 leafIndex) {
        if (self.height == 0) self.height = MIN_HEIGHT;

        if (self.leaves == _capacity(self.height)) {
            if (self.height == MAX_HEIGHT) revert AtCapacity();
            _grow(self);
        }

        uint64 checkedValue = _toUint64(value);
        leafIndex = self.leaves;
        _replaceLeaf(self, leafIndex, 0, checkedValue);
        self.leaves = leafIndex + 1;
    }

    /// @notice Replaces an appended leaf value and updates every ancestor subtotal.
    /// @dev Callers normally shrink leaves to preserve filled history while removing
    ///      unfilled quantity. The library supports either direction; every increase
    ///      remains bounded by the uint64 root invariant.
    /// @param self Tree storage.
    /// @param leafIndex Existing permanent leaf index.
    /// @param value Replacement value.
    function setLeaf(Tree storage self, uint32 leafIndex, uint256 value) internal {
        _requireLeaf(self, leafIndex);
        uint64 oldValue = _readNode(self, 0, leafIndex);
        uint64 newValue = _toUint64(value);
        _replaceLeaf(self, leafIndex, oldValue, newValue);
    }

    /// @notice Returns the sum of all leaves strictly before `leafIndex`.
    /// @dev Walks the base-8 digits of the index. At each level it adds the
    ///      preceding sibling subtrees from that eight-way segment.
    /// @param self Tree storage.
    /// @param leafIndex Existing permanent leaf index.
    /// @return value Exclusive prefix sum.
    function prefix(Tree storage self, uint32 leafIndex) internal view returns (uint64 value) {
        _requireLeaf(self, leafIndex);

        uint256 nodeIndex = leafIndex;
        uint256 sum;
        for (uint8 level = 0; level < self.height; ++level) {
            uint256 offset = nodeIndex % BRANCHING_FACTOR;
            sum += _sumNodes(self, level, nodeIndex - offset, offset);
            nodeIndex /= BRANCHING_FACTOR;
        }
        value = _toUint64(sum);
    }

    /// @notice Returns an existing leaf value, including zero-valued leaves.
    /// @param self Tree storage.
    /// @param leafIndex Existing permanent leaf index.
    /// @return value Stored leaf value.
    function leaf(Tree storage self, uint32 leafIndex) internal view returns (uint64 value) {
        _requireLeaf(self, leafIndex);
        value = _readNode(self, 0, leafIndex);
    }

    /// @notice Returns the sum of every appended leaf.
    /// @dev The root is derived from the eight nodes in the active top segment;
    ///      it is checked as uint64 even though those nodes occupy two words.
    /// @param self Tree storage.
    /// @return value Total tree quantity.
    function root(Tree storage self) internal view returns (uint64 value) {
        if (self.leaves == 0) return 0;
        value = _toUint64(_sumNodes(self, self.height - 1, 0, BRANCHING_FACTOR));
    }

    /// @notice Returns whether the active height has allocated every leaf index.
    /// @dev Exact at the boundary: false for capacity - 1 and true for capacity.
    /// @param self Tree storage.
    function atCapacity(Tree storage self) internal view returns (bool) {
        return self.height != 0 && self.leaves == _capacity(self.height);
    }

    /// @dev Adds one level. The sum must be read before the height write: afterward
    ///      the active top segment is the new, initially empty level. The shared
    ///      packed-write gate performs the root-copy narrowing check.
    function _grow(Tree storage self) private {
        uint8 oldHeight = self.height;
        uint256 oldRoot = _sumNodes(self, oldHeight - 1, 0, BRANCHING_FACTOR);
        self.height = oldHeight + 1;
        _writeNode(self, oldHeight, 0, oldRoot);
    }

    /// @dev Replaces one leaf and applies the same delta to one node per level.
    function _replaceLeaf(Tree storage self, uint32 leafIndex, uint64 oldValue, uint64 newValue) private {
        if (oldValue == newValue) return;

        uint64 oldRoot = root(self);
        uint256 updatedRoot = uint256(oldRoot) - oldValue + newValue;
        _toUint64(updatedRoot);

        uint256 nodeIndex = leafIndex;
        for (uint8 level = 0; level < self.height; ++level) {
            uint64 oldNode = _readNode(self, level, nodeIndex);
            uint256 newNode;
            if (newValue > oldValue) {
                newNode = uint256(oldNode) + (newValue - oldValue);
            } else {
                newNode = uint256(oldNode) - (oldValue - newValue);
            }
            _writeNode(self, level, nodeIndex, newNode);
            nodeIndex /= BRANCHING_FACTOR;
        }
    }

    /// @dev Sums `count` adjacent nodes from an eight-node, word-aligned segment.
    function _sumNodes(Tree storage self, uint8 level, uint256 firstNode, uint256 count)
        private
        view
        returns (uint256 sum)
    {
        if (count == 0) return 0;

        uint256 firstWord = self.nodes[level][firstNode >> 2];
        uint256 firstCount = Math.min(count, 4);
        sum = _sumPacked(firstWord, firstCount);

        if (count > 4) {
            uint256 secondWord = self.nodes[level][(firstNode >> 2) + 1];
            sum += _sumPacked(secondWord, count - 4);
        }
    }

    /// @dev Sums the lowest `count` uint64 fields of one packed storage word.
    function _sumPacked(uint256 packed, uint256 count) private pure returns (uint256 sum) {
        for (uint256 i = 0; i < count; ++i) {
            sum += (packed >> (i * 64)) & type(uint64).max;
        }
    }

    /// @dev Reads one uint64 field from its four-node packed word.
    function _readNode(Tree storage self, uint8 level, uint256 nodeIndex) private view returns (uint64 value) {
        uint256 packed = self.nodes[level][nodeIndex >> 2];
        uint256 shift = (nodeIndex & 3) * 64;
        value = _toUint64((packed >> shift) & type(uint64).max);
    }

    /// @dev Writes one uint64 field while preserving the other three packed nodes.
    function _writeNode(Tree storage self, uint8 level, uint256 nodeIndex, uint256 value) private {
        uint64 checkedValue = _toUint64(value);
        uint256 wordIndex = nodeIndex >> 2;
        uint256 shift = (nodeIndex & 3) * 64;
        uint256 mask = uint256(type(uint64).max) << shift;
        uint256 packed = self.nodes[level][wordIndex];
        self.nodes[level][wordIndex] = (packed & ~mask) | (uint256(checkedValue) << shift);
    }

    /// @dev Returns the capacity for an initialized height (`8 ** height`).
    function _capacity(uint8 height_) private pure returns (uint32) {
        return SafeCast.toUint32(uint256(BRANCHING_FACTOR) ** height_);
    }

    /// @dev Reverts unless the permanent coordinate has been appended.
    function _requireLeaf(Tree storage self, uint32 leafIndex) private view {
        if (leafIndex >= self.leaves) revert LeafMissing();
    }

    /// @dev Single checked narrowing gate for every stored or returned tree sum.
    function _toUint64(uint256 value) private pure returns (uint64 narrowed) {
        if (value > type(uint64).max) revert NodeOverflow();
        narrowed = uint64(value);
    }
}
