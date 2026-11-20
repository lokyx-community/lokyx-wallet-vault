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
    uint256 public constant MARKETS = 3;
    uint256 public steps; // settling waits until the market has seen real trading
    uint256 public constant WARMUP = 40;
    uint256 public evictions;
    uint256 public shareTransfers;
    uint256 public deposited;
    uint256 public withdrawn;
    // coverage counters: printed after each run so a green result can be checked to have reached the hard cases
    uint256 public trades;
    uint256 public fullBookPlaces;
    uint256 public proposals;
    uint256 public disputes;
    uint256 public finalized;
    uint256 public panelDecided;
    uint256 public expiredNoAnswer;
    uint256 public expiredStuckDispute;
    uint256 public cancels;
    uint256 public claims;

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
        steps++;
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
        steps++;
        address a = _actor(s);
        uint256 f = pm.free(a);
        if (f == 0) return;
        amt = bound(amt, 1, f);
        vm.prank(a);
        pm.withdraw(amt);
        withdrawn += amt;
    }

    function place(uint256 s, uint256 mid, uint8 outcome, uint8 side, uint8 price, uint64 qty) external {
        steps++;
        address a = _actor(s);
        mid = mid % MARKETS;
        outcome = outcome % 2;
        side = side % 2;
        price = uint8(bound(price, 1, 99));
        qty = uint64(bound(qty, 1, 40));
        vm.prank(a);
        uint256 len = _len(mid);
        try pm.place(mid, outcome, side, price, qty) { trades++; if (len >= pm.MAX_ORDERS()) fullBookPlaces++; } catch {}
    }

    function cancel(uint256 s, uint256 mid) external {
        steps++;
        mid = mid % MARKETS;
        (uint64[] memory ids, address[] memory owners, , , , ) = pm.book(mid);
        if (ids.length == 0) return;
        uint256 i = s % ids.length;
        vm.prank(owners[i]);
        pm.cancel(mid, ids[i]);
        cancels++;
    }

    function _len(uint256 mid) internal view returns (uint256) {
        (uint64[] memory ids, , , , , ) = pm.book(mid);
        return ids.length;
    }

    function _fund(address a, uint256 amt) internal {
        uint256 have = pm.free(a);
        if (have >= amt) return;
        uint256 need = amt - have;
        usdt.mint(a, need);
        vm.startPrank(a);
        usdt.approve(address(pm), type(uint256).max);
        pm.deposit(need);
        vm.stopPrank();
        deposited += need;
    }

    /// Fills a book with waiting bids at the lowest price so the next better order has to push one out.
    function flood(uint256 s, uint256 mid) external {
        steps++;
        address a = _actor(s);
        mid = mid % MARKETS;
        _fund(a, 100e18);
        for (uint256 i = _len(mid); i < pm.MAX_ORDERS(); i++) {
            vm.prank(a);
            try pm.place(mid, 0, 0, 1, 1) { trades++; } catch { break; }
        }
    }

    /// Shares are ERC-1155 tokens, so they can be sent between people at any time, in any state of the market.
    function shareTransfer(uint256 s, uint256 to, uint256 mid, uint8 outcome, uint256 amt) external {
        steps++;
        mid = mid % MARKETS;
        address from;
        uint256 tid;
        uint256 have;
        for (uint256 i = 0; i < actors.length * 2 && have == 0; i++) {
            from = actors[(s % actors.length + i) % actors.length];
            tid = mid * 2 + ((outcome + i / actors.length) % 2);
            have = pm.balanceOf(from, tid);
        }
        if (have == 0) return;
        address dest = _actor(to);
        amt = bound(amt, 1, have);
        vm.prank(from);
        try pm.safeTransferFrom(from, dest, tid, amt, "") { shareTransfers++; } catch {}
    }

    /// Floods a book, then places a better-priced bid: the full book must make room by pushing the worst bid out.
    function evict(uint256 s, uint256 mid) external {
        steps++;
        mid = mid % MARKETS;
        (, , , , PredictionMarket.State st, , , , ) = pm.info(mid);
        if (st != PredictionMarket.State.Open || clock >= closeAt) return;
        address a = _actor(s);
        _fund(a, 200e18);
        for (uint256 i = _len(mid); i < pm.MAX_ORDERS(); i++) {
            vm.prank(a);
            try pm.place(mid, 0, 0, 1, 1) {} catch { break; }
        }
        if (_len(mid) < pm.MAX_ORDERS()) return;
        address b = actors[(s % actors.length + 1) % actors.length];
        _fund(b, 10e18);
        vm.prank(b);
        try pm.place(mid, 0, 0, 2, 1) {
            evictions++;
            assertEq(_len(mid), pm.MAX_ORDERS(), "a full book stays at its cap after an eviction");
        } catch {}
    }

    /// The market closes and is settled by one of four routes: nobody answers (expiry), an answer nobody disputes,
    /// a dispute the panel decides (with votes that change on the way), or a dispute the panel never decides.
    function settleNoAnswer(uint256 mid) external { _settle(mid, 0, 0); }
    function settleQuiet(uint256 mid, uint8 v) external { _settle(mid, v, 1); }
    function settlePanel(uint256 mid, uint8 v) external { _settle(mid, v, 2); }
    function settleStuck(uint256 mid, uint8 v) external { _settle(mid, v, 3); }

    function _settle(uint256 mid, uint8 v, uint8 route) internal {
        if (steps < WARMUP) return;
        mid = mid % MARKETS;
        (, , , uint256 unit, PredictionMarket.State st, , , , ) = pm.info(mid);
        if (st != PredictionMarket.State.Open) return;
        if (clock < closeAt) { clock = closeAt; vm.warp(clock); }
        if (route == 0) {
            clock += 30 days; vm.warp(clock);
            try pm.expire(mid) { expiredNoAnswer++; } catch {}
            return;
        }
        address prop = actors[uint256(v) % actors.length];
        address disp = actors[(uint256(v) + 1) % actors.length];
        uint256 bond = unit * pm.BOND_SHARES();
        _fund(prop, bond);
        vm.prank(prop);
        try pm.propose(mid, (v / 3) % 3) { proposals++; } catch { return; }
        if (route == 1) {
            clock += 1 days; vm.warp(clock);
            try pm.finalize(mid) { finalized++; } catch {}
            return;
        }
        _fund(disp, bond);
        vm.prank(disp);
        try pm.dispute(mid) { disputes++; } catch { return; }
        if (route == 3) {
            clock += 30 days; vm.warp(clock);
            try pm.expire(mid) { expiredStuckDispute++; } catch {}
            return;
        }
        // three different answers (no majority), then the others settle it
        for (uint256 i = 0; i < 3; i++) { vm.prank(panel[i]); try pm.vote(mid, uint8((uint256(v) + i) % 3)) {} catch {} }
        for (uint256 i = 3; i < 5; i++) { vm.prank(panel[i]); try pm.vote(mid, v % 3) {} catch {} }
        (, , , , PredictionMarket.State after_, , , , ) = pm.info(mid);
        if (after_ != PredictionMarket.State.Open) panelDecided++;
    }

    function claim(uint256 s, uint256 mid) external {
        steps++;
        vm.prank(_actor(s));
        try pm.claim(mid % MARKETS) { claims++; } catch {}
    }

    // ---- views the invariants use ----
    function lockedInBook(uint256 mid) public view returns (uint256 sum) {
        (, , , uint256 unit, , , , , ) = pm.info(mid);
        (, , , uint8[] memory sides, uint8[] memory prices, uint64[] memory qtys) = pm.book(mid);
        for (uint256 i = 0; i < sides.length; i++) if (sides[i] == 0) sum += uint256(prices[i]) * qtys[i] * (unit / 100);
    }
    function escrowed(uint256 mid, uint8 outcome) public view returns (uint256 sum) {
        (, , uint8[] memory outcomes, uint8[] memory sides, , uint64[] memory qtys) = pm.book(mid);
        for (uint256 i = 0; i < sides.length; i++) if (sides[i] == 1 && outcomes[i] == outcome) sum += qtys[i];
    }
    function bondsOf(uint256 mid) public view returns (uint256 x) {
        (, , , , , , x) = pm.resolution(mid);
    }
    function totalFree() public view returns (uint256 sum) {
        for (uint256 i = 0; i < actors.length; i++) sum += pm.free(actors[i]);
        sum += pm.free(pm.feeCollector()); // fees collected stay inside the contract until withdrawn
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

    /// The plain run has no fee; InvariantFeeTest below repeats every invariant with the real 1% fee switched on.
    function _fee() internal view virtual returns (uint256) { return 0; }

    function setUp() public {
        usdt = new MockUSDT();
        pm = new PredictionMarket(address(usdt), address(0xFEE), _fee());
        h = new Handler(pm, usdt);
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](25);
        sel[0] = Handler.deposit.selector;
        sel[1] = Handler.deposit.selector;
        sel[2] = Handler.withdraw.selector;
        sel[3] = Handler.place.selector;
        sel[4] = Handler.place.selector;
        sel[5] = Handler.place.selector;
        sel[6] = Handler.place.selector;
        sel[7] = Handler.place.selector;
        sel[8] = Handler.place.selector;
        sel[9] = Handler.cancel.selector;
        sel[10] = Handler.claim.selector;
        sel[11] = Handler.flood.selector;
        sel[12] = Handler.evict.selector;
        sel[13] = Handler.evict.selector;
        sel[14] = Handler.settleNoAnswer.selector;
        sel[15] = Handler.settleQuiet.selector;
        sel[16] = Handler.settleQuiet.selector;
        sel[17] = Handler.settlePanel.selector;
        sel[18] = Handler.settlePanel.selector;
        sel[19] = Handler.settleStuck.selector;
        sel[20] = Handler.claim.selector;
        sel[21] = Handler.cancel.selector;
        sel[22] = Handler.shareTransfer.selector;
        sel[23] = Handler.shareTransfer.selector;
        sel[24] = Handler.shareTransfer.selector;
        targetSelector(FuzzSelector({ addr: address(h), selectors: sel }));
    }

    /// Every coin the contract holds is accounted for: free balances, coins locked behind waiting buy orders, and the
    /// pool that backs the shares. Equal, not just "at least": nothing is created and nothing is lost.
    function invariant_everyCoinIsAccountedFor() public view {
        uint256 owed = h.totalFree();
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , , , , uint256 pool, , ) = pm.info(m);
            owed += pool + h.lockedInBook(m) + h.bondsOf(m) + pm.answerFees(m);
        }
        assertEq(usdt.balanceOf(address(pm)), owed);
        assertEq(usdt.balanceOf(address(pm)), h.deposited() - h.withdrawn());
    }

    /// Shares waiting in sell orders are held by the market itself, as tokens, and nowhere else.
    function invariant_escrowedSharesAreTheMarketsOwnBalance() public view {
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            assertEq(pm.balanceOf(address(pm), m * 2), h.escrowed(m, 0));
            assertEq(pm.balanceOf(address(pm), m * 2 + 1), h.escrowed(m, 1));
        }
    }

    /// Bonds are held only while an answer is pending: none before an answer, one after a proposal, two after a dispute,
    /// and none at all once the market is decided (the winner or both parties have been paid back).
    function invariant_bondsAreHeldOnlyWhileTheAnswerIsPending() public view {
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , uint256 unit, PredictionMarket.State st, , , , ) = pm.info(m);
            (uint8 proposed, , , address disputer, , uint256 bond, uint256 held) = pm.resolution(m);
            assertEq(bond, unit * pm.BOND_SHARES());
            if (st != PredictionMarket.State.Open || proposed == 255) assertEq(held, 0);
            else if (disputer == address(0)) assertEq(held, bond);
            else assertEq(held, 2 * bond);
        }
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

    /// Once a market is decided its held answer share has been paid out: none of it is left behind.
    function invariant_decidedMarketsHoldNoAnswerFees() public view {
        for (uint256 m = 0; m < h.MARKETS(); m++) {
            (, , , , PredictionMarket.State st, , , , ) = pm.info(m);
            if (st != PredictionMarket.State.Open) assertEq(pm.answerFees(m), 0);
        }
    }

    /// One line per run is appended to a file, so the totals over all runs can be added up afterwards.
    function afterInvariant() public {
        string memory line = string.concat(
            vm.toString(h.trades()), ",", vm.toString(h.fullBookPlaces()), ",", vm.toString(h.evictions()), ",",
            vm.toString(h.cancels()), ",", vm.toString(h.proposals()), ",", vm.toString(h.disputes()), ",",
            vm.toString(h.finalized()), ",", vm.toString(h.panelDecided()), ",", vm.toString(h.expiredNoAnswer()), ",",
            vm.toString(h.expiredStuckDispute()), ",", vm.toString(h.claims()), ",", vm.toString(h.shareTransfers())
        );
        vm.writeLine("coverage-out/counters.csv", line);
    }
}

/// Everything above, again, with the 1% taker fee on: coins must still add up exactly, to the last unit.
contract InvariantFeeTest is InvariantTest {
    function _fee() internal pure override returns (uint256) { return 100; }
}
