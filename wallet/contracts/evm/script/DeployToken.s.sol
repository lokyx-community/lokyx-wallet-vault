// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TestUSDT.sol";

/// forge script script/DeployToken.s.sol --rpc-url <bnb testnet rpc> --broadcast --private-key $KEY
contract DeployToken is Script {
    function run() external {
        vm.startBroadcast();
        TestUSDT t = new TestUSDT();
        vm.stopBroadcast();
        console.log("TestUSDT:", address(t));
    }
}
