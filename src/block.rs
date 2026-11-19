//! Block and header types, genesis.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::crypto::{Hash, ZERO_HASH, merkle_root, tagged_hash};
use crate::params::{BLOCK_VERSION, ChainParams};
use crate::state::State;
use crate::tx::SignedTransaction;
use borsh::{BorshDeserialize, BorshSerialize};

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct BlockHeader {
    pub version: u32,
    pub height: u64,
    pub prev_hash: Hash,
    pub timestamp: u64,
    /// Expected hashes to find a block; must equal the LWMA value computed from ancestors.
    pub difficulty: u128,
    pub tx_root: Hash,
    /// Commitment to the full account state *after* this block. Lets any node (or a future
    /// light client) check balances and total issuance against the header chain.
    pub state_root: Hash,
    /// Commitment to what the block's contract transactions did (see `contract::receipts_root`).
    pub receipts_root: Hash,
    /// Receives the block reward plus all fees.
    pub coinbase: Address,
    /// The proof of work. Last in the header, so a miner varies the bytes at the end.
    pub pow: Pow,
}

/// How the work was done. A versioned enum so that a second way of proving work (merging with
/// another chain) can be switched on at an activation height without a new header format. Only
/// `Native` exists; any other tag fails to decode and the block is refused.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum Pow {
    /// RandomX over the header bytes, with this nonce as the last field.
    Native { nonce: u64 },
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Block {
    pub header: BlockHeader,
    pub txs: Vec<SignedTransaction>,
}

impl BlockHeader {
    pub fn nonce(&self) -> u64 {
        let Pow::Native { nonce } = &self.pow;
        *nonce
    }

    pub fn set_nonce(&mut self, n: u64) {
        self.pow = Pow::Native { nonce: n };
    }

    /// Next nonce, wrapping.
    pub fn bump_nonce(&mut self) {
        self.set_nonce(self.nonce().wrapping_add(1));
    }

    /// Block identifier (keccak, cheap). Distinct from the RandomX proof-of-work hash.
    pub fn hash(&self) -> Hash {
        tagged_hash(b"LOKYX/header/v2", &self.pow_input())
    }

    /// The exact bytes hashed by RandomX. Includes the nonce.
    pub fn pow_input(&self) -> Vec<u8> {
        borsh::to_vec(self).expect("borsh")
    }
}

impl Block {
    pub fn hash(&self) -> Hash {
        self.header.hash()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        borsh::to_vec(self).expect("borsh")
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, String> {
        borsh::from_slice(b).map_err(|e| format!("malformed block: {e}"))
    }

    pub fn compute_tx_root(txs: &[SignedTransaction]) -> Hash {
        let leaves: Vec<Hash> = txs.iter().map(|t| t.hash()).collect();
        merkle_root(&leaves)
    }
}

/// What block 0 points to as its parent: `keccak256("LOKYX/genesis/v1" || message)`.
pub fn genesis_parent(p: &ChainParams) -> Hash {
    tagged_hash(b"LOKYX/genesis/v1", p.genesis_message.as_bytes())
}

/// The genesis block: no transactions, no reward, no premine. Fully determined by parameters,
/// so every node constructs the identical block and anyone can check it.
pub fn genesis(p: &ChainParams) -> Block {
    Block {
        header: BlockHeader {
            version: BLOCK_VERSION,
            height: 0,
            prev_hash: genesis_parent(p),
            timestamp: p.genesis_timestamp,
            difficulty: p.initial_difficulty,
            tx_root: ZERO_HASH,
            state_root: State::default().root(),
            receipts_root: ZERO_HASH,
            coinbase: Address::ZERO,
            pow: Pow::Native { nonce: 0 },
        },
        txs: vec![],
    }
}
