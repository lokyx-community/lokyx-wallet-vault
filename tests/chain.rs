//! Consensus tests. Blocks are really mined with RandomX, just at difficulty 2.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::block::Block;
use lokyx::chain::{BlockError, Chain, Judgement, Outcome, Staged, now};
use lokyx::keys::address_of;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::store::Store;
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::OsRng;

fn test_params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams {
        initial_difficulty: 2,
        min_difficulty: 2,
        target_block_time: 10,
        min_block_spacing: 0,
        coinbase_maturity: 0,
        genesis_timestamp: now() - 1_000_000,
        ..DEVNET.clone()
    }))
}

/// Build and genuinely mine a block on the chain's tip. Timestamps advance by exactly the target
/// so LWMA keeps difficulty stable.
fn mine(c: &Chain, coinbase: Address, txs: Vec<SignedTransaction>) -> Block {
    let (mut b, seed) = c.block_template(coinbase, txs).unwrap();
    b.header.timestamp = c.tip().header.timestamp.max(c.params.genesis_timestamp) + c.params.target_block_time;
    loop {
        let h = PowEngine::global().hash(&seed, &b.header.pow_input()).unwrap();
        if meets_difficulty(&h, b.header.difficulty) {
            return b;
        }
        b.header.bump_nonce();
    }
}

/// A nonce whose RandomX hash does NOT meet difficulty (to test PoW rejection).
fn unmine(c: &Chain, mut b: Block) -> Block {
    let seed = c.pow_seed(&b).unwrap();
    loop {
        b.header.bump_nonce();
        let h = PowEngine::global().hash(&seed, &b.header.pow_input()).unwrap();
        if !meets_difficulty(&h, b.header.difficulty) {
            return b;
        }
    }
}

fn add(c: &mut Chain, b: Block) -> Result<Outcome, BlockError> {
    c.process_block(b, false)
}

#[test]
fn mining_rewards_and_supply() {
    let p = test_params();
    let mut c = Chain::new(p, None).unwrap();
    let miner = Address([1; 20]);
    for _ in 0..5 {
        let b = mine(&c, miner, vec![]);
        assert!(matches!(add(&mut c, b).unwrap(), Outcome::NewTip { reorg_depth: 0, .. }));
    }
    assert_eq!(c.height(), 5);
    assert_eq!(c.state.account(&miner).balance, 50 * COIN);
    assert_eq!(c.state.issued, lokyx::emission::issued_through(5, p));
    assert_eq!(c.state.circulating(), c.state.issued);
}

#[test]
fn transfers_confirm_and_invalid_blocks_are_rejected() {
    let p = test_params();
    let mut c = Chain::new(p, None).unwrap();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let bob = Address([2; 20]);
    let b = mine(&c, alice, vec![]);
    add(&mut c, b).unwrap();

    let t = build_transfer(&sk, p, 0, bob, 3 * COIN, None).unwrap();
    let good = mine(&c, bob, vec![t.clone()]);

    // Bad PoW.
    let bad_pow = unmine(&c, good.clone());
    assert!(matches!(add(&mut c, bad_pow), Err(BlockError::Invalid(e)) if e.contains("proof of work")));
    // Wrong difficulty claim.
    let mut wrong_diff = good.clone();
    wrong_diff.header.difficulty = 1;
    assert!(matches!(add(&mut c, wrong_diff), Err(BlockError::Invalid(e)) if e.contains("difficulty")));
    // Future timestamp.
    let mut future = good.clone();
    future.header.timestamp = now() + 3600;
    // Not punished as invalid (could just be a fast clock), and not remembered as bad either.
    assert!(matches!(add(&mut c, future.clone()), Err(BlockError::TooEarly(_))));
    assert!(matches!(add(&mut c, future), Err(BlockError::TooEarly(_))));
    // Inflated reward via forged state root (mined with valid PoW so only the state check fails).
    let mut forged = c.block_template(bob, vec![t.clone()]).unwrap().0;
    forged.header.state_root = [7; 32];
    forged.header.timestamp = c.tip().header.timestamp + p.target_block_time;
    let forged = remine(&c, forged);
    assert!(matches!(add(&mut c, forged), Err(BlockError::Invalid(e)) if e.contains("state root")));
    // Double spend inside one block (both txs individually valid).
    let t2 = build_transfer(&sk, p, 1, bob, 8 * COIN, None).unwrap();
    let mut ds = c.block_template(bob, vec![t.clone()]).unwrap().0;
    ds.txs.push(t2);
    ds.header.tx_root = Block::compute_tx_root(&ds.txs);
    ds.header.timestamp = c.tip().header.timestamp + p.target_block_time;
    let ds = remine(&c, ds);
    assert!(matches!(add(&mut c, ds), Err(BlockError::Invalid(e)) if e.contains("insufficient")));

    // The honest block still connects.
    assert!(matches!(add(&mut c, good).unwrap(), Outcome::NewTip { .. }));
    assert_eq!(c.state.account(&bob).balance, 3 * COIN + 10 * COIN + t.tx.fee);
    assert_eq!(c.tx_location(&t.hash()), Some((2, 0)));

    // Replay of the confirmed tx in a later block is rejected (nonce already used).
    let mut replay = c.block_template(bob, vec![]).unwrap().0;
    replay.txs.push(t);
    replay.header.tx_root = Block::compute_tx_root(&replay.txs);
    replay.header.timestamp = c.tip().header.timestamp + p.target_block_time;
    let replay = remine(&c, replay);
    assert!(matches!(add(&mut c, replay), Err(BlockError::Invalid(e)) if e.contains("bad nonce")));
    assert_eq!(c.state.circulating(), c.state.issued);
}

