//! Which inbound connection to drop when all the places are taken and another node wants in.
//!
//! The ones that cost an attacker something to fake are kept: the longest-connected, the quickest
//! to answer, and the ones that last gave us a new block. Of the rest, the victim comes from the
//! address group with the most connections, so a crowd from one range pays for itself.

use crate::addrman::Group;
use std::collections::HashMap;

pub const PROTECT_BY_AGE: usize = 4;
pub const PROTECT_BY_PING: usize = 4;
pub const PROTECT_BY_BLOCK: usize = 4;

#[derive(Clone, Debug)]
pub struct Candidate {
    pub id: u64,
    pub group: Group,
    /// Milliseconds connected.
    pub age: u64,
    /// Best round trip seen, in milliseconds.
    pub ping_ms: Option<u64>,
    /// Seconds since this peer last gave us a block that became our tip.
    pub block_ago: Option<u64>,
}

/// The id of the connection to drop, or None if every one is protected.
pub fn select_victim(peers: &[Candidate]) -> Option<u64> {
    let mut rest: Vec<&Candidate> = peers.iter().collect();
    let protect = |rest: &mut Vec<&Candidate>, n: usize, key: &dyn Fn(&Candidate) -> Option<u64>| {
        // Smaller key = better. Candidates without one aren't protected by this rule.
        let mut ranked: Vec<(u64, u64)> = rest.iter().filter_map(|c| key(c).map(|k| (k, c.id))).collect();
        ranked.sort();
        let keep: Vec<u64> = ranked.into_iter().take(n).map(|(_, id)| id).collect();
        rest.retain(|c| !keep.contains(&c.id));
    };
    protect(&mut rest, PROTECT_BY_AGE, &|c| Some(u64::MAX - c.age));
    protect(&mut rest, PROTECT_BY_PING, &|c| c.ping_ms);
    protect(&mut rest, PROTECT_BY_BLOCK, &|c| c.block_ago);

    let mut by_group: HashMap<&Group, Vec<&Candidate>> = HashMap::new();
    for c in &rest {
        by_group.entry(&c.group).or_default().push(c);
    }
    // The biggest group; on a tie, the one holding the newest connection. Then its newest.
    let newest = |v: &Vec<&Candidate>| v.iter().map(|c| u64::MAX - c.age).max().unwrap_or(0);
    let (_, members) = by_group.into_iter().max_by_key(|(g, v)| (v.len(), newest(v), (*g).clone()))?;
    members.into_iter().min_by_key(|c| (c.age, c.id)).map(|c| c.id)
}
