//! A fixed scenario touching every part of the state, with the root after every block recorded.
//!
//! The roots below were taken from the code as it stood before the state's internals were
//! reworked (undo logs, a journaled store). They are what the testnet's headers commit to, so a
//! change of internals that moves any of them would fork the chain. This test is the guard on
//! that: if it fails, the state commitment changed, and that is never an acceptable side effect.
//!
//! The values were regenerated for the Phase 4 format freeze (transaction format v2, then the
//! trie root and the new state sections). They moved because transactions got longer, so fees,
//! and with them balances, changed, and because swap and vault ids are transaction hashes. Nothing
//! else about how the state is built or hashed changed in that step.
//!
//! They were regenerated once more for header v2, when the root a header commits to became the
//! trie root (the flat hash is gone), and a third time when the scenario gained key rotation
//! (sections 9 and 10, a vault account moving to a new key). Regenerating them is
//! sanctioned only for a deliberate format change, and only in its own commit.

use k256::ecdsa::SigningKey;
use lokyx::abi;
use lokyx::address::Address;
use lokyx::contract::{build_call, build_deploy};
use lokyx::crypto::{Hash, keccak256};
use lokyx::keys::address_of;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pqkey::{KeyOp, build as build_key};
use lokyx::state::State;
use lokyx::swap::{build_claim, build_lock, sha256};
use lokyx::timelock::TimelockOp;
use lokyx::token::TokenOp;
use lokyx::tx::{Op, Params, SignedTransaction, build_from, build_op, build_transfer};
use lokyx::vault::{VaultOp, VaultSettings, blocks_for, build as build_vault};
use serde_json::json;

fn key(n: u8) -> SigningKey {
    SigningKey::from_bytes((&[n; 32]).into()).unwrap()
}

/// One block of the scenario: height, miner, transactions.
pub type Blk = (u64, Address, Vec<SignedTransaction>);

