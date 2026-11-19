//! Mining over RPC, for miners that don't run a node (the phone app).
//!
//! `get_work` hands out a block template: the header as bytes, where to put the timestamp and
//! the nonce, the RandomX key and the difficulty. The miner varies those two fields and sends
//! back the ones that work. `submit_work` rebuilds the block from the stored template and puts it
//! through the same checks as any block from a peer, so a bad submission costs the node one
//! RandomX hash and nothing else.

use crate::address::Address;
use crate::block::Block;
use crate::crypto::Hash;
use crate::node::Node;
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Byte offsets in the borsh header (version u32, height u64, prev 32, timestamp u64, ...).
pub const TIMESTAMP_OFFSET: usize = 4 + 8 + 32;
/// The proof-of-work enum's tag byte sits just before the nonce (tag 0 = Native).
pub const NONCE_OFFSET: usize = TIMESTAMP_OFFSET + 8 + 16 + 32 + 32 + 32 + 20 + 1;
pub const HEADER_BYTES: usize = NONCE_OFFSET + 8;

/// Templates are rebuilt at most this often for the same address and tip.
const REUSE_FOR: Duration = Duration::from_secs(20);
/// How many templates we remember for submissions.
const KEEP: usize = 256;

pub struct Work {
    pub id: Hash,
    pub block: Block,
    pub seed: Hash,
    pub not_before: u64,
    created: Instant,
}

#[derive(Default)]
pub struct WorkCache {
    items: Mutex<VecDeque<Arc<Work>>>,
}

impl WorkCache {
    /// A template paying `coinbase` on the current tip.
    pub fn get(&self, node: &Node, coinbase: Address) -> Result<Arc<Work>, String> {
        let c = node.chain.lock();
        let tip = c.tip().hash;
        if let Some(w) = self.items.lock().iter().rev().find(|w| {
            w.block.header.prev_hash == tip && w.block.header.coinbase == coinbase && w.created.elapsed() < REUSE_FOR
        }) {
            return Ok(w.clone());
        }
        let txs = node.mempool.lock().select(&c.state, node.params);
        let (block, seed) = c.block_template(coinbase, txs)?;
        let not_before = c.next_block_due();
        drop(c);
        let id = crate::crypto::keccak256(&[block.header.pow_input(), seed.to_vec()].concat());
        let w = Arc::new(Work { id, block, seed, not_before, created: Instant::now() });
        let mut items = self.items.lock();
        items.push_back(w.clone());
        while items.len() > KEEP {
            items.pop_front();
        }
        Ok(w)
    }

    /// The block for a solved template, or None if we no longer have it.
    pub fn solved(&self, id: &Hash, timestamp: u64, nonce: u64) -> Option<Block> {
        let w = self.items.lock().iter().find(|w| w.id == *id)?.clone();
        let mut b = w.block.clone();
        b.header.timestamp = timestamp;
        b.header.set_nonce(nonce);
        Some(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::block::BlockHeader;

    #[test]
    fn offsets_match_the_encoding() {
        let h = BlockHeader {
            version: 1,
            height: 2,
            prev_hash: [3; 32],
            timestamp: 0x1122334455667788,
            difficulty: 5,
            tx_root: [6; 32],
            state_root: [7; 32],
            receipts_root: [9; 32],
            coinbase: Address([8; 20]),
            pow: crate::block::Pow::Native { nonce: 0x99aabbccddeeff00 },
        };
        let b = h.pow_input();
        assert_eq!(b.len(), HEADER_BYTES);
        assert_eq!(u64::from_le_bytes(b[TIMESTAMP_OFFSET..TIMESTAMP_OFFSET + 8].try_into().unwrap()), h.timestamp);
        assert_eq!(u64::from_le_bytes(b[NONCE_OFFSET..NONCE_OFFSET + 8].try_into().unwrap()), h.nonce());
        assert_eq!(b[NONCE_OFFSET - 1], 0, "Native tag");
    }
}
