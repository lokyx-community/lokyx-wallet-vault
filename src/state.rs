//! Account balances/nonces and applying a block to them.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::block::Block;
use crate::contract::{self, ContractInfo, ContractOp, GAS_PRICE, Receipt};
use crate::crypto::{Hash, tagged_hash};
use crate::emission::block_reward;
use crate::journal::{Log, Storage, StorageLog, Tracked};
use crate::params::ChainParams;
use crate::swap::{MAX_LOCK_BLOCKS, SwapLock, SwapOp, sha256};
use crate::timelock::{Timelock, TimelockOp, max_lock_blocks};
use crate::token::{Token, TokenOp};
use crate::tx::{Op, SignedTransaction};
use crate::vault::{Pending, PendingKind, Vault, VaultOp, check_settings, day_blocks};
use borsh::{BorshDeserialize, BorshSerialize};
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Account {
    pub balance: u128,
    pub nonce: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    pub accounts: Tracked<Address, Account>,
    /// Total LYX ever issued by block rewards (fees are transfers, not issuance).
    pub issued: u128,
    /// Rewards (reward + fees) not spendable yet, keyed by the height of the block that earned them.
    pub immature: Tracked<u64, (Address, u128)>,
    /// Open swap locks by lock id (the hash of the lock transaction).
    pub swaps: Tracked<Hash, SwapLock>,
    /// Vault rules by owner address.
    pub vaults: Tracked<Address, Vault>,
    /// Withdrawals and settings changes waiting out a vault's delay, by the id of the tx that
    /// started them.
    pub pending: Tracked<Hash, Pending>,
    /// Post-quantum key commitments (see pqkey.rs), set once per account.
    pub pq: Tracked<Address, [u8; 32]>,
    /// Accounts that have rotated: the key (as an address) that controls them now. An account not
    /// here is controlled by its own address.
    pub keys: Tracked<Address, Address>,
    /// Rotations waiting out their delay, by account.
    pub key_pending: Tracked<Address, crate::pqkey::KeyPending>,
    /// Open timelocks by lock id (the hash of the lock transaction).
    pub timelocks: Tracked<Hash, Timelock>,
    /// Tokens by id (the hash of the transaction that created them).
    pub tokens: Tracked<Hash, Token>,
    /// Token balances, by holder and then token, so one account's holdings are a range. Never zero.
    pub token_balances: Tracked<(Address, Hash), u128>,
    /// LYX destroyed on purpose (making tokens). Issued minus burned is what exists.
    pub burned: u128,
    /// Deployed contracts by address.
    pub contracts: Tracked<Address, ContractInfo>,
    /// Contract code and ABIs by keccak256. Shared, so cloning the state stays cheap.
    pub blobs: Tracked<Hash, Arc<Vec<u8>>>,
    /// Contract storage: contract -> key -> value.
    pub storage: Storage,
    /// Height and timestamp of the last applied block. Not part of the commitment (the header has
    /// them).
    pub height: u64,
    pub time: u64,
    undo_scalars: Scalars,
    cache: TrieCache,
    releases: ReleaseIndex,
}

fn entry(section: u8, key: &[u8], value: &impl BorshSerialize) -> (Hash, Hash) {
    let mut k = Vec::with_capacity(key.len() + 1);
    k.push(section);
    k.extend_from_slice(key);
    (tagged_hash(b"LOKYX/trie/key/v1", &k), tagged_hash(b"LOKYX/trie/value/v1", &borsh::to_vec(value).expect("borsh")))
}

fn scalar_entry(name: &[u8], v: &u128) -> (Hash, Hash) {
    entry(0, name, v)
}

fn token_balance_key(a: &Address, t: &Hash) -> Vec<u8> {
    let mut key = t.to_vec();
    key.extend_from_slice(&a.0);
    key
}

/// The state trie kept between blocks (see `State::root_incremental`). Not part of what a state
/// is: it is a copy of what the maps say, so two states are equal with or without it.
#[derive(Debug, Default, Clone)]
struct TrieCache(Option<crate::trie::Trie>);
impl PartialEq for TrieCache {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl Eq for TrieCache {}

/// Pending vault releases ordered by the height they come due, so a block looks only at what is
/// due instead of every pending entry. Derived from `pending`, never committed: `None` means
/// "rebuild from `pending` before use" (after an undo, a load, or a sweep).
#[derive(Debug, Default, Clone)]
struct ReleaseIndex(Option<std::collections::BTreeSet<(u64, Hash)>>);
impl PartialEq for ReleaseIndex {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl Eq for ReleaseIndex {}

/// The numbers `record` remembers. Not part of what a state *is*: two states are equal whether or
/// not one of them is recording, and a copy never records.
#[derive(Debug, Default)]
struct Scalars(Option<(u128, u128, u64, u64)>);

impl Clone for Scalars {
    fn clone(&self) -> Self {
        Scalars(None)
    }
}
impl PartialEq for Scalars {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl Eq for Scalars {}

/// What it takes to put the state back as it was before one block: the previous value of
/// everything that block touched. Written while the block is applied (`State::record`), played
/// back by `State::undo`.
#[derive(Debug, Default)]
pub struct Undo {
    accounts: Log<Address, Account>,
    immature: Log<u64, (Address, u128)>,
    swaps: Log<Hash, SwapLock>,
    vaults: Log<Address, Vault>,
    pending: Log<Hash, Pending>,
    pq: Log<Address, [u8; 32]>,
    keys: Log<Address, Address>,
    key_pending: Log<Address, crate::pqkey::KeyPending>,
    timelocks: Log<Hash, Timelock>,
    tokens: Log<Hash, Token>,
    token_balances: Log<(Address, Hash), u128>,
    contracts: Log<Address, ContractInfo>,
    blobs: Log<Hash, Arc<Vec<u8>>>,
    storage: StorageLog,
    issued: u128,
    burned: u128,
    height: u64,
    time: u64,
}

/// A state written out flat, for the node's own database. Not part of the protocol: only this
/// node reads it back, and it checks the result against the block header's state root first.
#[derive(BorshSerialize, BorshDeserialize)]
struct Image {
    issued: u128,
    burned: u128,
    height: u64,
    time: u64,
    accounts: Vec<(Address, Account)>,
    immature: Vec<(u64, (Address, u128))>,
    swaps: Vec<(Hash, SwapLock)>,
    vaults: Vec<(Address, Vault)>,
    pending: Vec<(Hash, Pending)>,
    pq: Vec<(Address, [u8; 32])>,
    keys: Vec<(Address, Address)>,
    key_pending: Vec<(Address, crate::pqkey::KeyPending)>,
    timelocks: Vec<(Hash, Timelock)>,
    tokens: Vec<(Hash, Token)>,
    token_balances: Vec<((Address, Hash), u128)>,
    contracts: Vec<(Address, ContractInfo)>,
    blobs: Vec<(Hash, Vec<u8>)>,
    storage: Vec<(Address, Vec<Slot>)>,
}

type Slot = (Vec<u8>, Vec<u8>);

impl State {
    /// Start noting what changes, so that `undo` can take it back.
    pub fn record(&mut self) {
        self.accounts.record();
        self.immature.record();
        self.swaps.record();
        self.vaults.record();
        self.pending.record();
        self.pq.record();
        self.keys.record();
        self.key_pending.record();
        self.timelocks.record();
        self.tokens.record();
        self.token_balances.record();
        self.contracts.record();
        self.blobs.record();
        self.storage.record();
        self.undo_scalars = Scalars(Some((self.issued, self.burned, self.height, self.time)));
    }

