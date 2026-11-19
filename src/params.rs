//! Consensus constants per network. No mainnet params on purpose.
#![deny(clippy::float_arithmetic)]

/// 1 LYX = 10^18 base units (same granularity as wei).
pub const COIN: u128 = 1_000_000_000_000_000_000;
pub const DECIMALS: u32 = 18;

/// Human-readable part of every native address: `lyx1...`.
pub const ADDRESS_HRP: &str = "lyx";
/// Address payload version byte (0 = keccak256(pubkey)[12..], 20 bytes).
pub const ADDRESS_VERSION: u8 = 0;

/// P2P protocol version. Nodes on different versions don't talk to each other.
/// 7: encrypted transport (Noise XX), node keys. 6: headers-first sync (no consensus change). 5: contracts (testnet restart). 4: vaults.
/// 3 dropped Ethereum-format transactions.
pub const PROTOCOL_VERSION: u32 = 8;
pub const BLOCK_VERSION: u32 = 2;

pub const MAX_BLOCK_BYTES: usize = 1_000_000;
/// Big enough for a contract deploy (code is at most 120,000 bytes).
pub const MAX_TX_BYTES: usize = 131_072;
pub const MAX_TXS_PER_BLOCK: usize = 5_000;

/// Minimum fee: 10^12 base units (0.000001 LYX) per serialized byte.
/// A plain transfer is ~150 bytes, so ~0.00015 LYX.
pub const MIN_FEE_PER_BYTE: u128 = 1_000_000_000_000;

/// Timestamps must exceed the median of this many previous blocks.
pub const MEDIAN_TIME_SPAN: usize = 11;

/// RandomX key ("seed") rotation, identical scheme to Monero: the key changes every
/// 2048 blocks and lags 64 blocks behind so miners can pre-compute the new cache.
pub const RX_EPOCH: u64 = 2048;
pub const RX_LAG: u64 = 64;

/// BIP-44 coin type used for HD derivation (m/44'/COIN_TYPE'/0'/0/i).
/// PROVISIONAL: must be registered in SLIP-0044 before any public launch.
pub const PROVISIONAL_COIN_TYPE: u32 = 7_701;

/// The message block 0 descends from. Written the week Binance lost $6.3 billion to a hot-wallet
/// theft (29 Oct 2026), the largest crypto theft so far.
pub const GENESIS_MESSAGE: &str = "29 Oct 2026: $6.3 billion left Binance in twenty minutes. Whoever holds your keys holds your coins. LOKYX begins holding no keys for anyone.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Devnet,
    Testnet,
}

#[derive(Debug, Clone)]
pub struct ChainParams {
    pub network: Network,
    pub name: &'static str,
    /// Signed into every transaction (replay protection across networks).
    pub chain_id: u64,
    pub magic: [u8; 4],
    pub genesis_timestamp: u64,
    /// Written into block 0. Block 0 has no parent block; its parent hash is the hash of this
    /// text, so the whole chain descends from it and anyone can check the wording.
    pub genesis_message: &'static str,
    /// Target seconds between blocks.
    pub target_block_time: u64,
    /// Divides every wall-clock duration that is turned into blocks (vault delays, a day for the
    /// allowance and for key rotation). 1 everywhere except the devnet, which runs a day in five
    /// minutes so a rotation can be watched being released.
    pub time_scale: u64,
    /// Min seconds between a block and its parent. Keeps block times close to the target
    /// instead of anywhere from 1 s to minutes.
    pub min_block_spacing: u64,
    /// LWMA-1 averaging window (blocks).
    pub lwma_window: u64,
    pub initial_difficulty: u128,
    pub min_difficulty: u128,
    /// Blocks may not be timestamped more than this many seconds in the future.
    pub future_time_limit: u64,
    /// Emission: reward at height 1, halving interval, and perpetual tail reward.
    pub initial_reward: u128,
    pub halving_interval: u64,
    pub tail_reward: u128,
    /// Block rewards can't be spent until this many blocks have been built on top. Without it,
    /// a reorg could erase a reward that was already spent onward.
    pub coinbase_maturity: u64,
    /// Peers to try first, as host:port (DNS names are fine).
    pub seeds: &'static [&'static str],
    pub default_p2p_port: u16,
    pub default_rpc_port: u16,
    /// Sync policy, not consensus: until the best known header chain has at least this much work,
    /// the node downloads headers only, doesn't mine, and reports itself as syncing. Stops a new
    /// node from being fed a cheap fake chain. Set each release a little below the real chain's
    /// work at that time (see docs/TESTNET.md).
    pub min_chain_work: u128,
    /// Sync policy, not consensus: a block hash published in the release notes. Headers that are
    /// ancestors of it skip the RandomX check during sync (they're proven by the hash chain). The
    /// node still follows the most work, and every transaction is still applied and checked.
    pub assume_valid: Option<(u64, [u8; 32])>,
    /// Consensus: the first height at which contract deploys and calls are allowed. None means
    /// never (a mainnet launches this way, and turns them on at a fixed height in a later release,
    /// after audit and fuzzing). Before it, any contract transaction makes a block invalid.
    pub contracts_from: Option<u64>,
}