fn remine(c: &Chain, mut b: Block) -> Block {
    let seed = c.pow_seed(&b).unwrap();
    loop {
        let h = PowEngine::global().hash(&seed, &b.header.pow_input()).unwrap();
        if meets_difficulty(&h, b.header.difficulty) {
            return b;
        }
        b.header.bump_nonce();
    }
}

#[test]
fn heavier_fork_triggers_reorg_and_returns_transactions() {
    let p = test_params();
    let mut a = Chain::new(p, None).unwrap();
    let mut b = Chain::new(p, None).unwrap();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);

    // Shared history: block 1 pays alice.
    let b1 = mine(&a, alice, vec![]);
    add(&mut a, b1.clone()).unwrap();
    add(&mut b, b1).unwrap();

    // Chain A: alice's payment confirms at height 2, then one more block.
    let t = build_transfer(&sk, p, 0, Address([3; 20]), COIN, None).unwrap();
    let a2 = mine(&a, Address([10; 20]), vec![t.clone()]);
    add(&mut a, a2).unwrap();
    let a3 = mine(&a, Address([10; 20]), vec![]);
    add(&mut a, a3).unwrap();
    assert!(a.tx_location(&t.hash()).is_some());

    // Chain B: a different miner builds 3 blocks without the payment -> more total work.
    let mut fork = Vec::new();
    for _ in 0..3 {
        let x = mine(&b, Address([20; 20]), vec![]);
        add(&mut b, x.clone()).unwrap();
        fork.push(x);
    }

    // A sees B's first two blocks: equal/less work -> side chain, tip unchanged.
    assert!(matches!(add(&mut a, fork[0].clone()).unwrap(), Outcome::SideChain));
    assert!(matches!(add(&mut a, fork[1].clone()).unwrap(), Outcome::SideChain));
    assert_eq!(a.height(), 3);
    // Third block gives B's branch more work -> reorg of depth 2.
    match add(&mut a, fork[2].clone()).unwrap() {
        Outcome::NewTip { reorg_depth, disconnected } => {
            assert_eq!(reorg_depth, 2);
            assert_eq!(disconnected, vec![t.clone()]);
        }
        o => panic!("expected reorg, got {o:?}"),
    }
    assert_eq!(a.tip().hash, b.tip().hash);
    assert_eq!(a.state, b.state);
    assert!(a.tx_location(&t.hash()).is_none());
    // The address index follows the reorg: the losing miner's blocks and alice's spend are gone.
    assert_eq!(a.blocks_mined_by(&Address([10; 20])), 0);
    assert_eq!(a.blocks_mined_by(&Address([20; 20])), 3);
    let (alice_items, _) = a.address_activity(&alice, None, 10);
    assert_eq!(alice_items, vec![(1, lokyx::chain::MINED)]);
    assert_eq!(a.state.account(&Address([10; 20])).balance, 0);
}

