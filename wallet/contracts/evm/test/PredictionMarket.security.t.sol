// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionMarket.sol";
import "./Mocks.sol";

/// One test for each thing a review found, written so it FAILS on the old code.
contract SecurityTest is Test {
    MockUSDT usdt;
    PredictionMarket pm;
    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address[] panel;
    uint256 constant UNIT = 1e18;
    uint256 constant CENT = UNIT / 100;
    uint256 constant FUND = 100_000e18;
    uint256 clock = 1_000_000;

    function _adv(uint256 s) internal { clock += s; vm.warp(clock); }

    function setUp() public {
        usdt = new MockUSDT();
        pm = new PredictionMarket(address(usdt));
        address[3] memory who = [a, b, c];
        for (uint256 i = 0; i < 3; i++) {
            usdt.mint(who[i], FUND);
            vm.prank(who[i]); usdt.approve(address(pm), type(uint256).max);
            vm.prank(who[i]); pm.deposit(FUND);
        }
        for (uint256 i = 0; i < 5; i++) panel.push(address(uint160(0x100 + i)));
        vm.warp(clock);
        pm.create("Q?", uint64(clock + 1 days), UNIT, panel);
    }

    // ---- 3. expire() must not override a pending majority ----
    function test_expireCannotOverrideAPendingMajority() public {
        vm.prank(a); pm.place(0, 0, 0, 60, 10);
        vm.prank(b); pm.place(0, 1, 0, 40, 10);
        _adv(1 days + 30 days - 1 hours);
        for (uint256 i = 0; i < 3; i++) { vm.prank(panel[i]); pm.vote(0, 0); } // Yes majority, window runs 24h
        _adv(2 hours); // now past close + 30 days, but the decision is still pending
        vm.expectRevert("the panel has agreed: finalize it instead");
        pm.expire(0);
        _adv(1 days);
        pm.finalize(0);
        vm.prank(a); assertEq(pm.claim(0), 10 * UNIT);
    }

    function test_expireStillWorksWhenNobodyAgrees() public {
        _adv(1 days + 30 days);
        pm.expire(0);
        (, , , , PredictionMarket.State st, , , , ) = pm.info(0);
        assertEq(uint8(st), uint8(PredictionMarket.State.Invalid));
    }

    // ---- 6. a vote after the objection window cannot undo the decision ----
    function test_lateVoteCannotUndoAFinalizableDecision() public {
        _adv(1 days);
        for (uint256 i = 0; i < 3; i++) { vm.prank(panel[i]); pm.vote(0, 0); }
        _adv(1 days); // the window is over, nobody has finalized yet
        vm.prank(panel[0]);
        vm.expectRevert("the objection window is over: finalize it");
        pm.vote(0, 1);
        pm.finalize(0);
    }

    function test_voteInsideTheWindowStillChangesTheDecision() public {
        _adv(1 days);
        for (uint256 i = 0; i < 3; i++) { vm.prank(panel[i]); pm.vote(0, 0); }
        _adv(1 hours);
        vm.prank(panel[0]); pm.vote(0, 1); // allowed: still inside the window
        vm.expectRevert("the panel has not agreed yet");
        pm.finalize(0);
    }

    // ---- 4. a full book never stops an order that can trade ----
    function _fillBook() internal {
        for (uint256 i = 0; i < pm.MAX_ORDERS(); i++) { vm.prank(c); pm.place(0, 0, 0, 1, 1); } // 100 Yes bids at 1
        (uint64[] memory ids, , , , , ) = pm.book(0);
        assertEq(ids.length, pm.MAX_ORDERS());
    }

    function test_fullBookStillMatchesATaker() public {
        _fillBook();
        // A No buyer at 99 (= a Yes ask at 1) crosses the resting Yes bids at 1 and trades; nothing needs to rest.
        vm.prank(b); pm.place(0, 1, 0, 99, 1);
        assertEq(pm.yesOf(0, c), 1);
        assertEq(pm.noOf(0, b), 1);
        _solvent();
    }

    function test_fullBookRefusesAnOrderThatCannotTradeAtAll() public {
        _fillBook();
        vm.prank(b);
        vm.expectRevert("the book is full of waiting orders");
        pm.place(0, 0, 0, 1, 1);
    }

    function test_fullBookTradeThenTheLeftoverRests() public {
        _fillBook(); // 100 resting Yes bids at 1, one share each
        uint256 before_ = pm.free(b);
        // 150 shares: trades against all 100 resting bids (freeing 100 slots), the other 50 rest.
        vm.prank(b); pm.place(0, 1, 0, 99, 150);
        assertEq(pm.noOf(0, b), 100);
        (uint64[] memory ids, , , , , uint64[] memory qtys) = pm.book(0);
        assertEq(ids.length, 1);
        assertEq(qtys[0], 50);
        assertEq(before_ - pm.free(b), 150 * 99 * CENT, "100 traded at 99 each, 50 still locked at 99 each");
        _solvent();
    }

    // ---- 5. token safety ----
    function test_constructorRejectsZeroAndNonContractTokens() public {
        vm.expectRevert("the token must be a contract");
        new PredictionMarket(address(0));
        vm.expectRevert("the token must be a contract");
        new PredictionMarket(address(0xdead));
    }

    function test_feeOnTransferTokenIsRefused() public {
        FeeToken f = new FeeToken();
        PredictionMarket p = new PredictionMarket(address(f));
        f.mint(a, 1000e18);
        vm.prank(a); f.approve(address(p), type(uint256).max);
        vm.prank(a);
        vm.expectRevert("this token takes a fee on transfer");
        p.deposit(100e18);
        assertEq(p.free(a), 0);
    }

    function test_tokenThatSaysFalseIsRefused() public {
        FalseToken f = new FalseToken();
        PredictionMarket p = new PredictionMarket(address(f));
        vm.prank(a);
        vm.expectRevert("token transfer failed");
        p.deposit(1e18);
    }

    function test_tokenThatReturnsNothingWorks() public {
        NoReturnToken n = new NoReturnToken();
        PredictionMarket p = new PredictionMarket(address(n));
        n.mint(a, 100e18);
        vm.startPrank(a);
        n.approve(address(p), type(uint256).max);
        p.deposit(100e18);
        p.withdraw(40e18);
        vm.stopPrank();
        assertEq(n.balanceOf(a), 40e18);
        assertEq(p.free(a), 60e18);
    }

    // ---- 7. reentrancy ----
    function test_cannotReenterDepositFromATokenCallback() public {
        ReentrantToken r = new ReentrantToken();
        PredictionMarket p = new PredictionMarket(address(r));
        r.mint(a, 100e18);
        vm.prank(a); r.approve(address(p), type(uint256).max);
        r.arm(address(p), abi.encodeCall(PredictionMarket.deposit, (1)));
        vm.prank(a); p.deposit(10e18);
        assertFalse(r.lastOk());
        assertEq(keccak256(r.lastRet()), keccak256(abi.encodeWithSignature("Error(string)", "reentrant call")));
    }

    function test_cannotReenterWithdrawFromATokenCallback() public {
        ReentrantToken r = new ReentrantToken();
        PredictionMarket p = new PredictionMarket(address(r));
        r.mint(a, 100e18);
        vm.startPrank(a); r.approve(address(p), type(uint256).max); p.deposit(50e18); vm.stopPrank();
        r.arm(address(p), abi.encodeCall(PredictionMarket.withdraw, (1)));
        vm.prank(a); p.withdraw(10e18);
        assertFalse(r.lastOk());
        assertEq(keccak256(r.lastRet()), keccak256(abi.encodeWithSignature("Error(string)", "reentrant call")));
        assertEq(p.free(a), 40e18);
    }

    // ---- 6. panel validation ----
    function test_panelCannotHoldZeroOrTheMarketItself() public {
        address[] memory p3 = new address[](3);
        p3[0] = address(0x1); p3[1] = address(0x2); p3[2] = address(0);
        vm.expectRevert("that can't be a panel member");
        pm.create("x", uint64(clock + 1 days), UNIT, p3);
        p3[2] = address(pm);
        vm.expectRevert("that can't be a panel member");
        pm.create("x", uint64(clock + 1 days), UNIT, p3);
        p3[2] = address(usdt);
        vm.expectRevert("that can't be a panel member");
        pm.create("x", uint64(clock + 1 days), UNIT, p3);
    }

    // ---- 7. emergency pause: stops new activity, never exits ----
    function test_pauseStopsNewActivityButNeverExits() public {
        vm.prank(a); pm.place(0, 0, 0, 60, 10);
        vm.prank(b); pm.place(0, 1, 0, 40, 10);
        vm.prank(a); uint64 oid = pm.place(0, 0, 0, 10, 5); // a resting order
        pm.setPaused(true);

        vm.prank(a); vm.expectRevert("paused: no new deposits, markets or orders"); pm.deposit(1);
        vm.prank(a); vm.expectRevert("paused: no new deposits, markets or orders"); pm.place(0, 0, 0, 10, 1);
        vm.expectRevert("paused: no new deposits, markets or orders");
        pm.create("x", uint64(clock + 1 days), UNIT, panel);

        // exits all still work
        vm.prank(a); pm.cancel(0, oid);
        vm.prank(a); pm.withdraw(1e18);
        _adv(1 days + 30 days);
        pm.expire(0);
        vm.prank(a); pm.claim(0);
        vm.prank(b); pm.claim(0);
    }

    function test_onlyTheOwnerCanPauseAndTransfer() public {
        vm.prank(a); vm.expectRevert("only the owner"); pm.setPaused(true);
        vm.prank(a); vm.expectRevert("only the owner"); pm.transferOwnership(a);
        pm.transferOwnership(a);
        vm.prank(a); pm.setPaused(true);
        assertTrue(pm.paused());
    }

    // ---- collateral stays 100% backed through every kind of step ----
    function test_solvencyThroughAFullLifeCycle() public {
        vm.prank(a); pm.place(0, 0, 0, 70, 10);   // Yes bid 70
        _solvent();
        vm.prank(b); pm.place(0, 1, 0, 25, 4);    // No buy 25 = Yes ask 75: no cross
        _solvent();
        vm.prank(c); pm.place(0, 1, 0, 40, 6);    // Yes ask 60 crosses the bid at 70: trades 6 at 70 (partial fill of a's bid)
        _solvent();
        assertEq(pm.yesOf(0, a), 6);
        vm.prank(a); pm.place(0, 0, 1, 50, 3);    // Yes sell 3 at 50 (crosses a's own remaining bid: a self trade is fine)
        _solvent();
        vm.prank(c); pm.place(0, 1, 1, 30, 2);    // c sells 2 No at 30 (= Yes bid 70)
        _solvent();
        vm.prank(b); pm.cancel(0, 1);             // cancel b's resting order
        _solvent();

        _adv(1 days);
        for (uint256 i = 0; i < 3; i++) { vm.prank(panel[i]); pm.vote(0, 1); } // No wins
        _adv(1 days);
        pm.finalize(0);
        _solvent();
        vm.prank(a); pm.claim(0);
        vm.prank(b); pm.claim(0);
        vm.prank(c); pm.claim(0);
        (, , , , , , uint256 pool, , ) = pm.info(0);
        assertEq(pool, 0, "every share has been paid out and nothing is left over or missing");
        assertEq(usdt.balanceOf(address(pm)), pm.free(a) + pm.free(b) + pm.free(c));
        assertEq(pm.free(a) + pm.free(b) + pm.free(c), 3 * FUND);
    }

    function _solvent() internal view {
        (, , , , , uint64 supply, uint256 pool, , ) = pm.info(0);
        assertEq(pool, uint256(supply) * UNIT);
        uint256 locked;
        (, address[] memory owners, , uint8[] memory sides, uint8[] memory prices, uint64[] memory qtys) = pm.book(0);
        for (uint256 i = 0; i < owners.length; i++) if (sides[i] == 0) locked += uint256(prices[i]) * qtys[i] * CENT;
        assertEq(usdt.balanceOf(address(pm)), pm.free(a) + pm.free(b) + pm.free(c) + pool + locked);
    }
}
