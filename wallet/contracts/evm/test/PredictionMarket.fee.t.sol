// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionMarket.sol";
import "./Mocks.sol";

/// The taker fee: 1% of the taker's side, 20% to the maker, 20% held for the right answer, 60% to the collector.
contract PredictionMarketFeeTest is Test {
    MockUSDT usdt;
    PredictionMarket pm;
    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address collector = address(0xFEE);
    address[] panel;
    uint256 constant UNIT = 1e18;
    uint256 constant CENT = UNIT / 100;
    uint256 constant FUND = 1000e18;

    event Traded(uint256 indexed id, uint8 price, uint64 qty, address indexed taker, address indexed maker, uint256 fee);

    uint256 clock = 1_000_000;
    function _adv(uint256 s) internal { clock += s; vm.warp(clock); }

    function setUp() public {
        usdt = new MockUSDT();
        pm = new PredictionMarket(address(usdt), collector, 100);
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

    function _everyCoin() internal view {
        (, , , , , , uint256 pool, , ) = pm.info(0);
        (, address[] memory owners, , uint8[] memory sides, uint8[] memory prices, uint64[] memory qtys) = pm.book(0);
        uint256 locked;
        for (uint256 i = 0; i < owners.length; i++) if (sides[i] == 0) locked += uint256(prices[i]) * qtys[i] * CENT;
        (, , , , , , uint256 bonds) = pm.resolution(0);
        uint256 total = pm.free(a) + pm.free(b) + pm.free(c) + pm.free(collector) + pool + locked + bonds + pm.answerFees(0);
        assertEq(total, 3 * FUND, "coins must never appear or vanish");
        assertEq(usdt.balanceOf(address(pm)), 3 * FUND);
    }

    function test_fixedAtDeployAndCapped() public {
        assertEq(pm.feeBps(), 100);
        assertEq(pm.feeCollector(), collector);
        vm.expectRevert(bytes("the fee is above the maximum"));
        new PredictionMarket(address(usdt), collector, 101);
        vm.expectRevert(bytes("a fee needs a collector"));
        new PredictionMarket(address(usdt), address(0), 100);
    }

    function test_splitOfOneFee() public {
        // a waits to buy Yes at 62; b sells No into it by buying No at 38: b is the taker, a is the maker
        vm.prank(a); pm.place(0, 0, 0, 62, 10);
        uint256 aBefore = pm.free(a);
        uint256 bBefore = pm.free(b);
        uint256 fee = 38 * 10 * CENT / 100; // 1% of the taker's 3.80
        vm.expectEmit(true, true, true, true);
        emit Traded(0, 62, 10, b, a, fee);
        vm.prank(b); pm.place(0, 1, 0, 38, 10);
        assertEq(pm.free(b), bBefore - 38 * 10 * CENT - fee, "taker pays the side plus the fee");
        assertEq(pm.free(a), aBefore + fee * 20 / 100, "the maker gets 20%");
        assertEq(pm.answerFees(0), fee * 20 / 100, "20% waits for the right answer");
        assertEq(pm.free(collector), fee - fee * 20 / 100 - fee * 20 / 100, "the collector gets the rest");
        _everyCoin();
    }

    function test_makerOrderPaysNoFeeWhileWaiting() public {
        uint256 before_ = pm.free(a);
        vm.prank(a); pm.place(0, 0, 0, 50, 10);
        assertEq(pm.free(a), before_ - 500 * CENT, "only the lock leaves free coins");
        assertEq(pm.free(collector), 0);
    }

    function test_sellerTakerPaysFromProceeds() public {
        vm.prank(a); pm.place(0, 0, 0, 50, 10);
        vm.prank(b); pm.place(0, 1, 0, 50, 10); // b mints No, a holds Yes
        uint256 bBefore = pm.free(b);
        vm.prank(c); pm.place(0, 0, 0, 70, 10); // c waits to buy Yes at 70
        vm.prank(a); pm.place(0, 0, 1, 70, 10); // a sells Yes into it: a is the taker, receives 7.00
        uint256 fee = 70 * 10 * CENT / 100;
        uint256 rebate = (50 * 10 * CENT / 100) * 20 / 100; // a was the maker in its own buy
        assertEq(pm.free(a), FUND - 500 * CENT + rebate + 700 * CENT - fee);
        assertEq(pm.free(b), bBefore);
        _everyCoin();
    }

    function test_answerShareGoesToTheProposerWhenUndisputed() public {
        vm.prank(a); pm.place(0, 0, 0, 62, 10);
        vm.prank(b); pm.place(0, 1, 0, 38, 10);
        uint256 held = pm.answerFees(0);
        assertGt(held, 0);
        _adv(2 days);
        vm.prank(c); pm.propose(0, 0);
        _adv(1 days + 1);
        uint256 before_ = pm.free(c);
        pm.finalize(0);
        assertEq(pm.free(c), before_ + 20 * UNIT + held, "bond back plus the answer share");
        assertEq(pm.answerFees(0), 0);
        _everyCoin();
    }

    function test_answerShareGoesToTheCollectorWhenNoOneAnswers() public {
        vm.prank(a); pm.place(0, 0, 0, 62, 10);
        vm.prank(b); pm.place(0, 1, 0, 38, 10);
        uint256 held = pm.answerFees(0);
        uint256 before_ = pm.free(collector);
        _adv(31 days);
        pm.expire(0);
        assertEq(pm.free(collector), before_ + held);
        _everyCoin();
    }

    function test_buyNeedsRoomForTheFee() public {
        uint256 spare = pm.free(a) - 620 * CENT;
        vm.prank(a); pm.withdraw(spare); // leaves exactly the lock, nothing for a fee
        vm.expectRevert(bytes("not enough coins deposited"));
        vm.prank(a); pm.place(0, 0, 0, 62, 10);
    }

    function test_noFeeContractTakesNothing() public {
        PredictionMarket p = new PredictionMarket(address(usdt), address(0), 0);
        assertEq(p.feeBps(), 0);
    }
}
