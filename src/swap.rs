//! Hash-locked swaps (HTLC). Lets two people trade LYX for coins on another chain with nobody
//! holding the funds in between.
//!
//! A swap op is the `Op::Swap` of a transaction:
//!   Lock    `amount` leaves the sender. Claimable by `recipient` with the secret, refundable to
//!           the sender from `refund_height` on.
//!   Claim   signed by the recipient, before refund_height. Reveals the secret.
//!   Refund  signed by the original sender, at or after refund_height.
//! Claim and refund fees come out of the locked amount, so a recipient with no LYX can still claim.
//! The hashlock is sha256 and the secret exactly 32 bytes, same as a bitcoin HTLC checks.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::crypto::Hash;
use crate::params::ChainParams;
use crate::tx::SignedTransaction;
use borsh::{BorshDeserialize, BorshSerialize};
use k256::ecdsa::SigningKey;
use sha2::{Digest, Sha256};

/// Swaps are sent here. Nobody has the key; the address only marks the transaction as a swap op.
pub const SWAP_ADDRESS: Address = Address([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);

/// Longest allowed lock: 14 days of 60 s blocks.
pub const MAX_LOCK_BLOCKS: u64 = 20_160;

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum SwapOp {
    Lock { amount: u128, hashlock: [u8; 32], recipient: Address, refund_height: u64 },
    Claim { lock: Hash, secret: [u8; 32] },
    Refund { lock: Hash },
}

/// An open lock in the state.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct SwapLock {
    pub sender: Address,
    pub recipient: Address,
    pub amount: u128,
    pub hashlock: [u8; 32],
    pub refund_height: u64,
    /// Height of the block that created it.
    pub height: u64,
}

pub fn sha256(x: &[u8]) -> [u8; 32] {
    Sha256::digest(x).into()
}

/// The swap op in a transaction, if it is one.
pub fn op_of(t: &SignedTransaction) -> Option<SwapOp> {
    match &t.tx.op {
        crate::tx::Op::Swap(s) => Some(s.clone()),
        _ => None,
    }
}

fn build(sk: &SigningKey, p: &ChainParams, nonce: u64, op: SwapOp) -> anyhow::Result<SignedTransaction> {
    crate::tx::build_op(sk, p, nonce, crate::tx::Op::Swap(op))
}

pub fn build_lock(
    sk: &SigningKey,
    p: &ChainParams,
    nonce: u64,
    amount: u128,
    hashlock: [u8; 32],
    recipient: Address,
    refund_height: u64,
) -> anyhow::Result<SignedTransaction> {
    build(sk, p, nonce, SwapOp::Lock { amount, hashlock, recipient, refund_height })
}

pub fn build_claim(
    sk: &SigningKey,
    p: &ChainParams,
    nonce: u64,
    lock: Hash,
    secret: [u8; 32],
) -> anyhow::Result<SignedTransaction> {
    build(sk, p, nonce, SwapOp::Claim { lock, secret })
}

pub fn build_refund(sk: &SigningKey, p: &ChainParams, nonce: u64, lock: Hash) -> anyhow::Result<SignedTransaction> {
    build(sk, p, nonce, SwapOp::Refund { lock })
}
