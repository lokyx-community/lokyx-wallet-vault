//! The node's address tables, built so that someone who controls many addresses, or a whole
//! hosting range, can't fill them and decide who we talk to.
//!
//! Two tables of buckets. Addresses heard about but never connected to live in `new`; addresses
//! we completed an outbound handshake with live in `tried`. Which bucket and slot an address gets
//! depends on a secret only this node knows, so an attacker can't pick addresses that collide with
//! good ones, and on the address *group* (an IPv4 /16, an IPv6 /32), so a single range can reach
//! only a few buckets however many addresses it sends.
//!
//! Nothing in here reads a clock or the system's randomness: callers pass the time and a random
//! number generator, which is what makes the tests exact.

use crate::crypto::tagged_hash;
use borsh::{BorshDeserialize, BorshSerialize};
use rand::RngCore;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};

pub const NEW_BUCKETS: usize = 256;
pub const TRIED_BUCKETS: usize = 64;
pub const SLOTS: usize = 32;
/// Buckets of the new table reachable from addresses told to us by one source group.
pub const NEW_BUCKETS_PER_SOURCE: u64 = 64;
/// Buckets of the tried table reachable by addresses of one group.
pub const TRIED_BUCKETS_PER_GROUP: u64 = 8;
/// Dial attempts without a single success after which an address may be pushed out.
const RETRIES: u32 = 3;
/// An address nobody has mentioned for this long is stale.
const STALE_SECS: u64 = 30 * 24 * 3600;
/// An address dialled less than this long ago isn't dialled again, or thrown out.
const RETRY_SECS: u64 = 60;
const MAX_COLLISIONS: usize = 10;

/// The range an address belongs to, as bytes. Addresses on this machine (loopback) are each their
/// own group, so that nodes of a local network can all be neighbours.
pub type Group = Vec<u8>;

fn ip_bytes(ip: &IpAddr) -> Vec<u8> {
    match ip {
        IpAddr::V4(a) => a.octets().to_vec(),
        IpAddr::V6(a) => match a.to_ipv4_mapped() {
            Some(v4) => v4.octets().to_vec(),
            None => a.octets().to_vec(),
        },
    }
}

fn canonical(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(a) => a.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(IpAddr::V6(a)),
        v4 => v4,
    }
}

fn addr_bytes(a: &SocketAddr) -> Vec<u8> {
    let mut v = ip_bytes(&a.ip());
    v.extend_from_slice(&a.port().to_be_bytes());
    v
}

/// The group of an IP address: IPv4 /16, IPv6 /32. Loopback has none worth speaking of; see
/// `group`.
pub fn group_of_ip(ip: &IpAddr) -> Group {
    match canonical(*ip) {
        IpAddr::V4(a) => {
            let o = a.octets();
            vec![4, o[0], o[1]]
        }
        IpAddr::V6(a) => {
            let o = a.octets();
            vec![6, o[0], o[1], o[2], o[3]]
        }
    }
}

/// The group of a socket address. The same as for its IP, except on loopback, where the port is
/// part of it.
pub fn group(a: &SocketAddr) -> Group {
    if canonical(a.ip()).is_loopback() {
        let mut g = vec![0];
        g.extend(addr_bytes(a));
        g
    } else {
        group_of_ip(&a.ip())
    }
}

/// What the tables remember about an address.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry {
    /// The static key it is said to have, or that we saw.
    key: Option<[u8; 32]>,
    /// True once a handshake showed us the key, rather than someone telling us.
    verified: bool,
    /// When it was last heard of: told to us by a peer, or connected to.
    time: u64,
    last_try: u64,
    last_success: u64,
    attempts: u32,
    tried: bool,
    /// Group of whoever told us about it. Only the new table cares.
    source: Group,
    bucket: usize,
    slot: usize,
}

/// One address as told to a peer: where, the key it has (if known), and when it was last heard of.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct PeerAddr {
    pub addr: String,
    pub key: Option<[u8; 32]>,
    pub time: u64,
}

#[derive(BorshSerialize, BorshDeserialize)]
struct Saved {
    addr: String,
    key: Option<[u8; 32]>,
    verified: bool,
    time: u64,
    last_try: u64,
    last_success: u64,
    attempts: u32,
    tried: bool,
    source: Vec<u8>,
}

