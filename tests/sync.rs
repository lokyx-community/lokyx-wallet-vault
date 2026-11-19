//! Headers-first sync and its spam protection, attack cases included.
//!
//! These drive a real `Node` (the same header and body handling the p2p code calls), just without
//! TCP in between. They need thousands of blocks, so they use the cheap test proof of work: RandomX
//! in light mode is ~30 ms a hash. `tests/chain.rs` covers the same rules with real RandomX.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{
    BIG_PENDING, BlockError, Chain, HEADER_MARGIN, Judgement, MAX_HEADERS_PER_MSG, Outcome, Staged, now,
};
use lokyx::keys::address_of;
use lokyx::node::{BODY_TIMEOUT, HEADERS_TIMEOUT, MAX_BODIES_IN_FLIGHT, Node};
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::store::Store;
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::OsRng;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn params_with(f: impl FnOnce(&mut ChainParams)) -> &'static ChainParams {
    lokyx::pow::test_pow::enable();
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

/// Mine a block on the chain's tip. Timestamps advance by exactly the target, so difficulty stays
/// steady and work is proportional to length.
fn mine(c: &Chain, coinbase: Address, txs: Vec<SignedTransaction>) -> Block {
    let (mut b, seed) = c.block_template(coinbase, txs).unwrap();
    b.header.timestamp = c.tip().header.timestamp.max(c.params.genesis_timestamp) + c.params.target_block_time;
    solve(&seed, &mut b.header);
    b
}

fn solve(seed: &[u8; 32], h: &mut BlockHeader) {
    loop {
        if meets_difficulty(&PowEngine::global().hash(seed, &h.pow_input()).unwrap(), h.difficulty) {
            return;
        }
        h.bump_nonce();
    }
}

fn extend(c: &mut Chain, n: usize, coinbase: Address) -> Vec<Block> {
    (0..n)
        .map(|_| {
            let b = mine(c, coinbase, vec![]);
            assert!(matches!(c.process_block(b.clone(), false).unwrap(), Outcome::NewTip { .. }));
            b
        })
        .collect()
}

/// A chain that shares `shared` with another, then goes its own way.
fn chain_from(p: &'static ChainParams, shared: &[Block]) -> Chain {
    let mut c = Chain::new(p, None).unwrap();
    for b in shared {
        c.process_block(b.clone(), false).unwrap();
    }
    c
}

fn node(c: Chain) -> Arc<Node> {
    Node::new(c.params, c, 0, vec![])
}

/// What the p2p code does before asking a peer for headers: the peer said at the handshake that
/// its chain has `claimed` work, and we send it a locator.
fn ask(node: &Node, peer: u64, claimed: u128) -> Vec<lokyx::crypto::Hash> {
    if !node.sync.lock().contains_key(&peer) {
        node.add_sync_peer(peer, claimed);
    }
    node.want_headers(peer).expect("a header request was already waiting")
}

/// Sync `node` from `src` as peer `peer`, exactly as the p2p loop would: headers batch by batch,
/// then the bodies the node asks for.
fn sync_from(node: &Node, src: &Chain, peer: u64) {
    for _ in 0..1000 {
        let loc = ask(node, peer, src.cum_work());
        let hs = src.headers_after_locator(&loc, MAX_HEADERS_PER_MSG);
        let next = node.on_headers_blocking(peer, hs);
        assert!(next.penalty.is_none(), "honest peer penalized: {:?}", next.penalty);
        loop {
            let want = node.take_body_requests(peer, 64);
            if want.is_empty() {
                break;
            }
            for b in src.bodies_for(&want, usize::MAX) {
                assert!(node.body_arrived(peer, &b.hash()), "a body we asked for was refused");
                node.submit_block_blocking(b).unwrap();
            }
        }
        if !next.more_headers {
            return;
        }
    }
    panic!("sync never finished");
}

fn stored_blocks(path: &std::path::Path) -> Vec<Block> {
    Store::open(path).unwrap().load_all().unwrap()
}

fn temp_db() -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = std::env::temp_dir().join(format!("lokyx-sync-{}", rand::random::<u64>()));
    let path = dir.join("chain.redb");
    (dir, path)
}

// ---------- the attack this fixes ----------