    /// Stop noting, and hand back everything needed to restore the state to how it was at `record`.
    pub fn finish(&mut self) -> Undo {
        let (issued, burned, height, time) =
            self.undo_scalars.0.take().unwrap_or((self.issued, self.burned, self.height, self.time));
        Undo {
            accounts: self.accounts.take_log(),
            immature: self.immature.take_log(),
            swaps: self.swaps.take_log(),
            vaults: self.vaults.take_log(),
            pending: self.pending.take_log(),
            pq: self.pq.take_log(),
            keys: self.keys.take_log(),
            key_pending: self.key_pending.take_log(),
            timelocks: self.timelocks.take_log(),
            tokens: self.tokens.take_log(),
            token_balances: self.token_balances.take_log(),
            contracts: self.contracts.take_log(),
            blobs: self.blobs.take_log(),
            storage: self.storage.take_log(),
            issued,
            burned,
            height,
            time,
        }
    }

    /// Put the state back as it was before the block `u` was written for.
    pub fn undo(&mut self, u: Undo) {
        self.accounts.undo(u.accounts);
        self.immature.undo(u.immature);
        self.swaps.undo(u.swaps);
        self.vaults.undo(u.vaults);
        self.pending.undo(u.pending);
        self.releases.0 = None;
        self.pq.undo(u.pq);
        self.keys.undo(u.keys);
        self.key_pending.undo(u.key_pending);
        self.timelocks.undo(u.timelocks);
        self.tokens.undo(u.tokens);
        self.token_balances.undo(u.token_balances);
        self.contracts.undo(u.contracts);
        self.blobs.undo(u.blobs);
        self.storage.undo(u.storage);
        self.issued = u.issued;
        self.burned = u.burned;
        self.height = u.height;
        self.time = u.time;
    }

    /// The whole state as bytes, for the node's database.
    pub fn to_bytes(&self) -> Vec<u8> {
        fn pairs<K: Clone + Ord, V: Clone>(m: &Tracked<K, V>) -> Vec<(K, V)> {
            m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
        }
        let img = Image {
            issued: self.issued,
            burned: self.burned,
            height: self.height,
            time: self.time,
            accounts: pairs(&self.accounts),
            immature: pairs(&self.immature),
            swaps: pairs(&self.swaps),
            vaults: pairs(&self.vaults),
            pending: pairs(&self.pending),
            pq: pairs(&self.pq),
            keys: pairs(&self.keys),
            key_pending: pairs(&self.key_pending),
            timelocks: pairs(&self.timelocks),
            tokens: pairs(&self.tokens),
            token_balances: pairs(&self.token_balances),
            contracts: pairs(&self.contracts),
            blobs: self.blobs.iter().map(|(k, v)| (*k, v.as_ref().clone())).collect(),
            storage: self
                .storage
                .iter()
                .map(|(a, m)| (*a, m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()))
                .collect(),
        };
        borsh::to_vec(&img).expect("borsh")
    }

    /// Read back what `to_bytes` wrote. Says nothing about whether the state is the right one:
    /// the caller checks its root against a header.
    pub fn from_bytes(b: &[u8]) -> Result<State, String> {
        let img: Image = borsh::from_slice(b).map_err(|e| format!("unreadable state: {e}"))?;
        let mut s =
            State { issued: img.issued, burned: img.burned, height: img.height, time: img.time, ..State::default() };
        s.accounts.extend(img.accounts);
        s.immature.extend(img.immature);
        s.swaps.extend(img.swaps);
        s.vaults.extend(img.vaults);
        s.pending.extend(img.pending);
        s.pq.extend(img.pq);
        s.keys.extend(img.keys);
        s.key_pending.extend(img.key_pending);
        s.timelocks.extend(img.timelocks);
        s.tokens.extend(img.tokens);
        s.token_balances.extend(img.token_balances);
        s.contracts.extend(img.contracts);
        s.blobs.extend(img.blobs.into_iter().map(|(k, v)| (k, Arc::new(v))));
        for (a, slots) in img.storage {
            for (k, v) in slots {
                s.storage.put(a, k, Some(v));
            }
        }
        Ok(s)
    }

    pub fn account(&self, a: &Address) -> Account {
        self.accounts.get(a).copied().unwrap_or_default()
    }

    /// Sum of all balances, locked rewards, open swaps and pending vault withdrawals. Must always
    /// equal `issued`. Contracts hold LYX in ordinary accounts, so their balances are in the
    /// first term (`contracts_total` breaks that part out for reporting).
    pub fn circulating(&self) -> u128 {
        self.accounts.values().map(|a| a.balance).sum::<u128>()
            + self.immature_total()
            + self.swaps_total()
            + self.timelocks_total()
            + self.pending_total()
    }

    /// LYX held by deployed contracts. Part of `circulating`, not on top of it.
    pub fn contracts_total(&self) -> u128 {
        self.contracts.keys().map(|a| self.account(a).balance).sum()
    }

    /// The books must balance: nothing has ever been created except by a block reward, and
    /// everything held adds up to everything issued.
    ///
    /// This is a check on our own code, not on the block: if it fails, some rule we wrote is
    /// wrong, so the node stops rather than carrying on with a supply it can't account for.
    /// `height` is the height just applied.
    pub fn check_supply(&self, height: u64, p: &ChainParams) -> Result<(), String> {
        let expected = crate::emission::issued_through(height, p);
        if self.issued != expected {
            return Err(format!("issuance at height {height} is {} but the schedule says {expected}", self.issued));
        }
        // everything issued is either held somewhere or was burned on purpose
        let held = self.circulating().checked_add(self.burned).ok_or("supply overflows")?;
        if held != self.issued {
            return Err(format!(
                "at height {height}, {held} is held or burned but {} was issued (difference {})",
                self.issued,
                held.abs_diff(self.issued)
            ));
        }
        // and every token's balances add up to the supply it says it has
        let mut by_token: std::collections::BTreeMap<Hash, u128> = Default::default();
        for ((_, t), v) in self.token_balances.iter() {
            let e = by_token.entry(*t).or_default();
            *e = e.checked_add(*v).ok_or("token supply overflows")?;
        }
        for (id, tok) in self.tokens.iter() {
            let held = by_token.remove(id).unwrap_or(0);
            if held != tok.supply {
                return Err(format!("token {} holds {held} but its supply is {}", tok.symbol, tok.supply));
            }
        }
        if !by_token.is_empty() {
            return Err("token balances for a token that doesn't exist".into());
        }
        Ok(())
    }

    pub fn pending_total(&self) -> u128 {
        self.pending
            .values()
            .map(|x| match x.kind {
                PendingKind::Withdraw { amount, .. } => amount,
                _ => 0,
            })
            .sum()
    }

