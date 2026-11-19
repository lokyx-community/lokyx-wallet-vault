//! Quantum backup key: an account can commit, once, to a post-quantum public key.
//!
//! The commitment is `sha3-256(SLH-DSA public key)`. A hash reveals nothing about the key, to a
//! quantum computer or anyone else. Nothing uses it yet: if ECDSA ever becomes breakable, a planned
//! upgrade can switch committed accounts to signing with that key, and accounts without one stay
//! frozen until a slower recovery path exists. Wallets derive the key from the same recovery
//! phrase, so there is nothing new to back up.
//!
//! A key op is the `Op::Key` of a transaction.
//! The commitment can't be changed once set, so a stolen ECDSA key can't swap it for the thief's.
//!
//! Key rotation: an account is controlled by the key whose address it is, until it rotates.
//! `Rotate` names a new key and waits (a vault's own delay, or one day for a plain account); the
//! old key still signs, and can cancel, until it happens. A vault's recovery address can cancel
//! too, with the fee paid from the vault. A rotation does not stop a thief who holds the current
//! key from spending a plain account at once: it keeps them from locking the owner out of an
//! account that is waiting to be swept.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::params::ChainParams;
use crate::tx::SignedTransaction;
use borsh::{BorshDeserialize, BorshSerialize};
use k256::ecdsa::SigningKey;

/// Key ops are sent here. Nobody has the key.
pub const KEY_ADDRESS: Address = Address([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3]);

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum KeyOp {
    /// sha3-256 of an SLH-DSA-SHA2-128s public key.
    CommitPq { hash: [u8; 32] },
    /// Hand the account to another key after a delay. `new_key` is the hash of the new public
    /// key, in the same form as an address.
    Rotate { new_key: Address },
    /// Stop a rotation that hasn't happened yet. `account` is the account being rotated: the
    /// account itself (signed by its current key), or a vault's recovery address.
    CancelRotate { account: Address },
}

impl KeyOp {
    /// Rules that don't depend on state.
    pub fn check(&self) -> Result<(), String> {
        if let KeyOp::Rotate { new_key } = self
            && crate::contract::is_system(new_key)
        {
            return Err("a system address can't be a key".into());
        }
        Ok(())
    }
}

/// A rotation waiting out its delay.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct KeyPending {
    pub new_key: Address,
    /// The new key takes over at the start of the block at this height.
    pub release: u64,
}

pub fn op_of(t: &SignedTransaction) -> Option<KeyOp> {
    match &t.tx.op {
        crate::tx::Op::Key(k) => Some(k.clone()),
        _ => None,
    }
}

pub fn build(sk: &SigningKey, p: &ChainParams, nonce: u64, op: KeyOp) -> anyhow::Result<SignedTransaction> {
    crate::tx::build_op(sk, p, nonce, crate::tx::Op::Key(op))
}