/// Before v6: blocks forking from block 1 at the low early difficulty were stored forever, with
/// their transactions never looked at. Now nothing about them is stored, and they cost us no
/// proof-of-work checks either.
#[test]
fn spam_fork_from_block_one_stores_nothing() {
    let p = params();
    let (dir, path) = temp_db();
    let mut honest = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
    let shared = extend(&mut honest, 1, Address([1; 20]));
    extend(&mut honest, 299, Address([1; 20]));
    let tip = honest.tip().hash;
    let (count, bodies) = (honest.block_count(), honest.body_count());

    // The attacker forks from block 1. Early blocks are cheap, so this costs little real work.
    let mut attacker = chain_from(p, &shared);
    let spam = extend(&mut attacker, 150, Address([66; 20]));

    // As gossiped blocks: each one is ignored without being stored.
    for b in &spam {
        assert!(matches!(honest.process_block(b.clone(), false), Ok(Outcome::Ignored) | Ok(Outcome::NeedHeaders)));
    }
    // As a header sync: the branch is judged as a whole and dropped.
    let n = node(honest);
    let hs: Vec<BlockHeader> = spam.iter().map(|b| b.header.clone()).collect();
    ask(&n, 7, attacker.cum_work());
    let next = n.on_headers_blocking(7, hs);
    assert!(!next.bodies && !next.more_headers, "{next:?}");
    let c = n.chain.lock();
    assert_eq!(c.tip().hash, tip);
    assert_eq!((c.block_count(), c.body_count()), (count, bodies), "spam got into the block tree");
    assert_eq!(c.pending_count(), 0);
    drop(c);
    drop(n);
    let on_disk = stored_blocks(&path);
    assert!(on_disk.iter().all(|b| b.header.coinbase != Address([66; 20])), "spam reached the disk");
    assert_eq!(on_disk.len(), 300);
    let _ = std::fs::remove_dir_all(dir);
}

/// A near-tip side block with a malformed signature is turned away before it's stored, and anything
/// built on it is refused. (A signature that is well formed but recovers to some other, unfunded
/// address can only be caught when the block's state is applied, see `tests/chain.rs`.)
#[test]
fn side_block_with_bad_signature_is_rejected_before_storage() {
    let p = params();
    let (dir, path) = temp_db();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    let mut main = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
    let shared = extend(&mut main, 3, alice);
    extend(&mut main, 2, Address([1; 20]));

    let mut fork = chain_from(p, &shared);
    let mut forged = build_transfer(&sk, p, 0, Address([2; 20]), COIN, None).unwrap();
    forged.sig = lokyx::tx::Sig::Secp256k1Recoverable { signature: [0; 64], recovery_id: 0 };
    let mut bad = mine(&fork, Address([3; 20]), vec![]);
    bad.txs = vec![forged];
    bad.header.tx_root = Block::compute_tx_root(&bad.txs);
    let seed = fork.pow_seed(&bad).unwrap();
    solve(&seed, &mut bad.header);
    fork.process_block(bad.clone(), true).unwrap_err(); // even the attacker's own node can't apply it

    let n = node(main);
    match n.submit_block_blocking(bad.clone()) {
        Err(BlockError::Invalid(e)) => assert!(e.contains("signature"), "{e}"),
        o => panic!("expected the forged signature to be caught, got {o:?}"),
    }
    let c = n.chain.lock();
    assert!(!c.has_body(&bad.hash()));
    assert!(!c.knows(&bad.hash()));
    assert_eq!(c.height(), 5);
    drop(c);

    // A child of it is refused outright.
    let mut child = bad.clone();
    child.header.prev_hash = bad.hash();
    child.header.height += 1;
    child.txs.clear();
    child.header.tx_root = Block::compute_tx_root(&[]);
    assert!(matches!(n.submit_block_blocking(child), Err(BlockError::Invalid(e)) if e.contains("invalid block")));
    drop(n);
    assert!(stored_blocks(&path).iter().all(|b| b.hash() != bad.hash()), "bad block reached the disk");
    let _ = std::fs::remove_dir_all(dir);
}

/// A peer sending the wrong body for a good header is the peer's fault, not the block's: the
/// header stays, and the right body is still accepted afterwards.
#[test]
fn wrong_body_does_not_poison_a_good_header() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    let sk = SigningKey::random(&mut OsRng);
    let alice = address_of(&sk);
    extend(&mut src, 2, alice);
    let pay = build_transfer(&sk, p, 0, Address([2; 20]), COIN, None).unwrap();
    let good = mine(&src, alice, vec![pay]);
    src.process_block(good.clone(), false).unwrap();

    let mut dst = Chain::new(p, None).unwrap();
    for h in 1..=2 {
        dst.process_block(src.block(&src.hash_at(h).unwrap()).unwrap().as_ref().clone(), false).unwrap();
    }
    let n = node(dst);
    ask(&n, 1, src.cum_work());
    let next = n.on_headers_blocking(1, vec![good.header.clone()]);
    assert!(next.penalty.is_none());
    let mut swapped = good.clone();
    swapped.txs.clear();
    assert!(matches!(n.submit_block_blocking(swapped), Err(BlockError::Mismatch(_))));
    assert!(n.chain.lock().knows(&good.hash()), "the header must survive a bad body");
    assert!(matches!(n.submit_block_blocking(good.clone()).unwrap(), Outcome::NewTip { .. }));
    assert_eq!(n.chain.lock().tip().hash, good.hash());
}

