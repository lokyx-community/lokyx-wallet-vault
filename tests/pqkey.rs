//! Quantum key commitments: set once, paid like a normal tx, and invisible to the state root
//! until the first one exists (so the running testnet didn't need a reset).

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pqkey::{KeyOp, build};
use lokyx::state::State;
use rand::rngs::OsRng;

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}
const MINER: Address = Address([7; 20]);

#[test]
fn commit_once_and_never_change_it() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let a = address_of(&sk);
    let mut s = State::default();
    s.apply_body(1, a, &[], p).unwrap();
    let before = s.root();
    let mut empty_pq = s.clone();
    empty_pq.pq.clear();
    assert_eq!(empty_pq.root(), before, "no commitments, same root as before the feature");

    let t = build(&sk, p, 0, KeyOp::CommitPq { hash: [9; 32] }).unwrap();
    let fee = t.tx.fee;
    s.apply_body(2, MINER, &[t], p).unwrap();
    assert_eq!(s.pq[&a], [9; 32]);
    assert_eq!(s.account(&a).balance, 10 * COIN - fee);
    assert_eq!(s.circulating(), s.issued);

    // a thief with the ECDSA key can't replace it
    let again = build(&sk, p, 1, KeyOp::CommitPq { hash: [6; 32] }).unwrap();
    let e = s.clone().apply_body(3, MINER, std::slice::from_ref(&again), p).unwrap_err();
    assert!(e.contains("can't be changed"), "{e}");
    let mut mp = Mempool::default();
    assert!(mp.add(again, &s, p).unwrap_err().contains("can't be changed"));
}

#[test]
fn the_root_commits_to_it_and_bad_ops_are_refused() {
    let p = params();
    let sk = SigningKey::random(&mut OsRng);
    let a = address_of(&sk);
    let mut s = State::default();
    s.apply_body(1, a, &[], p).unwrap();
    let mut x = s.clone();
    let mut y = s.clone();
    x.pq.insert(a, [1; 32]);
    y.pq.insert(a, [2; 32]);
    assert_ne!(x.root(), y.root());
    assert_ne!(x.root(), s.root());

    // an empty account can't pay the fee (a key op has no value to carry)
    let poor = SigningKey::random(&mut OsRng);
    let t = build(&poor, p, 0, KeyOp::CommitPq { hash: [1; 32] }).unwrap();
    assert!(s.clone().apply_body(2, MINER, &[t], p).unwrap_err().contains("insufficient"));

    // only one pending at a time
    let mut mp = Mempool::default();
    s.height = 1;
    mp.add(build(&sk, p, 0, KeyOp::CommitPq { hash: [1; 32] }).unwrap(), &s, p).unwrap();
    let e = mp.add(build(&sk, p, 1, KeyOp::CommitPq { hash: [2; 32] }).unwrap(), &s, p).unwrap_err();
    assert!(e.contains("already pending"), "{e}");
}
