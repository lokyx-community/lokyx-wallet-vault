//! Which addresses to dial next. Pure: the state of the connections goes in, a list of dials comes
//! out, so the choices can be tested without sockets or clocks.

use crate::addrman::{AddrMan, Group, group};
use rand::RngCore;
use std::collections::HashSet;
use std::net::SocketAddr;

/// Outbound connections that carry everything.
pub const TARGET_FULL: usize = 8;
/// Outbound connections that carry only blocks: no transactions, no addresses. They tell an
/// attacker nothing about who we are connected to, and they are the ones saved as anchors.
pub const TARGET_BLOCK_ONLY: usize = 2;
/// Fewer addresses than this in the tables, and the seeds are used as well.
pub const MIN_ADDRS: usize = 50;
/// No connection at all for this long, and the seeds are used.
pub const SEED_AFTER_SECS: u64 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Full,
    BlockOnly,
    /// One more than the targets, to a group we have no peer in, because the tip looks stale.
    Extra,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dial {
    pub addr: SocketAddr,
    /// The keys it may have: one for an address we've been told or have met, one or more for a
    /// seed (two while its key is being rotated), none if we know nothing.
    pub keys: Vec<[u8; 32]>,
    pub kind: Kind,
    /// Taken from the saved anchors.
    pub anchor: bool,
}

/// What we are connected to now.
#[derive(Default)]
pub struct Connected {
    pub full: usize,
    pub block_only: usize,
    pub extra: usize,
    /// Groups of all outbound peers.
    pub groups: HashSet<Group>,
    pub addrs: HashSet<SocketAddr>,
    pub keys: HashSet<[u8; 32]>,
    pub stale_tip: bool,
    /// Seconds since we last had any peer.
    pub alone_for: u64,
}

pub struct Sources<'a> {
    pub addrs: &'a AddrMan,
    pub anchors: &'a [(SocketAddr, Option<[u8; 32]>)],
    pub seeds: &'a [(SocketAddr, Vec<[u8; 32]>)],
}

pub fn plan<R: RngCore>(
    rng: &mut R,
    now: u64,
    have: &Connected,
    src: &Sources,
    mut recently_failed: impl FnMut(&SocketAddr) -> bool,
) -> Vec<Dial> {
    let mut out = Vec::new();
    let mut used = have.groups.clone();
    let mut taken: HashSet<SocketAddr> = have.addrs.clone();
    let mut keys = have.keys.clone();
    let mut full_need = TARGET_FULL.saturating_sub(have.full);
    let mut block_need = TARGET_BLOCK_ONLY.saturating_sub(have.block_only);
    let mut extra_need = usize::from(have.stale_tip && have.extra == 0);

    // The anchors first: the block-relay peers from before the restart, whom nobody could have
    // chosen for us in the meantime.
    for (addr, key) in src.anchors {
        if block_need == 0 {
            break;
        }
        if taken.contains(addr) || used.contains(&group(addr)) || key.is_some_and(|k| keys.contains(&k)) {
            continue;
        }
        used.insert(group(addr));
        taken.insert(*addr);
        out.push(Dial { addr: *addr, keys: key.iter().copied().collect(), kind: Kind::BlockOnly, anchor: true });
        block_need -= 1;
    }

    let seeds_ok = src.addrs.len() < MIN_ADDRS || have.alone_for >= SEED_AFTER_SECS;
    for kind in [(Kind::Full, &mut full_need), (Kind::BlockOnly, &mut block_need), (Kind::Extra, &mut extra_need)]
        .map(|(k, n)| std::iter::repeat_n(k, std::mem::take(n)))
        .into_iter()
        .flatten()
    {
        let seed = seeds_ok
            .then(|| {
                src.seeds.iter().find(|(a, k)| {
                    !taken.contains(a)
                        && !used.contains(&group(a))
                        && !k.iter().any(|k| keys.contains(k))
                        && !recently_failed(a)
                })
            })
            .flatten();
        let pick = match seed {
            Some((a, k)) => Some((*a, k.clone())),
            None => src
                .addrs
                .select_outbound(rng, now, &used, |a| {
                    taken.contains(a) || src.addrs.key_of(a).is_some_and(|k| keys.contains(&k)) || recently_failed(a)
                })
                .map(|a| (a, src.addrs.key_of(&a).into_iter().collect::<Vec<_>>())),
        };
        let Some((addr, pinned)) = pick else { continue };
        used.insert(group(&addr));
        taken.insert(addr);
        keys.extend(pinned.iter().copied());
        out.push(Dial { addr, keys: pinned, kind, anchor: false });
    }
    out
}
