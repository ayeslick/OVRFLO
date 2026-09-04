// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import {OVRFLOToken} from "./OVRFLOToken.sol";

/// @dev Vault treasury getter. Declared here so this file does not import `OVRFLO.sol`
///      (the vault constructs this reserve).
interface IVaultTreasury {
    function TREASURY_ADDR() external view returns (address);
}

/// @title OVRFLOReserve
/// @notice Holds the underlying that backs 1:1 wrapped ovrfloToken for one column.
/// @dev One reserve per underlying. The OVRFLO vault constructs the reserve, and the
///      reserve constructs the column's ovrfloToken, so the token learns both minters
///      at construction: `vault` from the argument and `reserve` from `msg.sender`.
///      The vault holds no underlying; every wrap/unwrap balance lives here.
///      No reentrancy guard on `wrap`/`unwrap`: `wrappedUnderlying` moves before the
///      external call, and the end-of-function peg check reverts any state where the
///      tracked reserve exceeds the held balance. ERC-3156 flash mint uses a
///      flash-only entered flag; wrap and unwrap stay callable in the callback.
contract OVRFLOReserve is IERC3156FlashLender {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Hard cap on `flashMintMax`. 100 billion whole tokens.
    uint256 public constant FLASH_MINT_MAX_CEILING = 100_000_000_000 * 10 ** 18;

    /// @notice Hard cap on `flashFeeBps` (9 bps).
    uint16 public constant FLASH_FEE_MAX_BPS = 9;

    /// @dev ERC-3156 callback success value.
    bytes32 private constant FLASH_CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

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
    /// @dev `flashFee` / `flashLoan` was called for a token other than this column's ovrfloToken.
    error UnsupportedFlashToken();
    /// @dev `flashLoan` amount is 0 while entered, when max is 0, or above `maxFlashLoan`.
    error FlashExceedsMax();
    /// @dev The receiver did not return the ERC-3156 success keccak.
    error FlashCallbackFailed();
    /// @dev `setFlashMintMax` exceeded `FLASH_MINT_MAX_CEILING`.
    error FlashMintMaxTooHigh();
    /// @dev `setFlashFeeBps` exceeded `FLASH_FEE_MAX_BPS`.
    error FlashFeeTooHigh();

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

    /// @notice Per-call flash-mint cap. Launch 0 disables mint. Economic bound, not overflow guard.
    uint256 public flashMintMax;

    /// @notice Flash-mint fee in basis points. Launch 0. Capped at `FLASH_FEE_MAX_BPS`.
    uint16 public flashFeeBps;

    /// @dev True only during `flashLoan`. Nested flash sees `maxFlashLoan == 0`.
    bool private flashEntered;

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

    /// @notice Emitted when the factory sets the per-call flash-mint cap
    /// @param max New cap; 0 disables mint
    event FlashMintMaxSet(uint256 max);

    /// @notice Emitted when the factory sets the flash-mint fee
    /// @param bps New fee in basis points
    event FlashFeeBpsSet(uint16 bps);

    /// @notice Emitted on a successful flash mint. `fee` is the applied fee (CP#25).
    /// @param receiver The ERC-3156 receiver
    /// @param initiator The `flashLoan` caller
    /// @param amount Principal minted and burned
    /// @param fee Fee pulled from the receiver and sent to the column treasury
    event FlashLoan(address indexed receiver, address indexed initiator, uint256 amount, uint256 fee);

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

    /// @notice Set the per-call flash-mint cap. Zero disables mint.
    /// @dev Admin is the factory; the factory owner is the timelocked Safe. The economic
    ///      cap is `amount <= flashMintMax`. `type(uint256).max - totalSupply()` is overflow
    ///      guard only (sweep rule 10).
    /// @param max New cap; must be <= `FLASH_MINT_MAX_CEILING`
    function setFlashMintMax(uint256 max) external onlyAdmin {
        if (max > FLASH_MINT_MAX_CEILING) revert FlashMintMaxTooHigh();
        flashMintMax = max;
        emit FlashMintMaxSet(max);
    }

    /// @notice Set the flash-mint fee in basis points.
    /// @dev Admin is the factory; the factory owner is the timelocked Safe.
    /// @param bps New fee; must be <= `FLASH_FEE_MAX_BPS`
    function setFlashFeeBps(uint16 bps) external onlyAdmin {
        if (bps > FLASH_FEE_MAX_BPS) revert FlashFeeTooHigh();
        flashFeeBps = bps;
        emit FlashFeeBpsSet(bps);
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

    /// @notice ERC-3156 maximum flash mint of ovrfloToken
    /// @dev Returns 0 for any other token, while a flash is entered, or when `flashMintMax`
    ///      is 0. Otherwise `min(flashMintMax, type(uint256).max - totalSupply())`.
    function maxFlashLoan(address token) public view override returns (uint256) {
        if (token != ovrfloToken || flashEntered || flashMintMax == 0) return 0;
        uint256 supply = IERC20(ovrfloToken).totalSupply();
        uint256 overflowGuard = type(uint256).max - supply;
        return flashMintMax < overflowGuard ? flashMintMax : overflowGuard;
    }

    /// @notice ERC-3156 flash-mint fee for `amount` of ovrfloToken
    function flashFee(address token, uint256 amount) public view override returns (uint256) {
        if (token != ovrfloToken) revert UnsupportedFlashToken();
        return Math.mulDiv(amount, flashFeeBps, 10_000);
    }

    /// @notice ERC-3156 flash mint of ovrfloToken for one callback
    /// @dev Mint `amount` to `receiver`, call `onFlashLoan`, pull `amount + fee`, burn
    ///      `amount`, send `fee` to the column treasury. The flash mints and burns the
    ///      same `amount`, so it adds no unbacked supply. Callbacks may change supply
    ///      through wrap, unwrap, and deposit. Wrap, unwrap, and vault deposit stay
    ///      callable in the callback; they do not share this entered flag. Nested flash
    ///      reverts because `maxFlashLoan` is 0 while entered. Check max before setting
    ///      the flag so the outer call is not blocked by its own lock.
    function flashLoan(IERC3156FlashBorrower receiver, address token, uint256 amount, bytes calldata data)
        external
        override
        returns (bool)
    {
        if (token != ovrfloToken) revert UnsupportedFlashToken();
        if (amount == 0) revert ZeroAmount();
        if (amount > maxFlashLoan(token)) revert FlashExceedsMax();

        uint256 fee = Math.mulDiv(amount, flashFeeBps, 10_000);

        flashEntered = true;
        OVRFLOToken(ovrfloToken).mint(address(receiver), amount);

        if (receiver.onFlashLoan(msg.sender, token, amount, fee, data) != FLASH_CALLBACK_SUCCESS) {
            revert FlashCallbackFailed();
        }

        uint256 repay = amount + fee;
        IERC20 token_ = IERC20(ovrfloToken);
        token_.safeTransferFrom(address(receiver), address(this), repay);

        OVRFLOToken(ovrfloToken).burn(address(this), amount);
        if (fee > 0) {
            token_.safeTransfer(IVaultTreasury(vault).TREASURY_ADDR(), fee);
        }

        flashEntered = false;

        emit FlashLoan(address(receiver), msg.sender, amount, fee);
        return true;
    }

    /// @dev Peg as a checked fact: every wrapped ovrfloToken is backed by held underlying.
    function _requirePeg() internal view {
        if (wrappedUnderlying > IERC20(underlying).balanceOf(address(this))) revert ReserveExceedsBalance();
    }
}
