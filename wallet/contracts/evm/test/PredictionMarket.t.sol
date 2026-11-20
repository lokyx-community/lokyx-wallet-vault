// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionMarket.sol";
import "./Mocks.sol";

contract PredictionMarketTest is Test {
    MockUSDT usdt;
    PredictionMarket pm;
    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address[] panel;
    uint256 constant UNIT = 1e18; // one USDT per winning share; one cent = 0.01
    uint256 constant CENT = UNIT / 100;
    uint256 constant FUND = 1000e18;

    // block.timestamp can be cached across a warp when compiled with via_ir, so the test keeps its own clock
    uint256 clock = 1_000_000;
    function _adv(uint256 s) internal { clock += s; vm.warp(clock); }

    function setUp() public {
        usdt = new MockUSDT();
        pm = new PredictionMarket(address(usdt), address(0xFEE), 0);
        address[3] memory who = [a, b, c];
        for (uint256 i = 0; i < 3; i++) {
            usdt.mint(who[i], FUND);
            vm.prank(who[i]);
            usdt.approve(address(pm), type(uint256).max);
            vm.prank(who[i]);
            pm.deposit(FUND);
        }
        for (uint256 i = 0; i < 5; i++) panel.push(address(uint160(0x100 + i)));
        vm.warp(clock);
        pm.create("Will it rain?", uint64(clock + 1 days), UNIT, panel);
    }

    function _conserved() internal view {
        (, , , , , uint64 supply, uint256 pool, , ) = pm.info(0);
        (uint64[] memory ids, , , , , ) = pm.book(0);
        ids;
        assertEq(pool, uint256(supply) * UNIT);
        uint256 total = pm.free(a) + pm.free(b) + pm.free(c) + pool + _lockedInBook();
        assertEq(total, 3 * FUND, "coins must never appear or vanish");
        assertEq(usdt.balanceOf(address(pm)), 3 * FUND);
    }

    function _lockedInBook() internal view returns (uint256 sum) {
        (, address[] memory owners, uint8[] memory outcomes, uint8[] memory sides, uint8[] memory prices, uint64[] memory qtys) = pm.book(0);
        for (uint256 i = 0; i < owners.length; i++) {
            if (sides[i] == 0) sum += uint256(prices[i]) * qtys[i] * CENT; // a buy locks coins at its own price
            outcomes[i];
        }
    }

    function test_yesBuyerMeetsNoBuyerMintsPair() public {
        vm.prank(a); pm.place(0, 0, 0, 62, 10);
        vm.prank(b); pm.place(0, 1, 0, 38, 10);
        assertEq(pm.yesOf(0, a), 10);
        assertEq(pm.noOf(0, b), 10);
        assertEq(pm.free(a), FUND - 620 * CENT);
        assertEq(pm.free(b), FUND - 380 * CENT);
        _conserved();
    }

    function test_tradeAtWaitingPriceAndDifferenceReturns() public {
        vm.prank(a); pm.place(0, 0, 0, 60, 10);
        vm.prank(b); pm.place(0, 1, 0, 50, 10); // crosses at 60 -> pays 40
        assertEq(pm.free(a), FUND - 600 * CENT);
        assertEq(pm.free(b), FUND - 400 * CENT);
        _conserved();
    }

    function test_yesSalePaysSeller() public {
        vm.prank(a); pm.place(0, 0, 0, 50, 5);
        vm.prank(b); pm.place(0, 1, 0, 50, 5);
        vm.prank(a); pm.place(0, 0, 1, 70, 5);
        vm.prank(c); pm.place(0, 0, 0, 80, 5);
        assertEq(pm.yesOf(0, c), 5);
        assertEq(pm.free(a), FUND - 250 * CENT + 350 * CENT);
        assertEq(pm.free(c), FUND - 350 * CENT);
        _conserved();
    }

    function test_sellerMeetsSellerBurnsPair() public {
        vm.prank(a); pm.place(0, 0, 0, 60, 4);
        vm.prank(b); pm.place(0, 1, 0, 40, 4);
        vm.prank(a); pm.place(0, 0, 1, 55, 4);
        vm.prank(b); pm.place(0, 1, 1, 45, 4);
        (, , , , , uint64 supply, uint256 pool, , ) = pm.info(0);
        assertEq(supply, 0);
        assertEq(pool, 0);
        assertEq(pm.free(a) + pm.free(b), 2 * FUND);
        assertEq(pm.free(a), FUND - 240 * CENT + 220 * CENT);
        assertEq(pm.free(b), FUND - 160 * CENT + 180 * CENT);
    }

    function test_cancelOnlyByOwner() public {
        vm.prank(a); uint64 id = pm.place(0, 0, 0, 30, 10);
        vm.prank(b); vm.expectRevert("that order isn't yours"); pm.cancel(0, id);
        vm.prank(a); pm.cancel(0, id);
        assertEq(pm.free(a), FUND);
    }

    function test_rejectsBadOrders() public {
        vm.startPrank(a);
        vm.expectRevert("the price must be between 1 and 99"); pm.place(0, 0, 0, 0, 1);
        vm.expectRevert("the price must be between 1 and 99"); pm.place(0, 0, 0, 100, 1);
        vm.expectRevert("buy or sell at least one share"); pm.place(0, 0, 0, 50, 0);
        vm.expectRevert("you don't hold that many Yes shares"); pm.place(0, 0, 1, 50, 1);
        vm.expectRevert("not enough coins deposited"); pm.place(0, 0, 0, 50, 1_000_000);
        vm.stopPrank();
    }

    function _pair() internal {
        vm.prank(a); pm.place(0, 0, 0, 60, 10);
        vm.prank(b); pm.place(0, 1, 0, 40, 10);
    }

    function test_proposalStandsWhenNobodyDisputes() public {
        _pair();
        _adv(1 days);
        vm.prank(c); pm.propose(0, 0);
        _adv(1 days);
        pm.finalize(0);
        vm.prank(a); assertEq(pm.claim(0), 10 * UNIT);
        vm.prank(b); assertEq(pm.claim(0), 0);
        (, , , , , , uint256 pool, , ) = pm.info(0);
        assertEq(pool, 0);
        assertEq(pm.free(a) + pm.free(b) + pm.free(c), 3 * FUND);
    }

    function test_disputeGoesToThePanel() public {
        _pair();
        _adv(1 days);
        vm.prank(c); pm.propose(0, 0);       // c claims Yes
        vm.prank(b); pm.dispute(0);          // b says it is wrong
        for (uint256 i = 0; i < 2; i++) { vm.prank(panel[i]); pm.vote(0, 1); }
        vm.prank(panel[2]); pm.vote(0, 0);   // 2 No, 1 Yes: no majority yet
        (, , , , PredictionMarket.State st, , , , ) = pm.info(0);
        assertEq(uint8(st), uint8(PredictionMarket.State.Open));
        vm.prank(panel[2]); pm.vote(0, 1);   // a changed vote reaches the majority
        vm.prank(b); assertEq(pm.claim(0), 10 * UNIT);
        assertEq(pm.free(a) + pm.free(b) + pm.free(c), 3 * FUND);
    }

    function test_expireAndInvalidPaysHalf() public {
        _pair();
        _adv(1 days + 30 days - 1);
        vm.expectRevert("not yet: there is still time to propose"); pm.expire(0);
        _adv(1);
        pm.expire(0);
        vm.prank(a); assertEq(pm.claim(0), 5 * UNIT);
        vm.prank(b); assertEq(pm.claim(0), 5 * UNIT);
        assertEq(pm.free(a) + pm.free(b) + pm.free(c), 3 * FUND);
    }

    function test_claimCancelsWaitingOrders() public {
        _pair();
        vm.prank(c); pm.place(0, 0, 0, 10, 5);
        vm.prank(a); pm.place(0, 0, 1, 99, 10);
        _adv(1 days + 30 days);
        pm.expire(0);
        vm.prank(c); pm.claim(0);
        vm.prank(a); pm.claim(0);
        vm.prank(b); pm.claim(0);
        assertEq(pm.free(a) + pm.free(b) + pm.free(c), 3 * FUND);
        (uint64[] memory ids, , , , , ) = pm.book(0);
        assertEq(ids.length, 0);
    }

    function test_withdraw() public {
        vm.prank(a); pm.withdraw(100e18);
        assertEq(usdt.balanceOf(a), 100e18);
        vm.prank(a); vm.expectRevert("not enough free coins"); pm.withdraw(FUND);
    }

    function test_createValidation() public {
        vm.expectRevert("the share value must be a multiple of 100 base units");
        pm.create("x", uint64(clock + 1 days), 150, panel);
        vm.expectRevert("close at least an hour from now");
        pm.create("x", uint64(clock + 10), UNIT, panel);
        address[] memory two = new address[](2);
        vm.expectRevert("the panel needs between 3 and 9 people");
        pm.create("x", uint64(clock + 1 days), UNIT, two);
    }

    function testFuzz_booksStayBalanced(uint256 seed) public {
        for (uint256 t = 0; t < 40; t++) {
            seed = uint256(keccak256(abi.encode(seed, t)));
            address who = t % 3 == 0 ? a : t % 3 == 1 ? b : c;
            uint8 outcome = uint8(seed % 2);
            uint8 side = uint8((seed >> 8) % 3 == 0 ? 1 : 0);
            uint8 price = uint8(1 + (seed >> 16) % 99);
            uint64 qty = uint64(1 + (seed >> 24) % 5);
            vm.prank(who);
            try pm.place(0, outcome, side, price, qty) {} catch {}
        }
        (, , , , , uint64 supply, uint256 pool, , ) = pm.info(0);
        assertEq(pool, uint256(supply) * UNIT);
        uint256 yes = pm.yesOf(0, a) + pm.yesOf(0, b) + pm.yesOf(0, c);
        uint256 no = pm.noOf(0, a) + pm.noOf(0, b) + pm.noOf(0, c);
        (, address[] memory owners, uint8[] memory outcomes, uint8[] memory sides, , uint64[] memory qtys) = pm.book(0);
        for (uint256 i = 0; i < owners.length; i++) {
            if (sides[i] == 1) { if (outcomes[i] == 0) yes += qtys[i]; else no += qtys[i]; }
        }
        assertEq(yes, supply);
        assertEq(no, supply);
        assertEq(usdt.balanceOf(address(pm)), 3 * FUND);
    }
}
