//! LOKYX node and wallet library.
//!
//! No `unsafe` anywhere except `pow`, which has to tell the compiler what the RandomX C library
//! already guarantees: one immutable cache can back many VMs on different threads. Every module
//! that touches consensus is checked by the compiler to contain none.
#![deny(unsafe_code)]

pub mod abi;
pub mod address;
pub mod addrman;
pub mod amount;
pub mod block;
pub mod chain;
pub mod contract;
pub mod crypto;
pub mod dialplan;
pub mod difficulty;
pub mod emission;
pub mod eviction;
pub mod health;
pub mod journal;
pub mod keys;
pub mod keystore;
pub mod mempool;
pub mod miner;
pub mod net;
pub mod node;
pub mod params;
pub mod paths;
pub mod pow;
pub mod pqkey;
pub mod rpc;
pub mod state;
pub mod store;
pub mod swap;
pub mod timelock;
pub mod token;
pub mod transport;
pub mod trie;
pub mod tx;
pub mod vault;
pub mod work;
