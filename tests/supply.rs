//! The supply invariant: nothing is ever created except by a block reward, and everything held
//! adds up to everything issued.
//!
//! This is a check on our own code, not on the block. So when it fails the node stops rather
//! than carrying on, the peer that happened to send the block isn't punished, and the block
//! isn't remembered as invalid, so a fixed release can look at it again. These tests use the
//! cheap test proof of work (see tests/sync.rs).

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{BlockError, Chain, Outcome, now};
use lokyx::contract::{BLOCK_GAS_LIMIT, build_call};
use lokyx::emission::issued_through;
use lokyx::keys::address_of;
use lokyx::node::{Node, block_penalty};
use lokyx::params::{BLOCK_VERSION, COIN, ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::state::State;
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::Rng;
use rand::rngs::OsRng;

fn params_with(f: impl FnOnce(&mut ChainParams)) -> &'static ChainParams {
    lokyx::pow::test_pow::enable();
    // So `cargo test -- --nocapture` shows the message an operator would see in the node's log.
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();
    let mut p = ChainParams {
        initial_difficulty: 2,
        min_difficulty: 2,
        target_block_time: 10,
        min_block_spacing: 0,
        coinbase_maturity: 0,
        genesis_timestamp: now() - 1_000_000,
        ..DEVNET.clone()
    };
    f(&mut p);
    Box::leak(Box::new(p))
}

fn params() -> &'static ChainParams {
    params_with(|_| {})
}

fn solve(seed: &[u8; 32], h: &mut BlockHeader) {
    while !meets_difficulty(&PowEngine::global().hash(seed, &h.pow_input()).unwrap(), h.difficulty) {
        h.bump_nonce();
    }
}

fn mine(c: &Chain, coinbase: Address, txs: Vec<SignedTransaction>) -> Block {
    let (mut b, seed) = c.block_template(coinbase, txs).unwrap();
    b.header.timestamp = c.tip().header.timestamp.max(c.params.genesis_timestamp) + c.params.target_block_time;
    solve(&seed, &mut b.header);
    b
}

fn extend(c: &mut Chain, n: usize, coinbase: Address) {
    for _ in 0..n {
        let b = mine(c, coinbase, vec![]);
        assert!(matches!(c.process_block(b, false).unwrap(), Outcome::NewTip { .. }));
    }
}

/// An empty block on top of `c`'s tip, built from whatever `c`'s state happens to be (so its
/// state root matches even if that state has been tampered with) and solved.
fn next_block_over(c: &Chain, coinbase: Address) -> Block {
    let parent = c.tip().clone();
    let height = parent.header.height + 1;
    let mut s = c.state.clone();
    s.apply_body(height, coinbase, &[], c.params).unwrap();
    let mut header = BlockHeader {
        version: BLOCK_VERSION,
        height,
        prev_hash: parent.hash,
        timestamp: parent.header.timestamp + c.params.target_block_time,
        difficulty: c.next_difficulty_for(&parent.hash),
        tx_root: Block::compute_tx_root(&[]),
        state_root: s.root(),
        coinbase,
        receipts_root: lokyx::crypto::ZERO_HASH,
        pow: lokyx::block::Pow::Native { nonce: 0 },
    };
    let b = Block { header: header.clone(), txs: vec![] };
    let seed = c.pow_seed(&b).unwrap();
    solve(&seed, &mut header);
    Block { header, txs: vec![] }
}

// ---------- the invariant itself ----------

#[test]
fn a_correct_chain_always_balances() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 3, alice);
    c.state.check_supply(c.height(), p).unwrap();

    // Transfers, a swap lock and a vault withdrawal all move coins between the four places the
    // invariant adds up; none of them changes the total.
    for i in 0..3u64 {
        let tx = build_transfer(&sk, p, i, Address([(i + 2) as u8; 20]), COIN, None).unwrap();
        let b = mine(&c, alice, vec![tx]);
        c.process_block(b, false).unwrap();
        c.state.check_supply(c.height(), p).unwrap();
    }
    assert_eq!(c.state.circulating(), c.state.issued);
    assert_eq!(c.state.issued, issued_through(c.height(), p));
}

