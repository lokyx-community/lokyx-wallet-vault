// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TestUSDT.sol";

contract TestUSDTTest is Test {
    function test_mintAndMove() public {
        TestUSDT t = new TestUSDT();
        t.mint(address(this), 100e18);
        assertEq(t.decimals(), 18);
        t.transfer(address(0xB0B), 40e18);
        assertEq(t.balanceOf(address(0xB0B)), 40e18);
        vm.expectRevert("at most 10,000 per mint");
        t.mint(address(this), 10_001e18);
        vm.expectRevert("balance too low");
        t.transfer(address(0xB0B), 1000e18);
    }
}