/// Every block of the scenario, applied to a fresh state; returns the root after each.
pub fn scenario(p: &ChainParams) -> (State, Vec<Hash>, Vec<Blk>) {
    let (ak, bk, rk, qk, nk) = (key(1), key(2), key(3), key(4), key(5));
    let (a, b, r, q) = (address_of(&ak), address_of(&bk), address_of(&rk), address_of(&qk));
    let miner = Address([7; 20]);
    let mut blocks: Vec<Blk> = vec![];
    let mut s = State::default();
    let mut roots = vec![];
    let mut h = 0u64;
    let mut push = |s: &mut State, miner: Address, txs: Vec<SignedTransaction>, roots: &mut Vec<Hash>| {
        h += 1;
        s.apply_body(h, miner, &txs, p).unwrap();
        assert_eq!(s.circulating() + s.burned, s.issued);
        // The trie kept in the state, brought up to date from what changed, must equal the root
        // built from nothing, after every block of every section.
        let inc = s.root_incremental();
        assert_eq!(inc, s.root(), "incremental root at height {h}");
        assert!(s.release_index_consistent(), "release index at height {h}");
        roots.push(inc);
        blocks.push((h, miner, txs));
    };
    // rewards for a and b, some empty blocks while rewards mature
    push(&mut s, a, vec![], &mut roots);
    push(&mut s, b, vec![], &mut roots);
    for who in [a, q, miner] {
        push(&mut s, who, vec![], &mut roots);
    }
    // transfers
    let t0 = build_transfer(&ak, p, 0, b, 2 * COIN, None).unwrap();
    let t1 = build_transfer(&ak, p, 1, Address([9; 20]), COIN, None).unwrap();
    push(&mut s, miner, vec![t0, t1], &mut roots);
    // a swap lock, then its claim, and a second lock left open
    let secret = [5u8; 32];
    let lock = build_lock(&ak, p, 2, COIN, sha256(&secret), b, 500).unwrap();
    let lock_id = lock.hash();
    let lock2 = build_lock(&ak, p, 3, COIN, sha256(b"other"), b, 600).unwrap();
    push(&mut s, miner, vec![lock, lock2], &mut roots);
    let claim = build_claim(&bk, p, 0, lock_id, secret).unwrap();
    push(&mut s, miner, vec![claim], &mut roots);
    // a vault with a withdrawal pending, a post-quantum commitment
    let settings = VaultSettings {
        recovery: r,
        safe: Address([9; 20]),
        delay: blocks_for(86_400, p),
        allowance: COIN,
        heir: None,
    };
    let create = build_vault(&bk, p, 1, VaultOp::Create(settings)).unwrap();
    push(&mut s, miner, vec![create], &mut roots);
    let w = build_vault(&bk, p, 2, VaultOp::Withdraw { to: Address([9; 20]), amount: COIN / 2 }).unwrap();
    let pq = build_key(&ak, p, 4, KeyOp::CommitPq { hash: [3; 32] }).unwrap();
    push(&mut s, miner, vec![w, pq], &mut roots);
    // a contract with storage, called twice
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/contracts/");
    let code = std::fs::read(format!("{dir}counter.wasm")).unwrap();
    let abi_text = std::fs::read_to_string(format!("{dir}counter.abi.json")).unwrap();
    let spec = abi::parse(&abi_text).unwrap();
    let dep =
        build_deploy(&ak, p, 5, code, abi_text, abi::encode_deploy(&spec, &[json!(1)]).unwrap(), 2_000_000, 0).unwrap();
    let c = lokyx::contract::contract_address(&a, 5);
    push(&mut s, miner, vec![dep], &mut roots);
    let inc = |n| build_call(&ak, p, n, c, abi::encode_call(&spec, "increment", &[]).unwrap(), 200_000, 0).unwrap();
    push(&mut s, miner, vec![inc(6), inc(7)], &mut roots);
    // a token made, some of it sent away, and two timelocks: one claimed (by the vault's owner),
    // one left open
    let token = build_op(
        &ak,
        p,
        8,
        Op::Token(TokenOp::Create { symbol: "GOLD".into(), name: "Gold".into(), decimals: 6, supply: 1_000_000 }),
    )
    .unwrap();
    let token_id = token.hash();
    let send = build_op(&ak, p, 9, Op::Token(TokenOp::Transfer { token: token_id, to: Address([9; 20]), amount: 250 }))
        .unwrap();
    let lock_a =
        build_op(&ak, p, 10, Op::Timelock(TimelockOp::Lock { beneficiary: b, amount: COIN, unlock_height: 15 }))
            .unwrap();
    let lock_a_id = lock_a.hash();
    let lock_b = build_op(
        &ak,
        p,
        11,
        Op::Timelock(TimelockOp::Lock { beneficiary: Address([9; 20]), amount: 2 * COIN, unlock_height: 400 }),
    )
    .unwrap();
    push(&mut s, miner, vec![token, send, lock_a, lock_b], &mut roots);
    push(&mut s, miner, vec![], &mut roots);
    let claim = build_op(&bk, p, 3, Op::Timelock(TimelockOp::Claim { id: lock_a_id })).unwrap();
    push(&mut s, miner, vec![claim], &mut roots);
    for _ in 0..3 {
        push(&mut s, miner, vec![], &mut roots);
    }
    // key rotation: q becomes a vault with a one-hour delay, then hands its account to a new key;
    // `a` starts a rotation that is still waiting when the scenario ends
    let hour = blocks_for(3600, p);
    let qset = VaultSettings { recovery: r, safe: Address([9; 20]), delay: hour, allowance: COIN, heir: None };
    let qv = build_vault(&qk, p, 0, VaultOp::Create(qset)).unwrap();
    push(&mut s, miner, vec![qv], &mut roots);
    let new_q = address_of(&nk);
    let rot_q = build_key(&qk, p, 1, KeyOp::Rotate { new_key: new_q }).unwrap();
    let rot_a = build_key(&ak, p, 12, KeyOp::Rotate { new_key: Address([0x44; 20]) }).unwrap();
    push(&mut s, miner, vec![rot_q, rot_a], &mut roots);
    assert_eq!(s.key_pending.len(), 2);
    for _ in 0..hour {
        push(&mut s, miner, vec![], &mut roots);
    }
    assert_eq!(s.controller(&q), new_q, "the rotation has taken effect");
    // the new key spends from q (a payment inside the vault's allowance), the old key can't
    let pay = |k: &SigningKey, nonce| {
        build_from(
            k,
            q,
            p,
            Params { nonce, ..Default::default() },
            Op::Transfer { to: Address([9; 20]), value: COIN / 4 },
        )
        .unwrap()
    };
    assert!(s.clone().apply_body(s.height + 1, miner, &[pay(&qk, 2)], p).is_err());
    push(&mut s, miner, vec![pay(&nk, 2)], &mut roots);
    (s, roots, blocks)
}

