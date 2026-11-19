//! Where the node and wallet keep their files when no path is given:
//! Windows `%APPDATA%\LOKYX`, macOS `~/Library/Application Support/LOKYX`, elsewhere `~/.lokyx`.
//! Each network gets its own folder inside, e.g. `~/.lokyx/testnet`.

use std::path::PathBuf;

pub fn base_dir() -> PathBuf {
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if cfg!(windows) {
        if let Some(a) = env("APPDATA") {
            return a.join("LOKYX");
        }
        if let Some(h) = env("USERPROFILE") {
            return h.join(".lokyx");
        }
    } else if let Some(h) = env("HOME") {
        if cfg!(target_os = "macos") {
            return h.join("Library").join("Application Support").join("LOKYX");
        }
        return h.join(".lokyx");
    }
    PathBuf::from(".lokyx")
}

pub fn network_dir(network: &str) -> PathBuf {
    base_dir().join(network)
}
