//! Hash helpers (keccak256, merkle root).
#![deny(clippy::float_arithmetic)]

use sha3::{Digest, Keccak256};

pub type Hash = [u8; 32];
pub const ZERO_HASH: Hash = [0u8; 32];

pub fn keccak256(data: &[u8]) -> Hash {
    Keccak256::digest(data).into()
}

/// Domain-separated hash: keccak256(tag || data). Prevents a value hashed in one context
/// (e.g. a header) from colliding with a value hashed in another (e.g. a transaction).
pub fn tagged_hash(tag: &[u8], data: &[u8]) -> Hash {
    let mut h = Keccak256::new();
    h.update(tag);
    h.update(data);
    h.finalize().into()
}

/// Hashes are shown as plain lowercase hex, like Bitcoin and Monero. (`parse_hash` still accepts a
/// leading `0x`, so either form can be pasted in.)
pub fn to_hex(h: &[u8]) -> String {
    hex::encode(h)
}

pub fn parse_hash(s: &str) -> Result<Hash, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let v = hex::decode(s).map_err(|e| format!("invalid hex: {e}"))?;
    v.try_into().map_err(|_| "hash must be 32 bytes".to_string())
}

/// Merkle root over leaf hashes with domain separation (leaf = H(0x00||x), node = H(0x01||l||r)).
/// An unpaired node is promoted unchanged, which avoids Bitcoin's duplicate-last-leaf ambiguity
/// (CVE-2012-2459).
pub fn merkle_root(leaves: &[Hash]) -> Hash {
    if leaves.is_empty() {
        return ZERO_HASH;
    }
    let mut level: Vec<Hash> = leaves.iter().map(|l| tagged_hash(&[0x00], l)).collect();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            if pair.len() == 2 {
                let mut buf = [0u8; 64];
                buf[..32].copy_from_slice(&pair[0]);
                buf[32..].copy_from_slice(&pair[1]);
                next.push(tagged_hash(&[0x01], &buf));
            } else {
                next.push(pair[0]);
            }
        }
        level = next;
    }
    level[0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keccak_known_vector() {
        // keccak256(""), the well-known Ethereum empty hash.
        assert_eq!(hex::encode(keccak256(b"")), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    }

    #[test]
    fn merkle_differs_on_order_and_duplication() {
        let a = keccak256(b"a");
        let b = keccak256(b"b");
        let c = keccak256(b"c");
        assert_ne!(merkle_root(&[a, b]), merkle_root(&[b, a]));
        assert_ne!(merkle_root(&[a, b, c]), merkle_root(&[a, b, c, c]));
        assert_eq!(merkle_root(&[]), ZERO_HASH);
    }
}
