// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";

contract OVRFLOTokenTest is Test {
    address internal constant OWNER = address(0x123);
    address internal constant USER = address(0x789);

    OVRFLOToken internal token;

    function setUp() public {
        vm.prank(OWNER);
        token = new OVRFLOToken("OVRFLO Wrapped Ether", "ovrfloWETH");
    }

    function test_Constructor_SetsMetadataOwnerAndDecimals() public view {
        assertEq(token.name(), "OVRFLO Wrapped Ether");
        assertEq(token.symbol(), "ovrfloWETH");
        assertEq(token.decimals(), 18);
        assertEq(token.owner(), OWNER);
    }

    function test_Mint_RevertsForUnauthorizedCaller() public {
        vm.prank(USER);
        vm.expectRevert(OVRFLOToken.NotOwner.selector);
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
        vm.expectRevert(OVRFLOToken.NotOwner.selector);
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
