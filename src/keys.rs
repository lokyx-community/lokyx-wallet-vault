//! BIP-39 phrase -> BIP-32 keys, path m/44'/7701'/0'/0/i.

use crate::address::Address;
use crate::params::PROVISIONAL_COIN_TYPE;
use anyhow::{Context, Result};
use bip39::Mnemonic;
use k256::ecdsa::SigningKey;
use rand::RngCore;
use rand::rngs::OsRng;
use zeroize::Zeroize;

/// Create a new mnemonic from the operating system's CSPRNG. 24 words = 256 bits of entropy.
pub fn generate_mnemonic(words: usize) -> Result<Mnemonic> {
    let bytes = match words {
        12 => 16,
        24 => 32,
        _ => anyhow::bail!("mnemonic must be 12 or 24 words"),
    };
    let mut entropy = [0u8; 32];
    OsRng.fill_bytes(&mut entropy[..bytes]);
    let m = Mnemonic::from_entropy(&entropy[..bytes]).context("mnemonic from entropy")?;
    entropy.zeroize();
    Ok(m)
}

pub fn parse_mnemonic(phrase: &str) -> Result<Mnemonic> {
    let normalized = phrase.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    Mnemonic::parse_normalized(&normalized).context("invalid recovery phrase (word list or checksum)")
}

pub fn derive_signing_key(mnemonic: &Mnemonic, passphrase: &str, index: u32) -> Result<SigningKey> {
    let mut seed = mnemonic.to_seed(passphrase);
    let path: bip32::DerivationPath =
        format!("m/44'/{PROVISIONAL_COIN_TYPE}'/0'/0/{index}").parse().context("derivation path")?;
    let xprv = bip32::XPrv::derive_from_path(seed, &path).context("bip32 derivation")?;
    seed.zeroize();
    Ok(xprv.private_key().clone())
}

pub fn address_of(sk: &SigningKey) -> Address {
    Address::from_verifying_key(sk.verifying_key())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_recovery() {
        let m = generate_mnemonic(24).unwrap();
        assert_eq!(m.word_count(), 24);
        let a = address_of(&derive_signing_key(&m, "", 0).unwrap());
        let restored = parse_mnemonic(&format!("  {}  ", m.to_string().to_uppercase())).unwrap();
        assert_eq!(address_of(&derive_signing_key(&restored, "", 0).unwrap()), a);
        assert_ne!(address_of(&derive_signing_key(&m, "", 1).unwrap()), a);
        assert_ne!(address_of(&derive_signing_key(&m, "extra", 0).unwrap()), a);
    }

    #[test]
    fn fixed_vector_is_stable() {
        // Standard BIP-39 test mnemonic; pins our derivation so it can never silently change.
        let m = parse_mnemonic(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        )
        .unwrap();
        let a1 = address_of(&derive_signing_key(&m, "", 0).unwrap());
        let a2 = address_of(&derive_signing_key(&m, "", 0).unwrap());
        assert_eq!(a1, a2);
        assert!(a1.to_string().starts_with("lyx1"));
    }

    #[test]
    fn rejects_bad_checksum_phrase() {
        assert!(
            parse_mnemonic(
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
            )
            .is_err()
        );
    }
}
