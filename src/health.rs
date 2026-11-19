//! Signs that this node may be cut off from the rest of the network.
//!
//! The only thing done about them is to look for more connections. Mining is never touched: a
//! stale tip can be an eclipse, and it can equally be a real drop in hashrate, and a miner that
//! stopped itself on the second would hand the first to whoever caused it.

/// A tip older than this is odd at any block spacing we run.
pub const STALE_TIP_SECS: u64 = 30 * 60;
/// Outbound peers in fewer groups than this look like one party's.
pub const MIN_OUTBOUND_GROUPS: usize = 3;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Health {
    /// The tip is older than `STALE_TIP_SECS`.
    pub stale_tip: bool,
    /// We have outbound peers, and they sit in fewer than `MIN_OUTBOUND_GROUPS` groups.
    pub few_groups: bool,
    /// No peers at all.
    pub no_peers: bool,
}

pub struct Inputs {
    pub now: u64,
    /// Timestamp of our tip block.
    pub tip_time: u64,
    pub peers: usize,
    pub outbound: usize,
    /// Distinct address groups among the outbound peers.
    pub outbound_groups: usize,
}

impl Health {
    pub fn assess(i: &Inputs) -> Health {
        Health {
            stale_tip: i.now.saturating_sub(i.tip_time) > STALE_TIP_SECS,
            few_groups: i.outbound > 0 && i.outbound_groups < MIN_OUTBOUND_GROUPS,
            no_peers: i.peers == 0,
        }
    }

    pub fn any(&self) -> bool {
        self.stale_tip || self.few_groups || self.no_peers
    }
}
