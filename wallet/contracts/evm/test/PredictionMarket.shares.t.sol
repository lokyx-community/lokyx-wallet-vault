// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PredictionMarket.sol";
import "./Mocks.sol";

/// The shares are ERC-1155 tokens: Yes of market n is token 2n, No is token 2n+1.
contract SharesTest is Test {
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    MockUSDT usdt;
    PredictionMarket pm;
    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address d = address(0xD4);
    address[] panel;
    uint256 constant UNIT = 1e18;
    uint256 constant FUND = 100_000e18;
    uint256 clock = 1_000_000;
    function _adv(uint256 s) internal { clock += s; vm.warp(clock); }

    function setUp() public {
        usdt = new MockUSDT();
        pm = new PredictionMarket(address(usdt));
        address[4] memory who = [a, b, c, d];
        for (uint256 i = 0; i < 4; i++) {
            usdt.mint(who[i], FUND);
            vm.prank(who[i]); usdt.approve(address(pm), type(uint256).max);
            vm.prank(who[i]); pm.deposit(FUND);
        }
        for (uint256 i = 0; i < 5; i++) panel.push(address(uint160(0x100 + i)));
        vm.warp(clock);
        pm.create("Q?", uint64(clock + 1 days), UNIT, panel);
        // a holds 10 Yes, b holds 10 No
        vm.prank(a); pm.place(0, 0, 0, 60, 10);
        vm.prank(b); pm.place(0, 1, 0, 40, 10);
    }

    function test_mintingEmitsAndBalancesMatch() public {
        assertEq(pm.balanceOf(a, 0), 10);
        assertEq(pm.balanceOf(b, 1), 10);
        assertEq(pm.balanceOf(a, 1), 0);
        assertEq(pm.yesOf(0, a), 10);
        assertEq(pm.noOf(0, b), 10);
        vm.prank(c); pm.place(0, 0, 0, 90, 3);          // rests; nothing trades
        vm.expectEmit(true, true, true, true);
        emit TransferSingle(d, address(0), c, 0, 3);      // the Yes half of the new pair goes to c
        vm.prank(d); pm.place(0, 1, 0, 10, 3);           // buys No at 10 = Yes ask at 90: mints a pair with c's bid
        assertEq(pm.balanceOf(c, 0), 3);
        assertEq(pm.balanceOf(d, 1), 3);
    }

    function test_balanceOfBatchAndZeroAddress() public {
        address[] memory w = new address[](2); uint256[] memory ids = new uint256[](2);
        w[0] = a; ids[0] = 0; w[1] = b; ids[1] = 1;
        uint256[] memory r = pm.balanceOfBatch(w, ids);
        assertEq(r[0], 10); assertEq(r[1], 10);
        vm.expectRevert("the zero address holds nothing"); pm.balanceOf(address(0), 0);
        uint256[] memory one = new uint256[](1);
        vm.expectRevert("lists differ in length"); pm.balanceOfBatch(w, one);
    }

    function test_ownerCanTransfer() public {
        vm.expectEmit(true, true, true, true);
        emit TransferSingle(a, a, d, 0, 4);
        vm.prank(a); pm.safeTransferFrom(a, d, 0, 4, "");
        assertEq(pm.balanceOf(a, 0), 6);
        assertEq(pm.balanceOf(d, 0), 4);
    }

    function test_unapprovedOperatorCannotMoveShares() public {
        vm.prank(c); vm.expectRevert("you are not allowed to move these shares"); pm.safeTransferFrom(a, c, 0, 1, "");
    }

    function test_approvedOperatorCanAndRevokingStopsIt() public {
        vm.prank(a); pm.setApprovalForAll(c, true);
        assertTrue(pm.isApprovedForAll(a, c));
        vm.prank(c); pm.safeTransferFrom(a, d, 0, 2, "");
        assertEq(pm.balanceOf(d, 0), 2);
        vm.prank(a); pm.setApprovalForAll(c, false);
        vm.prank(c); vm.expectRevert("you are not allowed to move these shares"); pm.safeTransferFrom(a, d, 0, 1, "");
        vm.prank(a); vm.expectRevert("you can't approve yourself"); pm.setApprovalForAll(a, true);
    }

    function test_cannotMoveMoreThanYouHaveOrToBadRecipients() public {
        vm.prank(a); vm.expectRevert(); pm.safeTransferFrom(a, d, 0, 11, "");
        vm.prank(a); vm.expectRevert("bad recipient"); pm.safeTransferFrom(a, address(0), 0, 1, "");
        vm.prank(a); vm.expectRevert("bad recipient"); pm.safeTransferFrom(a, address(pm), 0, 1, "");
        vm.prank(a); vm.expectRevert("no such market"); pm.safeTransferFrom(a, d, 2, 0, "");
    }

    function test_sharesInAWaitingSaleAreHeldByTheMarketAndCannotBeMoved() public {
        vm.prank(a); uint64 oid = pm.place(0, 0, 1, 70, 6); // a sells 6 Yes
        assertEq(pm.balanceOf(a, 0), 4);
        assertEq(pm.balanceOf(address(pm), 0), 6, "escrow is visible as the market's own balance");
        vm.prank(a); vm.expectRevert(); pm.safeTransferFrom(a, d, 0, 5, ""); // only 4 are free to move
        vm.prank(a); pm.cancel(0, oid);
        assertEq(pm.balanceOf(a, 0), 10);
        assertEq(pm.balanceOf(address(pm), 0), 0);
    }

    function test_transferredSharesCanBeSoldAndClaimed() public {
        vm.prank(a); pm.safeTransferFrom(a, d, 0, 10, "");
        vm.prank(d); pm.place(0, 0, 1, 50, 10);             // d sells what it was sent
        vm.prank(c); pm.place(0, 0, 0, 50, 10);              // c buys them
        assertEq(pm.balanceOf(c, 0), 10);
        _adv(1 days);
        vm.prank(c); pm.propose(0, 0);
        _adv(1 days);
        pm.finalize(0);
        vm.prank(c); assertEq(pm.claim(0), 10 * UNIT);       // the buyer of transferred shares is paid
        assertEq(pm.balanceOf(c, 0), 0, "claimed shares are burned");
        vm.prank(a); assertEq(pm.claim(0), 0);
    }

    function test_theRecipientOfASharesTransferGetsPaid() public {
        vm.prank(a); pm.safeTransferFrom(a, d, 0, 10, "");
        _adv(1 days);
        vm.prank(c); pm.propose(0, 0);
        _adv(1 days);
        pm.finalize(0);
        vm.prank(d); assertEq(pm.claim(0), 10 * UNIT);
        vm.prank(a); assertEq(pm.claim(0), 0);
    }

    function test_batchTransfer() public {
        vm.prank(a); pm.safeTransferFrom(a, b, 0, 5, "");
        uint256[] memory ids = new uint256[](2); uint256[] memory vals = new uint256[](2);
        ids[0] = 0; vals[0] = 3; ids[1] = 1; vals[1] = 4;
        vm.prank(b); pm.safeBatchTransferFrom(b, d, ids, vals, "");
        assertEq(pm.balanceOf(d, 0), 3);
        assertEq(pm.balanceOf(d, 1), 4);
        vm.prank(c); vm.expectRevert("you are not allowed to move these shares"); pm.safeBatchTransferFrom(b, d, ids, vals, "");
        uint256[] memory one = new uint256[](1);
        vm.prank(b); vm.expectRevert("lists differ in length"); pm.safeBatchTransferFrom(b, d, ids, one, "");
    }

    function test_contractRecipients() public {
        GoodReceiver good = new GoodReceiver();
        vm.prank(a); pm.safeTransferFrom(a, address(good), 0, 3, "");
        assertEq(good.received(), 3);
        assertEq(pm.balanceOf(address(good), 0), 3);

        WrongAnswerReceiver wrong = new WrongAnswerReceiver();
        vm.prank(a); vm.expectRevert("the receiver refused the shares"); pm.safeTransferFrom(a, address(wrong), 0, 1, "");
        RevertingReceiver rev = new RevertingReceiver();
        vm.prank(a); vm.expectRevert("the receiver refused the shares"); pm.safeTransferFrom(a, address(rev), 0, 1, "");
        vm.prank(a); vm.expectRevert("the receiver refused the shares"); pm.safeTransferFrom(a, address(usdt), 0, 1, ""); // a contract that isn't a receiver

        uint256[] memory ids = new uint256[](1); uint256[] memory vals = new uint256[](1);
        ids[0] = 0; vals[0] = 2;
        vm.prank(a); pm.safeBatchTransferFrom(a, address(good), ids, vals, "");
        assertEq(good.received(), 5);
        vm.prank(a); vm.expectRevert("the receiver refused the shares"); pm.safeBatchTransferFrom(a, address(wrong), ids, vals, "");
    }

    function test_aReceiverCannotReenterTheTransfer() public {
        ReentrantReceiver r = new ReentrantReceiver(address(pm));
        vm.prank(a); pm.safeTransferFrom(a, address(r), 0, 3, "");
        assertTrue(r.triedAndFailed(), "the nested transfer was refused");
        assertEq(pm.balanceOf(address(r), 0), 3, "and the outer transfer still completed once");
        assertEq(pm.balanceOf(address(0xBEEF), 0), 0, "nothing moved in the nested call");
    }

    function test_interfaceIds() public view {
        assertTrue(pm.supportsInterface(0x01ffc9a7));
        assertTrue(pm.supportsInterface(0xd9b67a26));
        assertFalse(pm.supportsInterface(0xffffffff));
    }

    function test_burnOnClaimKeepsTheSupplyOfTokensHonest() public {
        _adv(1 days);
        vm.prank(c); pm.propose(0, 1);
        _adv(1 days);
        pm.finalize(0);
        vm.prank(a); pm.claim(0);
        vm.prank(b); pm.claim(0);
        assertEq(pm.balanceOf(a, 0), 0);
        assertEq(pm.balanceOf(b, 1), 0);
    }
}
