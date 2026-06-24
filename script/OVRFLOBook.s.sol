// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {OVRFLOBook} from "../src/OVRFLOBook.sol";

contract OVRFLOBookScript is Script {
    address internal constant DEFAULT_SABLIER_LL = 0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9;
    uint256 internal constant DEFAULT_BOOK_FEE_BPS = 0;

    function run() public {
        address factory = vm.envAddress("FACTORY_ADDRESS");
        address core = vm.envAddress("OVRFLO_ADDRESS");
        address multisig = vm.envAddress("MULTISIG_ADDRESS");
        address sablier = vm.envOr("SABLIER_ADDRESS", DEFAULT_SABLIER_LL);
        uint16 bookFeeBps = _toUint16(vm.envOr("BOOK_FEE_BPS", DEFAULT_BOOK_FEE_BPS), "BOOK_FEE_BPS");
        address bookTreasury = vm.envOr("BOOK_TREASURY", address(0));

        vm.startBroadcast();

        OVRFLOBook book = new OVRFLOBook(factory, core, sablier);
        if (book.aprMinBps() != book.LAUNCH_APR_BPS() || book.aprMaxBps() != book.LAUNCH_APR_BPS()) {
            book.setAprBounds(book.LAUNCH_APR_BPS(), book.LAUNCH_APR_BPS());
        }
        if (book.feeBps() != bookFeeBps) {
            book.setFee(bookFeeBps);
        }
        if (bookTreasury != address(0) && bookTreasury != book.treasury()) {
            book.setTreasury(bookTreasury);
        }
        book.transferOwnership(multisig);

        console.log("OVRFLOBook deployed to:", address(book));
        console.log("Factory:", factory);
        console.log("OVRFLO core:", core);
        console.log("Sablier:", sablier);
        console.log("Pending owner (multisig):", multisig);
        console.log("Treasury:", book.treasury());
        console.log("Fee bps:", book.feeBps());
        console.log("APR bounds:", book.aprMinBps(), book.aprMaxBps());

        vm.stopBroadcast();
    }

    function _toUint16(uint256 value, string memory name) internal pure returns (uint16) {
        require(value <= type(uint16).max, string(abi.encodePacked("OVRFLOBookScript: ", name, " too high")));
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(value);
    }
}