impl ChainParams {
    /// Are contract deploys and calls allowed in a block at `height`?
    pub fn contracts_active(&self, height: u64) -> bool {
        self.contracts_from.is_some_and(|h| height >= h)
    }
}

/// Local development network: 15 s blocks, very low starting difficulty so a laptop
/// in RandomX light mode finds blocks in seconds. Same emission rules as testnet.
pub static DEVNET: ChainParams = ChainParams {
    network: Network::Devnet,
    name: "devnet",
    chain_id: 77_701, // provisional; check chainlist.org for collisions before any public network
    magic: *b"LYXd",
    genesis_timestamp: 1_793_491_200, // 2026-11-01T00:00:00Z
    genesis_message: "LOKYX devnet",
    target_block_time: 15,
    time_scale: 1,
    min_block_spacing: 10,
    lwma_window: 60,
    initial_difficulty: 100,
    min_difficulty: 10,
    future_time_limit: 15,
    initial_reward: 10 * COIN,
    halving_interval: 1_051_200,
    tail_reward: COIN / 2,
    coinbase_maturity: 10,
    seeds: &[],
    default_p2p_port: 17_701,
    default_rpc_port: 18_701,
    min_chain_work: 0,
    assume_valid: None,
    contracts_from: Some(0),
};

/// Public testnet. Coins are worthless, chain can be reset.
pub static TESTNET: ChainParams = ChainParams {
    network: Network::Testnet,
    name: "testnet",
    chain_id: 77_703,
    magic: *b"LYXt",
    genesis_timestamp: 1_794_474_000, // 2026-11-12T09:00:00Z (testnet restart: Phase 4 formats)
    genesis_message: GENESIS_MESSAGE,
    target_block_time: 60,
    time_scale: 1,
    min_block_spacing: 50,
    lwma_window: 60,
    initial_difficulty: 400,
    min_difficulty: 40,
    // Kept short because of min_block_spacing: a block dated further ahead than this is ignored
    // until its time comes. Miners need a roughly correct clock (NTP / Windows time sync).
    future_time_limit: 15,
    initial_reward: 10 * COIN,
    halving_interval: 1_051_200, // ~2 years at 60 s
    tail_reward: COIN / 2,
    coinbase_maturity: 60,
    seeds: &["testnet.lokyx.xyz:27701"],
    default_p2p_port: 27_701,
    default_rpc_port: 28_701,
    // Filled in at each release from the seed node (docs/TESTNET.md, "Release values").
    min_chain_work: 0,
    assume_valid: None,
    contracts_from: Some(0),
};

impl Network {
    pub fn params(self) -> &'static ChainParams {
        match self {
            Network::Devnet => {
                // LOKYX_DEVNET_TIME_SCALE=288 makes a "day" (vault allowance window, plain-account
                // key rotation) five minutes, so a rotation can be watched being released. Devnet
                // only; every node of a devnet has to use the same value.
                static SCALED: std::sync::OnceLock<ChainParams> = std::sync::OnceLock::new();
                match std::env::var("LOKYX_DEVNET_TIME_SCALE").ok().and_then(|v| v.parse::<u64>().ok()) {
                    Some(k) if k > 1 => SCALED.get_or_init(|| ChainParams { time_scale: k, ..DEVNET.clone() }),
                    _ => &DEVNET,
                }
            }
            Network::Testnet => &TESTNET,
        }
    }
}

impl std::str::FromStr for Network {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "devnet" => Ok(Network::Devnet),
            "testnet" => Ok(Network::Testnet),
            "mainnet" => Err("mainnet does not exist yet: LOKYX has not been audited".into()),
            _ => Err(format!("unknown network '{s}' (devnet|testnet)")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Block 1 has to be dated after block 0 but not ahead of the clock, so a block 0 in the
    /// future means nobody can mine until that time comes.
    #[test]
    fn genesis_is_not_in_the_future() {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        for p in [&DEVNET, &TESTNET] {
            assert!(p.genesis_timestamp + p.min_block_spacing <= now, "{} block 0 is dated in the future", p.name);
        }
    }
}
