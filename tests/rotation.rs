//! Key rotation: a delay, a cancel, and the old key giving way to the new one exactly at the release.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pqkey::KeyOp;
use lokyx::state::State;
use lokyx::tx::{Op, Params, SignedTransaction, build_from};
use lokyx::vault::{VaultOp, VaultSettings, blocks_for, day_blocks};
use rand::rngs::OsRng;

const MINER: Address = Address([7; 20]);
const SHOP: Address = Address([8; 20]);

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

struct W {
    p: &'static ChainParams,
    s: State,
    h: u64,
    old: SigningKey,
    a: Address,
    new: SigningKey,
    n: Address,
}

fn key_op(k: &SigningKey, from: Address, nonce: u64, op: KeyOp) -> SignedTransaction {
    build_from(k, from, params(), Params { nonce, ..Default::default() }, Op::Key(op)).unwrap()
}

impl W {
    /// `a` has mined ten blocks (100 LYX).
    fn new() -> W {
        let p = params();
        let old = SigningKey::random(&mut OsRng);
        let new = SigningKey::random(&mut OsRng);
        let (a, n) = (address_of(&old), address_of(&new));
        let mut s = State::default();
        for h in 1..=10 {
            s.apply_body(h, a, &[], p).unwrap();
        }
        W { p, s, h: 10, old, a, new, n }
    }
    fn block(&mut self, txs: &[SignedTransaction]) -> Result<(), String> {
        let mut s = self.s.clone();
        s.apply_body(self.h + 1, MINER, txs, self.p)?;
        assert_eq!(s.circulating() + s.burned, s.issued);
        assert_eq!(s.root_incremental(), s.root());
        self.s = s;
        self.h += 1;
        Ok(())
    }
    fn skip_to(&mut self, h: u64) {
        while self.h + 1 < h {
            self.block(&[]).unwrap();
        }
    }
    fn nonce(&self) -> u64 {
        self.s.account(&self.a).nonce
    }
    fn pay(&self, k: &SigningKey, v: u128) -> SignedTransaction {
        build_from(
            k,
            self.a,
            self.p,
            Params { nonce: self.nonce(), ..Default::default() },
            Op::Transfer { to: SHOP, value: v },
        )
        .unwrap()
    }
    fn rotate(&mut self) -> u64 {
        let t = key_op(&self.old, self.a, self.nonce(), KeyOp::Rotate { new_key: self.n });
        self.block(&[t]).unwrap();
        self.s.key_pending[&self.a].release
    }
}

#[test]
fn old_key_until_release_new_key_after() {
    let mut w = W::new();
    let release = w.rotate();
    assert_eq!(release, w.h + day_blocks(w.p), "a plain account waits one day");
    assert_eq!(w.s.controller(&w.a), w.a);

    // until the release block the old key signs and the new one doesn't
    let e = w.block(&[w.pay(&w.new, COIN)]).unwrap_err();
    assert!(e.contains("isn't from the key that controls"), "{e}");
    w.block(&[w.pay(&w.old, COIN)]).unwrap();
    w.skip_to(release - 1);
    w.block(&[w.pay(&w.old, COIN)]).unwrap();
    assert_eq!(w.h, release - 1);

    // in the release block itself the new key already works and the old one is out
    let mut s = w.s.clone();
    let e = s.apply_body(release, MINER, &[w.pay(&w.old, COIN)], w.p).unwrap_err();
    assert!(e.contains("isn't from the key that controls"), "{e}");
    w.block(&[w.pay(&w.new, COIN)]).unwrap();
    assert_eq!(w.h, release);
    assert_eq!(w.s.controller(&w.a), w.n);
    assert!(w.s.key_pending.is_empty());

    // the account kept its balance and its nonce going; the new key's own account is untouched
    assert!(w.s.account(&w.a).balance > 0 && w.s.account(&w.a).nonce >= 3);
    assert_eq!(w.s.account(&w.n).balance, 0);
    assert_eq!(w.s.account(&w.n).nonce, 0);
    // and the old key's address is just a key now, it can still control nothing but fails
    w.block(&[w.pay(&w.new, COIN)]).unwrap();
    assert!(w.block(&[w.pay(&w.old, COIN)]).is_err());
}

#[test]
fn cancel_by_the_current_key_only() {
    let mut w = W::new();
    w.rotate();
    // a stranger can't cancel, whoever they are
    let stranger = SigningKey::random(&mut OsRng);
    let sa = address_of(&stranger);
    let mut s = w.s.clone();
    s.apply_body(w.h + 1, sa, &[], w.p).unwrap(); // give them a balance
    let t = key_op(&stranger, sa, 0, KeyOp::CancelRotate { account: w.a });
    let e = s.apply_body(w.h + 2, MINER, &[t], w.p).unwrap_err();
    assert!(e.contains("only the account's own key"), "{e}");
    // nothing to cancel is an error too
    let t = key_op(&w.old, w.a, w.nonce(), KeyOp::CancelRotate { account: SHOP });
    assert!(w.block(&[t]).unwrap_err().contains("no key rotation"));
    // the new key can't cancel before it is in charge
    let t = key_op(&w.new, w.a, w.nonce(), KeyOp::CancelRotate { account: w.a });
    assert!(w.block(&[t]).is_err());

    let t = key_op(&w.old, w.a, w.nonce(), KeyOp::CancelRotate { account: w.a });
    w.block(&[t]).unwrap();
    assert!(w.s.key_pending.is_empty());
    w.skip_to(w.h + day_blocks(w.p) + 2);
    assert_eq!(w.s.controller(&w.a), w.a, "a cancelled rotation never happens");
    assert!(w.s.keys.is_empty());
}

