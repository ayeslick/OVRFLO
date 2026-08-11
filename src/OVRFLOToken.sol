// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal single-owner model — ownership is fixed at construction to the
///         creating OVRFLO vault and can never move, so the vault always retains
///         mint/burn control and cannot permanently disable them. Not replaced with
///         OZ `Ownable`, which exposes renunciation and transfer.
contract OVRFLOToken is ERC20 {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev Caller is not the token's owner.
    error NotOwner();

    /// @notice The OVRFLO vault that created this token; fixed for the token's lifetime.
    address public immutable owner;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
