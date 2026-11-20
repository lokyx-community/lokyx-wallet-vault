// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../src/PredictionMarket.sol";
import "./Mocks.sol";

/// Plays the market at random: deposits, withdrawals, orders of every kind (so partial fills, mints, burns, trades),
/// cancels, then settlement (a panel decision, or expiry) and claims. Nothing here knows what the answer should be;
/// the invariants below must hold after every single call.
contract Handler is Test {
    PredictionMarket public pm;
    MockUSDT public usdt;
    address[] public actors;
    address[] public panel;
    uint256 public clock = 1_000_000;
    uint256 public closeAt;
    uint256 public constant MARKETS = 2;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public trades; // how many orders actually went through, so a "passing" run is known not to be empty

    constructor(PredictionMarket p, MockUSDT u) {
        pm = p;
        usdt = u;
        for (uint256 i = 0; i < 4; i++) actors.push(address(uint160(0xA00 + i)));
        for (uint256 i = 0; i < 5; i++) panel.push(address(uint160(0x100 + i)));
        vm.warp(clock);
        closeAt = clock + 1 days;
        for (uint256 i = 0; i < MARKETS; i++) pm.create("Q?", uint64(closeAt), 1e18, panel);
    }

    function _actor(uint256 s) internal view returns (address) { return actors[s % actors.length]; }

    function deposit(uint256 s, uint256 amt) external {
        address a = _actor(s);
        amt = bound(amt, 1, 500e18);
        usdt.mint(a, amt);
        vm.startPrank(a);
        usdt.approve(address(pm), type(uint256).max);
        pm.deposit(amt);
        vm.stopPrank();
        deposited += amt;
    }

    function withdraw(uint256 s, uint256 amt) external {
        address a = _actor(s);
        uint256 f = pm.free(a);
        if (f == 0) return;
        amt = bound(amt, 1, f);
        vm.prank(a);
        pm.withdraw(amt);
        withdrawn += amt;
    }

    function place(uint256 s, uint256 mid, uint8 outcome, uint8 side, uint8 price, uint64 qty) external {
        address a = _actor(s);
        mid = mid % MARKETS;
        outcome = outcome % 2;
        side = side % 2;
        price = uint8(bound(price, 1, 99));
        qty = uint64(bound(qty, 1, 40));
        vm.prank(a);
        try pm.place(mid, outcome, side, price, qty) { trades++; } catch {}
    }

    function cancel(uint256 s, uint256 mid) external {
        mid = mid % MARKETS;
        (uint64[] memory ids, address[] memory owners, , , , ) = pm.book(mid);
        if (ids.length == 0) return;
        uint256 i = s % ids.length;
        vm.prank(owners[i]);
        pm.cancel(mid, ids[i]);
    }

    /// Time moves on to the close, the panel votes (or nobody does and the market expires), the market is finalized.
    function settle(uint256 mid, uint8 v, bool expireInstead, bool flip) external {
        mid = mid % MARKETS;
        (, , , , PredictionMarket.State st, , , , ) = pm.info(mid);
        if (st != PredictionMarket.State.Open) return;
        if (clock < closeAt) { clock = closeAt; vm.warp(clock); }
        if (expireInstead) {
            clock += 30 days;
            vm.warp(clock);
            try pm.expire(mid) {} catch {}
            return;
        }
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(panel[i]);
            try pm.vote(mid, v % 3) {} catch {}
        }
        if (flip) { vm.prank(panel[0]); try pm.vote(mid, (v + 1) % 3) {} catch {} } // an objection inside the window
        clock += 1 days + 1;
        vm.warp(clock);
        try pm.finalize(mid) {} catch {}
    }

    function claim(uint256 s, uint256 mid) external {
        vm.prank(_actor(s));
        try pm.claim(mid % MARKETS) {} catch {}
    }

    // ---- views the invariants use ----
    function lockedInBook(uint256 mid) public view returns (uint256 sum) {
        (, , , uint256 unit, , , , , ) = pm.info(mid);
        (, , , uint8[] memory sides, uint8[] memory prices, uint64[] memory qtys) = pm.book(mid);
        for (uint256 i = 0; i < sides.length; i++) if (sides[i] == 0) sum += uint256(prices[i]) * qtys[i] * (unit / 100);
    }
    function totalFree() public view returns (uint256 sum) {
        for (uint256 i = 0; i < actors.length; i++) sum += pm.free(actors[i]);
    }
    function sharesHeld(uint256 mid) public view returns (uint256 yes, uint256 no) {
        for (uint256 i = 0; i < actors.length; i++) { yes += pm.yesOf(mid, actors[i]); no += pm.noOf(mid, actors[i]); }
        (, address[] memory owners, uint8[] memory outcomes, uint8[] memory sides, , uint64[] memory qtys) = pm.book(mid);
        for (uint256 i = 0; i < owners.length; i++) if (sides[i] == 1) { if (outcomes[i] == 0) yes += qtys[i]; else no += qtys[i]; }
    }
}

