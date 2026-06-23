// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOvrfloAdmin {
    function ovrfloInfo(address ovrflo)
        external
        view
        returns (address treasury, address underlying, address ovrfloToken);
}
