// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PredictionMarket.sol";

/// forge script script/Deploy.s.sol --rpc-url bnb_testnet --broadcast --private-key $KEY
/// TOKEN is the USDT contract on BNB testnet (chain 97) that you want the market to use.
contract Deploy is Script {
    function run() external {
        address token = vm.envAddress("TOKEN");
        vm.startBroadcast();
        PredictionMarket pm = new PredictionMarket(token);
        vm.stopBroadcast();
        console.log("PredictionMarket:", address(pm));
    }
}
