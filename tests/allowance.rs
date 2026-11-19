//! No operation lets a vault's owner move LYX out faster than the daily allowance.
//!
//! The attack this guards against: an operation that takes LYX from the sender but never asks the
//! allowance, so a stolen vault key could park everything somewhere (a lock addressed to itself)
//! and take it back later. Every variant of `Op` is listed here, with a function that has no
//! wildcard, so adding an operation breaks this file until someone decides where it stands.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pqkey::KeyOp;
use lokyx::state::State;
use lokyx::swap::SwapOp;
use lokyx::timelock::TimelockOp;
use lokyx::token::TokenOp;
use lokyx::tx::{Op, SignedTransaction, build_op};
use lokyx::vault::{VaultOp, VaultSettings, blocks_for};

const MINER: Address = Address([7; 20]);
const ALLOWANCE: u128 = COIN;

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

/// A position in the list of variants. No wildcard: a new `Op` variant doesn't compile until it
/// is given a number here, and `every_variant_is_listed` then fails until `ALL` has a sample.
fn variant(op: &Op) -> usize {
    match op {
        Op::Transfer { .. } => 0,
        Op::Batch(_) => 1,
        Op::Swap(_) => 2,
        Op::Vault(_) => 3,
        Op::Key(_) => 4,
        Op::Timelock(_) => 5,
        Op::Token(_) => 6,
        Op::Deploy { .. } => 7,
        Op::Call { .. } => 8,
    }
}
const VARIANTS: usize = 9;

/// Does this operation, sent by the vault's owner, take LYX out of the owner's own balance (or
/// lock it, or burn it, or hand it to someone), so that the allowance has to apply? No wildcard.
fn moves_owners_lyx(op: &Op) -> bool {
    match op {
        Op::Transfer { .. } | Op::Batch(_) | Op::Deploy { .. } | Op::Call { .. } => true,
        Op::Swap(SwapOp::Lock { .. }) => true,
        // pays out of a lock that was already paid for, when it was made
        Op::Swap(SwapOp::Claim { .. } | SwapOp::Refund { .. }) => false,
        // a withdrawal waits out the vault's delay, which is what stops a thief; the rest take
        // only a fee, and cancel/sweep/heir are other people's keys acting on the vault
        Op::Vault(VaultOp::Withdraw { .. }) => true,
        Op::Vault(
            VaultOp::Create(_)
            | VaultOp::Update(_)
            | VaultOp::Close
            | VaultOp::Cancel { .. }
            | VaultOp::Sweep { .. }
            | VaultOp::HeirClaim { .. },
        ) => false,
        // keys and rotations move no LYX but their fee
        Op::Key(KeyOp::CommitPq { .. } | KeyOp::Rotate { .. } | KeyOp::CancelRotate { .. }) => false,
        // a lock takes the amount at once, so it is charged; the claim pays out of a lock that was
        // already charged when it was made
        Op::Timelock(TimelockOp::Lock { .. }) => true,
        Op::Timelock(TimelockOp::Claim { .. }) => false,
        // making a token burns LYX; moving or burning tokens takes none
        Op::Token(TokenOp::Create { .. }) => true,
        Op::Token(TokenOp::Transfer { .. } | TokenOp::Burn { .. }) => false,
    }
}

/// One sample of every variant that moves the owner's LYX, each moving about `amount`.
fn samples(amount: u128, other: Address) -> Vec<Op> {
    vec![
        Op::Transfer { to: other, value: amount },
        Op::Batch(vec![(other, amount / 2), (Address([5; 20]), amount - amount / 2)]),
        Op::Swap(SwapOp::Lock { amount, hashlock: [1; 32], recipient: other, refund_height: 1000 }),
        Op::Vault(VaultOp::Withdraw { to: other, amount }),
        Op::Timelock(TimelockOp::Lock { beneficiary: other, amount, unlock_height: 500 }),
        Op::Token(TokenOp::Create { symbol: "X".into(), name: "x".into(), decimals: 0, supply: 1 }),
        Op::Deploy { value: amount, code: vec![0], abi: String::new(), input: vec![], gas: 100_000 },
        Op::Call { to: other, value: amount, input: vec![], gas: 100_000 },
        // the ones that don't move LYX, so the list has every variant
        Op::Swap(SwapOp::Claim { lock: [2; 32], secret: [3; 32] }),
        Op::Timelock(TimelockOp::Claim { id: [2; 32] }),
        Op::Token(TokenOp::Transfer { token: [2; 32], to: other, amount: 1 }),
        Op::Token(TokenOp::Burn { token: [2; 32], amount: 1 }),
        Op::Vault(VaultOp::Close),
        Op::Key(KeyOp::CommitPq { hash: [4; 32] }),
        Op::Key(KeyOp::Rotate { new_key: Address([6; 20]) }),
        Op::Key(KeyOp::CancelRotate { account: address_of(&vault_key()) }),
    ]
}

struct World {
    s: State,
    sk: SigningKey,
    v: Address,
    h: u64,
    p: &'static ChainParams,
}

/// The vault's key is fixed so the samples can name its account.
fn vault_key() -> SigningKey {
    SigningKey::from_bytes((&[0x31u8; 32]).into()).unwrap()
}

fn world() -> World {
    let p = params();
    let sk = vault_key();
    let v = address_of(&sk);
    let mut s = State::default();
    for h in 1..=10 {
        s.apply_body(h, v, &[], p).unwrap();
    }
    let set = VaultSettings {
        recovery: Address([1; 20]),
        safe: Address([2; 20]),
        delay: blocks_for(86_400, p),
        allowance: ALLOWANCE,
        heir: None,
    };
    let create = build_op(&sk, p, 0, Op::Vault(VaultOp::Create(set))).unwrap();
    s.apply_body(11, MINER, &[create], p).unwrap();
    assert!(s.vaults.contains_key(&v));
    World { s, sk, v, h: 11, p }
}