#[test]
fn planted_or_missing_coins_are_caught() {
    let p = params();
    let mut s = State::default();
    s.apply_body(1, Address([1; 20]), &[], p).unwrap();
    s.check_supply(1, p).unwrap();

    // Coins out of nowhere.
    let mut planted = s.clone();
    planted.accounts.entry(Address([9; 20])).or_default().balance += 1;
    let e = planted.check_supply(1, p).unwrap_err();
    assert!(e.contains("is held or burned but") && e.contains("difference 1"), "{e}");

    // Coins quietly destroyed.
    let mut burned = s.clone();
    burned.accounts.get_mut(&Address([1; 20])).unwrap().balance -= 1;
    assert!(burned.check_supply(1, p).unwrap_err().contains("is held or burned but"));

    // Issuance that doesn't match the schedule, even when the books balance.
    let mut extra = s.clone();
    extra.issued += 5;
    extra.accounts.entry(Address([9; 20])).or_default().balance += 5;
    let e = extra.check_supply(1, p).unwrap_err();
    assert!(e.contains("the schedule says"), "{e}");

    // The right height matters: the same state checked against the wrong one fails.
    assert!(s.check_supply(2, p).is_err());
}

/// Rewards held back by maturity, a contract holding LYX, an open swap and a pending vault
/// withdrawal are all counted, and random sequences of them keep the books balanced.
#[test]
fn every_place_coins_can_sit_is_counted() {
    let p = params_with(|p| p.coinbase_maturity = 3);
    let mut rng = rand::thread_rng();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 6, alice);
    assert!(c.state.immature_total() > 0, "some rewards should still be locked");
    c.state.check_supply(c.height(), p).unwrap();

    let mut nonce = 0u64;
    for _ in 0..25 {
        let txs: Vec<SignedTransaction> = (0..rng.gen_range(0..3))
            .filter_map(|_| {
                let to = Address([rng.r#gen::<u8>(); 20]);
                let amount = rng.gen_range(1..COIN / 100);
                let tx = build_transfer(&sk, p, nonce, to, amount, None).ok()?;
                nonce += 1;
                Some(tx)
            })
            .collect();
        let b = mine(&c, alice, txs);
        c.process_block(b, false).unwrap();
        c.state.check_supply(c.height(), p).unwrap();
    }
    assert!(c.halted().is_none());
}

// ---------- what happens when it breaks ----------

/// A block that applies cleanly but leaves the books wrong stops the node. The block isn't
/// written off as invalid, nothing is applied, and mining stops with the reason.
#[test]
fn a_supply_failure_halts_the_node_without_blaming_the_block() {
    let p = params();
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 3, Address([1; 20]));
    let tip = c.tip().hash;

    // Stand in for a bug of ours: coins appear in the state we're building on. The block built
    // over it is perfectly formed, and its state root matches, so only the supply check can
    // notice.
    c.state.accounts.entry(Address([7; 20])).or_default().balance += 42;
    let b = next_block_over(&c, Address([1; 20]));
    let before = c.state.clone();

    let e = c.process_block(b.clone(), false).unwrap_err();
    assert!(matches!(e, BlockError::Halted(_)), "{e:?}");
    assert!(e.to_string().contains("is held or burned but"), "{e}");
    assert_eq!(c.tip().hash, tip, "the block must not have been applied");
    assert_eq!(c.state, before, "and none of what it did to the state may be left behind");
    assert_eq!(c.halted(), Some(e.to_string().trim_start_matches("halted: ")));

    // Not remembered as invalid: the same block, and the chain it's on, can be looked at again
    // by a fixed release. (A block written off as invalid answers "invalid block", and so does
    // anything built on it.)
    let again = c.process_block(b.clone(), false).unwrap_err();
    assert!(matches!(again, BlockError::Halted(_)), "{again:?}");
    assert!(!again.to_string().contains("descends from an invalid block"));

    // And nothing else gets applied either, whatever it is.
    let other = c.process_block(next_block_over(&c, Address([2; 20])), false).unwrap_err();
    assert!(matches!(other, BlockError::Halted(_)), "{other:?}");

    // Mining stops, with the reason.
    let e = c.block_template(Address([1; 20]), vec![]).unwrap_err();
    assert!(e.starts_with("not mining:") && e.contains("is held or burned but"), "{e}");
}

