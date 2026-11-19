//! Timelocks: LYX that can't be claimed before a height.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::timelock::{MAX_LOCK_YEARS, TimelockOp, max_lock_blocks};
use lokyx::tx::{Op, SignedTransaction, build_op};
use rand::rngs::OsRng;

const MINER: Address = Address([7; 20]);

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

struct T {
    p: &'static ChainParams,
    s: State,
    alice: SigningKey,
    a: Address,
    bob: SigningKey,
    b: Address,
    h: u64,
}

fn setup() -> T {
    let p = params();
    let (alice, bob) = (SigningKey::random(&mut OsRng), SigningKey::random(&mut OsRng));
    let (a, b) = (address_of(&alice), address_of(&bob));
    let mut s = State::default();
    for h in 1..=10 {
        s.apply_body(h, a, &[], p).unwrap();
    }
    T { p, s, alice, a, bob, b, h: 10 }
}

impl T {
    fn op(&self, k: &SigningKey, op: TimelockOp) -> SignedTransaction {
        build_op(k, self.p, self.s.account(&address_of(k)).nonce, Op::Timelock(op)).unwrap()
    }
    fn lock(&self, to: Address, amount: u128, at: u64) -> SignedTransaction {
        self.op(&self.alice, TimelockOp::Lock { beneficiary: to, amount, unlock_height: at })
    }
    /// Apply a block; on error the state is untouched.
    fn block(&mut self, txs: &[SignedTransaction]) -> Result<(), String> {
        let mut s = self.s.clone();
        s.apply_body(self.h + 1, MINER, txs, self.p)?;
        s.check_supply(self.h + 1, self.p)?;
        self.h += 1;
        self.s = s;
        Ok(())
    }
    fn skip_to(&mut self, h: u64) {
        while self.h < h {
            self.block(&[]).unwrap();
        }
    }
}

#[test]
fn funds_are_locked_until_the_height_and_then_the_beneficiary_claims_them() {
    let mut t = setup();
    let before = t.s.account(&t.a).balance;
    let lock = t.lock(t.b, 4 * COIN, 20);
    let (id, fee) = (lock.hash(), lock.tx.fee);
    t.block(&[lock]).unwrap();
    assert_eq!(t.s.account(&t.a).balance, before - 4 * COIN - fee);
    assert_eq!(t.s.timelocks_total(), 4 * COIN);
    assert_eq!(t.s.account(&t.b).balance, 0, "nothing reaches the beneficiary yet");

    // too early: refused
    let claim = t.op(&t.bob, TimelockOp::Claim { id });
    t.skip_to(18);
    let e = t.block(std::slice::from_ref(&claim)).unwrap_err();
    assert!(e.contains("opens at block 20"), "{e}");
    // at the height it opens (the block at 20), the claim works, and bob had no LYX to pay with
    t.skip_to(19);
    t.block(std::slice::from_ref(&claim)).unwrap();
    assert_eq!(t.s.account(&t.b).balance, 4 * COIN - claim.tx.fee);
    assert!(t.s.timelocks.is_empty());
    assert_eq!(t.s.circulating() + t.s.burned, t.s.issued);
    // and only once
    let again = t.op(&t.bob, TimelockOp::Claim { id });
    assert!(t.block(&[again]).unwrap_err().contains("no open timelock"));
}

#[test]
fn nobody_else_can_claim_and_the_creator_cannot_take_it_back() {
    let mut t = setup();
    let lock = t.lock(t.b, COIN, 30);
    let id = lock.hash();
    t.block(&[lock]).unwrap();
    t.skip_to(40);
    let by_creator = t.op(&t.alice, TimelockOp::Claim { id });
    assert!(t.block(&[by_creator]).unwrap_err().contains("only the beneficiary"));
    let stranger = SigningKey::random(&mut OsRng);
    let by_stranger = t.op(&stranger, TimelockOp::Claim { id });
    assert!(t.block(&[by_stranger]).unwrap_err().contains("only the beneficiary"));
    // the creator can name themselves beneficiary, but then the funds are theirs only at the height
    let own = t.lock(t.a, COIN, 60);
    t.block(&[own]).unwrap();
}

