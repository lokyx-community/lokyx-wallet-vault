//! Swap lock / claim / refund rules.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::swap::{MAX_LOCK_BLOCKS, build_claim, build_lock, build_refund, sha256};

use rand::rngs::OsRng;

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

struct Setup {
    p: &'static ChainParams,
    s: State,
    alice: SigningKey,
    a: Address,
    bob: SigningKey,
    b: Address,
    secret: [u8; 32],
}

/// Alice mines 10 LYX at height 1. Bob has nothing.
fn setup() -> Setup {
    let p = params();
    let alice = SigningKey::random(&mut OsRng);
    let bob = SigningKey::random(&mut OsRng);
    let (a, b) = (address_of(&alice), address_of(&bob));
    let mut s = State::default();
    s.apply_body(1, a, &[], p).unwrap();
    Setup { p, s, alice, a, bob, b, secret: rand::random() }
}

const MINER: Address = Address([7; 20]);

#[test]
fn lock_then_claim_pays_the_recipient() {
    let mut t = setup();
    let lock = build_lock(&t.alice, t.p, 0, 4 * COIN, sha256(&t.secret), t.b, 20).unwrap();
    let id = lock.hash();
    t.s.apply_body(2, MINER, std::slice::from_ref(&lock), t.p).unwrap();
    assert_eq!(t.s.account(&t.a).balance, 6 * COIN - lock.tx.fee);
    assert_eq!(t.s.swaps[&id].amount, 4 * COIN);
    assert_eq!(t.s.circulating(), t.s.issued, "locked coins still count");

    // Bob has 0 LYX but can claim: the fee comes out of the lock.
    assert_eq!(t.s.account(&t.b).balance, 0);
    let claim = build_claim(&t.bob, t.p, 0, id, t.secret).unwrap();
    t.s.apply_body(3, MINER, std::slice::from_ref(&claim), t.p).unwrap();
    assert_eq!(t.s.account(&t.b).balance, 4 * COIN - claim.tx.fee);
    assert!(t.s.swaps.is_empty());
    assert_eq!(t.s.circulating(), t.s.issued);

    // Can't claim twice.
    let again = build_claim(&t.bob, t.p, 1, id, t.secret).unwrap();
    assert!(t.s.clone().apply_body(4, MINER, &[again], t.p).unwrap_err().contains("no open swap"));
}

#[test]
fn claim_needs_the_right_secret_the_right_person_and_time() {
    let mut t = setup();
    let lock = build_lock(&t.alice, t.p, 0, 4 * COIN, sha256(&t.secret), t.b, 10).unwrap();
    let id = lock.hash();
    t.s.apply_body(2, MINER, &[lock], t.p).unwrap();

    let wrong = build_claim(&t.bob, t.p, 0, id, [9; 32]).unwrap();
    assert!(t.s.clone().apply_body(3, MINER, &[wrong], t.p).unwrap_err().contains("wrong swap secret"));

    // Alice knows the secret but she isn't the recipient.
    let thief = build_claim(&t.alice, t.p, 1, id, t.secret).unwrap();
    assert!(t.s.clone().apply_body(3, MINER, &[thief], t.p).unwrap_err().contains("only the swap recipient"));

    // At the refund height the claim window has closed.
    let late = build_claim(&t.bob, t.p, 0, id, t.secret).unwrap();
    assert!(t.s.clone().apply_body(10, MINER, std::slice::from_ref(&late), t.p).unwrap_err().contains("expired"));
    // One block earlier it's fine.
    t.s.apply_body(9, MINER, &[late], t.p).unwrap();
}

#[test]
fn refund_only_for_the_sender_and_only_after_the_height() {
    let mut t = setup();
    let lock = build_lock(&t.alice, t.p, 0, 4 * COIN, sha256(&t.secret), t.b, 10).unwrap();
    let id = lock.hash();
    t.s.apply_body(2, MINER, std::slice::from_ref(&lock), t.p).unwrap();

    let early = build_refund(&t.alice, t.p, 1, id).unwrap();
    assert!(
        t.s.clone().apply_body(9, MINER, std::slice::from_ref(&early), t.p).unwrap_err().contains("before block 10")
    );

    let bob_refund = build_refund(&t.bob, t.p, 0, id).unwrap();
    assert!(t.s.clone().apply_body(10, MINER, &[bob_refund], t.p).unwrap_err().contains("only whoever locked"));

    let before = t.s.account(&t.a).balance;
    t.s.apply_body(10, MINER, std::slice::from_ref(&early), t.p).unwrap();
    assert_eq!(t.s.account(&t.a).balance, before + 4 * COIN - early.tx.fee);
    assert!(t.s.swaps.is_empty());
    assert_eq!(t.s.circulating(), t.s.issued);
}

#[test]
fn bad_locks_are_rejected() {
    let t = setup();
    let h = sha256(&t.secret);
    let past = build_lock(&t.alice, t.p, 0, COIN, h, t.b, 2).unwrap();
    assert!(t.s.clone().apply_body(2, MINER, &[past], t.p).unwrap_err().contains("already passed"));
    let too_long = build_lock(&t.alice, t.p, 0, COIN, h, t.b, 2 + MAX_LOCK_BLOCKS + 1).unwrap();
    assert!(t.s.clone().apply_body(2, MINER, &[too_long], t.p).unwrap_err().contains("longer than"));
    let too_much = build_lock(&t.alice, t.p, 0, 11 * COIN, h, t.b, 20).unwrap();
    assert!(t.s.clone().apply_body(2, MINER, &[too_much], t.p).unwrap_err().contains("insufficient"));

    // A zero-amount lock fails before touching state, and an operation that isn't one of ours
    // doesn't decode at all.
    let zero = build_lock(&t.alice, t.p, 0, 0, h, t.b, 20).unwrap();
    assert!(zero.check_stateless(t.p).unwrap_err().contains("needs an amount"));
    let mut junk = build_lock(&t.alice, t.p, 0, COIN, h, t.b, 20).unwrap().to_bytes();
    junk[66] = 99; // the operation's tag: version, chain id, from, nonce, expires, fee, limit, memo length
    assert!(lokyx::tx::SignedTransaction::from_bytes(&junk).unwrap_err().contains("malformed"));
}

#[test]
fn mempool_takes_claims_from_empty_accounts_and_holds_early_refunds_back() {
    let mut t = setup();
    let lock = build_lock(&t.alice, t.p, 0, 4 * COIN, sha256(&t.secret), t.b, 10).unwrap();
    let id = lock.hash();
    t.s.apply_body(2, MINER, &[lock], t.p).unwrap();

    let mut mp = Mempool::default();
    mp.add(build_claim(&t.bob, t.p, 0, id, t.secret).unwrap(), &t.s, t.p).unwrap();
    assert!(mp.add(build_claim(&t.bob, t.p, 1, id, [1; 32]).unwrap(), &t.s, t.p).unwrap_err().contains("wrong"));
    assert!(mp.add(build_refund(&t.alice, t.p, 1, id).unwrap(), &t.s, t.p).unwrap_err().contains("before block"));
    // The claim makes it into a block.
    let picked = mp.select(&t.s, t.p);
    assert_eq!(picked.len(), 1);
    t.s.apply_body(3, MINER, &picked, t.p).unwrap();
    assert_eq!(t.s.account(&t.b).balance, 4 * COIN - picked[0].tx.fee);
}
