//! Vaults: accounts where a stolen key isn't enough to take everything.
//!
//! A vault op is the `Op::Vault` of a transaction. It carries no value of its own; a withdrawal
//! names its amount.
//!
//!   Create    owner turns their account into a vault.
//!   Withdraw  owner moves more than the daily allowance. The amount is locked and only reaches
//!             `to` after `delay` blocks.
//!   Update    owner changes settings or closes the vault. Also waits `delay` blocks.
//!   Cancel    owner or recovery key stops a pending withdrawal or update.
//!   Sweep     recovery key moves everything (balance and pending withdrawals) to the safe address
//!             set at creation. Immediately.
//!   HeirClaim heir starts a withdrawal of everything after the owner has been inactive for long
//!             enough. Waits `delay` like any other withdrawal, so the owner can still cancel.
//!
//! Anything else the owner sends (transfers, swap locks, fees) counts against `allowance`, reset
//! every day's worth of blocks. Ops signed by the recovery key or the heir pay their fee from the
//! vault, so those keys don't need a balance of their own.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::crypto::Hash;
use crate::params::ChainParams;
use crate::tx::SignedTransaction;
use borsh::{BorshDeserialize, BorshSerialize};
use k256::ecdsa::SigningKey;

/// Vault ops are sent here. Nobody has the key.
pub const VAULT_ADDRESS: Address = Address([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);

pub const MIN_DELAY_SECS: u64 = 3600;
pub const MAX_DELAY_SECS: u64 = 30 * 86400;
/// The heir can't be allowed in sooner than this.
pub const MIN_INACTIVE_SECS: u64 = 30 * 86400;

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Heir {
    pub address: Address,
    /// Blocks without any transaction from the owner before the heir can claim.
    pub inactive_blocks: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct VaultSettings {
    pub recovery: Address,
    pub safe: Address,
    /// Blocks a withdrawal or settings change waits.
    pub delay: u64,
    /// LYX per day that can leave without waiting.
    pub allowance: u128,
    pub heir: Option<Heir>,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Vault {
    pub settings: VaultSettings,
    /// Allowance accounting: the current day started at this height, and this much has left since.
    pub day_start: u64,
    pub spent: u128,
    /// Height of the owner's last transaction (for the heir).
    pub last_active: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum PendingKind {
    Withdraw { to: Address, amount: u128 },
    Update(VaultSettings),
    Close,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Pending {
    pub vault: Address,
    pub kind: PendingKind,
    /// Applied at the start of the block at this height.
    pub release: u64,
    /// Height of the block that created it.
    pub height: u64,
    /// True when the heir started it.
    pub by_heir: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum VaultOp {
    Create(VaultSettings),
    Withdraw { to: Address, amount: u128 },
    Update(VaultSettings),
    Close,
    Cancel { id: Hash },
    Sweep { vault: Address },
    HeirClaim { vault: Address },
}

/// The vault op in a transaction, if it is one.
pub fn op_of(t: &SignedTransaction) -> Option<VaultOp> {
    match &t.tx.op {
        crate::tx::Op::Vault(v) => Some(v.clone()),
        _ => None,
    }
}

/// Blocks in a day on this network (allowance window).
pub fn day_blocks(p: &ChainParams) -> u64 {
    blocks_for(86_400, p).max(1)
}

pub fn blocks_for(secs: u64, p: &ChainParams) -> u64 {
    (secs / p.time_scale.max(1)).div_ceil(p.target_block_time).max(1)
}

/// Settings checks that don't depend on state.
pub fn check_settings(s: &VaultSettings, owner: Address, p: &ChainParams) -> Result<(), String> {
    if s.recovery == owner {
        return Err("the recovery key has to be a different address from the vault".into());
    }
    if s.safe == owner {
        return Err("the safe address has to be different from the vault".into());
    }
    if crate::contract::is_system(&s.recovery) || crate::contract::is_system(&s.safe) {
        return Err("system addresses can't be used here".into());
    }
    let (lo, hi) = (blocks_for(MIN_DELAY_SECS, p), blocks_for(MAX_DELAY_SECS, p));
    if s.delay < lo || s.delay > hi {
        return Err(format!("delay must be between {lo} and {hi} blocks (1 hour to 30 days)"));
    }
    if let Some(h) = &s.heir {
        if h.address == owner {
            return Err("the heir has to be a different address".into());
        }
        let min = blocks_for(MIN_INACTIVE_SECS, p).max(s.delay * 2);
        if h.inactive_blocks < min {
            return Err(format!("the heir's waiting period must be at least {min} blocks"));
        }
    }
    Ok(())
}

pub fn build(sk: &SigningKey, p: &ChainParams, nonce: u64, op: VaultOp) -> anyhow::Result<SignedTransaction> {
    crate::tx::build_op(sk, p, nonce, crate::tx::Op::Vault(op))
}