// ---------- honest forks are still followed ----------

fn follow_heavier_fork(shared_len: usize, ours: usize, theirs: usize) {
    let p = params();
    let mut a = Chain::new(p, None).unwrap();
    let shared = extend(&mut a, shared_len, Address([1; 20]));
    let mut b = chain_from(p, &shared);
    extend(&mut a, ours, Address([10; 20]));
    extend(&mut b, theirs, Address([20; 20]));
    assert!(b.cum_work() > a.cum_work());

    let n = node(a);
    sync_from(&n, &b, 1);
    let c = n.chain.lock();
    assert_eq!(c.tip().hash, b.tip().hash, "didn't follow the heavier chain");
    assert_eq!(c.height(), b.height());
    assert_eq!(c.state, b.state);
    assert_eq!(c.blocks_mined_by(&Address([10; 20])), 0);
    assert_eq!(c.pending_count(), 0);
}

#[test]
fn heavier_fork_300_blocks_deep_is_followed() {
    follow_heavier_fork(50, 300, 310);
}

/// Deeper than two full header batches: the first batches alone have less work than our chain
/// had 100 blocks ago, so judging batch by batch would have dropped the branch and split us off
/// for good. Collected across batches, it's followed.
#[test]
fn heavier_fork_5000_blocks_deep_is_followed() {
    follow_heavier_fork(100, 5000, 5100);
}

/// The same deep fork, checking what happens on the way: the first batches are collected, not
/// judged and not dropped.
#[test]
fn deep_fork_is_collected_across_batches_before_judging() {
    let p = params();
    let mut a = Chain::new(p, None).unwrap();
    let shared = extend(&mut a, 10, Address([1; 20]));
    let mut b = chain_from(p, &shared);
    extend(&mut a, 4200, Address([10; 20]));
    extend(&mut b, 4300, Address([20; 20]));
    let mut a = a;
    let first = b.headers_after_locator(&a.header_locator(1), MAX_HEADERS_PER_MSG);
    assert!(first.last().map(|h| h.height).unwrap() < a.height() - HEADER_MARGIN);
    let Staged::Verify { jobs, .. } = a.stage_headers(1, &first).unwrap() else { panic!() };
    let ok = Chain::verify_pow_jobs(&jobs).unwrap();
    assert!(matches!(a.judge_pending(1, false, &ok), Judgement::NeedMore));
    let new = first.iter().filter(|h| h.height > 10).count();
    assert!(new > MAX_HEADERS_PER_MSG / 2);
    assert_eq!(a.pending_count(), new);
    assert_eq!(a.block_count(), 4211, "nothing committed yet");
}

// ---------- fresh nodes and fake chains ----------

/// A fresh node offered a chain with less than `min_chain_work` takes its headers but downloads
/// no bodies and doesn't mine; the real chain then syncs normally.
#[test]
fn chain_below_min_chain_work_gets_no_bodies() {
    let base = params();
    let mut real = Chain::new(base, None).unwrap();
    extend(&mut real, 400, Address([1; 20]));
    let mut fake = Chain::new(base, None).unwrap();
    extend(&mut fake, 100, Address([66; 20]));
    let need = real.cum_work() - 10;
    let p = params_with(|p| {
        p.min_chain_work = need;
        p.genesis_timestamp = base.genesis_timestamp;
    });

    let n = node(Chain::new(p, None).unwrap());
    let hs = fake.headers_after_locator(&ask(&n, 1, fake.cum_work()), MAX_HEADERS_PER_MSG);
    assert!(n.on_headers_blocking(1, hs).penalty.is_none());
    {
        let c = n.chain.lock();
        assert_eq!(c.best_header().header.height, 100);
        assert!(c.missing_bodies(64).is_empty(), "bodies requested for a chain below min_chain_work");
        assert!(!c.is_synced());
        assert!(c.block_template(Address([1; 20]), vec![]).is_err(), "mining while not synced");
    }
    sync_from(&n, &real, 2);
    let c = n.chain.lock();
    assert_eq!(c.tip().hash, real.tip().hash);
    assert!(c.is_synced());
}