pub fn params() -> ChainParams {
    ChainParams { coinbase_maturity: 2, ..DEVNET.clone() }
}

#[test]
fn state_roots_match_the_ones_the_testnet_commits_to() {
    let p = params();
    let (s, roots, _) = scenario(&p);
    assert!(!s.storage.is_empty() && !s.swaps.is_empty() && !s.pending.is_empty());
    assert!(!s.vaults.is_empty() && !s.pq.is_empty() && !s.contracts.is_empty());
    assert!(!s.tokens.is_empty() && !s.token_balances.is_empty() && !s.timelocks.is_empty() && s.burned > 0);
    assert!(!s.keys.is_empty() && !s.key_pending.is_empty());
    let mut all = Vec::new();
    for r in &roots {
        all.extend_from_slice(r);
    }
    let digest = hex::encode(keccak256(&all));
    println!("GOLDEN {digest} last {}", hex::encode(roots.last().unwrap()));
    assert_eq!(digest, GOLDEN_DIGEST);
    assert_eq!(hex::encode(roots.last().unwrap()), GOLDEN_LAST);
}

const GOLDEN_DIGEST: &str = "5a9594fa72ca380d59d5daeeb27598af8c9c0135d1b74065ece3b39e279912e8";
const GOLDEN_LAST: &str = "006029b5e7002efbe1ba0f505102532c2cdd4f04c279922872ccd30b3541a369";

// ---------- the state as a trie ----------

use lokyx::trie::{Trie, verify};

#[test]
fn the_state_trie_proves_balances_and_what_is_not_there() {
    let p = params();
    let (s, _, _) = scenario(&p);
    let t = s.trie();
    let root = t.root();
    let entries = s.trie_entries();
    assert_eq!(t.len(), entries.len());
    assert_eq!(root, Trie::reference_root(&entries), "the incremental trie and the reference agree");

    // Every account has a proof that checks out against the root, to exactly its entry.
    assert!(s.accounts.len() > 4);
    for (a, acc) in &s.accounts {
        let (k, v) = State::account_entry(a, acc);
        assert_eq!(verify(&root, &k, &t.prove(&k)), Ok(Some(v)));
    }
    // An account that doesn't exist is provably absent, and a proof for someone else's balance
    // doesn't show up as this one's.
    let nobody = Address([0xee; 20]);
    let k = State::account_key(&nobody);
    assert_eq!(verify(&root, &k, &t.prove(&k)), Ok(None));
    let (alice, acc) = s.accounts.iter().next().unwrap();
    let (ka, _) = State::account_entry(alice, acc);
    assert!(verify(&root, &k, &t.prove(&ka)).is_err());
}