pub struct AddrMan {
    secret: [u8; 32],
    new: Vec<Option<SocketAddr>>,
    tried: Vec<Option<SocketAddr>>,
    map: HashMap<SocketAddr, Entry>,
    n_new: usize,
    n_tried: usize,
    /// Addresses that earned a place in `tried` but found it taken: (newcomer, incumbent). The
    /// incumbent is dialled, and stays if it answers.
    collisions: Vec<(SocketAddr, SocketAddr)>,
}

fn routable(a: &SocketAddr) -> bool {
    let ip = canonical(a.ip());
    a.port() != 0 && !ip.is_unspecified() && !ip.is_multicast()
}

impl AddrMan {
    pub fn new(secret: [u8; 32]) -> Self {
        AddrMan {
            secret,
            new: vec![None; NEW_BUCKETS * SLOTS],
            tried: vec![None; TRIED_BUCKETS * SLOTS],
            map: HashMap::new(),
            n_new: 0,
            n_tried: 0,
            collisions: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
    pub fn len_new(&self) -> usize {
        self.n_new
    }
    pub fn len_tried(&self) -> usize {
        self.n_tried
    }
    pub fn contains(&self, a: &SocketAddr) -> bool {
        self.map.contains_key(a)
    }
    pub fn is_tried(&self, a: &SocketAddr) -> bool {
        self.map.get(a).is_some_and(|e| e.tried)
    }
    pub fn key_of(&self, a: &SocketAddr) -> Option<[u8; 32]> {
        self.map.get(a).and_then(|e| e.key)
    }
    /// Every address held, in no particular order.
    pub fn addrs(&self) -> Vec<SocketAddr> {
        self.map.keys().copied().collect()
    }
    /// (in tried, bucket, slot) of an address.
    pub fn position(&self, a: &SocketAddr) -> Option<(bool, usize, usize)> {
        self.map.get(a).map(|e| (e.tried, e.bucket, e.slot))
    }
    /// (newcomer, incumbent) pairs waiting for the incumbent to be tested.
    pub fn collisions(&self) -> &[(SocketAddr, SocketAddr)] {
        &self.collisions
    }

    fn hash(&self, tag: &[u8], parts: &[&[u8]]) -> u64 {
        let mut data = self.secret.to_vec();
        for p in parts {
            data.extend_from_slice(&(p.len() as u32).to_le_bytes());
            data.extend_from_slice(p);
        }
        u64::from_le_bytes(tagged_hash(tag, &data)[..8].try_into().expect("8"))
    }

    fn slot_of(&self, bucket: usize, a: &SocketAddr, tried: bool) -> usize {
        (self.hash(b"LOKYX/addrman/slot", &[&(bucket as u32).to_le_bytes(), &addr_bytes(a), &[tried as u8]])
            % SLOTS as u64) as usize
    }

    fn new_position(&self, a: &SocketAddr, source: &Group) -> (usize, usize) {
        let h1 = self.hash(b"LOKYX/addrman/new1", &[&group(a), source]) % NEW_BUCKETS_PER_SOURCE;
        let bucket = (self.hash(b"LOKYX/addrman/new2", &[source, &h1.to_le_bytes()]) % NEW_BUCKETS as u64) as usize;
        (bucket, self.slot_of(bucket, a, false))
    }

    fn tried_position(&self, a: &SocketAddr) -> (usize, usize) {
        let h1 = self.hash(b"LOKYX/addrman/tried1", &[&addr_bytes(a)]) % TRIED_BUCKETS_PER_GROUP;
        let bucket =
            (self.hash(b"LOKYX/addrman/tried2", &[&group(a), &h1.to_le_bytes()]) % TRIED_BUCKETS as u64) as usize;
        (bucket, self.slot_of(bucket, a, true))
    }

    /// May this entry be pushed out of its slot by a newcomer?
    fn terrible(e: &Entry, now: u64) -> bool {
        if e.last_try != 0 && e.last_try + RETRY_SECS > now {
            return false; // we were just talking to it
        }
        if e.time + STALE_SECS < now {
            return true;
        }
        e.last_success == 0 && e.attempts >= RETRIES
    }

    fn table_mut(&mut self, tried: bool) -> &mut Vec<Option<SocketAddr>> {
        if tried { &mut self.tried } else { &mut self.new }
    }

    fn unplace(&mut self, a: &SocketAddr) -> Option<Entry> {
        let e = self.map.remove(a)?;
        let idx = e.bucket * SLOTS + e.slot;
        let t = self.table_mut(e.tried);
        if t[idx] == Some(*a) {
            t[idx] = None;
        }
        if e.tried {
            self.n_tried -= 1;
        } else {
            self.n_new -= 1;
        }
        self.collisions.retain(|(c, i)| c != a && i != a);
        Some(e)
    }

    /// Hear of an address, from `source` (None: a seed, or our own configuration), claimed last
    /// seen at `time`, with the key it is said to have. Returns whether it is new to us and was
    /// kept.
    pub fn add(
        &mut self,
        addr: SocketAddr,
        key: Option<[u8; 32]>,
        source: Option<IpAddr>,
        time: u64,
        now: u64,
    ) -> bool {
        if !routable(&addr) {
            return false;
        }
        let time = time.min(now);
        if let Some(e) = self.map.get_mut(&addr) {
            e.time = e.time.max(time);
            if e.key.is_none() {
                e.key = key; // the first claim stands; a later one doesn't replace it
            }
            return false;
        }
        if time + STALE_SECS < now {
            return false;
        }
        let source = source.map(|ip| group_of_ip(&ip)).unwrap_or_else(|| vec![255]);
        let (bucket, slot) = self.new_position(&addr, &source);
        let idx = bucket * SLOTS + slot;
        if let Some(old) = self.new[idx] {
            let replace = self.map.get(&old).is_none_or(|e| Self::terrible(e, now));
            if !replace {
                return false;
            }
            self.unplace(&old);
        }
        self.new[idx] = Some(addr);
        self.n_new += 1;
        self.map.insert(
            addr,
            Entry {
                key,
                verified: false,
                time,
                last_try: 0,
                last_success: 0,
                attempts: 0,
                tried: false,
                source,
                bucket,
                slot,
            },
        );
        true
    }

    /// We are about to dial `addr`.
    pub fn attempt(&mut self, addr: &SocketAddr, now: u64) {
        if let Some(e) = self.map.get_mut(addr) {
            e.last_try = now;
            e.attempts += 1;
        }
    }

    /// An outbound handshake with `addr` finished and showed `key`. Moves the address to the tried
    /// table. If its slot there is taken the move waits for the occupant to be tested (see
    /// `collisions`), and this returns false.
    pub fn good(&mut self, addr: SocketAddr, key: [u8; 32], now: u64) -> bool {
        if !routable(&addr) {
            return false;
        }
        if !self.map.contains_key(&addr) && !self.add(addr, Some(key), None, now, now) {
            // Its place in the new table is taken by an address that's doing fine. We've just
            // talked to this one, so try the tried table directly.
            let (bucket, slot) = self.tried_position(&addr);
            if self.tried[bucket * SLOTS + slot].is_some() {
                return false;
            }
            self.tried[bucket * SLOTS + slot] = Some(addr);
            self.n_tried += 1;
            self.map.insert(
                addr,
                Entry {
                    key: Some(key),
                    verified: true,
                    time: now,
                    last_try: now,
                    last_success: now,
                    attempts: 0,
                    tried: true,
                    source: vec![255],
                    bucket,
                    slot,
                },
            );
            return true;
        }
        let Some(e) = self.map.get_mut(&addr) else { return false };
        e.key = Some(key);
        e.verified = true;
        e.time = now;
        e.last_try = now;
        e.last_success = now;
        e.attempts = 0;
        if e.tried {
            return true;
        }
        let (bucket, slot) = self.tried_position(&addr);
        let idx = bucket * SLOTS + slot;
        match self.tried[idx] {
            None => {
                self.move_to_tried(addr, bucket, slot);
                true
            }
            Some(other) => {
                if self.collisions.len() < MAX_COLLISIONS && !self.collisions.iter().any(|(c, _)| *c == addr) {
                    self.collisions.push((addr, other));
                }
                false
            }
        }
    }

    fn move_to_tried(&mut self, addr: SocketAddr, bucket: usize, slot: usize) {
        let Some(e) = self.map.get_mut(&addr) else { return };
        let old = e.bucket * SLOTS + e.slot;
        e.tried = true;
        e.bucket = bucket;
        e.slot = slot;
        if self.new[old] == Some(addr) {
            self.new[old] = None;
        }
        self.n_new -= 1;
        self.tried[bucket * SLOTS + slot] = Some(addr);
        self.n_tried += 1;
        self.collisions.retain(|(c, _)| *c != addr);
    }

    /// The incumbent of a collision was dialled: `alive` says whether it answered. If it did, it
    /// keeps its place and the newcomer stays in the new table. If not, the newcomer replaces it.
    pub fn resolve_collision(&mut self, newcomer: &SocketAddr, incumbent: &SocketAddr, alive: bool) {
        if !self.collisions.contains(&(*newcomer, *incumbent)) {
            return;
        }
        self.collisions.retain(|c| *c != (*newcomer, *incumbent));
        if alive || !self.map.contains_key(newcomer) {
            return;
        }
        let (bucket, slot) = self.tried_position(newcomer);
        if self.tried[bucket * SLOTS + slot] == Some(*incumbent) {
            self.unplace(incumbent);
            self.move_to_tried(*newcomer, bucket, slot);
        }
    }

    pub fn forget(&mut self, addr: &SocketAddr) {
        self.unplace(addr);
    }

    /// A handshake with `addr` showed a key other than the one we hold for it. If a handshake gave
    /// us that one, the address has changed hands (or the key was rotated), and it is forgotten. If
    /// we were only told it, the claim is dropped and the address stays: otherwise anyone could
    /// get honest addresses thrown out by gossiping wrong keys for them.
    pub fn key_mismatch(&mut self, addr: &SocketAddr) {
        match self.map.get_mut(addr) {
            Some(e) if e.verified => {
                self.unplace(addr);
            }
            Some(e) => e.key = None,
            None => {}
        }
    }

    fn pick_from<R: RngCore>(
        &self,
        rng: &mut R,
        tried: bool,
        now: u64,
        ok: &mut dyn FnMut(&SocketAddr) -> bool,
    ) -> Option<SocketAddr> {
        let (table, buckets) = if tried { (&self.tried, TRIED_BUCKETS) } else { (&self.new, NEW_BUCKETS) };
        let mut usable = |idx: usize| -> Option<SocketAddr> {
            let a = table[idx]?;
            let e = self.map.get(&a)?;
            if e.last_try != 0 && e.last_try + RETRY_SECS > now {
                return None;
            }
            ok(&a).then_some(a)
        };
        // A random bucket, then a random slot in it and on from there. Tried a number of times,
        // so which address comes out is spread over the table...
        for _ in 0..64 {
            let b = (rng.next_u64() % buckets as u64) as usize;
            let s0 = (rng.next_u64() % SLOTS as u64) as usize;
            for k in 0..SLOTS {
                if let Some(a) = usable(b * SLOTS + (s0 + k) % SLOTS) {
                    return Some(a);
                }
            }
        }
        // ...and then a sweep from a random place, so a table with few suitable addresses still
        // yields one if it has any.
        let total = buckets * SLOTS;
        let start = (rng.next_u64() % total as u64) as usize;
        (0..total).find_map(|k| usable((start + k) % total))
    }

    /// An address to dial: from the tried or the new table with equal chance (the other if that
    /// one is empty or has nothing suitable), a random bucket and a random slot in it. `ok` rules
    /// out addresses the caller can't use, such as one in a group it already has a peer in.
    pub fn select<R: RngCore>(
        &self,
        rng: &mut R,
        now: u64,
        mut ok: impl FnMut(&SocketAddr) -> bool,
    ) -> Option<SocketAddr> {
        let first_tried = rng.next_u32() & 1 == 0;
        let order = if first_tried { [true, false] } else { [false, true] };
        for tried in order {
            if (tried && self.n_tried == 0) || (!tried && self.n_new == 0) {
                continue;
            }
            if let Some(a) = self.pick_from(rng, tried, now, &mut ok) {
                return Some(a);
            }
        }
        None
    }

    /// An address for an outbound connection that isn't in a group we already have a peer in,
    /// isn't one `skip` rules out, and wasn't dialled a moment ago. One peer per group is what
    /// keeps a single hosting range from being all of our outbound connections.
    pub fn select_outbound<R: RngCore>(
        &self,
        rng: &mut R,
        now: u64,
        used_groups: &std::collections::HashSet<Group>,
        mut skip: impl FnMut(&SocketAddr) -> bool,
    ) -> Option<SocketAddr> {
        self.select(rng, now, |a| !used_groups.contains(&group(a)) && !skip(a))
    }

    /// An address to make a short test connection to: one from the new table.
    pub fn select_feeler<R: RngCore>(
        &self,
        rng: &mut R,
        now: u64,
        mut ok: impl FnMut(&SocketAddr) -> bool,
    ) -> Option<SocketAddr> {
        if self.n_new == 0 {
            return None;
        }
        self.pick_from(rng, false, now, &mut ok)
    }

    /// Up to `max` addresses to tell a peer about, chosen at random from both tables, leaving out
    /// ones that are stale or have never answered.
    pub fn sample<R: RngCore>(&self, rng: &mut R, max: usize, now: u64) -> Vec<PeerAddr> {
        let mut all: Vec<(&SocketAddr, &Entry)> = self.map.iter().filter(|(_, e)| !Self::terrible(e, now)).collect();
        all.sort_by_key(|(a, _)| addr_bytes(a)); // HashMap order is arbitrary; start from a fixed one
        let take = max.min(all.len());
        for i in 0..take {
            let j = i + (rng.next_u64() % (all.len() - i) as u64) as usize;
            all.swap(i, j);
        }
        all[..take].iter().map(|(a, e)| PeerAddr { addr: a.to_string(), key: e.key, time: e.time }).collect()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut v: Vec<(&SocketAddr, &Entry)> = self.map.iter().collect();
        v.sort_by_key(|(a, _)| addr_bytes(a));
        let saved: Vec<Saved> = v
            .into_iter()
            .map(|(a, e)| Saved {
                addr: a.to_string(),
                key: e.key,
                verified: e.verified,
                time: e.time,
                last_try: e.last_try,
                last_success: e.last_success,
                attempts: e.attempts,
                tried: e.tried,
                source: e.source.clone(),
            })
            .collect();
        borsh::to_vec(&saved).expect("encode")
    }

    /// Rebuild from `to_bytes`. Positions are worked out again from the secret, so a table saved
    /// under another secret still loads (and lands differently). Entries that no longer fit are
    /// dropped.
    pub fn from_bytes(secret: [u8; 32], bytes: &[u8], now: u64) -> Option<AddrMan> {
        let saved: Vec<Saved> = borsh::from_slice(bytes).ok()?;
        let mut m = AddrMan::new(secret);
        // Tried ones first, so they get their slots before anything else is placed.
        for s in saved.iter().filter(|s| s.tried).chain(saved.iter().filter(|s| !s.tried)) {
            let Ok(addr) = s.addr.parse::<SocketAddr>() else { continue };
            if !routable(&addr) {
                continue;
            }
            let (bucket, slot, tried) = if s.tried {
                let (b, sl) = m.tried_position(&addr);
                (b, sl, true)
            } else {
                let (b, sl) = m.new_position(&addr, &s.source);
                (b, sl, false)
            };
            let idx = bucket * SLOTS + slot;
            if m.table_mut(tried)[idx].is_some() {
                continue;
            }
            m.table_mut(tried)[idx] = Some(addr);
            if tried {
                m.n_tried += 1;
            } else {
                m.n_new += 1;
            }
            m.map.insert(
                addr,
                Entry {
                    key: s.key,
                    verified: s.verified,
                    time: s.time.min(now),
                    last_try: s.last_try,
                    last_success: s.last_success,
                    attempts: s.attempts,
                    tried,
                    source: s.source.clone(),
                    bucket,
                    slot,
                },
            );
        }
        Some(m)
    }
}
