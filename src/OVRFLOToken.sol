// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Two named immutable minters, fixed at construction: the OVRFLO vault
///         (mints on deposit, burns on claim) and the OVRFLOReserve that constructs
///         this token (mints on wrap, burns on unwrap). Neither authority can move,
///         so mint/burn control can never be disabled or transferred. Not OZ
///         `Ownable` or `AccessControl`, which expose renunciation and grants.
///         `ERC20Permit` shares `name_` with `ERC20` so the EIP-712 domain matches.
contract OVRFLOToken is ERC20, ERC20Permit {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev Caller is neither the vault nor the reserve.
    error NotMinter();
    /// @dev The vault constructor argument was the zero address.
    error ZeroAddress();

    /// @notice The OVRFLO vault this token belongs to; fixed for the token's lifetime.
    address public immutable vault;

    /// @notice The OVRFLOReserve that created this token; fixed for the token's lifetime.
    address public immutable reserve;

    modifier onlyMinter() {
        if (msg.sender != vault && msg.sender != reserve) revert NotMinter();
        _;
    }

    /// @param name_ Full ERC20 name; also the EIP-712 domain name
    /// @param symbol_ Full ERC20 symbol
    /// @param vault_ The OVRFLO vault authority. The reserve authority is `msg.sender`.
    constructor(string memory name_, string memory symbol_, address vault_) ERC20(name_, symbol_) ERC20Permit(name_) {
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        reserve = msg.sender;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyMinter {
        _burn(from, amount);
    }
}
