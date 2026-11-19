//! Reorganizations: stepping blocks off the tip with undo notes and putting another branch on.
//!
//! Whatever route a node takes to its state, it has to end up exactly where a node that simply
//! applied the winning chain from the start would be. Every test here checks that against a
//! second chain built from scratch. Uses the cheap test proof of work (see tests/sync.rs).

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{Chain, Outcome, now};
use lokyx::keys::address_of;
use lokyx::params::{BLOCK_VERSION, COIN, ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::OsRng;

fn params() -> &'static ChainParams {
    // One set of parameters for the whole test binary: the genesis time is part of them, and two
    // chains only agree if they share it.
    static P: std::sync::OnceLock<ChainParams> = std::sync::OnceLock::new();
    lokyx::pow::test_pow::enable();
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();
    P.get_or_init(|| ChainParams {
        initial_difficulty: 2,
        min_difficulty: 2,
        target_block_time: 10,
        min_block_spacing: 0,
        coinbase_maturity: 2,
        genesis_timestamp: now() - 1_000_000,
        ..DEVNET.clone()
    })
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

/// Mine and add `n` blocks, `txs_per` of them carrying a transfer from `sk`. Returns the blocks.
fn grow(c: &mut Chain, n: usize, miner: Address, sk: &SigningKey, to: u8) -> Vec<Block> {
    let me = address_of(sk);
    let mut out = vec![];
    for _ in 0..n {
        let nonce = c.state.account(&me).nonce;
        let txs = if c.state.account(&me).balance > 2 * COIN {
            vec![build_transfer(sk, c.params, nonce, Address([to; 20]), COIN / 10, None).unwrap()]
        } else {
            vec![]
        };
        let b = mine(c, miner, txs);
        assert!(matches!(c.process_block(b.clone(), false).unwrap(), Outcome::NewTip { .. }));
        out.push(b);
    }
    out
}

/// A chain that has only ever seen `blocks`, in order.
fn replayed(blocks: &[Block]) -> Chain {
    let mut c = Chain::new(params(), None).unwrap();
    for b in blocks {
        c.process_block(b.clone(), false).unwrap();
    }
    c
}

fn same(a: &Chain, b: &Chain) {
    assert_eq!(a.tip().hash, b.tip().hash);
    assert_eq!(a.state, b.state, "state");
    assert_eq!(a.state.root(), b.state.root());
    // The trie kept inside each node's state agrees with building it from scratch.
    for c in [a, b] {
        let mut st = c.state.clone();
        assert_eq!(st.root_incremental(), st.root(), "incremental root");
    }
    for h in 0..=a.height() {
        assert_eq!(a.hash_at(h), b.hash_at(h));
    }
    assert_eq!(a.state.circulating(), a.state.issued);
}

/// Two branches from a shared prefix, each carrying real transfers. The node follows the first,
/// then switches to the longer second, which takes several blocks off and puts more on.
#[test]
fn switching_branches_gives_the_state_a_fresh_replay_gives() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut a = Chain::new(p, None).unwrap();
    let shared = grow(&mut a, 8, alice, &sk, 1);
    let mut b = replayed(&shared);

    let a_only = grow(&mut a, 4, Address([0xa1; 20]), &sk, 2);
    let b_only = grow(&mut b, 6, Address([0xb2; 20]), &sk, 3);
    let a_tip = a.tip().hash;
    assert_ne!(a_tip, b.tip().hash);

    // Hand `a` the other branch: it is longer, so `a` reorganizes four deep.
    let mut disconnected = 0;
    for blk in &b_only {
        if let Outcome::NewTip { reorg_depth, disconnected: d } = a.process_block(blk.clone(), false).unwrap()
            && reorg_depth > 0
        {
            assert_eq!(reorg_depth, 4);
            disconnected = d.len();
        }
    }
    assert!(disconnected > 0, "the old branch's transfers come back for the mempool");
    same(&a, &b);

    // Everything that was on the old branch is gone from the indexes; the new one is there.
    for blk in &a_only {
        for t in &blk.txs {
            assert!(a.tx_location(&t.hash()).is_none());
        }
    }
    for blk in &b_only {
        for t in &blk.txs {
            assert!(a.tx_location(&t.hash()).is_some());
        }
    }
    // And the same chain as one that never saw the other branch at all.
    let mut all = shared.clone();
    all.extend(b_only.clone());
    same(&a, &replayed(&all));
}