/// One header with bad proof of work in the middle of a batch rejects the whole batch, whether
/// or not it happened to be sampled on arrival.
#[test]
fn bad_proof_of_work_in_a_batch_rejects_the_batch() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    extend(&mut src, 20, Address([1; 20]));
    // A block whose nonce doesn't meet difficulty, forced into the source chain, and more on top.
    let mut bad = mine(&src, Address([1; 20]), vec![]);
    let seed = src.pow_seed(&bad).unwrap();
    loop {
        bad.header.bump_nonce();
        if !meets_difficulty(&PowEngine::global().hash(&seed, &bad.header.pow_input()).unwrap(), bad.header.difficulty)
        {
            break;
        }
    }
    src.process_block(bad, true).unwrap();
    extend(&mut src, 30, Address([1; 20]));

    for attempt in 0..5 {
        let n = node(Chain::new(p, None).unwrap());
        let hs = src.headers_after_locator(&ask(&n, 1, src.cum_work()), MAX_HEADERS_PER_MSG);
        let next = n.on_headers_blocking(1, hs);
        let (points, why) = next.penalty.expect("bad proof of work went unnoticed");
        assert_eq!(points, 100, "{why}");
        assert!(why.contains("proof of work"), "{why}");
        let c = n.chain.lock();
        assert_eq!(c.block_count(), 1, "attempt {attempt}: part of a bad batch was kept");
        assert_eq!(c.pending_count(), 0);
    }
}

/// Only two peers at a time may feed us long header chains; a third is told to wait.
#[test]
fn only_two_peers_may_feed_long_header_chains_at_once() {
    let p = params();
    let mut a = Chain::new(p, None).unwrap();
    let shared = extend(&mut a, 10, Address([1; 20]));
    let mut b = chain_from(p, &shared);
    extend(&mut a, 3000, Address([10; 20]));
    extend(&mut b, 3100, Address([20; 20]));
    let batch = b.headers_after_locator(&a.header_locator(1), MAX_HEADERS_PER_MSG);
    let more = |a: &Chain, peer| {
        let loc = a.header_locator(peer);
        b.headers_after_locator(&loc, MAX_HEADERS_PER_MSG)
    };
    for peer in [1, 2] {
        assert!(matches!(a.stage_headers(peer, &batch).unwrap(), Staged::Verify { .. }));
        let next = more(&a, peer);
        assert!(matches!(a.stage_headers(peer, &next[..BIG_PENDING.min(next.len())]).unwrap(), Staged::Verify { .. }));
    }
    assert!(matches!(a.stage_headers(3, &batch).unwrap(), Staged::Verify { .. }), "a first batch is always fine");
    let next = more(&a, 3);
    assert!(matches!(a.stage_headers(3, &next).unwrap(), Staged::Busy));
}

// ---------- assume-valid ----------

/// Headers that lead to the published assume-valid block skip their RandomX check; headers above
/// it, and every header of a chain that doesn't contain it, are checked.
#[test]
fn assume_valid_skips_proof_of_work_only_below_its_block() {
    let base = params();
    let mut real = Chain::new(base, None).unwrap();
    extend(&mut real, 3000, Address([1; 20]));
    let av_height = 2500;
    let av_hash = real.hash_at(av_height).unwrap();
    let p = params_with(|p| {
        p.assume_valid = Some((av_height, av_hash));
        p.genesis_timestamp = base.genesis_timestamp;
    });

    let mut c = Chain::new(p, None).unwrap();
    let mut checked_heights = Vec::new();
    loop {
        let hs = real.headers_after_locator(&c.header_locator(1), MAX_HEADERS_PER_MSG);
        let done = hs.len() < MAX_HEADERS_PER_MSG;
        let Staged::Verify { jobs, .. } = c.stage_headers(1, &hs).unwrap() else { panic!() };
        checked_heights.extend(jobs.iter().map(|j| j.header.height));
        let ok = Chain::verify_pow_jobs(&jobs).unwrap();
        match c.judge_pending(1, done, &ok) {
            Judgement::NeedMore => continue,
            Judgement::Commit(jobs) => {
                assert!(jobs.iter().all(|j| j.header.height > av_height), "a header below assume-valid was checked");
                checked_heights.extend(jobs.iter().map(|j| j.header.height));
                let ok = Chain::verify_pow_jobs(&jobs).unwrap();
                c.commit_pending(1, &ok).unwrap();
                if done {
                    break;
                }
            }
            j => panic!("{j:?}"),
        }
    }
    let below = checked_heights.iter().filter(|h| **h <= av_height).count();
    assert!(below < av_height as usize / 8, "{below} of {av_height} headers below assume-valid were checked");
    assert!((av_height + 1..=3000).all(|h| checked_heights.contains(&h)), "a header above assume-valid went unchecked");

    // A different chain with the same height: it doesn't contain the assume-valid block, so every
    // header gets checked.
    let mut other = Chain::new(base, None).unwrap();
    extend(&mut other, 2600, Address([2; 20]));
    let mut c2 = Chain::new(p, None).unwrap();
    let mut all = Vec::new();
    loop {
        let hs = other.headers_after_locator(&c2.header_locator(1), MAX_HEADERS_PER_MSG);
        let done = hs.len() < MAX_HEADERS_PER_MSG;
        let Staged::Verify { jobs, .. } = c2.stage_headers(1, &hs).unwrap() else { panic!() };
        all.extend(jobs.iter().map(|j| j.header.height));
        let ok = Chain::verify_pow_jobs(&jobs).unwrap();
        match c2.judge_pending(1, done, &ok) {
            Judgement::NeedMore => continue,
            Judgement::Commit(jobs) => {
                all.extend(jobs.iter().map(|j| j.header.height));
                let ok = Chain::verify_pow_jobs(&jobs).unwrap();
                c2.commit_pending(1, &ok).unwrap();
                if done {
                    break;
                }
            }
            j => panic!("{j:?}"),
        }
    }
    assert!(
        (1..=2600).all(|h| all.contains(&h)),
        "a header of a chain without the assume-valid block skipped its check"
    );
}