/// The world for one sample: a cancel has something to cancel, a rotation has nothing waiting.
fn world_for(op: &Op) -> World {
    let mut w = world();
    if matches!(op, Op::Key(KeyOp::CancelRotate { .. })) {
        let v = w.v;
        w.s.key_pending.insert(v, lokyx::pqkey::KeyPending { new_key: Address([6; 20]), release: 100_000 });
    }
    w
}

impl World {
    fn tx(&self, op: Op) -> SignedTransaction {
        build_op(&self.sk, self.p, self.s.account(&self.v).nonce, op).unwrap()
    }
    fn try_apply(&self, tx: SignedTransaction) -> Result<State, String> {
        let mut s = self.s.clone();
        s.apply_body(self.h + 1, MINER, &[tx], self.p)?;
        assert_eq!(s.circulating(), s.issued, "supply invariant");
        Ok(s)
    }
}

#[test]
fn every_variant_is_listed() {
    let w = world();
    let mut seen = vec![false; VARIANTS];
    for op in samples(COIN, Address([9; 20])) {
        seen[variant(&op)] = true;
    }
    assert!(seen.iter().all(|x| *x), "a variant of Op has no sample in this file: {seen:?}");
    let _ = w;
}

#[test]
fn nothing_the_owner_sends_gets_past_the_allowance() {
    let other = Address([9; 20]);
    let over = 20 * ALLOWANCE;
    for op in samples(over, other) {
        let w = &world_for(&op);
        if !moves_owners_lyx(&op) {
            continue;
        }
        let delayed = op.immediate_outflow() == 0;
        let tx = w.tx(op.clone());
        let r = w.try_apply(tx.clone());
        if delayed {
            // a withdrawal is accepted, but nothing has left: it sits in `pending` for the delay
            let s = r.unwrap_or_else(|e| panic!("{op:?} should be accepted as a delayed withdrawal: {e}"));
            assert_eq!(s.account(&other).balance, 0, "{op:?} paid out at once");
            assert!(s.pending_total() >= over, "{op:?} isn't waiting out the delay");
        } else {
            let e = r.expect_err(&format!("{op:?} got past the daily allowance"));
            assert!(
                e.contains("allowance")
                    || e.contains("vault accounts can't use contracts")
                    || e.contains("vault accounts can't use tokens"),
                "{op:?} was refused, but not for the allowance: {e}"
            );
        }
        // the mempool applies the same rule before the transaction gets into a block
        let mut mp = Mempool::default();
        let mut s = w.s.clone();
        s.height = w.h;
        let m = mp.add(tx, &s, w.p);
        if !delayed {
            assert!(m.is_err(), "the mempool accepted {op:?}, which is over the allowance");
        }
    }
}

#[test]
fn what_is_charged_is_what_the_operation_says_it_costs() {
    let other = Address([9; 20]);
    let under = ALLOWANCE / 10;
    let mut checked = 0;
    for op in samples(under, other) {
        let w = &world_for(&op);
        let tx = w.tx(op.clone());
        let fee = tx.tx.fee;
        let Ok(s) = w.try_apply(tx) else {
            // only the contract operations are refused here, and the vault can't use them at all
            assert!(
                matches!(
                    op,
                    Op::Deploy { .. } | Op::Call { .. } | Op::Swap(_) | Op::Vault(_) | Op::Timelock(_) | Op::Token(_)
                ),
                "{op:?}"
            );
            continue;
        };
        let before = &w.s.vaults[&w.v];
        let after = match s.vaults.get(&w.v) {
            Some(v) => v,
            None => continue, // closed or changed: it's pending, and only the fee is taken
        };
        assert_eq!(
            after.spent - before.spent,
            op.allowance_cost(fee),
            "{op:?}: the allowance charged isn't what Op::allowance_cost says"
        );
        if moves_owners_lyx(&op) {
            let gone = w.s.account(&w.v).balance - s.account(&w.v).balance;
            assert_eq!(gone, op.outflow() + fee, "{op:?}: balance change isn't outflow + fee");
        }
        checked += 1;
    }
    assert!(checked >= 4, "only {checked} operations were checked");
}

#[test]
fn a_lock_to_yourself_is_not_a_way_around_the_allowance() {
    // The case this file exists for: park everything in a lock addressed to yourself, claim later.
    let w = world();
    let lock = Op::Swap(SwapOp::Lock {
        amount: 50 * COIN,
        hashlock: lokyx::swap::sha256(&[7; 32]),
        recipient: w.v,
        refund_height: w.h + 100,
    });
    let e = w.try_apply(w.tx(lock)).unwrap_err();
    assert!(e.contains("allowance"), "{e}");
}

#[test]
fn a_timelock_to_yourself_is_not_a_way_around_the_allowance() {
    // Lock everything for yourself one block ahead, claim it a block later: it must not work.
    let w = world();
    let lock = Op::Timelock(TimelockOp::Lock { beneficiary: w.v, amount: 50 * COIN, unlock_height: w.h + 2 });
    let e = w.try_apply(w.tx(lock)).unwrap_err();
    assert!(e.contains("allowance"), "{e}");
    // within the allowance it is allowed, and is charged like a payment of that size
    let small = Op::Timelock(TimelockOp::Lock { beneficiary: w.v, amount: ALLOWANCE / 2, unlock_height: w.h + 2 });
    let tx = w.tx(small);
    let fee = tx.tx.fee;
    let s = w.try_apply(tx).unwrap();
    assert_eq!(s.vaults[&w.v].spent, ALLOWANCE / 2 + fee);
}