    /// What a vault owner can still send today without a delayed withdrawal. None if not a vault.
    pub fn allowance_left(&self, owner: &Address, height: u64, p: &ChainParams) -> Option<u128> {
        let v = self.vaults.get(owner)?;
        let spent = if height >= v.day_start + day_blocks(p) { 0 } else { v.spent };
        Some(v.settings.allowance.saturating_sub(spent))
    }

    /// Count `amount` against a vault's daily allowance (no-op for normal accounts), and mark the
    /// owner as active.
    fn charge_allowance(&mut self, owner: Address, amount: u128, height: u64, p: &ChainParams) -> Result<(), String> {
        if let Some(v) = self.vaults.get_mut(&owner) {
            if height >= v.day_start + day_blocks(p) {
                v.day_start = height;
                v.spent = 0;
            }
            let left = v.settings.allowance.saturating_sub(v.spent);
            if amount > left {
                return Err(format!(
                    "over the vault's daily allowance ({} LYX left today), use a withdrawal",
                    crate::amount::format_lyx(left)
                ));
            }
            v.spent = v.spent.checked_add(amount).ok_or("allowance overflow")?;
            v.last_active = height;
        }
        Ok(())
    }

    pub fn swaps_total(&self) -> u128 {
        self.swaps.values().map(|l| l.amount).sum()
    }

    pub fn timelocks_total(&self) -> u128 {
        self.timelocks.values().map(|l| l.amount).sum()
    }

    /// What `a` holds of token `t`.
    pub fn token_balance(&self, a: &Address, t: &Hash) -> u128 {
        self.token_balances.get(&(*a, *t)).copied().unwrap_or(0)
    }

    /// Does `a` hold any token at all?
    pub fn holds_tokens(&self, a: &Address) -> bool {
        self.token_balances.range((*a, [0u8; 32])..=(*a, [0xffu8; 32])).next().is_some()
    }

    pub fn immature_total(&self) -> u128 {
        self.immature.values().map(|(_, v)| *v).sum()
    }

    /// Rewards earned by `a` that are still locked.
    pub fn immature_of(&self, a: &Address) -> u128 {
        self.immature.values().filter(|(x, _)| x == a).map(|(_, v)| *v).sum()
    }

    /// The state root as the header commits to it: the root of the state trie, built from scratch.
    /// O(n). This is the reference; `root_incremental` must always agree with it.
    pub fn root(&self) -> Hash {
        self.trie().root()
    }

    /// Same value as `root`, but only the entries changed since the last call are touched in a
    /// trie kept inside the state. The first call (or the first after a state is loaded) builds
    /// the trie once.
    pub fn root_incremental(&mut self) -> Hash {
        if self.cache.0.is_none() {
            let t = self.trie();
            self.discard_dirty();
            self.cache.0 = Some(t);
            return self.cache.0.as_ref().expect("just set").root();
        }
        let mut t = self.cache.0.take().expect("checked");
        let mut put = |k: Hash, v: Option<Hash>| match v {
            Some(v) => {
                t.insert(k, v);
            }
            None => {
                t.remove(&k);
            }
        };
        let (k, v) = scalar_entry(b"issued", &self.issued);
        put(k, Some(v));
        let (k, v) = scalar_entry(b"burned", &self.burned);
        put(k, Some(v));
        macro_rules! sync {
            ($field:ident, $section:expr, $key:expr) => {
                for k in self.$field.take_dirty() {
                    let (tk, _) = entry($section, &$key(&k), &0u8);
                    let v = self.$field.get(&k).map(|v| entry($section, &$key(&k), v).1);
                    put(tk, v);
                }
            };
        }
        sync!(accounts, 1, |a: &Address| a.0.to_vec());
        sync!(immature, 2, |h: &u64| h.to_be_bytes().to_vec());
        sync!(swaps, 3, |id: &Hash| id.to_vec());
        sync!(vaults, 4, |a: &Address| a.0.to_vec());
        sync!(pending, 5, |id: &Hash| id.to_vec());
        sync!(pq, 6, |a: &Address| a.0.to_vec());
        sync!(keys, 9, |a: &Address| a.0.to_vec());
        sync!(key_pending, 10, |a: &Address| a.0.to_vec());
        sync!(contracts, 7, |a: &Address| a.0.to_vec());
        sync!(timelocks, 11, |id: &Hash| id.to_vec());
        sync!(tokens, 12, |id: &Hash| id.to_vec());
        sync!(token_balances, 13, |k: &(Address, Hash)| token_balance_key(&k.0, &k.1));
        let _ = self.blobs.take_dirty(); // committed through the hashes in `contracts`
        for (c, slot) in self.storage.take_dirty() {
            let mut key = c.0.to_vec();
            key.extend_from_slice(&slot);
            let (tk, _) = entry(8, &key, &0u8);
            let v = self.storage.get(&c).and_then(|m| m.get(&slot)).map(|v| entry(8, &key, v).1);
            put(tk, v);
        }
        let root = t.root();
        self.cache.0 = Some(t);
        root
    }

    fn discard_dirty(&mut self) {
        let _ = self.accounts.take_dirty();
        let _ = self.immature.take_dirty();
        let _ = self.swaps.take_dirty();
        let _ = self.vaults.take_dirty();
        let _ = self.pending.take_dirty();
        let _ = self.pq.take_dirty();
        let _ = self.keys.take_dirty();
        let _ = self.key_pending.take_dirty();
        let _ = self.timelocks.take_dirty();
        let _ = self.tokens.take_dirty();
        let _ = self.token_balances.take_dirty();
        let _ = self.contracts.take_dirty();
        let _ = self.blobs.take_dirty();
        let _ = self.storage.take_dirty();
    }

    /// Every entry of the state as (trie key, trie value). Each section has its own tag, so an
    /// account and a swap with the same bytes for a key can't collide. Contract code and ABIs
    /// aren't listed: they are named by hash inside `contracts`, so they are committed anyway.
    pub fn trie_entries(&self) -> Vec<(Hash, Hash)> {
        let mut out = vec![scalar_entry(b"issued", &self.issued), scalar_entry(b"burned", &self.burned)];
        out.extend(self.accounts.iter().map(|(a, v)| entry(1, &a.0, v)));
        out.extend(self.immature.iter().map(|(h, v)| entry(2, &h.to_be_bytes(), v)));
        out.extend(self.swaps.iter().map(|(id, v)| entry(3, id, v)));
        out.extend(self.vaults.iter().map(|(a, v)| entry(4, &a.0, v)));
        out.extend(self.pending.iter().map(|(id, v)| entry(5, id, v)));
        out.extend(self.pq.iter().map(|(a, v)| entry(6, &a.0, v)));
        out.extend(self.keys.iter().map(|(a, v)| entry(9, &a.0, v)));
        out.extend(self.key_pending.iter().map(|(a, v)| entry(10, &a.0, v)));
        out.extend(self.contracts.iter().map(|(a, v)| entry(7, &a.0, v)));
        out.extend(self.timelocks.iter().map(|(id, v)| entry(11, id, v)));
        out.extend(self.tokens.iter().map(|(id, v)| entry(12, id, v)));
        out.extend(self.token_balances.iter().map(|((a, t), v)| entry(13, &token_balance_key(a, t), v)));
        for (c, slots) in self.storage.iter() {
            for (k, v) in slots {
                let mut key = c.0.to_vec();
                key.extend_from_slice(k);
                out.push(entry(8, &key, v));
            }
        }
        out
    }

