//! Starting again from a database: the saved state, bodies read back from disk, receipts, and
//! what happens when the saved state can't be trusted. Uses the cheap test proof of work.

use k256::ecdsa::SigningKey;
use lokyx::abi;
use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{Chain, Outcome, now};
use lokyx::contract::{build_call, build_deploy, contract_address};
use lokyx::keys::address_of;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::store::Store;
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::OsRng;
use serde_json::json;
use std::path::PathBuf;

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

fn dir() -> PathBuf {
    std::env::temp_dir().join(format!("lokyx-restart-{}", rand::random::<u64>()))
}

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

fn replayed(blocks: &[Block]) -> Chain {
    let mut c = Chain::new(params(), None).unwrap();
    for b in blocks {
        c.process_block(b.clone(), false).unwrap();
    }
    c
}

fn same(a: &Chain, b: &Chain) {
    assert_eq!(a.tip().hash, b.tip().hash);
    assert_eq!(a.state, b.state);
    assert_eq!(a.state.root(), b.state.root());
    assert_eq!(a.cum_work(), b.cum_work());
    for h in 0..=a.height() {
        assert_eq!(a.hash_at(h), b.hash_at(h));
    }
}

fn open(path: &std::path::Path, reverify: bool) -> Chain {
    Chain::open(params(), Some(Store::open(path).unwrap()), reverify).unwrap()
}

#[test]
fn a_restart_begins_from_the_saved_state_and_ends_up_identical() {
    let d = dir();
    let path = d.join("chain.redb");
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let blocks = {
        let mut c = open(&path, false);
        assert_eq!(c.started_from(), None, "a new database starts from genesis");
        grow(&mut c, 250, alice, &sk, 1)
    };
    let fresh = replayed(&blocks);

    let c = open(&path, false);
    assert_eq!(c.started_from(), Some(200), "the newest saved state is at a multiple of 100");
    same(&c, &fresh);
    c.state.check_supply(c.height(), c.params).unwrap();

    // Everything that was indexed from the blocks it skipped is there anyway.
    for b in blocks.iter().step_by(17) {
        for (i, t) in b.txs.iter().enumerate() {
            assert_eq!(c.tx_location(&t.hash()), Some((b.header.height, i)));
        }
    }
    assert_eq!(c.blocks_mined_by(&alice), fresh.blocks_mined_by(&alice));
    let (a, total) = c.address_activity(&alice, None, 10);
    let (fa, ftotal) = fresh.address_activity(&alice, None, 10);
    assert_eq!((a, total), (fa, ftotal));

    // Old bodies come back from the database.
    for h in [1u64, 2, 99, 100, 150, 200, 250] {
        let hash = c.hash_at(h).unwrap();
        assert_eq!(c.block(&hash).unwrap().hash(), hash);
    }

    // Checking everything again gets the same chain by the long way.
    drop(c);
    let slow = open(&path, true);
    assert_eq!(slow.started_from(), None);
    same(&slow, &fresh);
    let _ = std::fs::remove_dir_all(d);
}

/// The chain carries on from where it was after a restart: new blocks connect, and a reorg that
/// reaches back past the restart (where there are no undo notes yet) still comes out right.
#[test]
fn after_a_restart_the_chain_keeps_growing_and_can_still_reorganize() {
    let d = dir();
    let path = d.join("chain.redb");
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    // 102 blocks: the saved state is at 100, so a restart skips the first hundred and has undo
    // notes only for the last two.
    let mut agreed = {
        let mut c = open(&path, false);
        grow(&mut c, 102, alice, &sk, 1)
    };
    let mut c = open(&path, false);
    assert_eq!(c.started_from(), Some(100));
    same(&c, &replayed(&agreed));

    // A rival that forks 5 back, at 97: before the saved state, where there are no notes, so the
    // node has to rebuild from further back. It is longer, so the node switches.
    let keep = agreed.len() - 5;
    let mut rival = replayed(&agreed[..keep]);
    let new = grow(&mut rival, 6, Address([0x77; 20]), &sk, 5);
    let mut depth = 0;
    for b in &new {
        if let Outcome::NewTip { reorg_depth, .. } = c.process_block(b.clone(), false).unwrap() {
            depth = depth.max(reorg_depth);
        }
    }
    assert_eq!(depth, 5);
    agreed.truncate(keep);
    agreed.extend(new);
    same(&c, &replayed(&agreed));

    // Blocks keep coming after that.
    agreed.extend(grow(&mut c, 3, alice, &sk, 2));
    same(&c, &replayed(&agreed));

    // And it is the same after another restart.
    drop(c);
    let again = open(&path, false);
    same(&again, &replayed(&agreed));
    let _ = std::fs::remove_dir_all(d);
}

