// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {IFlashBorrower} from "../../../interfaces/IFlashBorrower.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal vault interface for deposit during reentrancy test
interface IVaultFlash {
    function flashLoan(address ptToken, uint256 amount, bytes calldata data) external;
    function deposit(address market, uint256 ptAmount, uint256 minToUser)
        external returns (uint256, uint256, uint256);
}

/// @notice Mock flash loan borrower that repays PT plus fee, with optional reentrancy mode
contract MockFlashBorrower is IFlashBorrower {
    bytes32 private constant CALLBACK_SUCCESS = keccak256("OVRFLO.onFlashLoan");

    address public immutable vault;
    address public immutable ptToken;
    address public immutable underlying;
    address public immutable market;

    constructor(address _vault, address _ptToken, address _underlying, address _market) {
        vault = _vault;
        ptToken = _ptToken;
        underlying = _underlying;
        market = _market;
        IERC20(_ptToken).approve(_vault, type(uint256).max);
        IERC20(_underlying).approve(_vault, type(uint256).max);
    }

    function onFlashLoan(address, address, uint256, uint256, bytes calldata data)
        external
        returns (bytes32)
    {
        if (data.length > 0) {
            bool reenter = abi.decode(data, (bool));
            if (reenter) {
                try IVaultFlash(vault).deposit(market, 1e6, 0) {} catch {}
            }
        }
        return CALLBACK_SUCCESS;
    }

    function executeFlashLoan(uint256 amount, bytes calldata data) external {
        IVaultFlash(vault).flashLoan(ptToken, amount, data);
    }
}