    /// The state as a Merkle trie, for proofs. Built from scratch, O(n).
    pub fn trie(&self) -> crate::trie::Trie {
        let mut t = crate::trie::Trie::new();
        for (k, v) in self.trie_entries() {
            t.insert(k, v);
        }
        t
    }

    /// The trie key and value of an account, for checking a proof against `trie().root()`.
    pub fn account_entry(a: &Address, acc: &Account) -> (Hash, Hash) {
        let k = tagged_hash(b"LOKYX/trie/key/v1", &[&[1u8][..], &a.0[..]].concat());
        (k, tagged_hash(b"LOKYX/trie/value/v1", &borsh::to_vec(acc).expect("borsh")))
    }

    /// Just the trie key of an account.
    pub fn account_key(a: &Address) -> Hash {
        tagged_hash(b"LOKYX/trie/key/v1", &[&[1u8][..], &a.0[..]].concat())
    }

    /// Swap rules that depend on state, for a swap tx going into a block at `height`.
    /// Doesn't look at the nonce. Used by block validation and the mempool.
    pub fn check_swap(&self, stx: &SignedTransaction, sender: Address, height: u64) -> Result<SwapOp, String> {
        let tx = &stx.tx;
        let op = crate::swap::op_of(stx).ok_or("not a swap operation")?;
        match &op {
            SwapOp::Lock { amount, refund_height, .. } => {
                if *refund_height <= height {
                    return Err("swap refund height has already passed".into());
                }
                if *refund_height > height + MAX_LOCK_BLOCKS {
                    return Err(format!("swap lock longer than {MAX_LOCK_BLOCKS} blocks"));
                }
                let total = amount.checked_add(tx.fee).ok_or("overflow")?;
                if self.account(&sender).balance < total {
                    return Err(format!("insufficient balance for {sender}"));
                }
            }
            SwapOp::Claim { lock, secret } => {
                let l = self.swaps.get(lock).ok_or("no open swap with that id")?;
                if sender != l.recipient {
                    return Err("only the swap recipient can claim".into());
                }
                if height >= l.refund_height {
                    return Err("swap expired, it can only be refunded now".into());
                }
                if sha256(secret) != l.hashlock {
                    return Err("wrong swap secret".into());
                }
                if tx.fee > l.amount {
                    return Err("fee is more than the swap amount".into());
                }
            }
            SwapOp::Refund { lock } => {
                let l = self.swaps.get(lock).ok_or("no open swap with that id")?;
                if sender != l.sender {
                    return Err("only whoever locked the swap can refund it".into());
                }
                if height < l.refund_height {
                    return Err(format!("swap can't be refunded before block {}", l.refund_height));
                }
                if tx.fee > l.amount {
                    return Err("fee is more than the swap amount".into());
                }
            }
        }
        Ok(op)
    }

    /// The address of the key that controls an account. It is the account's own address until the
    /// account rotates its key.
    pub fn controller(&self, a: &Address) -> Address {
        self.keys.get(a).copied().unwrap_or(*a)
    }

    /// Is the signature from the key that controls `from`?
    pub fn check_signer(&self, stx: &SignedTransaction, signer: Address) -> Result<(), String> {
        if self.controller(&stx.tx.from) != signer {
            return Err(format!("the signature isn't from the key that controls {}", stx.tx.from));
        }
        Ok(())
    }

    /// The rules every transaction meets that depend on state but not on its kind: whose
    /// signature, expiry, nonce. Used by block validation and the mempool (which has its own
    /// nonce queue, so it passes `nonce: false`).
    pub fn check_common(
        &self,
        stx: &SignedTransaction,
        signer: Address,
        height: u64,
        nonce: bool,
    ) -> Result<(), String> {
        let tx = &stx.tx;
        self.check_signer(stx, signer)?;
        if tx.expires != 0 && height > tx.expires {
            return Err(format!("expired: it could be included up to block {}", tx.expires));
        }
        if nonce {
            let have = self.account(&tx.from).nonce;
            if tx.nonce != have {
                return Err(format!("bad nonce {} for {} (expected {have})", tx.nonce, tx.from));
            }
        }
        Ok(())
    }

    /// Apply one transaction whose stateless checks already passed, as part of the block at
    /// `height`. `signer` is what `check_stateless` returned. Returns the fee.
    pub fn apply_tx(
        &mut self,
        stx: &SignedTransaction,
        signer: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        self.apply_tx_with(stx, signer, height, p).map(|(fee, _)| fee)
    }

