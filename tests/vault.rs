//! Vault rules: allowance, delayed withdrawals, cancel, sweep, settings changes, heir.

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::swap::{build_lock, sha256};
use lokyx::tx::build_transfer;
use lokyx::vault::{Heir, VaultOp, VaultSettings, blocks_for, build, day_blocks};
use rand::rngs::OsRng;

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

const MINER: Address = Address([7; 20]);
const SHOP: Address = Address([8; 20]);

struct T {
    p: &'static ChainParams,
    s: State,
    owner: SigningKey,
    o: Address,
    recovery: SigningKey,
    r: Address,
    safe: Address,
    h: u64,
}

impl T {
    /// Apply txs in the next block. Returns the error if the block is invalid (state unchanged).
    fn block(&mut self, txs: &[lokyx::tx::SignedTransaction]) -> Result<(), String> {
        self.h += 1;
        let mut s = self.s.clone();
        s.apply_body(self.h, MINER, txs, self.p)?;
        assert_eq!(s.circulating(), s.issued, "supply invariant at {}", self.h);
        self.s = s;
        Ok(())
    }
    fn skip_to(&mut self, h: u64) {
        self.h = h - 1;
        self.block(&[]).unwrap();
    }
    fn nonce(&self, a: &Address) -> u64 {
        self.s.account(a).nonce
    }
    fn bal(&self, a: &Address) -> u128 {
        self.s.account(a).balance
    }
    fn op(&self, k: &SigningKey, op: VaultOp) -> lokyx::tx::SignedTransaction {
        build(k, self.p, self.nonce(&address_of(k)), op).unwrap()
    }
}

fn settings(p: &ChainParams, r: Address, safe: Address) -> VaultSettings {
    VaultSettings { recovery: r, safe, delay: blocks_for(86_400, p), allowance: 5 * COIN, heir: None }
}

/// Owner has 100 LYX (mined 10 blocks) and makes a vault with a 5 LYX/day allowance and a 1-day delay.
fn setup() -> T {
    let p = params();
    let owner = SigningKey::random(&mut OsRng);
    let recovery = SigningKey::random(&mut OsRng);
    let (o, r) = (address_of(&owner), address_of(&recovery));
    let mut s = State::default();
    for h in 1..=10 {
        s.apply_body(h, o, &[], p).unwrap();
    }
    let mut t = T { p, s, owner, o, recovery, r, safe: Address([9; 20]), h: 10 };
    let create = t.op(&t.owner, VaultOp::Create(settings(p, t.r, t.safe)));
    t.block(&[create]).unwrap();
    assert!(t.s.vaults.contains_key(&t.o));
    t
}

#[test]
fn spending_is_capped_by_the_daily_allowance() {
    let mut t = setup();
    let send = |t: &T, v| build_transfer(&t.owner, t.p, t.nonce(&t.o), SHOP, v, None).unwrap();
    t.block(&[send(&t, 3 * COIN)]).unwrap();
    // 2 LYX minus the first fee is left; 2 LYX more doesn't fit
    let e = t.block(&[send(&t, 2 * COIN)]).unwrap_err();
    assert!(e.contains("daily allowance"), "{e}");
    t.block(&[send(&t, COIN)]).unwrap();
    // a swap lock counts too
    let lock = build_lock(&t.owner, t.p, t.nonce(&t.o), 2 * COIN, sha256(b"s"), SHOP, t.h + 50).unwrap();
    assert!(t.block(&[lock]).unwrap_err().contains("daily allowance"));
    // the next day it resets
    let next_day = t.s.vaults[&t.o].day_start + day_blocks(t.p);
    t.skip_to(next_day);
    let lock = build_lock(&t.owner, t.p, t.nonce(&t.o), 2 * COIN, sha256(b"s"), SHOP, t.h + 50).unwrap();
    t.block(&[lock]).unwrap();
    assert_eq!(t.s.swaps.len(), 1);
}

#[test]
fn big_withdrawals_wait_and_the_recovery_key_can_cancel_them() {
    let mut t = setup();
    let before = t.bal(&t.o);
    let w = t.op(&t.owner, VaultOp::Withdraw { to: SHOP, amount: 60 * COIN });
    let (id, fee) = (w.hash(), w.tx.fee);
    t.block(&[w]).unwrap();
    assert_eq!(t.bal(&t.o), before - 60 * COIN - fee);
    assert_eq!(t.bal(&SHOP), 0);
    let release = t.s.pending[&id].release;
    assert_eq!(release, t.h + blocks_for(86_400, t.p));

    // the recovery key has no LYX of its own; the cancel fee comes out of the vault
    assert_eq!(t.bal(&t.r), 0);
    let c = t.op(&t.recovery, VaultOp::Cancel { id });
    let cfee = c.tx.fee;
    t.block(&[c]).unwrap();
    assert!(t.s.pending.is_empty());
    assert_eq!(t.bal(&t.o), before - fee - cfee);
    t.skip_to(release + 1);
    assert_eq!(t.bal(&SHOP), 0, "cancelled withdrawal never arrives");

    // one that isn't cancelled arrives after the delay
    let w = t.op(&t.owner, VaultOp::Withdraw { to: SHOP, amount: 10 * COIN });
    t.block(&[w]).unwrap();
    let release = t.h + blocks_for(86_400, t.p);
    t.skip_to(release - 1);
    assert_eq!(t.bal(&SHOP), 0);
    t.block(&[]).unwrap();
    assert_eq!(t.bal(&SHOP), 10 * COIN);
}