/// Feed `headers` from `peer` the way the node does: collect, check PoW, judge, commit.
fn sync_headers(c: &mut Chain, peer: u64, headers: &[lokyx::block::BlockHeader]) {
    let Staged::Verify { jobs, .. } = c.stage_headers(peer, headers).unwrap() else { panic!("busy") };
    let ok = Chain::verify_pow_jobs(&jobs).unwrap();
    match c.judge_pending(peer, true, &ok) {
        Judgement::Commit(jobs) => {
            let ok = Chain::verify_pow_jobs(&jobs).unwrap();
            c.commit_pending(peer, &ok).unwrap();
        }
        j => panic!("expected the headers to be kept, got {j:?}"),
    }
}

/// Before protocol v6 a block with an unknown parent waited in an orphan pool. Now nothing about
/// it is stored (the sender is asked for headers instead); once the headers are in, bodies
/// connect in any order.
#[test]
fn out_of_order_bodies_connect_once_headers_are_known() {
    let p = test_params();
    let mut src = Chain::new(p, None).unwrap();
    let mut blocks = Vec::new();
    for _ in 0..4 {
        let b = mine(&src, Address([4; 20]), vec![]);
        add(&mut src, b.clone()).unwrap();
        blocks.push(b);
    }
    let mut dst = Chain::new(p, None).unwrap();
    for b in blocks.iter().rev().take(3) {
        assert!(matches!(add(&mut dst, b.clone()).unwrap(), Outcome::NeedHeaders));
    }
    assert_eq!(dst.block_count(), 1, "a block with an unknown parent must not be stored");

    let headers: Vec<_> = blocks.iter().map(|b| b.header.clone()).collect();
    sync_headers(&mut dst, 1, &headers);
    assert_eq!(dst.best_header().header.height, 4);
    assert_eq!(dst.height(), 0);

    for b in blocks.iter().rev().take(3) {
        assert!(matches!(add(&mut dst, b.clone()).unwrap(), Outcome::SideChain));
    }
    assert_eq!(dst.height(), 0, "nothing connects before the first body");
    assert!(matches!(add(&mut dst, blocks[0].clone()).unwrap(), Outcome::NewTip { .. }));
    assert_eq!(dst.height(), 4);
    assert_eq!(dst.state, src.state);
}

