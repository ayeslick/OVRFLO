// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";

contract OVRFLOTokenTest is Test {
    address internal constant OWNER = address(0x123);
    address internal constant NEW_OWNER = address(0x456);
    address internal constant USER = address(0x789);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    OVRFLOToken internal token;

    function setUp() public {
        vm.prank(OWNER);
        token = new OVRFLOToken("OVRFLO Wrapped Ether", "ovrfloWETH", 6);
    }

    function test_Constructor_SetsMetadataOwnerAndDecimals() public view {
        assertEq(token.name(), "OVRFLO Wrapped Ether");
        assertEq(token.symbol(), "ovrfloWETH");
        assertEq(token.decimals(), 6);
        assertEq(token.owner(), OWNER);
    }

    function test_TransferOwnership_RevertsForUnauthorizedOrZeroAddress() public {
        vm.prank(USER);
        vm.expectRevert("ovrflo: not owner");
        token.transferOwnership(NEW_OWNER);

        vm.prank(OWNER);
        vm.expectRevert("ovrflo: new owner is zero address");
        token.transferOwnership(address(0));
    }

    function test_TransferOwnership_UpdatesOwnerAndHandsOffAuthority() public {
        vm.expectEmit(true, true, false, false, address(token));
        emit OwnershipTransferred(OWNER, NEW_OWNER);

        vm.prank(OWNER);
        token.transferOwnership(NEW_OWNER);

        assertEq(token.owner(), NEW_OWNER);

        vm.prank(OWNER);
        vm.expectRevert("ovrflo: not owner");
        token.mint(USER, 1e6);

        vm.prank(NEW_OWNER);
        token.mint(USER, 2e6);
        assertEq(token.balanceOf(USER), 2e6);

        vm.prank(NEW_OWNER);
        token.burn(USER, 5e5);
        assertEq(token.balanceOf(USER), 15e5);
    }

    function test_Mint_RevertsForUnauthorizedCaller() public {
        vm.prank(USER);
        vm.expectRevert("ovrflo: not owner");
        token.mint(USER, 1);
    }

    function test_Mint_IncreasesBalanceAndTotalSupply() public {
        vm.prank(OWNER);
        token.mint(USER, 25e5);

        assertEq(token.balanceOf(USER), 25e5);
        assertEq(token.totalSupply(), 25e5);
    }

    function test_Burn_RevertsForUnauthorizedCallerAndInsufficientBalance() public {
        vm.prank(USER);
        vm.expectRevert("ovrflo: not owner");
        token.burn(USER, 1);

        vm.prank(OWNER);
        vm.expectRevert();
        token.burn(USER, 1);
    }

    function test_Burn_DecreasesBalanceAndTotalSupply() public {
        vm.startPrank(OWNER);
        token.mint(USER, 3e6);
        token.burn(USER, 12e5);
        vm.stopPrank();

        assertEq(token.balanceOf(USER), 18e5);
        assertEq(token.totalSupply(), 18e5);
    }
}