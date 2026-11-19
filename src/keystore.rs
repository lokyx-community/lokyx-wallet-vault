//! Encrypted wallet file: argon2id + xchacha20poly1305. The first address is
//! stored in clear so `address` works without the password.

use anyhow::{Context, Result, bail};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::{Zeroize, Zeroizing};

const AAD: &[u8] = b"LOKYX-keystore-v1";

#[derive(Serialize, Deserialize)]
pub struct KeystoreFile {
    pub version: u32,
    pub address: String,
    pub kdf: String,
    pub kdf_memory_kib: u32,
    pub kdf_iterations: u32,
    pub kdf_parallelism: u32,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Serialize, Deserialize, Zeroize)]
#[zeroize(drop)]
pub struct Secret {
    pub mnemonic: String,
    pub passphrase: String,
}

fn derive_key(password: &str, salt: &[u8], m: u32, t: u32, p: u32) -> Result<Zeroizing<[u8; 32]>> {
    let params = Params::new(m, t, p, Some(32)).map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut *key)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(key)
}

pub fn encrypt(secret: &Secret, address: &str, password: &str) -> Result<KeystoreFile> {
    if password.chars().count() < 8 {
        bail!("password must be at least 8 characters");
    }
    let (m, t, p) = (64 * 1024, 3, 1);
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let key = derive_key(password, &salt, m, t, p)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*key));
    let plain = Zeroizing::new(serde_json::to_vec(secret)?);
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: &plain, aad: AAD })
        .map_err(|_| anyhow::anyhow!("encryption failed"))?;
    Ok(KeystoreFile {
        version: 1,
        address: address.to_string(),
        kdf: "argon2id".into(),
        kdf_memory_kib: m,
        kdf_iterations: t,
        kdf_parallelism: p,
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ciphertext: hex::encode(ct),
    })
}

pub fn decrypt(file: &KeystoreFile, password: &str) -> Result<Secret> {
    if file.version != 1 || file.kdf != "argon2id" {
        bail!("unsupported keystore format");
    }
    let salt = hex::decode(&file.salt)?;
    let nonce = hex::decode(&file.nonce)?;
    if nonce.len() != 24 {
        bail!("corrupt keystore nonce");
    }
    let key = derive_key(password, &salt, file.kdf_memory_kib, file.kdf_iterations, file.kdf_parallelism)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&*key));
    let plain = Zeroizing::new(
        cipher
            .decrypt(XNonce::from_slice(&nonce), Payload { msg: &hex::decode(&file.ciphertext)?, aad: AAD })
            .map_err(|_| anyhow::anyhow!("wrong password or corrupted wallet file"))?,
    );
    Ok(serde_json::from_slice(&plain)?)
}

pub fn save(path: &Path, file: &KeystoreFile) -> Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(file)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn load(path: &Path) -> Result<KeystoreFile> {
    let b = std::fs::read(path).with_context(|| format!("no wallet at {} (run `lokyx-wallet new`)", path.display()))?;
    Ok(serde_json::from_slice(&b)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_wrong_password() {
        let s = Secret { mnemonic: "a b c".into(), passphrase: "".into() };
        let f = encrypt(&s, "lyx1test", "correct horse").unwrap();
        assert_eq!(decrypt(&f, "correct horse").unwrap().mnemonic, "a b c");
        assert!(decrypt(&f, "wrong password").is_err());
        let mut tampered = f;
        let mut ct = hex::decode(&tampered.ciphertext).unwrap();
        ct[0] ^= 1;
        tampered.ciphertext = hex::encode(ct);
        assert!(decrypt(&tampered, "correct horse").is_err());
        assert!(encrypt(&s, "x", "short").is_err());
    }
}