/// A miner is stopped before it can hand anyone a block built on books that don't balance,
/// even if nothing has halted yet.
#[test]
fn a_miner_wont_build_on_a_state_that_doesnt_balance() {
    let p = params();
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 2, Address([1; 20]));
    c.block_template(Address([1; 20]), vec![]).unwrap();

    c.state.accounts.entry(Address([7; 20])).or_default().balance += 1;
    assert!(c.halted().is_none(), "nothing has been applied, so nothing has halted");
    let e = c.block_template(Address([1; 20]), vec![]).unwrap_err();
    assert!(e.contains("is held or burned but"), "{e}");
}

/// The peer that happened to send it is in the clear: a halt costs it nothing, where an invalid
/// block would have disconnected it.
#[test]
fn a_halt_does_not_punish_the_peer_that_sent_the_block() {
    assert_eq!(block_penalty(&BlockError::Halted("books don't balance".into())), None);
    assert_eq!(block_penalty(&BlockError::TooEarly("fast clock".into())), None);
    assert_eq!(block_penalty(&BlockError::Internal("disk".into())), None);
    assert_eq!(block_penalty(&BlockError::Invalid("bad signature".into())).map(|(n, _)| n), Some(100));
    assert_eq!(block_penalty(&BlockError::Mismatch("wrong body".into())).map(|(n, _)| n), Some(50));

    // The same thing through a real node: the block comes back as a halt, which carries no
    // points, so nothing about the sender changes.
    let p = params();
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 3, Address([1; 20]));
    c.state.accounts.entry(Address([7; 20])).or_default().balance += 1;
    let b = next_block_over(&c, Address([1; 20]));
    let n = Node::new(p, c, 0, vec![]);
    n.add_sync_peer(5, 0);

    let e = n.submit_block_blocking(b).unwrap_err();
    assert!(matches!(e, BlockError::Halted(_)), "{e:?}");
    assert_eq!(block_penalty(&e), None, "the sender would have been penalised");
    assert!(n.sync.lock().contains_key(&5), "the peer is still there");
    assert!(n.chain.lock().halted().is_some());
}

/// Once halted, nothing gets it going again in this process: not another block, not a heavier
/// branch that would have reorganised the chain. Only a new release.
///
/// (A reorg rebuilds state from a snapshot rather than from the live one, so it would otherwise
/// quietly repair a corrupted state and hide the bug.)
#[test]
fn a_halt_sticks_even_when_a_heavier_branch_turns_up() {
    let p = params();
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 4, Address([1; 20]));

    // A heavier branch, built before anything goes wrong.
    let shared: Vec<Block> = (1..=2).map(|h| c.block(&c.hash_at(h).unwrap()).unwrap().as_ref().clone()).collect();
    let mut fork = Chain::new(p, None).unwrap();
    for b in &shared {
        fork.process_block(b.clone(), false).unwrap();
    }
    extend(&mut fork, 5, Address([2; 20]));
    assert!(fork.cum_work() > c.cum_work());
    let branch: Vec<Block> =
        (3..=fork.height()).map(|h| fork.block(&fork.hash_at(h).unwrap()).unwrap().as_ref().clone()).collect();

    c.state.accounts.entry(Address([7; 20])).or_default().balance += 1;
    assert!(matches!(c.process_block(next_block_over(&c, Address([1; 20])), false), Err(BlockError::Halted(_))));
    let tip = c.tip().hash;

    for b in branch {
        let e = c.process_block(b, false).unwrap_err();
        assert!(matches!(e, BlockError::Halted(_)), "{e:?}");
    }
    assert_eq!(c.tip().hash, tip, "nothing moved while halted");
    assert!(c.halted().is_some());
}

