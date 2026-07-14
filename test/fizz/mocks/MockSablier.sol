// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISablierV2LockupLinear} from "../../../interfaces/ISablierV2LockupLinear.sol";

contract MockSablier is ISablierV2LockupLinear {
    using SafeERC20 for IERC20;

    struct Stream {
        address sender;
        address recipient;
        IERC20 asset;
        uint40 startTime;
        uint40 endTime;
        uint40 cliffTime;
        uint128 depositedAmount;
        uint128 withdrawnAmount;
        bool cancelable;
        bool transferable;
    }

    mapping(uint256 => Stream) private streams;
    mapping(uint256 => address) private owners;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    uint256 public nextStreamId; // starts at 0, pre-increment gives ID 1 first

    function createWithDurations(CreateWithDurations calldata params) external returns (uint256 streamId) {
        streamId = ++nextStreamId;
        uint40 start = uint40(block.timestamp);
        streams[streamId] = Stream({
            sender: params.sender,
            recipient: params.recipient,
            asset: params.asset,
            startTime: start,
            endTime: start + params.durations.total,
            cliffTime: start + params.durations.cliff,
            depositedAmount: params.totalAmount,
            withdrawnAmount: 0,
            cancelable: params.cancelable,
            transferable: params.transferable
        });
        owners[streamId] = params.recipient;
        params.asset.safeTransferFrom(params.sender, address(this), params.totalAmount);
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
        return streams[streamId].depositedAmount;
    }

    function getWithdrawnAmount(uint256 streamId) external view returns (uint128) {
        return streams[streamId].withdrawnAmount;
    }

    function withdrawableAmountOf(uint256 streamId) public view returns (uint128) {
        Stream memory s = streams[streamId];
        if (s.depositedAmount == 0) return 0;
        if (block.timestamp < s.cliffTime) return 0;
        uint256 elapsed = block.timestamp > s.endTime ? s.endTime - s.startTime : block.timestamp - s.startTime;
        uint256 total = s.endTime - s.startTime;
        if (total == 0) return s.depositedAmount - s.withdrawnAmount;
        uint256 vested = (uint256(s.depositedAmount) * elapsed) / total;
        if (vested > s.depositedAmount) vested = s.depositedAmount;
        uint256 withdrawable = vested - s.withdrawnAmount;
        return withdrawable > s.depositedAmount - s.withdrawnAmount
            ? s.depositedAmount - s.withdrawnAmount
            : uint128(withdrawable);
    }

    function withdraw(uint256 streamId, address to, uint128 amount) public {
        address owner = owners[streamId];
        bool isOwner = owner == msg.sender;
        bool isApproved = getApproved[streamId] == msg.sender || isApprovedForAll[owner][msg.sender];
        bool isSender = streams[streamId].sender == msg.sender;
        require(isOwner || isApproved || isSender, "SablierV2Lockup_Unauthorized");
        // v1.1 ACL: sender may only withdraw to the current recipient (NFT owner)
        if (isSender && !isOwner && !isApproved) {
            require(to == owner, "SablierV2Lockup_WithdrawToNonRecipient");
        }
        require(withdrawableAmountOf(streamId) >= amount, "insufficient");
        streams[streamId].withdrawnAmount += amount;
        streams[streamId].asset.safeTransfer(to, amount);
    }

    function withdrawMultiple(uint256[] calldata streamIds, address to, uint128[] calldata amounts) external {
        for (uint256 i; i < streamIds.length; i++) {
            withdraw(streamIds[i], to, amounts[i]);
        }
    }

    function approve(address to, uint256 streamId) external {
        require(owners[streamId] == msg.sender, "not owner");
        getApproved[streamId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        require(streams[tokenId].transferable, "not transferable");
        require(owners[tokenId] == from, "not owner");
        require(
            msg.sender == from || getApproved[tokenId] == msg.sender || isApprovedForAll[from][msg.sender],
            "not approved"
        );
        owners[tokenId] = to;
        delete getApproved[tokenId];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }
}