/// A saved state that doesn't belong, in each way it could not: the node says so, ignores it, and
/// replays instead, ending up on the right state.
#[test]
fn a_saved_state_that_cant_be_trusted_is_ignored() {
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let setup = || {
        let d = dir();
        let path = d.join("chain.redb");
        let blocks = {
            let mut c = open(&path, false);
            grow(&mut c, 120, alice, &sk, 1)
        };
        (d, path, blocks)
    };

    // 1. The right block, but a state with one coin too many (even with the books balanced).
    let (d, path, blocks) = setup();
    {
        let hash = open(&path, false).hash_at(100).unwrap();
        let mut at100 = replayed(&blocks[..100]).state;
        at100.accounts.entry(Address([0xee; 20])).or_default().balance += 1;
        at100.accounts.entry(alice).or_default().balance -= 1;
        Store::open(&path).unwrap().put_state(100, &hash, &at100).unwrap();
    }
    let c = open(&path, false);
    assert_eq!(c.started_from(), None, "a state that doesn't hash to the block's root isn't used");
    same(&c, &replayed(&blocks));
    let _ = std::fs::remove_dir_all(d);

    // 2. A genuine state, filed under a block that isn't the one it belongs to.
    let (d, path, blocks) = setup();
    {
        let at100 = replayed(&blocks[..100]).state;
        let s = Store::open(&path).unwrap();
        s.put_state(100, &blocks[50].hash(), &at100).unwrap();
    }
    let c = open(&path, false);
    assert_eq!(c.started_from(), None);
    same(&c, &replayed(&blocks));
    let _ = std::fs::remove_dir_all(d);
}

/// What the state looks like written out and read back.
#[test]
fn a_state_survives_being_written_out() {
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut c = Chain::new(params(), None).unwrap();
    grow(&mut c, 12, alice, &sk, 1);
    let bytes = c.state.to_bytes();
    let back = lokyx::state::State::from_bytes(&bytes).unwrap();
    assert_eq!(back, c.state);
    assert_eq!(back.root(), c.state.root());
    assert!(lokyx::state::State::from_bytes(&bytes[..bytes.len() - 3]).is_err());
}

/// Contract receipts are not recomputed for the blocks a restart skips; they come from the
/// database, and go away if their block does.
#[test]
fn receipts_come_back_after_a_restart() {
    let d = dir();
    let path = d.join("chain.redb");
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let dirp = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/contracts/");
    let code = std::fs::read(format!("{dirp}counter.wasm")).unwrap();
    let abi_text = std::fs::read_to_string(format!("{dirp}counter.abi.json")).unwrap();
    let spec = abi::parse(&abi_text).unwrap();
    let (blocks, tx_hashes) = {
        let mut c = open(&path, false);
        let mut blocks = grow(&mut c, 4, alice, &sk, 1);
        let n = c.state.account(&alice).nonce;
        let dep = build_deploy(
            &sk,
            c.params,
            n,
            code,
            abi_text,
            abi::encode_deploy(&spec, &[json!(5)]).unwrap(),
            2_000_000,
            0,
        )
        .unwrap();
        let at = contract_address(&alice, n);
        let inc = build_call(&sk, c.params, n + 1, at, abi::encode_call(&spec, "increment", &[]).unwrap(), 200_000, 0)
            .unwrap();
        let hs = vec![dep.hash(), inc.hash()];
        let b = mine(&c, alice, vec![dep, inc]);
        c.process_block(b.clone(), false).unwrap();
        blocks.push(b);
        blocks.extend(grow(&mut c, 110, alice, &sk, 2));
        for h in &hs {
            assert!(c.receipt(h).unwrap().ok);
        }
        (blocks, hs)
    };
    let fresh = replayed(&blocks);
    let c = open(&path, false);
    assert_eq!(c.started_from(), Some(100));
    for h in &tx_hashes {
        assert_eq!(c.receipt(h), fresh.receipt(h));
        assert!(c.receipt(h).is_some());
    }
    let _ = std::fs::remove_dir_all(d);
}

