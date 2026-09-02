// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";

/// @title OVRFLOReserve
/// @notice Holds the underlying that backs 1:1 wrapped ovrfloToken for one column.
/// @dev One reserve per underlying. The OVRFLO vault constructs the reserve, and the
///      reserve constructs the column's ovrfloToken, so the token learns both minters
///      at construction: `vault` from the argument and `reserve` from `msg.sender`.
///      The vault holds no underlying; every wrap/unwrap balance lives here.
///      No reentrancy guard on `wrap`/`unwrap`: `wrappedUnderlying` moves before the
///      external call, and the end-of-function peg check reverts any state where the
///      tracked reserve exceeds the held balance.
contract OVRFLOReserve {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @dev Caller is not the factory (the reserve's sole admin).
    error NotAdmin();
    /// @dev A required constructor address argument was the zero address.
    error ZeroAddress();
    /// @dev The supplied token amount is zero.
    error ZeroAmount();
    /// @dev The pulled token delivered less than the requested amount (fee-on-transfer behavior).
    error TransferMismatch();
    /// @dev `unwrap` requested more than the tracked wrap reserve holds.
    error InsufficientReserve();
    /// @dev There is no surplus above the tracked reserve to sweep.
    error NoExcess();
    /// @dev The tracked reserve exceeded the held underlying at the end of a wrap or unwrap.
    error ReserveExceedsBalance();

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Factory address with admin permission (immutable, set at construction)
    address public immutable factory;

    /// @notice Underlying asset held 1:1 against wrapped supply (constant per reserve)
    address public immutable underlying;

    /// @notice The OVRFLO vault that created this reserve (constant per reserve)
    address public immutable vault;

    /// @notice ovrfloToken this reserve created and mints/burns (constant per reserve)
    address public immutable ovrfloToken;

    /// @notice Underlying deposited through wrap and reserved for 1:1 unwraps
    uint256 public wrappedUnderlying;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a user wraps underlying into ovrfloToken
    /// @param user The wrapper's address
    /// @param amount Amount of underlying wrapped and ovrfloToken minted
    event Wrapped(address indexed user, uint256 amount);

    /// @notice Emitted when a user unwraps ovrfloToken back to underlying
    /// @param user The unwrapper's address
    /// @param amount Amount of ovrfloToken burned and underlying returned
    event Unwrapped(address indexed user, uint256 amount);

    /// @notice Emitted when excess underlying tokens are swept
    /// @param underlying The underlying token address
    /// @param to The recipient address
    /// @param amount The amount swept
    event ExcessUnderlyingSwept(address indexed underlying, address indexed to, uint256 amount);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Restricts function access to the factory
    modifier onlyAdmin() {
        if (msg.sender != factory) revert NotAdmin();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Constructs the reserve and the column's ovrfloToken
    /// @param admin The factory address (immutable admin for the reserve's lifetime)
    /// @param _underlying The underlying asset address
    /// @param name_ Full ERC20 name for the ovrfloToken
    /// @param symbol_ Full ERC20 symbol for the ovrfloToken
    /// @param vault_ The OVRFLO vault; passed to the token as its second minter
    constructor(address admin, address _underlying, string memory name_, string memory symbol_, address vault_) {
        if (admin == address(0)) revert ZeroAddress();
        if (_underlying == address(0)) revert ZeroAddress();
        if (vault_ == address(0)) revert ZeroAddress();

        factory = admin;
        underlying = _underlying;
        vault = vault_;
        ovrfloToken = address(new OVRFLOToken(name_, symbol_, vault_));
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Sweeps underlying accidentally sent above the wrap reserve
    /// @dev Underlying held for wrapped supply is reserved and cannot be swept. `to` is
    ///      trusted because the caller is always the factory (admin), which is itself owned
    ///      by a timelocked multisig; zero-address validation is intentionally omitted.
    /// @param to The recipient address
    function sweepExcessUnderlying(address to) external onlyAdmin {
        uint256 balance = IERC20(underlying).balanceOf(address(this));
        uint256 reserve = wrappedUnderlying;
        uint256 excess = balance > reserve ? balance - reserve : 0;

        if (excess == 0) revert NoExcess();
        IERC20(underlying).safeTransfer(to, excess);
        emit ExcessUnderlyingSwept(underlying, to, excess);
    }

    /*//////////////////////////////////////////////////////////////
                            USER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Wraps underlying 1:1 into ovrfloToken without fees or streams
    /// @param amount Amount of underlying to wrap
    function wrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        wrappedUnderlying += amount;

        uint256 balanceBefore = IERC20(underlying).balanceOf(address(this));
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = IERC20(underlying).balanceOf(address(this));
        if (balanceAfter - balanceBefore != amount) revert TransferMismatch();

        OVRFLOToken(ovrfloToken).mint(msg.sender, amount);

        emit Wrapped(msg.sender, amount);
        _requirePeg();
    }

    /// @notice Unwraps ovrfloToken 1:1 into underlying when the reserve is funded
    /// @param amount Amount of ovrfloToken to burn
    function unwrap(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 reserve = wrappedUnderlying;
        if (reserve < amount) revert InsufficientReserve();

        wrappedUnderlying = reserve - amount;
        OVRFLOToken(ovrfloToken).burn(msg.sender, amount);
        IERC20(underlying).safeTransfer(msg.sender, amount);

        emit Unwrapped(msg.sender, amount);
        _requirePeg();
    }

    /// @dev Peg as a checked fact: every wrapped ovrfloToken is backed by held underlying.
    function _requirePeg() internal view {
        if (wrappedUnderlying > IERC20(underlying).balanceOf(address(this))) revert ReserveExceedsBalance();
    }
}
