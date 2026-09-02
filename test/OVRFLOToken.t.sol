// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {OVRFLOToken} from "../src/OVRFLOToken.sol";

/// @dev Standalone token pair. A pranked stand-in address plays the constructing
///      OVRFLOReserve, so `reserve == msg.sender` is exercised without a vault.
///      The vault-side binding (`OVRFLO` -> `OVRFLOReserve` -> token) is covered
///      by the nested-constructor test in `test/OVRFLO.t.sol`.
contract OVRFLOTokenTest is Test {
    address internal constant VAULT = address(0x123);
    address internal constant RESERVE = address(0x456);
    address internal constant USER = address(0x789);

    OVRFLOToken internal token;

    uint256 internal signerKey;
    address internal signer;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("signer");

        vm.prank(RESERVE);
        token = new OVRFLOToken("OVRFLO Wrapped Ether", "ovrfloWETH", VAULT);
    }

    function test_Constructor_SetsMetadataMintersAndDecimals() public view {
        assertEq(token.name(), "OVRFLO Wrapped Ether");
        assertEq(token.symbol(), "ovrfloWETH");
        assertEq(token.decimals(), 18);
        assertEq(token.vault(), VAULT);
        assertEq(token.reserve(), RESERVE);
    }

    function test_Constructor_RevertsForZeroVault() public {
        vm.prank(RESERVE);
        vm.expectRevert(OVRFLOToken.ZeroAddress.selector);
        new OVRFLOToken("OVRFLO Wrapped Ether", "ovrfloWETH", address(0));
    }

    function test_TokenAbi_HasNoOwnerGetter() public {
        (bool ok, bytes memory data) = address(token).staticcall(abi.encodeWithSignature("owner()"));
        assertFalse(ok);
        assertEq(data, "");
    }

    function test_Mint_RevertsForUnauthorizedCaller() public {
        vm.prank(USER);
        vm.expectRevert(OVRFLOToken.NotMinter.selector);
        token.mint(USER, 1);
    }

    function test_Mint_AllowedForVaultAndReserve() public {
        vm.prank(VAULT);
        token.mint(USER, 25e5);
        vm.prank(RESERVE);
        token.mint(USER, 5e5);

        assertEq(token.balanceOf(USER), 3e6);
        assertEq(token.totalSupply(), 3e6);
    }

    function test_Burn_RevertsForUnauthorizedCallerAndInsufficientBalance() public {
        vm.prank(USER);
        vm.expectRevert(OVRFLOToken.NotMinter.selector);
        token.burn(USER, 1);

        vm.prank(VAULT);
        vm.expectRevert();
        token.burn(USER, 1);

        vm.prank(RESERVE);
        vm.expectRevert();
        token.burn(USER, 1);
    }

    function test_Burn_AllowedForVaultAndReserve() public {
        vm.prank(VAULT);
        token.mint(USER, 3e6);

        vm.prank(VAULT);
        token.burn(USER, 12e5);
        vm.prank(RESERVE);
        token.burn(USER, 6e5);

        assertEq(token.balanceOf(USER), 12e5);
        assertEq(token.totalSupply(), 12e5);
    }

    /* ---------- ERC20Permit ---------- */

    function test_Permit_SetsAllowanceFromSignatureAndBumpsNonce() public {
        uint256 value = 7e18;
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(signer, USER, value, token.nonces(signer), deadline);

        assertEq(token.nonces(signer), 0);
        token.permit(signer, USER, value, deadline, v, r, s);

        assertEq(token.allowance(signer, USER), value);
        assertEq(token.nonces(signer), 1);
    }

    function test_Permit_AllowanceIsSpendableByTransferFrom() public {
        uint256 value = 4e18;
        vm.prank(VAULT);
        token.mint(signer, value);

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(signer, USER, value, 0, deadline);
        token.permit(signer, USER, value, deadline, v, r, s);

        vm.prank(USER);
        assertTrue(token.transferFrom(signer, USER, value));
        assertEq(token.balanceOf(USER), value);
        assertEq(token.balanceOf(signer), 0);
    }

    function test_Permit_RevertsAfterDeadline() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(signer, USER, 1e18, 0, deadline);

        vm.warp(deadline + 1);
        vm.expectRevert("ERC20Permit: expired deadline");
        token.permit(signer, USER, 1e18, deadline, v, r, s);
    }

    function test_Permit_RevertsOnReplay() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(signer, USER, 1e18, 0, deadline);
        token.permit(signer, USER, 1e18, deadline, v, r, s);

        vm.expectRevert("ERC20Permit: invalid signature");
        token.permit(signer, USER, 1e18, deadline, v, r, s);
    }

    function test_Permit_DomainNameMatchesTokenName() public view {
        (, string memory name, string memory version,,,,) = token.eip712Domain();
        assertEq(name, token.name());
        assertEq(version, "1");
    }

    function _signPermit(address owner, address spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                spender,
                value,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(signerKey, digest);
    }
}