// ---------- storage and restarts ----------

/// Side branches near the tip are kept (so short races reorg instantly), then pruned from memory
/// and disk once the tip has moved on.
#[test]
fn side_branches_are_pruned_once_the_tip_moves_on() {
    let p = params();
    let (dir, path) = temp_db();
    let mut c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
    let shared = extend(&mut c, 10, Address([1; 20]));
    let mut f = chain_from(p, &shared);
    let side = extend(&mut f, 1, Address([2; 20])).remove(0);
    extend(&mut c, 1, Address([1; 20]));
    assert!(matches!(c.process_block(side.clone(), false).unwrap(), Outcome::SideChain));
    assert!(c.has_body(&side.hash()), "a near-tip side block should keep its body");

    extend(&mut c, 10, Address([1; 20]));
    c.prune();
    assert!(c.knows(&side.hash()) && !c.has_body(&side.hash()), "body should go after BODY_MARGIN blocks");
    extend(&mut c, HEADER_MARGIN as usize, Address([1; 20]));
    c.prune();
    assert!(!c.knows(&side.hash()), "header should go after HEADER_MARGIN blocks");
    drop(c);
    assert!(stored_blocks(&path).iter().all(|b| b.hash() != side.hash()), "pruned block still on disk");
    let _ = std::fs::remove_dir_all(dir);
}

/// A database that already holds spam (from a node older than v6) is cleaned up on the first
/// restart, so later restarts are as fast as with a clean database.
#[test]
fn old_spam_in_the_database_is_cleaned_up_on_restart() {
    let p = params();
    let (dir, path) = temp_db();
    let (tip, state) = {
        let mut c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
        let shared = extend(&mut c, 1, Address([1; 20]));
        extend(&mut c, 299, Address([1; 20]));
        // What an old node would have stored: a long fork from block 1.
        let mut attacker = chain_from(p, &shared);
        let spam = extend(&mut attacker, 150, Address([66; 20]));
        drop(c);
        let s = Store::open(&path).unwrap();
        for b in &spam {
            s.put_block(&b.hash(), b).unwrap();
        }
        drop(s);
        let c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
        (c.tip().hash, c.state.clone())
    };
    let on_disk = stored_blocks(&path);
    assert_eq!(on_disk.len(), 300, "spam still on disk after a restart");
    let c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
    assert_eq!(c.tip().hash, tip);
    assert_eq!(c.state, state);
    assert_eq!(c.block_count(), 301);
    let _ = std::fs::remove_dir_all(dir);
}

/// A restart keeps the chain, and a near-tip side block, exactly as they were.
#[test]
fn restart_keeps_main_chain_and_near_tip_side_blocks() {
    let p = params();
    let (dir, path) = temp_db();
    let (tip, side_hash) = {
        let mut c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
        let shared = extend(&mut c, 20, Address([1; 20]));
        let mut f = chain_from(p, &shared);
        let side = extend(&mut f, 1, Address([2; 20])).remove(0);
        extend(&mut c, 1, Address([1; 20]));
        assert!(matches!(c.process_block(side.clone(), false).unwrap(), Outcome::SideChain));
        (c.tip().hash, side.hash())
    };
    let c = Chain::new(p, Some(Store::open(&path).unwrap())).unwrap();
    assert_eq!(c.tip().hash, tip);
    assert!(c.has_body(&side_hash));
    let _ = std::fs::remove_dir_all(dir);
}

