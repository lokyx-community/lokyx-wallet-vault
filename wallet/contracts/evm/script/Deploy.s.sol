// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PredictionMarket.sol";

/// forge script script/Deploy.s.sol --rpc-url bnb_testnet --broadcast --private-key $KEY
/// TOKEN is the USDT contract on BNB testnet (chain 97) that you want the market to use.
/// COLLECTOR receives 60% of fees (an address you control); FEE_BPS is the taker fee, at most 100 (1%). Both are fixed for good.
contract Deploy is Script {
    function run() external {
        address token = vm.envAddress("TOKEN");
        address collector = vm.envAddress("COLLECTOR");
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(100));
        vm.startBroadcast();
        PredictionMarket pm = new PredictionMarket(token, collector, feeBps);
        vm.stopBroadcast();
        console.log("PredictionMarket:", address(pm));
    }
}