/// Reorganizing over and over, each time a little deeper or shallower than the last, so every
/// switch steps off blocks that an earlier switch put on.
#[test]
fn reorganizing_again_and_again_keeps_the_state_exact() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut node = Chain::new(p, None).unwrap();
    let mut agreed = grow(&mut node, 10, alice, &sk, 1);
    for round in 0..9u8 {
        let depth = 1 + (round as usize % 4);
        let keep = agreed.len() - depth;
        let mut rival = replayed(&agreed[..keep]);
        // One block longer than what it replaces, so the node has to switch.
        let new = grow(&mut rival, depth + 1, Address([0x40 + round; 20]), &sk, round + 2);
        let mut switched = 0;
        for blk in &new {
            if let Outcome::NewTip { reorg_depth, .. } = node.process_block(blk.clone(), false).unwrap() {
                switched = switched.max(reorg_depth);
            }
        }
        assert_eq!(switched, depth as u64, "round {round}");
        agreed.truncate(keep);
        agreed.extend(new);
        same(&node, &replayed(&agreed));
    }
}

/// A branch that turns out to be invalid part-way through. It had already been partly applied;
/// the node has to end up exactly where it was, and its undo notes have to still be good.
#[test]
fn a_branch_that_fails_half_way_leaves_the_node_where_it_was() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut node = Chain::new(p, None).unwrap();
    let shared = grow(&mut node, 6, alice, &sk, 1);
    let own = grow(&mut node, 3, Address([0xa1; 20]), &sk, 2);
    let mut honest = replayed(&shared);
    let honest_blocks = grow(&mut honest, 3, Address([0xa1; 20]), &sk, 2);
    assert_eq!(
        honest_blocks.iter().map(|b| b.hash()).collect::<Vec<_>>(),
        own.iter().map(|b| b.hash()).collect::<Vec<_>>()
    );
    let before = replayed(&[shared.clone(), own.clone()].concat());

    // A fork from the shared prefix: two good blocks and a third whose state root is wrong.
    let mut fork = replayed(&shared);
    let mut blocks = grow(&mut fork, 2, Address([0xbb; 20]), &sk, 9);
    let bad = {
        let mut b = mine(&fork, Address([0xbb; 20]), vec![]);
        b.header.state_root[0] ^= 1;
        let seed = fork.pow_seed(&b).unwrap();
        solve(&seed, &mut b.header);
        b
    };
    blocks.push(bad.clone());
    // Feed the good ones and the bad one: the node keeps them as a side branch, then the two on
    // top make it the heavier one and it tries to switch.
    for b in &blocks {
        node.process_block(b.clone(), false).unwrap();
    }
    let mut parent = bad.clone();
    // One block on top of the bad one makes this branch heavier than ours, so the node tries to
    // switch: two good blocks go on, the third fails, and everything is taken back.
    for _ in 0..1 {
        let mut h = BlockHeader {
            version: BLOCK_VERSION,
            height: parent.header.height + 1,
            prev_hash: parent.hash(),
            timestamp: parent.header.timestamp + p.target_block_time,
            difficulty: node.next_difficulty_for(&parent.hash()),
            tx_root: Block::compute_tx_root(&[]),
            state_root: [0; 32],
            coinbase: Address([0xbb; 20]),
            receipts_root: lokyx::crypto::ZERO_HASH,
            pow: lokyx::block::Pow::Native { nonce: 0 },
        };
        let blk = Block { header: h.clone(), txs: vec![] };
        let seed = node.pow_seed(&blk).unwrap();
        solve(&seed, &mut h);
        let blk = Block { header: h, txs: vec![] };
        let _ = node.process_block(blk.clone(), false);
        assert!(!node.knows(&bad.hash()), "the bad block and what's built on it are written off");
        parent = blk;
    }

    // Nothing moved, and nothing is half-applied.
    same(&node, &before);
    assert!(node.halted().is_none());

    // The notes are still good: a real reorg afterwards works and matches a fresh replay.
    let mut winner = replayed(&shared);
    let win = grow(&mut winner, 6, Address([0xcc; 20]), &sk, 7);
    for b in &win {
        node.process_block(b.clone(), false).unwrap();
    }
    same(&node, &winner);
}
