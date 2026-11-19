//! Transaction format v2: what decodes, what is refused, expiry, batches, memos.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::tx::{MAX_BATCH, Op, Params, Sig, SignedTransaction, Transaction, build_op, build_transfer, build_with};
use rand::rngs::OsRng;

const MINER: Address = Address([7; 20]);

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

fn funded() -> (State, SigningKey, Address) {
    let sk = SigningKey::random(&mut OsRng);
    let a = address_of(&sk);
    let mut s = State::default();
    for h in 1..=10 {
        s.apply_body(h, a, &[], params()).unwrap();
    }
    (s, sk, a)
}

fn bob() -> Address {
    Address([2; 20])
}

#[test]
fn a_plain_transfer_is_small() {
    let (_, sk, _) = funded();
    let t = build_transfer(&sk, params(), 0, bob(), COIN, None).unwrap();
    // version 1, chain 8, from 20, nonce 8, expires 8, fee 16, memo 4, op 1+20+16, sig 1+64+1
    assert_eq!(t.size(), 1 + 8 + 20 + 8 + 8 + 16 + 4 + 37 + 66);
}

#[test]
fn decoding_refuses_what_it_does_not_know() {
    let (_, sk, _) = funded();
    let t = build_transfer(&sk, params(), 0, bob(), COIN, None).unwrap();
    let bytes = t.to_bytes();
    assert_eq!(SignedTransaction::from_bytes(&bytes).unwrap(), t);

    // an operation tag that doesn't exist
    let mut b = bytes.clone();
    b[65] = 200;
    assert!(SignedTransaction::from_bytes(&b).unwrap_err().contains("malformed"));
    // a signature scheme that doesn't exist: the tag is the byte after the operation
    let mut b = bytes.clone();
    let sig_tag = bytes.len() - 66;
    b[sig_tag] = 1;
    assert!(SignedTransaction::from_bytes(&b).unwrap_err().contains("malformed"));
    // trailing bytes
    let mut b = bytes.clone();
    b.push(0);
    assert!(SignedTransaction::from_bytes(&b).is_err());
    // cut short
    assert!(SignedTransaction::from_bytes(&bytes[..bytes.len() - 1]).is_err());

    // a version that isn't 2 is refused by the stateless check, even correctly signed
    let mut tx: Transaction = t.tx.clone();
    tx.version = 3;
    let v3 = tx.sign(&sk).unwrap();
    assert!(v3.check_stateless(params()).unwrap_err().contains("version"));
    // and a memo over the limit
    let big = build_with(
        &sk,
        params(),
        Params { memo: vec![1; 65], ..Default::default() },
        Op::Transfer { to: bob(), value: 1 },
    )
    .unwrap();
    assert!(big.check_stateless(params()).unwrap_err().contains("memo"));
    let ok = build_with(
        &sk,
        params(),
        Params { memo: vec![1; 64], ..Default::default() },
        Op::Transfer { to: bob(), value: 1 },
    )
    .unwrap();
    ok.check_stateless(params()).unwrap();
    let _ = Sig::Secp256k1Recoverable { signature: [0; 64], recovery_id: 0 };
}

#[test]
fn a_signature_from_another_key_does_not_act_on_the_account() {
    let (s, sk, a) = funded();
    let thief = SigningKey::random(&mut OsRng);
    // the thief signs a transaction that names the victim's account
    let mut tx = build_transfer(&sk, params(), 0, bob(), COIN, None).unwrap().tx;
    tx.from = a;
    let forged = tx.sign(&thief).unwrap();
    let mut s2 = s.clone();
    let e = s2.apply_body(11, MINER, std::slice::from_ref(&forged), params()).unwrap_err();
    assert!(e.contains("isn't from the key that controls"), "{e}");
    assert!(Mempool::default().add(forged, &s, params()).unwrap_err().contains("controls"));
    assert_eq!(s2.account(&bob()).balance, 0);
}

