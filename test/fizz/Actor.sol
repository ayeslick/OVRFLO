// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

/// @notice Represents an actor interacting with the system
contract Actor {
    constructor() payable {
        
    }

    receive() external payable {}

    // ――――――――――――――――――― Flash loan borrower ――――――――――――――――――――

    function onFlashLoan(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes32)
    {
        return keccak256("OVRFLO.onFlashLoan");
    }

    // ――――――――――――――――――――― ERC-721 receiver ―――――――――――――――――――――

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC721Received.selector;
    }

    // ―――――――――――――――――――― ERC-1155 receiver ―――――――――――――――――――――

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}