// ---------- per-peer limits ----------

/// A node with `src`'s headers but none of its bodies, as after the header part of a sync.
fn headers_only(src: &Chain, peer: u64) -> Arc<Node> {
    let n = node(Chain::new(src.params, None).unwrap());
    let hs = src.headers_after_locator(&ask(&n, peer, src.cum_work()), MAX_HEADERS_PER_MSG);
    let next = n.on_headers_blocking(peer, hs);
    assert!(next.penalty.is_none() && next.bodies, "{next:?}");
    n
}

#[test]
fn headers_nobody_asked_for_are_refused() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    extend(&mut src, 30, Address([1; 20]));
    let n = node(Chain::new(p, None).unwrap());
    n.add_sync_peer(1, src.cum_work());
    let hs = src.headers_after_locator(&n.chain.lock().header_locator(1), MAX_HEADERS_PER_MSG);
    let next = n.on_headers_blocking(1, hs.clone());
    assert_eq!(next.penalty.map(|(points, _)| points), Some(20));
    assert_eq!(n.chain.lock().block_count(), 1);
    // Asked once, answered once; a second copy of the answer is unsolicited again.
    ask(&n, 1, 0);
    assert!(n.on_headers_blocking(1, hs.clone()).penalty.is_none());
    assert!(n.on_headers_blocking(1, hs).penalty.is_some());
}

/// However many announcements a peer sends, there's only ever one header request to it waiting.
#[test]
fn one_header_request_per_peer_at_a_time() {
    let p = params();
    let n = node(Chain::new(p, None).unwrap());
    n.add_sync_peer(1, 1_000);
    assert!(n.want_headers(1).is_some());
    for _ in 0..100 {
        assert!(n.want_headers(1).is_none());
    }
    assert!(n.want_headers(2).is_none(), "a peer we never shook hands with");
}

/// To be asked for headers, a peer has to say it has more work than us. One that says so and
/// then can't show it is lying: penalised, and none of its headers kept.
#[test]
fn peer_that_claims_more_work_than_it_has_is_penalised() {
    let p = params();
    let mut honest = Chain::new(p, None).unwrap();
    let shared = extend(&mut honest, 1, Address([1; 20]));
    extend(&mut honest, 299, Address([1; 20]));
    let mut attacker = chain_from(p, &shared);
    extend(&mut attacker, 150, Address([66; 20]));
    let n = node(honest);
    let claim = n.chain.lock().cum_work() + 1;

    let hs = attacker.headers_after_locator(&ask(&n, 1, claim), MAX_HEADERS_PER_MSG);
    let (points, why) = n.on_headers_blocking(1, hs).penalty.expect("the lie went unnoticed");
    assert_eq!(points, 100, "{why}");
    assert_eq!(n.chain.lock().pending_count(), 0);

    // Saying nothing at all doesn't get it off either.
    ask(&n, 2, claim);
    let (points, _) = n.on_headers_blocking(2, vec![]).penalty.expect("an empty answer to a big claim");
    assert_eq!(points, 100);
}

/// The other side of the rule: an honest peer whose last batch is exactly full, while we're still
/// collecting towards the assume-valid block, then answers with nothing. Its work is in what we
/// collected, not yet in our best header, and it must not be called a liar.
#[test]
fn honest_peer_ending_on_a_full_batch_is_not_called_a_liar() {
    let base = params();
    let mut src = Chain::new(base, None).unwrap();
    extend(&mut src, MAX_HEADERS_PER_MSG, Address([1; 20]));
    let p = params_with(|p| {
        p.assume_valid = Some((3 * MAX_HEADERS_PER_MSG as u64, [9; 32]));
        p.genesis_timestamp = base.genesis_timestamp;
    });
    let n = node(Chain::new(p, None).unwrap());
    let hs = src.headers_after_locator(&ask(&n, 1, src.cum_work()), MAX_HEADERS_PER_MSG);
    assert_eq!(hs.len(), MAX_HEADERS_PER_MSG);
    let next = n.on_headers_blocking(1, hs);
    assert!(next.penalty.is_none() && next.more_headers, "{next:?}");
    assert_eq!(n.chain.lock().pending_count(), MAX_HEADERS_PER_MSG, "should still be collecting");
    let hs = src.headers_after_locator(&ask(&n, 1, 0), MAX_HEADERS_PER_MSG);
    assert!(hs.is_empty());
    let next = n.on_headers_blocking(1, hs);
    assert!(next.penalty.is_none(), "{next:?}");
    assert_eq!(n.chain.lock().best_header().hash, src.tip().hash);
}