/// A saved state is only worth anything if it belongs to the chain the node was following. This
/// one is genuine in every other way: it is the true state of a real block, with a matching root,
/// and its lineage leads back to genesis. But the block is on a side branch, so starting from it
/// would put the node on the wrong chain.
#[test]
fn a_saved_state_from_a_side_branch_is_not_used() {
    let d = dir();
    let path = d.join("chain.redb");
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut agreed = {
        let mut c = open(&path, false);
        grow(&mut c, 117, alice, &sk, 1)
    };
    // A rival branch two blocks long off block 117, which loses to the main chain's three more
    // but is close enough to the tip that the node keeps its bodies.
    let (side_hash, side_state) = {
        let mut c = open(&path, false);
        let mut rival = replayed(&agreed);
        let side = grow(&mut rival, 2, Address([0x55; 20]), &sk, 8);
        agreed.extend(grow(&mut c, 3, alice, &sk, 2));
        for b in &side {
            assert!(matches!(c.process_block(b.clone(), false).unwrap(), Outcome::SideChain));
        }
        assert!(c.has_body(&side[1].hash()), "the side branch's body is stored");
        (side[1].hash(), rival.state.clone())
    };
    assert_eq!(side_state.height, 119);
    Store::open(&path).unwrap().put_state(119, &side_hash, &side_state).unwrap();

    let c = open(&path, false);
    assert_eq!(c.started_from(), None, "a state from a branch we weren't on is not a starting point");
    same(&c, &replayed(&agreed));
    let _ = std::fs::remove_dir_all(d);
}

/// The saved state matches its block's state root, but the books don't balance: the block was
/// committed over a state that already had coins out of nowhere. Nothing about the root can show
/// that, only the supply check. So the saved state is refused and the node replays instead; the
/// replay doesn't reproduce the bad state, so the block fails on its root and is thrown away.
/// Without the check the node would have started on a state it can't account for, at height 100,
/// with nothing to tell it so.
#[test]
fn a_saved_state_whose_books_dont_balance_is_refused_even_when_the_root_matches() {
    let d = dir();
    let path = d.join("chain.redb");
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let (hash, state) = {
        let mut c = open(&path, false);
        grow(&mut c, 99, alice, &sk, 1);
        // Stand in for a bug of ours: coins appear in the state, and the next block is built on it.
        let mut bad = c.state.clone();
        bad.accounts.entry(Address([7; 20])).or_default().balance += 42;
        bad.apply_body(100, alice, &[], c.params).unwrap();
        assert!(bad.check_supply(100, c.params).is_err());
        let parent = c.tip().clone();
        let mut header = BlockHeader {
            version: lokyx::params::BLOCK_VERSION,
            height: 100,
            prev_hash: parent.hash,
            timestamp: parent.header.timestamp + c.params.target_block_time,
            difficulty: c.next_difficulty_for(&parent.hash),
            tx_root: Block::compute_tx_root(&[]),
            state_root: bad.root(),
            coinbase: alice,
            receipts_root: lokyx::crypto::ZERO_HASH,
            pow: lokyx::block::Pow::Native { nonce: 0 },
        };
        let seed = c.pow_seed(&Block { header: header.clone(), txs: vec![] }).unwrap();
        solve(&seed, &mut header);
        let block = Block { header, txs: vec![] };
        (block.hash(), (block, bad))
    };
    let (block, bad) = state;
    {
        // Written straight to the database: the node would never have accepted it.
        let s = Store::open(&path).unwrap();
        s.put_block(&hash, &block).unwrap();
        s.set_tip(&hash).unwrap();
        s.put_state(100, &hash, &bad).unwrap();
    }

    let c = open(&path, false);
    assert_eq!(c.started_from(), None, "the root matched; the books did not");
    assert_eq!(c.height(), 99, "the block over the bad state was not applied");
    assert!(!c.knows(&hash), "and it was thrown away");
    c.state.check_supply(99, c.params).unwrap();
    let _ = std::fs::remove_dir_all(d);
}
