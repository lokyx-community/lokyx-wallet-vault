//! lyx1 addresses (bech32m). Payload is a version byte + keccak256(pubkey)[12..], the same 20
//! bytes Ethereum derives from a key.
#![deny(clippy::float_arithmetic)]

use crate::crypto::keccak256;
use crate::params::{ADDRESS_HRP, ADDRESS_VERSION};
use bech32::primitives::decode::CheckedHrpstring;
use bech32::{Bech32m, Hrp};
use borsh::{BorshDeserialize, BorshSerialize};
use k256::ecdsa::VerifyingKey;
use std::fmt;

#[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, BorshSerialize, BorshDeserialize)]
pub struct Address(pub [u8; 20]);

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum AddressError {
    #[error("not a valid Bech32m string or checksum mismatch: {0}")]
    Encoding(String),
    #[error("address must start with '{ADDRESS_HRP}1'")]
    WrongPrefix,
    #[error("unsupported address version {0}")]
    Version(u8),
    #[error("address payload must be 21 bytes, got {0}")]
    Length(usize),
}

impl Address {
    pub const ZERO: Address = Address([0u8; 20]);

    pub fn from_verifying_key(vk: &VerifyingKey) -> Self {
        let point = vk.to_encoded_point(false);
        let h = keccak256(&point.as_bytes()[1..]);
        let mut a = [0u8; 20];
        a.copy_from_slice(&h[12..]);
        Address(a)
    }

    /// The 20 bytes as 0x hex (test vectors, debugging).
    pub fn to_evm_hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }

    pub fn from_evm_hex(s: &str) -> Result<Self, AddressError> {
        let s = s.strip_prefix("0x").ok_or(AddressError::WrongPrefix)?;
        let v = hex::decode(s).map_err(|e| AddressError::Encoding(e.to_string()))?;
        let a: [u8; 20] = v.try_into().map_err(|v: Vec<u8>| AddressError::Length(v.len()))?;
        Ok(Address(a))
    }

    pub fn parse(s: &str) -> Result<Self, AddressError> {
        let checked = CheckedHrpstring::new::<Bech32m>(s.trim()).map_err(|e| AddressError::Encoding(e.to_string()))?;
        if checked.hrp().to_lowercase() != ADDRESS_HRP {
            return Err(AddressError::WrongPrefix);
        }
        let bytes: Vec<u8> = checked.byte_iter().collect();
        if bytes.len() != 21 {
            return Err(AddressError::Length(bytes.len()));
        }
        if bytes[0] != ADDRESS_VERSION {
            return Err(AddressError::Version(bytes[0]));
        }
        let mut a = [0u8; 20];
        a.copy_from_slice(&bytes[1..]);
        Ok(Address(a))
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let hrp = Hrp::parse_unchecked(ADDRESS_HRP);
        let mut payload = [0u8; 21];
        payload[0] = ADDRESS_VERSION;
        payload[1..].copy_from_slice(&self.0);
        let s = bech32::encode::<Bech32m>(hrp, &payload).map_err(|_| fmt::Error)?;
        f.write_str(&s)
    }
}

impl fmt::Debug for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self}")
    }
}

impl std::str::FromStr for Address {
    type Err = AddressError;
    fn from_str(s: &str) -> Result<Self, AddressError> {
        Address::parse(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::SigningKey;

    #[test]
    fn matches_ethereum_derivation() {
        // Private key 1 -> well-known Ethereum address 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf.
        let mut sk = [0u8; 32];
        sk[31] = 1;
        let sk = SigningKey::from_slice(&sk).unwrap();
        let a = Address::from_verifying_key(sk.verifying_key());
        assert_eq!(a.to_evm_hex(), "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
        let s = a.to_string();
        assert!(s.starts_with("lyx1"), "{s}");
        assert_eq!(s.len(), 44);
        assert_eq!(Address::parse(&s).unwrap(), a);
        assert_eq!(Address::parse(&s.to_uppercase()).unwrap(), a);
        assert_eq!(Address::from_evm_hex(&a.to_evm_hex()).unwrap(), a);
    }

    #[test]
    fn rejects_bad_addresses() {
        let a = Address([7u8; 20]).to_string();
        // Any single-character change must fail the checksum.
        let mut chars: Vec<char> = a.chars().collect();
        let i = chars.len() - 3;
        chars[i] = if chars[i] == 'q' { 'p' } else { 'q' };
        let bad: String = chars.into_iter().collect();
        assert!(Address::parse(&bad).is_err());
        // Wrong prefix with a valid checksum.
        let other = bech32::encode::<Bech32m>(Hrp::parse("btc").unwrap(), &[0u8; 21]).unwrap();
        assert_eq!(Address::parse(&other), Err(AddressError::WrongPrefix));
        // Bech32 (not Bech32m) checksum is rejected.
        let legacy = bech32::encode::<bech32::Bech32>(Hrp::parse("lyx").unwrap(), &[0u8; 21]).unwrap();
        assert!(Address::parse(&legacy).is_err());
        // Mixed case is rejected.
        let mut mixed = a.clone();
        mixed.replace_range(5..6, &a[5..6].to_uppercase());
        if mixed != a {
            assert!(Address::parse(&mixed).is_err());
        }
        assert!(Address::parse("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf").is_err());
        assert!(Address::parse("").is_err());
    }
}