/// A peer that takes a header request and never answers loses the slot it was holding (so it
/// can't keep one of the two long-sync slots forever) and is penalised.
#[test]
fn unanswered_header_request_frees_the_peer_slot() {
    let p = params();
    let mut a = Chain::new(p, None).unwrap();
    let shared = extend(&mut a, 10, Address([1; 20]));
    let mut b = chain_from(p, &shared);
    extend(&mut a, 3000, Address([10; 20]));
    extend(&mut b, 3100, Address([20; 20]));
    let n = node(a);
    let hs = b.headers_after_locator(&ask(&n, 1, b.cum_work()), MAX_HEADERS_PER_MSG);
    assert!(n.on_headers_blocking(1, hs).more_headers);
    assert!(n.chain.lock().pending_count() > 0);
    ask(&n, 1, 0); // ...and never answered

    let t = Instant::now();
    assert!(n.sync_tick(t + Duration::from_secs(30)).penalties.is_empty(), "too early to give up");
    let tick = n.sync_tick(t + HEADERS_TIMEOUT + Duration::from_secs(1));
    assert!(tick.penalties.iter().any(|(peer, points, _)| *peer == 1 && *points == 50), "{tick:?}");
    assert_eq!(n.chain.lock().pending_count(), 0, "the slot is still held");
    assert!(n.want_headers(1).is_some());
}

/// One peer can't have more than MAX_BODIES_IN_FLIGHT bodies on order, however often we ask.
#[test]
fn bodies_in_flight_per_peer_are_capped() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    extend(&mut src, 400, Address([1; 20]));
    let n = headers_only(&src, 1);
    n.add_sync_peer(2, src.cum_work());
    let mut asked = 0;
    for _ in 0..20 {
        asked += n.take_body_requests(1, 64).len();
    }
    assert_eq!(asked, MAX_BODIES_IN_FLIGHT);
    // The rest go to another peer.
    assert_eq!(n.take_body_requests(2, 64).len(), 64);
}

/// Bodies are only taken from the peer we asked. A peer that lets a request run out is
/// penalised, the bodies go to someone else, and its late answer is no longer wanted.
#[test]
fn stalled_body_requests_move_to_another_peer() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    extend(&mut src, 100, Address([1; 20]));
    let n = headers_only(&src, 1);
    n.add_sync_peer(2, src.cum_work());
    let t = Instant::now();
    let want = n.take_body_requests_at(1, 64, t);
    assert_eq!(want.len(), 64);
    let first = src.bodies_for(&want[..1], usize::MAX).remove(0);
    assert!(!n.body_arrived(2, &first.hash()), "a body from a peer we didn't ask");
    assert!(!n.body_arrived(1, &[7; 32]), "a body nobody asked for");

    let later = t + BODY_TIMEOUT + Duration::from_secs(1);
    let tick = n.sync_tick(later);
    assert_eq!(tick.penalties.iter().filter(|(peer, points, _)| *peer == 1 && *points == 10).count(), 1);
    assert_eq!(n.sync.lock()[&1].stalls, 1);
    assert_eq!(tick.bodies_from, Some(2), "should prefer the peer that hasn't stalled");
    assert!(n.sync_tick(later).penalties.is_empty(), "one stall counted twice");

    // A late answer is still welcome while nobody else has been asked...
    let second = src.bodies_for(&want[1..2], usize::MAX).remove(0);
    assert!(n.body_arrived(1, &second.hash()));
    // ...but not once the request has gone to peer 2.
    let moved = n.take_body_requests_at(2, 64, later);
    assert!(moved.contains(&first.hash()));
    assert!(!n.body_arrived(1, &first.hash()));
    assert!(n.body_arrived(2, &first.hash()));
}

/// What a peer says about its height or work never moves our view of it; only blocks we've
/// checked do. (Before, a NewBlock with any height made that peer the one we synced from.)
#[test]
fn only_checked_blocks_move_a_peers_standing() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    extend(&mut src, 20, Address([1; 20]));
    let n = node(Chain::new(p, None).unwrap());
    n.add_sync_peer(1, 0);
    n.add_sync_peer(2, 0);
    n.peer_has_block(1, &[5; 32]);
    assert_eq!(n.sync.lock()[&1].claimed_work, 0);
    let tick = n.sync_tick(Instant::now());
    assert_eq!(tick.headers_from, None, "nobody has shown more work than us");

    // Peer 2 sends a real block: now it has shown work, and it's the one to ask.
    let b = src.block(&src.hash_at(1).unwrap()).unwrap().as_ref().clone();
    n.submit_block_blocking(b.clone()).unwrap();
    n.peer_has_block(2, &b.hash());
    assert_eq!(n.sync.lock()[&2].claimed_work, n.chain.lock().cum_work());
    n.add_sync_peer(3, src.cum_work()); // claims more at the handshake
    assert_eq!(n.sync_tick(Instant::now()).headers_from, Some(3));
}