#[test]
fn every_part_of_the_state_moves_the_trie_root() {
    let p = params();
    let (s, _, _) = scenario(&p);
    let root = s.trie().root();
    let moved = |f: &dyn Fn(&mut State)| {
        let mut x = s.clone();
        f(&mut x);
        x.trie().root() != root
    };
    let a = *s.accounts.keys().next().unwrap();
    assert!(moved(&|x| x.accounts.get_mut(&a).unwrap().balance += 1));
    assert!(moved(&|x| x.accounts.get_mut(&a).unwrap().nonce += 1));
    assert!(moved(&|x| x.issued += 1));
    assert!(moved(&|x| {
        let k = *x.immature.keys().next().unwrap();
        x.immature.get_mut(&k).unwrap().1 += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.swaps.keys().next().unwrap();
        x.swaps.get_mut(&k).unwrap().amount += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.vaults.keys().next().unwrap();
        x.vaults.get_mut(&k).unwrap().spent += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.pending.keys().next().unwrap();
        x.pending.get_mut(&k).unwrap().release += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.pq.keys().next().unwrap();
        x.pq.get_mut(&k).unwrap()[0] ^= 1;
    }));
    assert!(moved(&|x| {
        let k = *x.contracts.keys().next().unwrap();
        x.storage.put(k, b"count".to_vec(), Some(vec![9; 8]));
    }));
    assert!(moved(&|x| {
        let c = *x.storage.keys().next().unwrap();
        x.storage.put(c, b"extra".to_vec(), Some(vec![1]));
    }));
    assert!(moved(&|x| x.burned += 1));
    assert!(moved(&|x| {
        let k = *x.keys.keys().next().unwrap();
        x.keys.insert(k, Address([0xab; 20]));
    }));
    assert!(moved(&|x| {
        let k = *x.key_pending.keys().next().unwrap();
        x.key_pending.get_mut(&k).unwrap().release += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.key_pending.keys().next().unwrap();
        x.key_pending.remove(&k);
    }));
    assert!(moved(&|x| {
        let k = *x.timelocks.keys().next().unwrap();
        x.timelocks.get_mut(&k).unwrap().unlock_height += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.tokens.keys().next().unwrap();
        x.tokens.get_mut(&k).unwrap().decimals += 1;
    }));
    assert!(moved(&|x| {
        let k = *x.token_balances.keys().next().unwrap();
        *x.token_balances.get_mut(&k).unwrap() += 1;
    }));
    // and so does anything being removed
    assert!(moved(&|x| {
        let k = *x.swaps.keys().next().unwrap();
        x.swaps.remove(&k);
    }));
    assert!(moved(&|x| {
        let k = *x.timelocks.keys().next().unwrap();
        x.timelocks.remove(&k);
    }));
    assert!(moved(&|x| {
        let k = *x.token_balances.keys().next().unwrap();
        x.token_balances.remove(&k);
    }));
    assert!(!moved(&|_| {}));
}

// ---------- undo ----------

/// Apply every block of the scenario while noting what each one changed; then take them off one at
/// a time, from the tip back, checking the state against a copy taken before that block went on.
#[test]
fn undoing_each_block_gives_back_the_state_before_it() {
    let p = params();
    let (end, roots, blocks) = scenario(&p);
    let mut s = State::default();
    let mut before = vec![];
    let mut undos = vec![];
    for (h, miner, txs) in &blocks {
        before.push(s.clone());
        s.record();
        s.apply_body(*h, *miner, txs, &p).unwrap();
        undos.push(s.finish());
        assert_eq!(s.root(), roots[*h as usize - 1], "recording must not change what a block does");
    }
    assert_eq!(s, end);
    for (b, u) in before.into_iter().zip(undos).rev() {
        s.undo(u);
        assert_eq!(s, b);
        assert_eq!(s.root(), b.root());
    }
    assert_eq!(s, State::default());
}

/// A block that fails half way leaves changes behind; the note taken while it ran puts them back.
#[test]
fn a_block_that_fails_part_way_can_be_taken_back() {
    let p = params();
    let (end, _, blocks) = scenario(&p);
    let ak = key(1);
    let mut s = end.clone();
    let next = blocks.len() as u64 + 1;
    // One good transfer, then one that can't be paid for: the first has already changed balances.
    let n = s.account(&address_of(&ak)).nonce;
    let good = build_transfer(&ak, &p, n, Address([4; 20]), COIN / 10, None).unwrap();
    let broke = build_transfer(&ak, &p, n + 1, Address([5; 20]), 10_000 * COIN, None).unwrap();
    s.record();
    let r = s.apply_body(next, Address([7; 20]), &[good, broke], &p);
    assert!(r.is_err());
    assert_ne!(s, end, "the failed block did leave changes");
    let u = s.finish();
    s.undo(u);
    assert_eq!(s, end);
    assert_eq!(s.root(), end.root());
}

/// Recording is off unless asked for: a state nobody is recording keeps no notes.
#[test]
fn copies_do_not_record() {
    let p = params();
    let (end, _, blocks) = scenario(&p);
    let mut s = end.clone();
    s.record();
    let mut copy = s.clone();
    let before = copy.clone();
    copy.apply_body(blocks.len() as u64 + 1, Address([7; 20]), &[], &p).unwrap();
    let u = copy.finish();
    copy.undo(u);
    // `copy` never recorded, so `finish` had nothing to give back and `undo` changed nothing.
    assert_ne!(copy, before);
}