#[test]
fn the_recovery_key_sweeps_everything_to_the_safe_address_and_nowhere_else() {
    let mut t = setup();
    let w = t.op(&t.owner, VaultOp::Withdraw { to: SHOP, amount: 40 * COIN });
    t.block(&[w]).unwrap();
    let total = t.bal(&t.o) + 40 * COIN;

    // a thief with only the owner key can't sweep, and the recovery key can't withdraw
    let e = t.block(&[t.op(&t.owner, VaultOp::Sweep { vault: t.o })]).unwrap_err();
    assert!(e.contains("only the recovery key"), "{e}");
    let e = t.block(&[t.op(&t.recovery, VaultOp::Withdraw { to: t.r, amount: COIN })]).unwrap_err();
    assert!(e.contains("isn't a vault"), "{e}");

    let sweep = t.op(&t.recovery, VaultOp::Sweep { vault: t.o });
    let fee = sweep.tx.fee;
    t.block(&[sweep]).unwrap();
    assert_eq!(t.bal(&t.safe), total - fee);
    assert_eq!(t.bal(&t.o), 0);
    assert!(t.s.pending.is_empty(), "the pending withdrawal was swept too");
}

#[test]
fn settings_changes_and_closing_wait_out_the_delay() {
    let mut t = setup();
    let mut s2 = settings(t.p, t.r, t.safe);
    s2.allowance = 50 * COIN;
    let u = t.op(&t.owner, VaultOp::Update(s2));
    let uid = u.hash();
    t.block(&[u]).unwrap();
    assert_eq!(t.s.vaults[&t.o].settings.allowance, 5 * COIN, "not yet");
    // a thief raising the allowance gets cancelled by the recovery key
    t.block(&[t.op(&t.recovery, VaultOp::Cancel { id: uid })]).unwrap();
    t.skip_to(t.h + blocks_for(86_400, t.p) + 1);
    assert_eq!(t.s.vaults[&t.o].settings.allowance, 5 * COIN);

    // closing works the same way, and afterwards the account is a normal one again
    t.block(&[t.op(&t.owner, VaultOp::Close)]).unwrap();
    let send = build_transfer(&t.owner, t.p, t.nonce(&t.o), SHOP, 30 * COIN, None).unwrap();
    assert!(t.block(std::slice::from_ref(&send)).unwrap_err().contains("daily allowance"));
    t.skip_to(t.h + blocks_for(86_400, t.p));
    assert!(!t.s.vaults.contains_key(&t.o));
    t.block(&[send]).unwrap();
    assert_eq!(t.bal(&SHOP), 30 * COIN);
}

#[test]
fn bad_settings_are_refused() {
    let t = setup();
    let other = SigningKey::random(&mut OsRng);
    let mut s = State::default();
    s.apply_body(1, address_of(&other), &[], t.p).unwrap();
    let me = address_of(&other);
    let try_create = |set: VaultSettings| {
        let tx = build(&other, t.p, 0, VaultOp::Create(set)).unwrap();
        s.clone().apply_body(2, MINER, &[tx], t.p).unwrap_err()
    };
    assert!(try_create(VaultSettings { recovery: me, ..settings(t.p, t.r, t.safe) }).contains("recovery key"));
    assert!(try_create(VaultSettings { safe: me, ..settings(t.p, t.r, t.safe) }).contains("safe address"));
    assert!(try_create(VaultSettings { delay: 10, ..settings(t.p, t.r, t.safe) }).contains("delay"));
    let heir = Some(Heir { address: SHOP, inactive_blocks: 100 });
    assert!(try_create(VaultSettings { heir, ..settings(t.p, t.r, t.safe) }).contains("heir"));
    // can't make a vault twice
    let again = t.op(&t.owner, VaultOp::Create(settings(t.p, t.r, t.safe)));
    assert!(t.s.clone().apply_body(t.h + 1, MINER, &[again], t.p).unwrap_err().contains("already"));
    // (a vault op carrying a value is no longer a rule: the encoding has nowhere to put one)
}