#[test]
fn expiry_is_the_last_height_a_transaction_can_be_included_at() {
    let (s, sk, _) = funded();
    let p = params();
    let t = |nonce, expires| {
        build_with(&sk, p, Params { nonce, expires, ..Default::default() }, Op::Transfer { to: bob(), value: 1 })
            .unwrap()
    };
    // included at 15 with expires 15: fine. At 16: refused.
    let ok = t(0, 15);
    let mut a = s.clone();
    a.apply_body(15, MINER, std::slice::from_ref(&ok), p).unwrap();
    let mut b = s.clone();
    b.apply_body(15, MINER, &[], p).unwrap();
    let e = b.apply_body(16, MINER, std::slice::from_ref(&ok), p).unwrap_err();
    assert!(e.contains("expired"), "{e}");
    // zero means never
    let never = t(0, 0);
    let mut c = s.clone();
    c.apply_body(1_000_000, MINER, &[never], p).unwrap();

    // the mempool turns away what is already too late, and drops what becomes too late, with the
    // sender's later nonces (nothing after a gap could be mined)
    let mut st = s.clone();
    st.height = 10;
    let mut mp = Mempool::default();
    mp.add(t(0, 12), &st, p).unwrap();
    mp.add(t(1, 0), &st, p).unwrap();
    assert!(mp.add(t(2, 10), &st, p).unwrap_err().contains("expired"));
    assert_eq!(mp.len(), 2);
    let mut later = st.clone();
    later.apply_body(11, MINER, &[], p).unwrap();
    later.apply_body(12, MINER, &[], p).unwrap();
    later.apply_body(13, MINER, &[], p).unwrap();
    mp.on_new_tip(&later, p, vec![]);
    assert_eq!(mp.len(), 0, "the expired one and the one behind it should be gone");
    // a block with the expired one in it is never assembled
    let mut mp = Mempool::default();
    mp.add(t(0, 11), &st, p).unwrap();
    assert_eq!(mp.select(&st, p).len(), 1);
    assert_eq!(mp.select(&later, p).len(), 0);
}

#[test]
fn batches_pay_everyone_in_one_transaction_and_refuse_bad_ones() {
    let (s, sk, a) = funded();
    let p = params();
    let (c, d) = (Address([3; 20]), Address([4; 20]));
    let t = build_op(&sk, p, 0, Op::Batch(vec![(bob(), COIN), (c, 2 * COIN), (d, 3)])).unwrap();
    let mut s2 = s.clone();
    let before = s2.account(&a).balance;
    s2.apply_body(11, MINER, std::slice::from_ref(&t), p).unwrap();
    assert_eq!(s2.account(&bob()).balance, COIN);
    assert_eq!(s2.account(&c).balance, 2 * COIN);
    assert_eq!(s2.account(&d).balance, 3);
    assert_eq!(s2.account(&a).balance, before - (3 * COIN + 3) - t.tx.fee);
    assert_eq!(s2.account(&a).nonce, 1);
    assert_eq!(s2.circulating(), s2.issued);

    let bad = |v: Vec<(Address, u128)>| build_op(&sk, p, 0, Op::Batch(v)).unwrap().check_stateless(p).unwrap_err();
    assert!(bad(vec![]).contains("1 to"));
    assert!(bad(vec![(bob(), 1); MAX_BATCH + 1]).contains("1 to"));
    assert!(bad(vec![(bob(), 1), (c, 0)]).contains("zero"));
    let m = bad(vec![(bob(), u128::MAX), (c, 1)]);
    assert!(m.contains("batch total overflows"), "{m}");
    assert!(bad(vec![(bob(), 1), (lokyx::swap::SWAP_ADDRESS, 1)]).contains("system"));
    // the largest batch is accepted
    build_op(&sk, p, 0, Op::Batch(vec![(bob(), 1); MAX_BATCH])).unwrap().check_stateless(p).unwrap();
    // more than the account holds: nothing is paid
    let over = build_op(&sk, p, 0, Op::Batch(vec![(bob(), 60 * COIN), (c, 60 * COIN)])).unwrap();
    let mut s3 = s.clone();
    assert!(s3.apply_body(11, MINER, &[over], p).unwrap_err().contains("insufficient"));
}

#[test]
fn plain_payments_cannot_go_to_a_system_address_or_a_contract() {
    let (s, sk, _) = funded();
    let p = params();
    let to_sys = build_transfer(&sk, p, 0, lokyx::vault::VAULT_ADDRESS, 1, None).unwrap();
    assert!(to_sys.check_stateless(p).unwrap_err().contains("system address"));
    let mut s2 = s.clone();
    let c = Address([0xcc; 20]);
    s2.contracts
        .insert(c, lokyx::contract::ContractInfo { code: [1; 32], abi: [2; 32], creator: Address([1; 20]), height: 1 });
    let t = build_transfer(&sk, p, 0, c, 1, None).unwrap();
    assert!(s2.apply_body(11, MINER, &[t], p).unwrap_err().contains("is a contract"));
}
