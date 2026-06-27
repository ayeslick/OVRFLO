// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFlashBorrower
/// @notice Interface for contracts that receive PT flash loans from the OVRFLO vault.
/// @dev Inspired by EIP-3156. The borrower must return keccak256("OVRFLO.onFlashLoan")
///      to confirm acceptance of the loan. A custom hash is used to domain-separate from
///      other flash loan protocols.
interface IFlashBorrower {
    /// @notice Called by the OVRFLO vault after sending PT tokens to the borrower.
    /// @param initiator The address that called flashLoan (msg.sender of the flashLoan call)
    /// @param ptToken The PT token address that was lent
    /// @param amount The amount of PT tokens lent
    /// @param fee The fee in underlying tokens that will be pulled after repayment
    /// @param data Arbitrary data passed by the initiator
    /// @return CALLBACK_SUCCESS if the borrower accepts the loan, any other value reverts
    function onFlashLoan(
        address initiator,
        address ptToken,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bytes32);
}