#[test]
fn chain_survives_restart() {
    let p = test_params();
    let dir = std::env::temp_dir().join(format!("lokyx-test-{}", rand::random::<u64>()));
    let path = dir.join("chain.redb");
    let (tip, state) = {
        let mut c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
        for _ in 0..3 {
            let b = mine(&c, Address([6; 20]), vec![]);
            add(&mut c, b).unwrap();
        }
        (c.tip().hash, c.state.clone())
    };
    let c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
    assert_eq!(c.tip().hash, tip);
    assert_eq!(c.state, state);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn foreign_network_blocks_rejected() {
    // A block mined for a different chain id has a different genesis -> never connects.
    let p = test_params();
    let other: &'static ChainParams =
        Box::leak(Box::new(ChainParams { chain_id: 1, genesis_timestamp: p.genesis_timestamp + 1, ..p.clone() }));
    let o = Chain::new(other, None).unwrap();
    let b = mine(&o, Address([1; 20]), vec![]);
    let mut c = Chain::new(p, None).unwrap();
    assert!(matches!(add(&mut c, b).unwrap(), Outcome::NeedHeaders));
    assert_eq!(c.height(), 0);
    assert_eq!(c.block_count(), 1, "nothing from another network is stored");
}

#[test]
fn deep_reorg_uses_snapshots_and_matches_full_replay() {
    // Long enough to cross a snapshot (every 100 blocks), with a fork after it.
    let p = test_params();
    let mut a = Chain::new(p, None).unwrap();
    let mut b = Chain::new(p, None).unwrap();
    for _ in 0..205 {
        let x = mine(&a, Address([1; 20]), vec![]);
        add(&mut a, x.clone()).unwrap();
        add(&mut b, x).unwrap();
    }
    for _ in 0..3 {
        let x = mine(&a, Address([2; 20]), vec![]);
        add(&mut a, x).unwrap();
    }
    let mut fork = vec![];
    for _ in 0..5 {
        let x = mine(&b, Address([3; 20]), vec![]);
        add(&mut b, x.clone()).unwrap();
        fork.push(x);
    }
    let mut depths = vec![];
    for x in fork {
        if let Outcome::NewTip { reorg_depth, .. } = add(&mut a, x).unwrap() {
            depths.push(reorg_depth);
        }
    }
    // The 4th fork block overtakes (reorg of 3), the 5th simply extends.
    assert_eq!(depths, vec![3, 0]);
    assert_eq!(a.tip().hash, b.tip().hash);
    assert_eq!(a.state, b.state);
    // Rebuild from scratch and compare: the snapshot shortcut must give the identical state.
    let mut fresh = lokyx::state::State::default();
    for h in 1..=b.height() {
        fresh.apply_block(&b.block(&b.hash_at(h).unwrap()).unwrap(), p).unwrap();
    }
    assert_eq!(a.state, fresh);
}

#[test]
fn locked_rewards_cannot_be_spent_early() {
    let p: &'static ChainParams = Box::leak(Box::new(ChainParams { coinbase_maturity: 3, ..test_params().clone() }));
    let mut c = Chain::new(p, None).unwrap();
    let sk = SigningKey::random(&mut OsRng);
    let me = address_of(&sk);
    let b = mine(&c, me, vec![]);
    add(&mut c, b).unwrap();
    // Reward from block 1 is still locked: a spend in block 2 is rejected.
    let t = build_transfer(&sk, p, 0, Address([9; 20]), COIN, None).unwrap();
    assert!(c.block_template(me, vec![t.clone()]).is_err());
    for _ in 0..3 {
        let b = mine(&c, me, vec![]);
        add(&mut c, b).unwrap();
    }
    // Block 4 unlocked block 1's reward; the same spend now confirms.
    let b = mine(&c, me, vec![t.clone()]);
    add(&mut c, b).unwrap();
    assert!(c.tx_location(&t.hash()).is_some());
    assert_eq!(c.state.circulating(), c.state.issued);
}

#[test]
fn blocks_must_respect_minimum_spacing() {
    let p: &'static ChainParams =
        Box::leak(Box::new(ChainParams { target_block_time: 10, min_block_spacing: 6, ..test_params().clone() }));
    let mut c = Chain::new(p, None).unwrap();
    let miner = address_of(&SigningKey::random(&mut OsRng));
    for _ in 0..3 {
        let b = mine(&c, miner, vec![]);
        assert!(matches!(add(&mut c, b).unwrap(), Outcome::NewTip { .. }));
    }
    let parent_ts = c.tip().header.timestamp;
    assert_eq!(c.next_block_due(), parent_ts + 6);

    // 5 s after the parent: too soon, even with valid proof of work.
    let mut early = mine(&c, miner, vec![]);
    early.header.timestamp = parent_ts + 5;
    let early = remine(&c, early);
    assert!(matches!(add(&mut c, early), Err(BlockError::Invalid(e)) if e.contains("after its parent")));

    // Exactly the spacing: fine.
    let mut ok = mine(&c, miner, vec![]);
    ok.header.timestamp = parent_ts + 6;
    let ok = remine(&c, ok);
    assert!(matches!(add(&mut c, ok).unwrap(), Outcome::NewTip { .. }));
}

#[test]
fn block_zero_descends_from_the_genesis_message() {
    use lokyx::block::genesis;
    use lokyx::crypto::tagged_hash;
    use lokyx::params::TESTNET;
    let g = genesis(&TESTNET);
    assert_eq!(g.header.prev_hash, tagged_hash(b"LOKYX/genesis/v1", TESTNET.genesis_message.as_bytes()));
    assert!(TESTNET.genesis_message.contains("Binance"));
    // A different message is a different chain.
    let other = ChainParams { genesis_message: "something else", ..TESTNET.clone() };
    assert_ne!(genesis(&other).hash(), g.hash());
}