/// The whole point of sampling proof of work on arrival: a header that gets kept, or whose body
/// we go on to ask for, has had its RandomX checked in full by then. Nothing is taken on trust
/// because it happened to miss the spot-check.
///
/// This drives the same steps `Node::on_headers_blocking` does, but records every hash whose
/// proof of work was actually checked, and compares that with the headers in the block tree.
#[test]
fn every_kept_header_has_had_its_proof_of_work_checked() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    // More than two full batches, so the sampling has thousands of chances to skip a header.
    extend(&mut src, 4500, Address([1; 20]));

    let mut c = Chain::new(p, None).unwrap();
    let mut verified: Vec<lokyx::crypto::Hash> = Vec::new();
    let mut sampled_on_arrival = 0usize;
    loop {
        let hs = src.headers_after_locator(&c.header_locator(1), MAX_HEADERS_PER_MSG);
        let done = hs.len() < MAX_HEADERS_PER_MSG;
        let Staged::Verify { jobs, .. } = c.stage_headers(1, &hs).unwrap() else { panic!("busy") };
        sampled_on_arrival += jobs.len();
        let ok = Chain::verify_pow_jobs(&jobs).unwrap();
        verified.extend(&ok);
        match c.judge_pending(1, done, &ok) {
            Judgement::NeedMore => continue,
            Judgement::Commit(jobs) => {
                let ok = Chain::verify_pow_jobs(&jobs).unwrap();
                verified.extend(&ok);
                let before = c.block_count();
                let n = c.commit_pending(1, &ok).unwrap();
                assert_eq!(c.block_count(), before + n);
                // Every header now in the tree (bar genesis) has been through a real check.
                let mut at = c.best_header().clone();
                while at.header.height > 0 {
                    assert!(
                        verified.contains(&at.hash),
                        "header {} was kept without its proof of work being checked",
                        at.header.height
                    );
                    at = c.meta(&at.header.prev_hash).expect("parent of a kept header").clone();
                }
                // ...and only then are bodies asked for.
                for want in c.missing_bodies(64) {
                    assert!(verified.contains(&want), "a body was requested for an unchecked header");
                }
                if done {
                    break;
                }
            }
            j => panic!("{j:?}"),
        }
    }
    assert_eq!(c.best_header().header.height, 4500);
    // The sampling really did skip most of them on arrival: that's where the saving comes from.
    assert!(sampled_on_arrival < 4500 / 4, "{sampled_on_arrival} of 4500 were checked on arrival");
}

/// The guard behind that: committing headers without having checked their proof of work is
/// refused outright, so the sampling can never be short-circuited by a caller's mistake.
#[test]
fn committing_unchecked_headers_is_refused() {
    let p = params();
    let mut src = Chain::new(p, None).unwrap();
    extend(&mut src, 40, Address([1; 20]));
    let hs = src.headers_after_locator(&[src.genesis_hash()], MAX_HEADERS_PER_MSG);

    let mut c = Chain::new(p, None).unwrap();
    let Staged::Verify { jobs, .. } = c.stage_headers(1, &hs).unwrap() else { panic!("busy") };
    let ok = Chain::verify_pow_jobs(&jobs).unwrap();
    let Judgement::Commit(jobs) = c.judge_pending(1, true, &ok) else { panic!("should want to keep them") };
    assert!(!jobs.is_empty(), "most headers should still need checking");

    // Pretending the jobs passed, without running them.
    let lie: Vec<lokyx::crypto::Hash> = vec![];
    match c.commit_pending(1, &lie) {
        Err(BlockError::Internal(e)) => assert!(e.contains("proof of work"), "{e}"),
        o => panic!("expected a refusal, got {o:?}"),
    }
    assert_eq!(c.block_count(), 1, "nothing was kept");

    // And a commit nobody judged is refused too.
    let mut c = Chain::new(p, None).unwrap();
    c.stage_headers(1, &hs).unwrap();
    match c.commit_pending(1, &hs.iter().map(|h| h.hash()).collect::<Vec<_>>()) {
        Err(BlockError::Internal(e)) => assert!(e.contains("Commit judgement"), "{e}"),
        o => panic!("expected a refusal, got {o:?}"),
    }
    assert_eq!(c.block_count(), 1);
}