#[test]
fn bad_locks_are_refused() {
    let t = setup();
    let try_lock = |tx: SignedTransaction| t.s.clone().apply_body(t.h + 1, MINER, &[tx], t.p).unwrap_err();
    // already past, or this very block
    assert!(try_lock(t.lock(t.b, COIN, t.h)).contains("already passed"));
    assert!(try_lock(t.lock(t.b, COIN, t.h + 1)).contains("already passed"));
    // too far ahead: the furthest allowed is exactly ten years, and one block more is refused
    let far = t.h + 1 + max_lock_blocks(t.p);
    t.s.clone().apply_body(t.h + 1, MINER, &[t.lock(t.b, COIN, far)], t.p).unwrap();
    assert!(try_lock(t.lock(t.b, COIN, far + 1)).contains(&format!("{MAX_LOCK_YEARS} years")));
    // nothing to lock, more than there is, for a system address, for a contract
    assert!(t.lock(t.b, 0, 50).check_stateless(t.p).unwrap_err().contains("needs an amount"));
    assert!(try_lock(t.lock(t.b, 1000 * COIN, 50)).contains("insufficient"));
    assert!(t.lock(lokyx::vault::VAULT_ADDRESS, COIN, 50).check_stateless(t.p).unwrap_err().contains("system"));
    let mut s = t.s.clone();
    let c = Address([0xcc; 20]);
    s.contracts
        .insert(c, lokyx::contract::ContractInfo { code: [1; 32], abi: [2; 32], creator: Address([1; 20]), height: 1 });
    assert!(s.apply_body(t.h + 1, MINER, &[t.lock(c, COIN, 50)], t.p).unwrap_err().contains("is a contract"));
}

#[test]
fn the_books_balance_with_locks_and_the_check_notices_when_they_do_not() {
    let mut t = setup();
    t.block(&[t.lock(t.b, 3 * COIN, 50)]).unwrap();
    t.s.check_supply(t.h, t.p).unwrap();
    // a lock that vanished without being paid out would be caught
    let mut broken = t.s.clone();
    let id = *broken.timelocks.keys().next().unwrap();
    broken.timelocks.remove(&id);
    assert!(broken.check_supply(t.h, t.p).is_err());
}

#[test]
fn a_block_with_a_lock_and_a_claim_can_be_taken_back() {
    let mut t = setup();
    let lock = t.lock(t.b, 2 * COIN, 12);
    let id = lock.hash();
    t.block(&[lock]).unwrap();
    t.skip_to(11);
    let before = t.s.root();
    let snapshot = t.s.clone();
    let claim = t.op(&t.bob, TimelockOp::Claim { id });
    let mut s = t.s.clone();
    s.record();
    s.apply_body(12, MINER, &[claim], t.p).unwrap();
    assert_ne!(s.root(), before);
    let u = s.finish();
    s.undo(u);
    assert_eq!(s, snapshot);
    assert_eq!(s.root(), before);
    // and a lock too
    let mut s = t.s.clone();
    s.record();
    s.apply_body(12, MINER, &[t.lock(t.b, COIN, 99)], t.p).unwrap();
    let u = s.finish();
    s.undo(u);
    assert_eq!(s, snapshot);
}

#[test]
fn the_mempool_holds_early_claims_back() {
    let mut t = setup();
    let lock = t.lock(t.b, COIN, 20);
    let id = lock.hash();
    t.block(&[lock]).unwrap();
    let mut mp = Mempool::default();
    let claim = t.op(&t.bob, TimelockOp::Claim { id });
    assert!(mp.add(claim.clone(), &t.s, t.p).unwrap_err().contains("opens at block 20"));
    t.skip_to(19);
    mp.add(claim, &t.s, t.p).unwrap();
    let picked = mp.select(&t.s, t.p);
    assert_eq!(picked.len(), 1);
    t.block(&picked).unwrap();
    assert_eq!(t.s.account(&t.b).balance, COIN - picked[0].tx.fee);
}