// ---------- item 1.4: checked arithmetic ----------

/// A block whose gas limits overflow a 64-bit total is refused, and refused the same way in a
/// debug build as in a release one. An unchecked sum would panic in one and wrap in the other,
/// and a wrapped total would slip under the block limit.
#[test]
fn a_block_whose_gas_overflows_is_refused_not_wrapped() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut c = Chain::new(p, None).unwrap();
    extend(&mut c, 2, alice);

    // Three calls whose limits add up to just over u64::MAX: wrapped, the total would be tiny
    // and pass the block limit.
    let gas = [u64::MAX / 2, u64::MAX / 2, 8];
    assert_eq!(gas.iter().fold(0u64, |a, g| a.wrapping_add(*g)), 6, "wrapped, this looks harmless");
    let txs: Vec<SignedTransaction> = gas
        .iter()
        .enumerate()
        .map(|(i, g)| build_call(&sk, p, i as u64, Address([3; 20]), vec![1], *g, 0).unwrap())
        .collect();

    let e = lokyx::state::check_block_gas(&txs).unwrap_err();
    assert!(e.contains("overflow"), "{e}");
    // Both ways in: the body check before anything is stored, and applying the block.
    let e = Chain::check_body(&Block { header: c.tip().header.clone(), txs: txs.clone() }, p).unwrap_err();
    assert!(e.contains("overflow"), "{e}");
    let e = c.state.clone().apply_body(c.height() + 1, alice, &txs, p).unwrap_err();
    assert!(e.contains("overflow"), "{e}");

    // And the ordinary over-the-limit case still reads the way it did.
    let txs: Vec<SignedTransaction> =
        (0..3).map(|i| build_call(&sk, p, i, Address([3; 20]), vec![1], BLOCK_GAS_LIMIT / 2, 0).unwrap()).collect();
    let e = lokyx::state::check_block_gas(&txs).unwrap_err();
    assert!(e.contains("over the block limit"), "{e}");
    assert_eq!(lokyx::state::check_block_gas(&[]).unwrap(), 0);
}

/// Balances can't wrap. Every spend is checked before the money moves, so these errors should be
/// unreachable, but if a check is ever wrong, the block is invalid rather than the account
/// ending up with an enormous balance. (`overflow-checks` is on in release builds too, so the
/// behaviour is the same in every build.)
#[test]
fn balances_cannot_wrap_round() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut s = State::default();
    s.apply_body(1, alice, &[], p).unwrap();
    let have = s.account(&alice).balance;

    // More than the account holds: refused, and the balance is untouched.
    let too_much = build_transfer(&sk, p, 0, Address([2; 20]), have + 1, None).unwrap();
    let e = s.clone().apply_body(2, Address([9; 20]), &[too_much], p).unwrap_err();
    assert!(e.contains("insufficient balance"), "{e}");

    // A value and fee that overflow when added: refused before anything moves.
    let mut huge = build_transfer(&sk, p, 0, Address([2; 20]), u128::MAX, None).unwrap();
    huge.tx.fee = u128::MAX;
    let huge = huge.tx.clone().sign(&sk).unwrap();
    let e = s.clone().apply_body(2, Address([9; 20]), &[huge], p).unwrap_err();
    assert!(e.contains("overflow") || e.contains("insufficient"), "{e}");

    // A credit that would take a balance past u128::MAX.
    let mut s2 = s.clone();
    s2.accounts.entry(Address([2; 20])).or_default().balance = u128::MAX;
    let tx = build_transfer(&sk, p, 0, Address([2; 20]), 1, None).unwrap();
    let e = s2.apply_body(2, Address([9; 20]), &[tx], p).unwrap_err();
    assert!(e.contains("balance overflow"), "{e}");
    assert_eq!(s.account(&alice).balance, have, "nothing moved");
}