#[test]
fn only_one_rotation_at_a_time_and_not_to_the_same_key() {
    let mut w = W::new();
    let same = key_op(&w.old, w.a, w.nonce(), KeyOp::Rotate { new_key: w.a });
    assert!(w.block(&[same]).unwrap_err().contains("already controls"));
    let sys = key_op(&w.old, w.a, w.nonce(), KeyOp::Rotate { new_key: lokyx::contract::DEPLOY_ADDRESS });
    assert!(sys.check_stateless(w.p).unwrap_err().contains("system address"));
    w.rotate();
    let second = key_op(&w.old, w.a, w.nonce(), KeyOp::Rotate { new_key: Address([3; 20]) });
    assert!(w.block(&[second]).unwrap_err().contains("already waiting"));
}

#[test]
fn rotating_back_to_the_original_key_leaves_no_trace() {
    let mut w = W::new();
    let release = w.rotate();
    w.skip_to(release);
    w.block(&[]).unwrap(); // the release block
    assert_eq!(w.s.controller(&w.a), w.n);
    // the new key hands the account back to the old key
    let t = key_op(&w.new, w.a, w.nonce(), KeyOp::Rotate { new_key: w.a });
    w.block(&[t]).unwrap();
    let release = w.s.key_pending[&w.a].release;
    w.skip_to(release);
    w.block(&[]).unwrap();
    assert_eq!(w.s.controller(&w.a), w.a);
    assert!(w.s.keys.is_empty(), "an account under its own key has no entry");
    w.block(&[w.pay(&w.old, COIN)]).unwrap();
}

#[test]
fn undo_across_the_rotation_and_its_release() {
    let mut w = W::new();
    let before = w.s.clone();
    // undo the rotate itself
    let t = key_op(&w.old, w.a, w.nonce(), KeyOp::Rotate { new_key: w.n });
    let mut s = w.s.clone();
    s.record();
    s.apply_body(w.h + 1, MINER, &[t], w.p).unwrap();
    assert!(!s.key_pending.is_empty());
    let u = s.finish();
    s.undo(u);
    assert_eq!(s, before);
    assert_eq!(s.root_incremental(), before.root());

    // undo the release block
    let release = w.rotate();
    w.skip_to(release - 1);
    let pre = w.s.clone();
    let mut s = w.s.clone();
    s.record();
    s.apply_body(release, MINER, &[], w.p).unwrap();
    assert_eq!(s.controller(&w.a), w.n);
    let _ = s.root_incremental();
    let u = s.finish();
    s.undo(u);
    assert_eq!(s, pre);
    assert_eq!(s.controller(&w.a), w.a);
    assert_eq!(s.root_incremental(), pre.root());
}

fn vault_world() -> (W, SigningKey, Address) {
    let mut w = W::new();
    let recovery = SigningKey::random(&mut OsRng);
    let r = address_of(&recovery);
    let set = VaultSettings {
        recovery: r,
        safe: Address([9; 20]),
        delay: blocks_for(7200, w.p),
        allowance: 5 * COIN,
        heir: None,
    };
    let c = lokyx::vault::build(&w.old, w.p, w.nonce(), VaultOp::Create(set)).unwrap();
    w.block(&[c]).unwrap();
    (w, recovery, r)
}

#[test]
fn a_vault_rotates_on_its_own_delay_and_the_recovery_key_can_cancel() {
    let (mut w, recovery, r) = vault_world();
    let release = w.rotate();
    assert_eq!(release, w.h + blocks_for(7200, w.p), "a vault waits its own delay");
    assert!(release < w.h + day_blocks(w.p));

    // the recovery address has no LYX; the vault pays for the cancel
    let before = w.s.account(&w.a).balance;
    assert_eq!(w.s.account(&r).balance, 0);
    let t = key_op(&recovery, r, 0, KeyOp::CancelRotate { account: w.a });
    let fee = t.tx.fee;
    w.block(&[t]).unwrap();
    assert!(w.s.key_pending.is_empty());
    assert_eq!(w.s.account(&w.a).balance, before - fee);
    assert_eq!(w.s.account(&r).balance, 0);
    assert_eq!(w.s.account(&r).nonce, 1);
    w.skip_to(release + 2);
    assert_eq!(w.s.controller(&w.a), w.a);
}

#[test]
fn a_vault_owner_cancelling_its_own_rotation_counts_against_the_allowance() {
    let (mut w, _, _) = vault_world();
    w.rotate();
    let spent = w.s.vaults[&w.a].spent;
    let t = key_op(&w.old, w.a, w.nonce(), KeyOp::CancelRotate { account: w.a });
    let fee = t.tx.fee;
    w.block(&[t]).unwrap();
    assert_eq!(w.s.vaults[&w.a].spent, spent + fee);
}

#[test]
fn the_mempool_never_hands_a_miner_a_transaction_the_rotation_has_made_invalid() {
    let mut w = W::new();
    let release = w.rotate();
    w.skip_to(release);
    // signed by the old key, valid right now, queued
    let mut mp = Mempool::default();
    let t = w.pay(&w.old, COIN);
    mp.add(t, &w.s, w.p).unwrap();
    // the next block is the release block: the old key is out, so nothing may be chosen
    let picked = mp.select(&w.s, w.p);
    assert!(picked.is_empty(), "{} picked", picked.len());
    // and a transfer signed by the new key is refused by the pool until it has taken over (it
    // isn't valid in the current state), but works as a block at the release height
    let mut s = w.s.clone();
    s.apply_body(release, MINER, &[w.pay(&w.new, COIN)], w.p).unwrap();
}
