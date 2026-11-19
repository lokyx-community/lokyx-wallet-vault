//! Timelocks: LYX that can't be claimed before a height. Capsules and savings jars.
//!
//! A lock is the `Op::Timelock(Lock)` of a transaction. Its id is that transaction's hash. The
//! amount leaves the sender then (so it counts against a vault's allowance like any other
//! payment) and sits in the state until the beneficiary claims it, at or after `unlock_height`.
//! Nobody can take it back, the creator included: a jar its maker can break isn't a jar.
//! The claim's fee comes out of the locked amount, so a beneficiary with an empty account can
//! still claim. Claiming is something the beneficiary does; nothing is released automatically.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::crypto::Hash;
use crate::params::ChainParams;
use borsh::{BorshDeserialize, BorshSerialize};

/// Reserved so that nobody can send to it. Timelock operations don't use it for routing.
pub const TIMELOCK_ADDRESS: Address = Address([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 5]);

/// The furthest ahead a lock may be set.
pub const MAX_LOCK_YEARS: u64 = 10;

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum TimelockOp {
    Lock { beneficiary: Address, amount: u128, unlock_height: u64 },
    Claim { id: Hash },
}

/// An open lock in the state.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Timelock {
    pub creator: Address,
    pub beneficiary: Address,
    pub amount: u128,
    pub unlock_height: u64,
    /// Height of the block that created it.
    pub height: u64,
}

/// How many blocks ahead the furthest lock may be.
pub fn max_lock_blocks(p: &ChainParams) -> u64 {
    MAX_LOCK_YEARS * 365 * 86_400 / p.target_block_time
}

impl TimelockOp {
    /// Checks that need no state.
    pub fn check(&self) -> Result<(), String> {
        match self {
            TimelockOp::Lock { beneficiary, amount, .. } => {
                if *amount == 0 {
                    return Err("a timelock needs an amount".into());
                }
                if crate::contract::is_system(beneficiary) {
                    return Err("can't lock funds for a system address".into());
                }
                Ok(())
            }
            TimelockOp::Claim { .. } => Ok(()),
        }
    }
}
