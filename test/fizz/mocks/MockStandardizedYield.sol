// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IStandardizedYield} from "../../../interfaces/IStandardizedYield.sol";

contract MockStandardizedYield is IStandardizedYield {
    address public yieldTokenAddr;

    constructor(address _yieldToken) { yieldTokenAddr = _yieldToken; }

    function yieldToken() external view returns (address) { return yieldTokenAddr; }

    // Minimal stubs for interface compliance
    function deposit(address, address, uint256, uint256) external payable returns (uint256) { return 0; }
    function redeem(address, uint256, address, uint256, bool) external returns (uint256) { return 0; }
    function exchangeRate() external pure returns (uint256) { return 1e18; }
    function claimRewards(address) external returns (uint256[] memory) { return new uint256[](0); }
    function accruedRewards(address) external pure returns (uint256[] memory) { return new uint256[](0); }
    function rewardIndexesCurrent() external returns (uint256[] memory) { return new uint256[](0); }
    function rewardIndexesStored() external pure returns (uint256[] memory) { return new uint256[](0); }
    function getRewardTokens() external pure returns (address[] memory) { return new address[](0); }
    function getTokensIn() external pure returns (address[] memory) { return new address[](0); }
    function getTokensOut() external pure returns (address[] memory) { return new address[](0); }
    function isValidTokenIn(address) external pure returns (bool) { return false; }
    function isValidTokenOut(address) external pure returns (bool) { return false; }
    function previewDeposit(address, uint256) external pure returns (uint256) { return 0; }
    function previewRedeem(address, uint256) external pure returns (uint256) { return 0; }
    function assetInfo() external pure returns (AssetType, address, uint8) { return (AssetType.TOKEN, address(0), 18); }

    // ERC20 stubs (not used but needed for interface)
    function name() external pure returns (string memory) { return "MockSY"; }
    function symbol() external pure returns (string memory) { return "MSY"; }
    function decimals() external pure returns (uint8) { return 18; }
    function totalSupply() external pure returns (uint256) { return 0; }
    function balanceOf(address) external pure returns (uint256) { return 0; }
    function transfer(address, uint256) external returns (bool) { return true; }
    function allowance(address, address) external pure returns (uint256) { return 0; }
    function approve(address, uint256) external returns (bool) { return true; }
    function transferFrom(address, address, uint256) external returns (bool) { return true; }
}