contract InvariantTest is StdInvariant, Test {
    MockUSDT usdt;
    PredictionMarket pm;
    Handler h;

    function setUp() public {
        usdt = new MockUSDT();
        pm = new PredictionMarket(address(usdt));
        h = new Handler(pm, usdt);
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](6);
        sel[0] = Handler.deposit.selector;
        sel[1] = Handler.withdraw.selector;
        sel[2] = Handler.place.selector;
        sel[3] = Handler.cancel.selector;
        sel[4] = Handler.settle.selector;
        sel[5] = Handler.claim.selector;
        targetSelector(FuzzSelector({ addr: address(h), selectors: sel }));
    }

    /// Every coin the contract holds is accounted for: free balances, coins locked behind waiting buy orders, and the
    /// pool that backs the shares. Equal, not just "at least": nothing is created and nothing is lost.
    function invariant_everyCoinIsAccountedFor() public view {
        uint256 owed = h.totalFree();
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , , , , uint256 pool, , ) = pm.info(m);
            owed += pool + h.lockedInBook(m);
        }
        assertEq(usdt.balanceOf(address(pm)), owed);
        assertEq(usdt.balanceOf(address(pm)), h.deposited() - h.withdrawn());
    }

    /// While a market is open the pool is exactly what pays one coin-unit for every pair of shares.
    function invariant_openPoolBacksEveryPair() public view {
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , uint256 unit, PredictionMarket.State st, uint64 supply, uint256 pool, , ) = pm.info(m);
            if (st == PredictionMarket.State.Open) assertEq(pool, uint256(supply) * unit);
            else assertLe(pool, uint256(supply) * unit);
        }
    }

    /// Yes and No shares always exist in equal numbers while the market is open (held or locked in a waiting sell).
    function invariant_yesAndNoSharesStayPaired() public view {
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , , PredictionMarket.State st, uint64 supply, , , ) = pm.info(m);
            (uint256 y, uint256 n) = h.sharesHeld(m);
            if (st == PredictionMarket.State.Open) {
                assertEq(y, supply);
                assertEq(n, supply);
            } else {
                assertLe(y, supply);
                assertLe(n, supply);
            }
        }
    }

    /// Solvency of the settlement itself: whatever a decided market still owes to the shares that are left can be paid
    /// from what is left in its pool.
    function invariant_decidedMarketCanPayEveryone() public view {
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , uint256 unit, PredictionMarket.State st, , uint256 pool, , ) = pm.info(m);
            if (st == PredictionMarket.State.Open) continue;
            (uint256 y, uint256 n) = h.sharesHeld(m);
            uint256 owes = st == PredictionMarket.State.Yes ? y * unit : st == PredictionMarket.State.No ? n * unit : (y + n) * (unit / 2);
            assertEq(pool, owes, "the pool is exactly what the remaining shares are owed");
        }
    }
}