    /// Like `apply_tx`, plus the receipt for a contract transaction.
    pub fn apply_tx_with(
        &mut self,
        stx: &SignedTransaction,
        signer: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<(u128, Option<Receipt>), String> {
        self.check_common(stx, signer, height, true)?;
        let sender = stx.tx.from;
        match &stx.tx.op {
            Op::Deploy { .. } | Op::Call { .. } => {
                if !p.contracts_active(height) {
                    return Err(CONTRACTS_OFF.into());
                }
                self.apply_contract(stx, sender, height, p)
            }
            _ => self.apply_plain(stx, sender, height, p).map(|f| (f, None)),
        }
    }

    /// Contract rules that depend on state. Doesn't look at the nonce. Used by block validation
    /// and the mempool.
    pub fn check_contract(&self, stx: &SignedTransaction, sender: Address) -> Result<ContractOp, String> {
        let tx = &stx.tx;
        if self.vaults.contains_key(&sender) {
            return Err("vault accounts can't use contracts. Use a normal account for apps".into());
        }
        let (to, value, op) = tx.op.contract_op().ok_or("not a contract operation")?;
        if let ContractOp::Call { .. } = &op
            && !self.contracts.contains_key(&to)
        {
            return Err(format!("there's no contract at {to}"));
        }
        op.check()?;
        if tx.fee < stx.min_fee() {
            return Err(format!("fee must cover the size fee plus gas limit x {GAS_PRICE}"));
        }
        let total = value.checked_add(tx.fee).ok_or("overflow")?;
        if self.account(&sender).balance < total {
            return Err(format!("insufficient balance for {sender}"));
        }
        Ok(op)
    }

    fn apply_contract(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<(u128, Option<Receipt>), String> {
        let tx = &stx.tx;
        let op = self.check_contract(stx, sender)?;
        let (to, value, _) = tx.op.contract_op().expect("checked");
        // Take the value and the most the fee can be; whatever gas isn't used comes back.
        self.spend(sender, &tx.op, tx.fee, height, p)?;
        let env = contract::Env { height, time: self.time + p.min_block_spacing };
        let run = contract::run(self, sender, tx.nonce, to, value, &op, env);
        let unused = (op.gas() - run.gas_used) as u128 * GAS_PRICE;
        let fee = tx.fee - unused;
        let logs = run.changes.logs.clone();
        let mut back = unused;
        if run.ok {
            run.changes.apply(self);
        } else {
            back += value;
        }
        self.credit(sender, back)?;
        let receipt = Receipt {
            ok: run.ok,
            gas_used: run.gas_used,
            fee,
            output: run.output,
            error: run.error,
            logs: if run.ok { logs } else { vec![] },
            contract: run.contract.filter(|_| run.ok),
        };
        Ok((fee, Some(receipt)))
    }

    /// The one place LYX leaves a sender's own account for a transaction. It checks the balance,
    /// counts the cost against a vault's daily allowance (`Op::allowance_cost`, which defaults to
    /// everything that leaves at once, so an operation nobody thought about is still charged),
    /// takes the money and counts the transaction. Every operation that moves the sender's LYX goes
    /// through here.
    fn spend(&mut self, who: Address, op: &Op, fee: u128, height: u64, p: &ChainParams) -> Result<(), String> {
        let total = op.outflow().checked_add(fee).ok_or("amount plus fee overflows")?;
        if self.account(&who).balance < total {
            return Err(format!("insufficient balance for {who}"));
        }
        self.charge_allowance(who, op.allowance_cost(fee), height, p)?;
        self.debit(who, total, true)
    }

    /// Is `a` somewhere plain LYX can't be sent to?
    pub fn check_payee(&self, a: &Address) -> Result<(), String> {
        if contract::is_system(a) {
            return Err("can't send to a system address".into());
        }
        if self.contracts.contains_key(a) {
            return Err("that address is a contract. Send it a contract call, not a plain transfer".into());
        }
        Ok(())
    }

    fn apply_plain(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        let tx = &stx.tx;
        match &tx.op {
            Op::Swap(_) => self.apply_swap(stx, sender, height, p),
            Op::Vault(_) => self.apply_vault(stx, sender, height, p),
            Op::Key(_) => self.apply_key(stx, sender, height, p),
            Op::Transfer { to, value } => {
                self.check_payee(to)?;
                self.spend(sender, &tx.op, tx.fee, height, p)?;
                self.credit(*to, *value)?;
                Ok(tx.fee)
            }
            Op::Batch(v) => {
                for (to, _) in v {
                    self.check_payee(to)?;
                }
                self.spend(sender, &tx.op, tx.fee, height, p)?;
                for (to, value) in v {
                    self.credit(*to, *value)?;
                }
                Ok(tx.fee)
            }
            Op::Timelock(_) => self.apply_timelock(stx, sender, height, p),
            Op::Token(_) => self.apply_token(stx, sender, height, p),
            Op::Deploy { .. } | Op::Call { .. } => unreachable!("routed to apply_contract"),
        }
    }

    /// Timelock rules that depend on state. Doesn't look at the nonce.
    pub fn check_timelock(
        &self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<TimelockOp, String> {
        let tx = &stx.tx;
        let Op::Timelock(op) = &tx.op else { return Err("not a timelock operation".into()) };
        match op {
            TimelockOp::Lock { beneficiary, amount, unlock_height } => {
                if *unlock_height <= height {
                    return Err("the unlock height has already passed".into());
                }
                if *unlock_height > height + max_lock_blocks(p) {
                    return Err(format!(
                        "a timelock can be set at most {} years ahead",
                        crate::timelock::MAX_LOCK_YEARS
                    ));
                }
                self.check_payee(beneficiary)?;
                let total = amount.checked_add(tx.fee).ok_or("overflow")?;
                if self.account(&sender).balance < total {
                    return Err(format!("insufficient balance for {sender}"));
                }
            }
            TimelockOp::Claim { id } => {
                let l = self.timelocks.get(id).ok_or("no open timelock with that id")?;
                if sender != l.beneficiary {
                    return Err("only the beneficiary can claim a timelock".into());
                }
                if height < l.unlock_height {
                    return Err(format!("this timelock opens at block {}", l.unlock_height));
                }
                if tx.fee > l.amount {
                    return Err("fee is more than the locked amount".into());
                }
            }
        }
        Ok(op.clone())
    }

    fn apply_timelock(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        let tx = &stx.tx;
        match self.check_timelock(stx, sender, height, p)? {
            TimelockOp::Lock { beneficiary, amount, unlock_height } => {
                self.spend(sender, &tx.op, tx.fee, height, p)?;
                let l = Timelock { creator: sender, beneficiary, amount, unlock_height, height };
                self.timelocks.insert(stx.hash(), l);
            }
            TimelockOp::Claim { id } => {
                self.charge_allowance(sender, tx.op.allowance_cost(tx.fee), height, p)?;
                let l = self.timelocks.remove(&id).expect("checked");
                let f = self.accounts.entry(sender).or_default();
                f.nonce += 1;
                f.balance = f.balance.checked_add(l.amount - tx.fee).ok_or("balance overflow")?;
            }
        }
        Ok(tx.fee)
    }

    /// Token rules that depend on state. Doesn't look at the nonce.
    pub fn check_token(&self, stx: &SignedTransaction, sender: Address) -> Result<TokenOp, String> {
        let tx = &stx.tx;
        let Op::Token(op) = &tx.op else { return Err("not a token operation".into()) };
        if self.vaults.contains_key(&sender) {
            return Err("vault accounts can't use tokens. Use a normal account".into());
        }
        let need = op.lyx_burn().checked_add(tx.fee).ok_or("overflow")?;
        if self.account(&sender).balance < need {
            return Err(format!("insufficient balance for {sender}"));
        }
        match op {
            TokenOp::Create { .. } => {}
            TokenOp::Transfer { token, to, amount } => {
                if !self.tokens.contains_key(token) {
                    return Err("no token with that id".into());
                }
                if self.token_balance(&sender, token) < *amount {
                    return Err(format!("insufficient token balance for {sender}"));
                }
                self.check_payee(to)?;
                if self.vaults.contains_key(to) {
                    return Err("a vault can't hold tokens".into());
                }
            }
            TokenOp::Burn { token, amount } => {
                if !self.tokens.contains_key(token) {
                    return Err("no token with that id".into());
                }
                if self.token_balance(&sender, token) < *amount {
                    return Err(format!("insufficient token balance for {sender}"));
                }
            }
        }
        Ok(op.clone())
    }

    /// Add to or take from a token balance, keeping the rule that a balance is never stored as 0.
    fn token_credit(&mut self, a: Address, t: Hash, v: u128) -> Result<(), String> {
        let e = self.token_balances.entry((a, t)).or_default();
        *e = e.checked_add(v).ok_or("token balance overflow")?;
        Ok(())
    }

    fn token_debit(&mut self, a: Address, t: Hash, v: u128) -> Result<(), String> {
        let have = self.token_balance(&a, &t);
        let left = have.checked_sub(v).ok_or_else(|| format!("insufficient token balance for {a}"))?;
        if left == 0 {
            self.token_balances.remove(&(a, t));
        } else {
            self.token_balances.insert((a, t), left);
        }
        Ok(())
    }

    fn apply_token(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        let tx = &stx.tx;
        let op = self.check_token(stx, sender)?;
        self.spend(sender, &tx.op, tx.fee, height, p)?;
        match op {
            TokenOp::Create { symbol, name, decimals, supply } => {
                self.burned = self.burned.checked_add(crate::token::TOKEN_CREATE_BURN).ok_or("burn overflow")?;
                let id = stx.hash();
                self.tokens.insert(id, Token { symbol, name, decimals, supply, creator: sender, height });
                self.token_credit(sender, id, supply)?;
            }
            TokenOp::Transfer { token, to, amount } => {
                self.token_debit(sender, token, amount)?;
                self.token_credit(to, token, amount)?;
            }
            TokenOp::Burn { token, amount } => {
                self.token_debit(sender, token, amount)?;
                let t = self.tokens.get_mut(&token).expect("checked");
                t.supply = t.supply.checked_sub(amount).ok_or("token supply underflow")?;
            }
        }
        Ok(tx.fee)
    }

    fn apply_swap(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        let tx = &stx.tx;
        match self.check_swap(stx, sender, height)? {
            SwapOp::Lock { amount, hashlock, recipient, refund_height } => {
                self.spend(sender, &tx.op, tx.fee, height, p)?;
                let lock = SwapLock { sender, recipient, amount, hashlock, refund_height, height };
                self.swaps.insert(stx.hash(), lock);
            }
            SwapOp::Claim { lock, .. } | SwapOp::Refund { lock } => {
                self.charge_allowance(sender, tx.op.allowance_cost(tx.fee), height, p)?;
                let l = self.swaps.remove(&lock).expect("checked");
                let f = self.accounts.entry(sender).or_default();
                f.nonce += 1;
                f.balance = f.balance.checked_add(l.amount - tx.fee).ok_or("balance overflow")?;
            }
        }
        Ok(tx.fee)
    }

    /// Apply a block body (transactions + reward) without checking the header's state root.
    pub fn apply_body(
        &mut self,
        height: u64,
        coinbase: Address,
        txs: &[SignedTransaction],
        p: &ChainParams,
    ) -> Result<(), String> {
        self.apply_body_with(height, coinbase, txs, p).map(|_| ())
    }

    /// Like `apply_body`, returning the receipts of contract transactions by tx hash.
    pub fn apply_body_with(
        &mut self,
        height: u64,
        coinbase: Address,
        txs: &[SignedTransaction],
        p: &ChainParams,
    ) -> Result<Vec<(Hash, Receipt)>, String> {
        check_block_gas(txs)?;
        self.begin_block(height)?;
        let mut fees: u128 = 0;
        let mut receipts = Vec::new();
        for (i, stx) in txs.iter().enumerate() {
            let sender = stx.check_stateless(p).map_err(|e| format!("tx {i}: {e}"))?;
            let (fee, r) = self.apply_tx_with(stx, sender, height, p).map_err(|e| format!("tx {i}: {e}"))?;
            fees = fees.checked_add(fee).ok_or("fee overflow")?;
            if let Some(r) = r {
                receipts.push((stx.hash(), r));
            }
        }
        let reward = block_reward(height, p);
        let earned = reward.checked_add(fees).ok_or("coinbase overflow")?;
        self.issued = self.issued.checked_add(reward).ok_or("issuance overflow")?;
        if p.coinbase_maturity == 0 {
            self.credit(coinbase, earned)?;
        } else {
            // Unlock the reward from `maturity` blocks ago, then lock this block's.
            if let Some(unlock_at) = height.checked_sub(p.coinbase_maturity)
                && let Some((a, v)) = self.immature.remove(&unlock_at)
            {
                self.credit(a, v)?;
            }
            self.immature.insert(height, (coinbase, earned));
        }
        Ok(receipts)
    }

    /// Vault rules that depend on state, for a vault tx going into a block at `height`. Doesn't
    /// look at the nonce. Used by block validation and the mempool.
    pub fn check_vault(
        &self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<VaultOp, String> {
        let fee = stx.tx.fee;
        let op = crate::vault::op_of(stx).ok_or("not a vault operation")?;
        let balance = self.account(&sender).balance;
        let own_vault = || self.vaults.get(&sender).ok_or_else(|| "this account isn't a vault".to_string());
        let allowance_ok = |amount: u128| match self.allowance_left(&sender, height, p) {
            Some(left) if amount > left => {
                Err(format!("over the vault's daily allowance ({} LYX left today)", crate::amount::format_lyx(left)))
            }
            _ => Ok(()),
        };
        match &op {
            VaultOp::Create(s) => {
                if self.vaults.contains_key(&sender) {
                    return Err("this account is already a vault".into());
                }
                check_settings(s, sender, p)?;
                if self.holds_tokens(&sender) {
                    return Err("an account that holds tokens can't become a vault. Send them away first".into());
                }
                if balance < fee {
                    return Err(format!("insufficient balance for {sender}"));
                }
            }
            VaultOp::Withdraw { to, amount } => {
                own_vault()?;
                if *amount == 0 {
                    return Err("withdrawal amount is zero".into());
                }
                if contract::is_system(to) {
                    return Err("can't withdraw to a system address".into());
                }
                if balance < amount.checked_add(fee).ok_or("overflow")? {
                    return Err(format!("insufficient balance for {sender}"));
                }
                allowance_ok(fee)?;
            }
            VaultOp::Update(s) => {
                own_vault()?;
                check_settings(s, sender, p)?;
                if balance < fee {
                    return Err(format!("insufficient balance for {sender}"));
                }
                allowance_ok(fee)?;
            }
            VaultOp::Close => {
                own_vault()?;
                if balance < fee {
                    return Err(format!("insufficient balance for {sender}"));
                }
                allowance_ok(fee)?;
            }
            VaultOp::Cancel { id } => {
                let x = self.pending.get(id).ok_or("nothing pending with that id")?;
                let recovery = self.vaults.get(&x.vault).map(|v| v.settings.recovery);
                if sender != x.vault && Some(sender) != recovery {
                    return Err("only the vault owner or its recovery key can cancel".into());
                }
                let back = match x.kind {
                    PendingKind::Withdraw { amount, .. } => amount,
                    _ => 0,
                };
                if self.account(&x.vault).balance + back < fee {
                    return Err("the vault can't cover the fee".into());
                }
                if sender == x.vault {
                    allowance_ok(fee)?;
                }
            }
            VaultOp::Sweep { vault } => {
                let v = self.vaults.get(vault).ok_or("no vault at that address")?;
                if sender != v.settings.recovery {
                    return Err("only the recovery key can sweep a vault".into());
                }
                if self.sweep_total(vault) < fee {
                    return Err("the vault can't cover the fee".into());
                }
            }
            VaultOp::HeirClaim { vault } => {
                let v = self.vaults.get(vault).ok_or("no vault at that address")?;
                let h = v.settings.heir.as_ref().ok_or("this vault has no heir")?;
                if sender != h.address {
                    return Err("only the heir can claim".into());
                }
                let from = v.last_active + h.inactive_blocks;
                if height < from {
                    return Err(format!("the owner was active recently; the heir can claim from block {from}"));
                }
                if self.account(vault).balance <= fee {
                    return Err("the vault is empty".into());
                }
            }
        }
        Ok(op)
    }

    /// Key op rules that depend on state. Doesn't look at the nonce.
    pub fn check_key(&self, stx: &SignedTransaction, sender: Address) -> Result<(), String> {
        use crate::pqkey::KeyOp;
        let op = crate::pqkey::op_of(stx).ok_or("not a key operation")?;
        let fee = stx.tx.fee;
        let own_fee = |s: &State| -> Result<(), String> {
            if s.account(&sender).balance < fee {
                return Err(format!("insufficient balance for {sender}"));
            }
            Ok(())
        };
        match op {
            KeyOp::CommitPq { .. } => {
                if self.pq.contains_key(&sender) {
                    return Err("this account already has a quantum key commitment, and it can't be changed".into());
                }
                own_fee(self)
            }
            KeyOp::Rotate { new_key } => {
                if self.key_pending.contains_key(&sender) {
                    return Err("a key rotation is already waiting for this account. Cancel it first".into());
                }
                if new_key == self.controller(&sender) {
                    return Err("that key already controls this account".into());
                }
                own_fee(self)
            }
            KeyOp::CancelRotate { account } => {
                if !self.key_pending.contains_key(&account) {
                    return Err("no key rotation is waiting for that account".into());
                }
                if account == sender {
                    return own_fee(self);
                }
                let recovery = self.vaults.get(&account).map(|v| v.settings.recovery);
                if Some(sender) != recovery {
                    return Err("only the account's own key or its vault's recovery key can cancel a rotation".into());
                }
                if self.account(&account).balance < fee {
                    return Err("the vault can't cover the fee".into());
                }
                Ok(())
            }
        }
    }

    fn apply_key(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        use crate::pqkey::{KeyOp, KeyPending};
        self.check_key(stx, sender)?;
        let tx = &stx.tx;
        match crate::pqkey::op_of(stx).expect("key op") {
            KeyOp::CommitPq { hash } => {
                self.spend(sender, &tx.op, tx.fee, height, p)?;
                self.pq.insert(sender, hash);
            }
            KeyOp::Rotate { new_key } => {
                let wait = match self.vaults.get(&sender) {
                    Some(v) => v.settings.delay,
                    None => crate::vault::day_blocks(p),
                };
                self.spend(sender, &tx.op, tx.fee, height, p)?;
                self.key_pending.insert(sender, KeyPending { new_key, release: height + wait });
            }
            KeyOp::CancelRotate { account } => {
                if account == sender {
                    self.spend(sender, &tx.op, tx.fee, height, p)?;
                } else {
                    // the recovery key has no LYX of its own; the vault pays, as for a vault cancel
                    self.debit(account, tx.fee, false)?;
                    self.bump_nonce(sender)?;
                }
                self.key_pending.remove(&account);
            }
        }
        Ok(tx.fee)
    }

    /// Rotations whose delay is over take effect, in account order, before the block's transactions.
    fn release_keys(&mut self, height: u64) {
        let due: Vec<(Address, crate::pqkey::KeyPending)> =
            self.key_pending.iter().filter(|(_, k)| k.release <= height).map(|(a, k)| (*a, k.clone())).collect();
        for (a, k) in due {
            self.key_pending.remove(&a);
            if k.new_key == a {
                self.keys.remove(&a);
            } else {
                self.keys.insert(a, k.new_key);
            }
        }
    }

    /// Owner balance plus everything pending withdrawal: what a sweep moves.
    fn sweep_total(&self, vault: &Address) -> u128 {
        self.account(vault).balance
            + self
                .pending
                .values()
                .filter(|x| x.vault == *vault)
                .map(|x| match x.kind {
                    PendingKind::Withdraw { amount, .. } => amount,
                    _ => 0,
                })
                .sum::<u128>()
    }

    fn apply_vault(
        &mut self,
        stx: &SignedTransaction,
        sender: Address,
        height: u64,
        p: &ChainParams,
    ) -> Result<u128, String> {
        let fee = stx.tx.fee;
        let id = stx.hash();
        let op = self.check_vault(stx, sender, height, p)?;
        let delay = |s: &Self| s.vaults.get(&sender).map(|v| v.settings.delay).unwrap_or(0);
        match op {
            VaultOp::Create(settings) => {
                self.debit(sender, fee, true)?;
                self.vaults.insert(sender, Vault { settings, day_start: height, spent: 0, last_active: height });
            }
            VaultOp::Withdraw { to, amount } => {
                self.charge_allowance(sender, fee, height, p)?;
                let release = height + delay(self);
                self.debit(sender, amount.checked_add(fee).ok_or("amount plus fee overflows")?, true)?;
                let kind = PendingKind::Withdraw { to, amount };
                self.put_pending(id, Pending { vault: sender, kind, release, height, by_heir: false });
            }
            VaultOp::Update(_) | VaultOp::Close => {
                self.charge_allowance(sender, fee, height, p)?;
                let release = height + delay(self);
                self.debit(sender, fee, true)?;
                let kind = match op {
                    VaultOp::Update(s) => PendingKind::Update(s),
                    _ => PendingKind::Close,
                };
                self.put_pending(id, Pending { vault: sender, kind, release, height, by_heir: false });
            }
            VaultOp::Cancel { id: target } => {
                let x = self.take_pending(&target).expect("checked");
                if sender == x.vault {
                    self.charge_allowance(sender, fee, height, p)?;
                }
                let back = match x.kind {
                    PendingKind::Withdraw { amount, .. } => amount,
                    _ => 0,
                };
                // The cancelled withdrawal's amount comes back, minus this transaction's fee.
                self.credit(x.vault, back)?;
                self.debit(x.vault, fee, false)?;
                self.bump_nonce(sender)?;
            }
            VaultOp::Sweep { vault } => {
                let total = self.sweep_total(&vault);
                self.pending.retain(|_, x| x.vault != vault);
                self.releases.0 = None;
                self.accounts.entry(vault).or_default().balance = 0;
                let safe = self.vaults[&vault].settings.safe;
                self.credit(safe, total.checked_sub(fee).ok_or("the fee is more than the vault holds")?)?;
                self.bump_nonce(sender)?;
            }
            VaultOp::HeirClaim { vault } => {
                let v = &self.vaults[&vault];
                let (to, release) = (sender, height + v.settings.delay);
                let a = self.accounts.entry(vault).or_default();
                let amount = a.balance.checked_sub(fee).ok_or("the fee is more than the vault holds")?;
                a.balance = 0;
                self.bump_nonce(sender)?;
                let kind = PendingKind::Withdraw { to, amount };
                self.put_pending(id, Pending { vault, kind, release, height, by_heir: true });
            }
        }
        Ok(fee)
    }

    /// Withdrawals and settings changes whose delay is over take effect at the start of a block.
    /// What happens at the start of the block at `height`, before its transactions: waiting vault
    /// releases and key rotations come due. The mempool's block selection runs it too, so what it
    /// picks is valid for the block it is picked for.
    pub fn begin_block(&mut self, height: u64) -> Result<(), String> {
        self.height = height;
        self.release_pending(height)?;
        self.release_keys(height);
        Ok(())
    }

    fn put_pending(&mut self, id: Hash, x: Pending) {
        if let Some(i) = &mut self.releases.0 {
            i.insert((x.release, id));
        }
        self.pending.insert(id, x);
    }

    fn take_pending(&mut self, id: &Hash) -> Option<Pending> {
        let x = self.pending.remove(id)?;
        if let Some(i) = &mut self.releases.0 {
            i.remove(&(x.release, *id));
        }
        Some(x)
    }

    /// The release index, rebuilt from `pending` if it was dropped.
    fn release_index(&mut self) -> &mut std::collections::BTreeSet<(u64, Hash)> {
        if self.releases.0.is_none() {
            self.releases.0 = Some(self.pending.iter().map(|(id, x)| (x.release, *id)).collect());
        }
        self.releases.0.as_mut().expect("just built")
    }

    /// Whether the release index (if there is one) matches `pending`. For tests.
    pub fn release_index_consistent(&self) -> bool {
        match &self.releases.0 {
            None => true,
            Some(i) => {
                let scan: std::collections::BTreeSet<(u64, Hash)> =
                    self.pending.iter().map(|(id, x)| (x.release, *id)).collect();
                *i == scan
            }
        }
    }

    fn release_pending(&mut self, height: u64) -> Result<(), String> {
        let mut due: Vec<Hash> = self.release_index().range(..=(height, [0xff; 32])).map(|(_, id)| *id).collect();
        // Applied in id order, as when this scanned every entry: two releases for one vault in the
        // same block (an update and a close) must not change order.
        due.sort_unstable();
        for id in due {
            let x = self.take_pending(&id).expect("listed");
            match x.kind {
                PendingKind::Withdraw { to, amount } => self.credit(to, amount)?,
                PendingKind::Update(s) => {
                    if let Some(v) = self.vaults.get_mut(&x.vault) {
                        v.settings = s;
                    }
                }
                PendingKind::Close => {
                    self.vaults.remove(&x.vault);
                }
            }
        }
        Ok(())
    }

    fn credit(&mut self, a: Address, v: u128) -> Result<(), String> {
        let acc = self.accounts.entry(a).or_default();
        acc.balance = acc.balance.checked_add(v).ok_or("balance overflow")?;
        Ok(())
    }

    /// Take `v` from an account and count the transaction. Every balance check in this file is
    /// made before the money moves, so reaching the error here would mean one of those checks is
    /// wrong: better an invalid block than a balance that wrapped round to an enormous number.
    fn debit(&mut self, a: Address, v: u128, nonce: bool) -> Result<(), String> {
        let acc = self.accounts.entry(a).or_default();
        acc.balance = acc.balance.checked_sub(v).ok_or_else(|| format!("insufficient balance for {a}"))?;
        if nonce {
            acc.nonce = acc.nonce.checked_add(1).ok_or("nonce overflow")?;
        }
        Ok(())
    }

    fn bump_nonce(&mut self, a: Address) -> Result<(), String> {
        let acc = self.accounts.entry(a).or_default();
        acc.nonce = acc.nonce.checked_add(1).ok_or("nonce overflow")?;
        Ok(())
    }

    /// Full block application including the state-root commitment check.
    pub fn apply_block(&mut self, block: &Block, p: &ChainParams) -> Result<Vec<(Hash, Receipt)>, String> {
        let receipts = self.apply_body_with(block.header.height, block.header.coinbase, &block.txs, p)?;
        self.time = block.header.timestamp;
        let root = self.root_incremental();
        if root != block.header.state_root {
            return Err("state root mismatch".into());
        }
        if crate::contract::receipts_root(&receipts) != block.header.receipts_root {
            return Err("receipts root mismatch".into());
        }
        Ok(receipts)
    }
}

pub const CONTRACTS_OFF: &str = "contracts aren't active on this network yet";

/// The gas limits of a block's transactions must add up to no more than the block limit.
///
/// Checked, not `.sum()`: a block whose limits overflow a u64 has to be refused the same way in
/// every build. An unchecked sum panics in a debug build and wraps in a release one, and a
/// wrapped total would slip under the block limit. Both the pre-storage body check and applying
/// the block go through here, so they can't disagree.
pub fn check_block_gas(txs: &[SignedTransaction]) -> Result<u64, String> {
    let mut gas: u64 = 0;
    for g in txs.iter().filter_map(contract_gas) {
        gas = gas.checked_add(g).ok_or("contract gas limits overflow a 64-bit total")?;
    }
    if gas > contract::BLOCK_GAS_LIMIT {
        return Err(format!("contract gas limits add up to {gas}, over the block limit"));
    }
    Ok(gas)
}

/// Is this a contract deploy or call?
pub fn is_contract_tx(stx: &SignedTransaction) -> bool {
    matches!(stx.tx.op, Op::Deploy { .. } | Op::Call { .. })
}

/// The gas a contract transaction declares, for the per-block limit.
pub fn contract_gas(stx: &SignedTransaction) -> Option<u64> {
    stx.tx.op.gas()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::address_of;
    use crate::params::{COIN, ChainParams, DEVNET};
    use crate::tx::build_transfer;

    fn instant() -> ChainParams {
        ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }
    }
    use k256::ecdsa::SigningKey;
    use rand::rngs::OsRng;

    #[test]
    fn transfers_nonces_and_double_spend() {
        let p = &instant();
        let alice = SigningKey::random(&mut OsRng);
        let a = address_of(&alice);
        let bob = Address([2; 20]);
        let miner = Address([3; 20]);
        let mut s = State::default();
        s.apply_body(1, a, &[], p).unwrap(); // alice mines block 1: 10 LYX
        assert_eq!(s.account(&a).balance, 10 * COIN);

        let t0 = build_transfer(&alice, p, 0, bob, 6 * COIN, None).unwrap();
        let t0_fee = t0.tx.fee;
        // Second spend of the same funds (nonce 1, 6 LYX) must fail inside the same block.
        let t1 = build_transfer(&alice, p, 1, bob, 6 * COIN, None).unwrap();
        let mut s2 = s.clone();
        assert!(s2.apply_body(2, miner, &[t0.clone(), t1], p).unwrap_err().contains("insufficient"));
        // Replay of the same tx (same nonce) must fail.
        let mut s3 = s.clone();
        assert!(s3.apply_body(2, miner, &[t0.clone(), t0.clone()], p).unwrap_err().contains("bad nonce"));

        s.apply_body(2, miner, &[t0], p).unwrap();
        assert_eq!(s.account(&bob).balance, 6 * COIN);
        assert_eq!(s.account(&a).nonce, 1);
        assert_eq!(s.account(&miner).balance, 10 * COIN + t0_fee);
        assert_eq!(s.issued, 20 * COIN);
        assert_eq!(s.circulating(), s.issued, "supply invariant");
    }

    #[test]
    fn rewards_unlock_after_maturity() {
        let p = &ChainParams { coinbase_maturity: 3, ..DEVNET.clone() };
        let m = Address([4; 20]);
        let mut s = State::default();
        for h in 1..=3 {
            s.apply_body(h, m, &[], p).unwrap();
            assert_eq!(s.account(&m).balance, 0, "locked at height {h}");
        }
        assert_eq!(s.immature_of(&m), 30 * COIN);
        s.apply_body(4, m, &[], p).unwrap(); // block 1's reward unlocks
        assert_eq!(s.account(&m).balance, 10 * COIN);
        assert_eq!(s.immature_of(&m), 30 * COIN);
        assert_eq!(s.circulating(), s.issued);
    }

    #[test]
    fn root_changes_with_state() {
        let mut s = State::default();
        let r0 = s.root();
        s.apply_body(1, Address([1; 20]), &[], &DEVNET).unwrap();
        assert_ne!(s.root(), r0);
    }
}