#[test]
fn the_heir_can_claim_after_long_inactivity_and_the_owner_can_still_stop_it() {
    let mut t = setup();
    let heir_key = SigningKey::random(&mut OsRng);
    let heir = address_of(&heir_key);
    let inactive = blocks_for(30 * 86_400, t.p);
    let mut s = settings(t.p, t.r, t.safe);
    s.heir = Some(Heir { address: heir, inactive_blocks: inactive });
    t.block(&[t.op(&t.owner, VaultOp::Update(s))]).unwrap();
    t.skip_to(t.h + blocks_for(86_400, t.p) + 1);
    let last = t.s.vaults[&t.o].last_active;

    let claim = |t: &T| t.op(&heir_key, VaultOp::HeirClaim { vault: t.o });
    let e = t.block(&[claim(&t)]).unwrap_err();
    assert!(e.contains("active recently"), "{e}");
    t.skip_to(last + inactive);
    let c = claim(&t);
    let id = c.hash();
    t.block(&[c]).unwrap();
    assert_eq!(t.bal(&t.o), 0);
    assert!(t.s.pending[&id].by_heir);

    // the owner turns out to be alive
    t.block(&[t.op(&t.owner, VaultOp::Cancel { id })]).unwrap();
    assert!(t.bal(&t.o) > 90 * COIN);
    assert_eq!(t.s.vaults[&t.o].last_active, t.h);
    // and now the heir has to wait again
    assert!(t.block(&[claim(&t)]).unwrap_err().contains("active recently"));
}

#[test]
fn mempool_enforces_the_allowance_and_takes_recovery_ops_from_empty_keys() {
    let mut t = setup();
    let mut mp = Mempool::default();
    t.s.height = t.h;
    let n = t.nonce(&t.o);
    mp.add(build_transfer(&t.owner, t.p, n, SHOP, 3 * COIN, None).unwrap(), &t.s, t.p).unwrap();
    // with the pending one, this goes over
    let e = mp.add(build_transfer(&t.owner, t.p, n + 1, SHOP, 2 * COIN, None).unwrap(), &t.s, t.p).unwrap_err();
    assert!(e.contains("daily allowance"), "{e}");
    // a delayed withdrawal only counts its fee
    let w = build(&t.owner, t.p, n + 1, VaultOp::Withdraw { to: SHOP, amount: 50 * COIN }).unwrap();
    let id = w.hash();
    mp.add(w, &t.s, t.p).unwrap();
    let picked = mp.select(&t.s, t.p);
    assert_eq!(picked.len(), 2);
    t.block(&picked).unwrap();
    t.s.height = t.h;
    // recovery key with zero balance cancels through the mempool
    let c = build(&t.recovery, t.p, 0, VaultOp::Cancel { id }).unwrap();
    let mut mp = Mempool::default();
    mp.add(c, &t.s, t.p).unwrap();
    assert_eq!(mp.select(&t.s, t.p).len(), 1);
}

/// The index of pending releases by height always agrees with a scan, through create, cancel,
/// sweep, release, and taking a block back off.
#[test]
fn pending_releases_are_indexed_by_height_and_the_index_survives_undo() {
    let mut t = setup();
    let w1 = t.op(&t.owner, VaultOp::Withdraw { to: SHOP, amount: 10 * COIN });
    let id1 = w1.hash();
    t.block(&[w1]).unwrap();
    assert!(t.s.release_index_consistent());

    // a block that adds a second one, then taken back off
    let w2 = t.op(&t.owner, VaultOp::Withdraw { to: SHOP, amount: 11 * COIN });
    let mut s = t.s.clone();
    s.record();
    s.apply_body(t.h + 1, MINER, &[w2], t.p).unwrap();
    assert_eq!(s.pending.len(), 2);
    assert!(s.release_index_consistent());
    let u = s.finish();
    s.undo(u);
    assert_eq!(s.pending.len(), 1);
    assert!(s.release_index_consistent());
    // and a release after the undo still happens, exactly once
    let release = s.pending[&id1].release;
    s.apply_body(release, MINER, &[], t.p).unwrap();
    assert_eq!(s.account(&SHOP).balance, 10 * COIN);
    assert!(s.pending.is_empty() && s.release_index_consistent());

    // a sweep drops pending entries wholesale
    let w3 = t.op(&t.owner, VaultOp::Withdraw { to: SHOP, amount: 12 * COIN });
    t.block(&[w3]).unwrap();
    let sweep = t.op(&t.recovery, VaultOp::Sweep { vault: t.o });
    t.block(&[sweep]).unwrap();
    assert!(t.s.pending.is_empty() && t.s.release_index_consistent());
    t.skip_to(t.h + 2 * blocks_for(86_400, t.p));
    assert_eq!(t.bal(&SHOP), 0, "the swept withdrawal never arrives");
}
