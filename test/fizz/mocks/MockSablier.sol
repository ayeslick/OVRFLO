// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISablierV2LockupLinear} from "../../../interfaces/ISablierV2LockupLinear.sol";
import {IOVRFLOFactoryRegistry} from "../../../src/StreamPricing.sol";

/// @notice Comptroller stub whose `admin()` `setOvrfloStream` reads.
contract MockSablierComptroller {
    address public admin;

    constructor(address admin_) {
        admin = admin_;
    }

    function setAdmin(address admin_) external {
        admin = admin_;
    }
}

contract MockSablier is ISablierV2LockupLinear {
    using SafeERC20 for IERC20;

    struct StreamData {
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
        bool depleted;
    }

    address public immutable override factory;
    address public immutable override admin;
    address public immutable override comptroller;

    address public nftDescriptor;
    bool public burnReverts;

    mapping(uint256 => StreamData) private streams;
    mapping(uint256 => address) private owners;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(address => uint256[]) private ownedTokens;
    mapping(uint256 => uint256) private ownedIndexPlusOne;
    uint256 public nextStreamId; // starts at 0, pre-increment gives ID 1 first

    constructor(address factory_, address admin_, address comptroller_) {
        factory = factory_;
        admin = admin_;
        comptroller = comptroller_;
    }

    function setNFTDescriptor(address descriptor) external override {
        require(msg.sender == admin, "not admin");
        nftDescriptor = descriptor;
    }

    function setBurnReverts(bool v) external {
        burnReverts = v;
    }

    function createWithDurations(CreateWithDurations calldata params) external returns (uint256 streamId) {
        if (factory != address(0)) {
            (address treasury,,) = IOVRFLOFactoryRegistry(factory).ovrfloInfo(msg.sender);
            require(treasury != address(0), "not registered vault");
        }
        streamId = ++nextStreamId;
        uint40 start = uint40(block.timestamp);
        streams[streamId] = StreamData({
            sender: params.sender,
            recipient: params.recipient,
            asset: params.asset,
            startTime: start,
            endTime: start + params.durations.total,
            cliffTime: start + params.durations.cliff,
            depositedAmount: params.totalAmount,
            withdrawnAmount: 0,
            cancelable: params.cancelable,
            transferable: params.transferable,
            depleted: false
        });
        _addOwned(params.recipient, streamId);
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

    function isDepleted(uint256 streamId) public view returns (bool) {
        return streams[streamId].depleted;
    }

    function getStream(uint256 streamId) external view returns (Stream memory) {
        StreamData memory s = streams[streamId];
        return Stream({
            sender: s.sender,
            startTime: s.startTime,
            cliffTime: s.cliffTime,
            isCancelable: s.cancelable,
            wasCanceled: false,
            asset: s.asset,
            endTime: s.endTime,
            isDepleted: s.depleted,
            isStream: s.depositedAmount > 0,
            isTransferable: s.transferable,
            amounts: Amounts({deposited: s.depositedAmount, withdrawn: s.withdrawnAmount, refunded: 0})
        });
    }

    function withdrawableAmountOf(uint256 streamId) public view returns (uint128) {
        StreamData memory s = streams[streamId];
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
        if (streams[streamId].withdrawnAmount >= streams[streamId].depositedAmount) {
            streams[streamId].depleted = true;
            streams[streamId].cancelable = false;
        }
        streams[streamId].asset.safeTransfer(to, amount);
    }

    function withdrawMultiple(uint256[] calldata streamIds, address to, uint128[] calldata amounts) external {
        for (uint256 i; i < streamIds.length; i++) {
            withdraw(streamIds[i], to, amounts[i]);
        }
    }

    function burn(uint256 streamId) external {
        require(!burnReverts, "burn revert");
        require(streams[streamId].depleted, "not depleted");
        address owner = owners[streamId];
        require(owner != address(0), "ERC721: invalid token ID");
        require(
            msg.sender == owner || getApproved[streamId] == msg.sender || isApprovedForAll[owner][msg.sender],
            "not approved"
        );
        _removeOwned(owner, streamId);
        delete owners[streamId];
        delete getApproved[streamId];
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
        _removeOwned(from, tokenId);
        _addOwned(to, tokenId);
        delete getApproved[tokenId];
    }

    function ownerOf(uint256 tokenId) external view returns (address owner) {
        owner = owners[tokenId];
        require(owner != address(0), "ERC721: invalid token ID");
    }

    function balanceOf(address owner) public view override returns (uint256) {
        return ownedTokens[owner].length;
    }

    function tokensOfOwnerIn(address owner, uint256 start, uint256 stop)
        external
        view
        override
        returns (uint256[] memory ids)
    {
        require(start < stop, "invalid range");
        uint256 bal = ownedTokens[owner].length;
        if (bal == 0 || start >= bal) return new uint256[](0);
        uint256 exclusiveEnd = stop > bal ? bal : stop;
        ids = new uint256[](exclusiveEnd - start);
        for (uint256 i = start; i < exclusiveEnd; ++i) {
            ids[i - start] = ownedTokens[owner][i];
        }
    }

    function statusOf(uint256 streamId) external view override returns (Status) {
        StreamData memory s = streams[streamId];
        require(s.depositedAmount > 0, "null stream");
        if (s.depleted) return Status.DEPLETED;
        if (block.timestamp < s.startTime) return Status.PENDING;
        if (block.timestamp >= s.endTime) return Status.SETTLED;
        return Status.STREAMING;
    }

    function _addOwned(address to, uint256 tokenId) private {
        owners[tokenId] = to;
        ownedTokens[to].push(tokenId);
        ownedIndexPlusOne[tokenId] = ownedTokens[to].length;
    }

    function _removeOwned(address from, uint256 tokenId) private {
        uint256 idx = ownedIndexPlusOne[tokenId];
        require(idx != 0, "not owned");
        uint256 last = ownedTokens[from].length - 1;
        uint256 swapped = ownedTokens[from][last];
        if (idx - 1 != last) {
            ownedTokens[from][idx - 1] = swapped;
            ownedIndexPlusOne[swapped] = idx;
        }
        ownedTokens[from].pop();
        delete ownedIndexPlusOne[tokenId];
        delete owners[tokenId];
    }
}
