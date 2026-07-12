// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestERC20} from "./TestERC20.sol";

/// @notice Shared mock factory implementing IOVRFLOFactoryRegistry.
contract MockLendingFactory {
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

    function ovrfloInfo(address core)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken)
    {
        Info memory info = infos[core];
        return (info.treasury, info.underlying, info.ovrfloToken);
    }
}

/// @notice Shared mock core implementing IOVRFLOSeriesRegistry.
/// @dev Includes both 5-arg (hardcoded ptToken/oracle) and 7-arg (explicit) setSeries overloads.
contract MockLendingCore {
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

    function setSeries(
        address market,
        bool approved,
        uint256 expiryCached,
        address ptToken,
        address ovrfloToken,
        address underlying,
        address oracle
    ) external {
        seriesInfo[market] = Series({
            approved: approved,
            twapDurationFixed: 30 minutes,
            feeBps: 0,
            expiryCached: expiryCached,
            ptToken: ptToken,
            ovrfloToken: ovrfloToken,
            underlying: underlying,
            oracle: oracle
        });
    }

    function series(address market)
        external
        view
        returns (
            bool approved,
            uint32 twapDurationFixed,
            uint16 feeBps,
            uint256 expiryCached,
            address ptToken,
            address ovrfloToken,
            address underlying,
            address oracle
        )
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

/// @notice Shared mock Sablier with NFT ownership, withdraw, and stream management.
/// @dev Superset of all Lending and StreamPricing mock variants. StreamPricing tests
///      use the 8-arg setStream and setStreamWithStartTime; Lending tests use the
///      9-arg setStream with owner, setWithdrawable, withdraw, and NFT methods.
contract MockLendingSablier {
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

    function setStream(
        uint256 streamId,
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

    function setStreamWithStartTime(
        uint256 streamId,
        address sender,
        IERC20 asset,
        uint40 startTime,
        uint40 endTime,
        uint40 cliffTime,
        bool cancelable,
        uint128 deposited,
        uint128 withdrawn
    ) external {
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
        TestERC20(address(streams[streamId].asset)).mint(to, amount);
    }
}
