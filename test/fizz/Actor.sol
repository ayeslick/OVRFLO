// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

/// @notice Represents an actor interacting with the system
contract Actor {
    constructor() payable {
        
    }

    receive() external payable {}

    // ――――――――――――――――――― Flash loan borrower ――――――――――――――――――――

    function onFlashLoan(address initiator, address token, uint256 amount, uint256 fee, bytes calldata data)
        external
        returns (bytes32)
    {
        // Implement here flash loan logic, if needed
        return keccak256("OVRFLO.onFlashLoan");
    }

    // ――――――――――――――――――――― ERC-721 receiver ―――――――――――――――――――――

    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    // ―――――――――――――――――――― ERC-1155 receiver ―――――――――――――――――――――

    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
