//! Node state shared by p2p, rpc and the miner. Blocks and txs from all three
//! go through the same submit functions.

use crate::addrman::{AddrMan, group};
use crate::block::Block;
use crate::block::BlockHeader;
use crate::chain::{BlockError, Chain, Judgement, MAX_HEADERS_PER_MSG, Outcome, Precheck, Staged};
use crate::crypto::Hash;
use crate::dialplan::Connected;
use crate::health::{Health, Inputs};
use crate::mempool::Mempool;
use crate::miner::Miner;
use crate::net::{Hello, Message};
use crate::params::{ChainParams, PROTOCOL_VERSION};
use crate::tx::SignedTransaction;
use parking_lot::Mutex;
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use tokio::sync::mpsc;

pub const USER_AGENT: &str = concat!("lokyxd/", env!("CARGO_PKG_VERSION"));

pub struct PeerInfo {
    pub id: u64,
    pub addr: SocketAddr,
    /// Address the peer accepts connections on (its IP + advertised port).
    pub listen_addr: SocketAddr,
    pub inbound: bool,
    pub sender: mpsc::Sender<Message>,
    pub best_height: u64,
    pub user_agent: String,
    pub connected_at: Instant,
    pub misbehavior: u32,
    /// The peer's static key, proven by the handshake. Identifies it across connections.
    pub key: [u8; 32],
    pub last_seen: Instant,
    /// Carries blocks only: no transactions, no addresses either way.
    pub block_only: bool,
    /// An outbound connection opened beyond the targets because our tip looked stale.
    pub extra: bool,
    /// Wakes the connection's reader so it can end (we dropped this peer).
    pub closer: Arc<Notify>,
    /// The ping we're waiting for an answer to: (nonce, when sent).
    pub ping_sent: Option<(u64, Instant)>,
    /// The quickest answer to a ping so far.
    pub ping_best: Option<Duration>,
    /// When this peer last gave us a block that became our tip.
    pub last_block: Option<Instant>,
    /// When we last asked for its addresses, and whether the answer is still due.
    pub asked_peers: Option<Instant>,
    pub awaiting_peers: bool,
    /// When we last answered such a request from it.
    pub answered_peers: Option<Instant>,
}

pub struct Node {
    pub params: &'static ChainParams,
    pub chain: Mutex<Chain>,
    pub mempool: Mutex<Mempool>,
    pub peers: Mutex<HashMap<u64, PeerInfo>>,
    /// Addresses we know of, in tables built to resist being filled by one party (see addrman.rs).
    pub addrs: Mutex<AddrMan>,
    /// Configured entry points, with the key each is pinned to, if it publishes one. Used when the
    /// tables are nearly empty or we've been alone for a while.
    pub seeds: Mutex<Vec<(SocketAddr, Vec<[u8; 32]>)>>,
    /// Block-relay peers from before the last restart, dialled first.
    pub anchors: Mutex<Vec<(SocketAddr, Option<[u8; 32]>)>>,
    /// What the last look at the network's health found.
    pub health: Mutex<Health>,
    pub timing: Mutex<Timing>,
    pub banned: Mutex<HashMap<IpAddr, Instant>>,
    /// Caps on inbound handshakes under way.
    pub gate: crate::net::HandshakeGate,
    /// This node's identity on the network: its static key, and the secret for its address tables.
    pub key: crate::transport::NodeKey,
    pub listen_port: u16,
    pub miner: Arc<Miner>,
    pub started: Instant,
    /// Hostnames to re-resolve when the node finds itself without peers.
    pub seed_hosts: Mutex<Vec<String>>,
    /// Block templates handed out over RPC (phone miners).
    pub work: crate::work::WorkCache,
    /// Bodies we've asked a peer for: hash -> (peer, when). Asked again elsewhere after
    /// BODY_TIMEOUT, and forgotten after BODY_FORGET.
    pub inflight: Mutex<HashMap<Hash, Inflight>>,
    /// Per-peer sync bookkeeping (see `PeerSync`).
    pub sync: Mutex<HashMap<u64, PeerSync>>,
    next_peer_id: AtomicU64,
}

/// How often the connection manager does its rounds. Only tests change these.
#[derive(Clone, Copy, Debug)]
pub struct Timing {
    pub tick: Duration,
    /// A feeler connection every this many ticks.
    pub feeler_ticks: u64,
    /// The address tables and anchors are saved every this many ticks.
    pub save_ticks: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Timing { tick: Duration::from_secs(5), feeler_ticks: 24, save_ticks: 180 }
    }
}

/// Messages a block-relay-only connection must never carry.
fn not_for_block_only(m: &Message) -> bool {
    matches!(m, Message::NewTx(_) | Message::GetPeers | Message::Peers(_))
}

/// A header request that isn't answered in this long costs the peer and frees its slot.
pub const HEADERS_TIMEOUT: Duration = Duration::from_secs(60);
/// A body request that isn't answered in this long goes to someone else.
pub const BODY_TIMEOUT: Duration = Duration::from_secs(60);
/// Bodies that arrive this long after being asked for are no longer expected.
pub const BODY_FORGET: Duration = Duration::from_secs(600);
/// The most bodies one peer may be fetching for us at once.
pub const MAX_BODIES_IN_FLIGHT: usize = 128;

/// A body request.
#[derive(Debug, Clone, Copy)]
pub struct Inflight {
    pub peer: u64,
    pub at: Instant,
    /// Already counted against the peer for running out.
    pub late: bool,
}

/// What we know about a peer's chain, and what we've asked it for.
#[derive(Debug, Default)]
pub struct PeerSync {
    /// The most work the peer has said its chain has (at the handshake), or that we've seen it
    /// prove (blocks it sent that we accepted). A peer that says it has more than it can show
    /// is lying, so it's penalised.
    pub claimed_work: u128,
    /// When we sent the header request still waiting for an answer, if any. One at a time.
    pub headers_asked: Option<Instant>,
    /// Body requests this peer let run out.
    pub stalls: u32,
}

/// Misbehaviour points for a block a peer sent us, and why. `None` means the peer is in the
/// clear, which is the case whenever the fault isn't the peer's:
///
/// - `TooEarly`: a clock a few seconds fast, or ours a few seconds slow. The block is looked at
///   again when its time comes.
/// - `Halted`: the supply check broke, which is a bug in our code. Punishing the messenger would
///   be wrong, and would eventually disconnect every honest peer.
/// - `Internal`: our own failure (disk, locks).
pub fn block_penalty(e: &BlockError) -> Option<(u32, &'static str)> {
    match e {
        BlockError::Invalid(_) => Some((100, "invalid block")),
        BlockError::Mismatch(_) => Some((50, "body doesn't match its header")),
        BlockError::TooEarly(_) | BlockError::Halted(_) | BlockError::Internal(_) => None,
    }
}

/// What to do on the periodic sync tick.
#[derive(Debug, Default)]
pub struct SyncTick {
    /// Ask this peer for headers.
    pub headers_from: Option<u64>,
    /// Ask this peer for bodies.
    pub bodies_from: Option<u64>,
    pub penalties: Vec<(u64, u32, String)>,
}

/// What to ask a peer for after handling its headers.
#[derive(Debug, Default)]
pub struct HeadersNext {
    pub more_headers: bool,
    pub bodies: bool,
    /// Misbehaviour points and why.
    pub penalty: Option<(u32, String)>,
}

impl Node {
    /// A node with a throwaway identity (tests, tools). A real node keeps its key: `with_key`.
    pub fn new(params: &'static ChainParams, chain: Chain, listen_port: u16, bootstrap: Vec<SocketAddr>) -> Arc<Self> {
        Node::with_key(params, chain, listen_port, bootstrap, crate::transport::NodeKey::generate())
    }

    pub fn with_key(
        params: &'static ChainParams,
        chain: Chain,
        listen_port: u16,
        bootstrap: Vec<SocketAddr>,
        key: crate::transport::NodeKey,
    ) -> Arc<Self> {
        let secret = key.table_secret;
        Arc::new(Node {
            params,
            chain: Mutex::new(chain),
            mempool: Mutex::new(Mempool::default()),
            peers: Mutex::new(HashMap::new()),
            addrs: Mutex::new(AddrMan::new(secret)),
            seeds: Mutex::new(bootstrap.into_iter().map(|a| (a, vec![])).collect()),
            anchors: Mutex::new(Vec::new()),
            health: Mutex::new(Health::default()),
            timing: Mutex::new(Timing::default()),
            banned: Mutex::new(HashMap::new()),
            gate: Default::default(),
            key,
            listen_port,
            miner: Arc::new(Miner::new()),
            started: Instant::now(),
            seed_hosts: Mutex::new(Vec::new()),
            work: Default::default(),
            inflight: Mutex::new(HashMap::new()),
            sync: Mutex::new(HashMap::new()),
            next_peer_id: AtomicU64::new(1),
        })
    }

    pub fn net_id(&self) -> crate::transport::NetId {
        crate::transport::NetId { chain_id: self.params.chain_id, genesis: self.chain.lock().genesis_hash() }
    }

    /// Remember the entry points found by `net::resolve`, and the key each that publishes one must
    /// have. A different key on connect ends the handshake.
    pub fn add_resolved(&self, found: Vec<(SocketAddr, Vec<[u8; 32]>)>) {
        let mut seeds = self.seeds.lock();
        for (a, key) in found {
            match seeds.iter_mut().find(|(x, _)| *x == a) {
                Some(s) => {
                    if !key.is_empty() {
                        s.1 = key;
                    }
                }
                None => seeds.push((a, key)),
            }
        }
    }

    /// Addresses of every kind we hold: the tables and the configured seeds.
    pub fn known_address_count(&self) -> usize {
        self.addrs.lock().len() + self.seeds.lock().len()
    }

    /// Forget an address everywhere (we dialled ourselves, say).
    pub fn forget_address(&self, a: &SocketAddr) {
        self.addrs.lock().forget(a);
        self.seeds.lock().retain(|(x, _)| x != a);
        self.anchors.lock().retain(|(x, _)| x != a);
    }

    /// The state of our connections, as the dial planner wants it.
    pub fn connected(&self, stale_tip: bool, alone_for: u64) -> Connected {
        let peers = self.peers.lock();
        let mut c = Connected { stale_tip, alone_for, ..Default::default() };
        for p in peers.values() {
            c.keys.insert(p.key);
            c.addrs.insert(p.addr);
            c.addrs.insert(p.listen_addr);
            if p.inbound {
                continue;
            }
            c.groups.insert(group(&p.listen_addr));
            match (p.block_only, p.extra) {
                (true, _) => c.block_only += 1,
                (false, true) => c.extra += 1,
                (false, false) => c.full += 1,
            }
        }
        c
    }

    /// Look at the signs of isolation. Only ever read: what to do about them (look for more
    /// connections) is decided by the dialer, and mining is never touched.
    pub fn assess_health(&self, now: u64) -> Health {
        let tip_time = self.chain.lock().tip().header.timestamp;
        let peers = self.peers.lock();
        let outbound: Vec<&PeerInfo> = peers.values().filter(|p| !p.inbound).collect();
        let groups: HashSet<_> = outbound.iter().map(|p| group(&p.listen_addr)).collect();
        Health::assess(&Inputs {
            now,
            tip_time,
            peers: peers.len(),
            outbound: outbound.len(),
            outbound_groups: groups.len(),
        })
    }

    /// Save the address tables, and the block-relay peers as anchors.
    pub fn save_net(&self) {
        let tables = self.addrs.lock().to_bytes();
        let live: Vec<(String, Option<[u8; 32]>)> = self
            .peers
            .lock()
            .values()
            .filter(|p| !p.inbound && p.block_only)
            .map(|p| (p.listen_addr.to_string(), Some(p.key)))
            .collect();
        let c = self.chain.lock();
        c.save_meta("addrs", &tables);
        // With none connected right now, the ones from before stay.
        if !live.is_empty() {
            c.save_meta("anchors", &borsh::to_vec(&live).expect("encode"));
        }
    }

    /// Load what `save_net` saved.
    pub fn load_net(&self) {
        let (tables, anchors) = {
            let c = self.chain.lock();
            (c.load_meta("addrs"), c.load_meta("anchors"))
        };
        if let Some(m) = tables.and_then(|b| AddrMan::from_bytes(self.key.table_secret, &b, crate::chain::now())) {
            tracing::info!("{} saved address(es) loaded ({} tried)", m.len(), m.len_tried());
            *self.addrs.lock() = m;
        }
        if let Some(list) = anchors.and_then(|b| borsh::from_slice::<Vec<(String, Option<[u8; 32]>)>>(&b).ok()) {
            *self.anchors.lock() =
                list.into_iter().filter_map(|(a, k)| a.parse::<SocketAddr>().ok().map(|a| (a, k))).collect();
        }
    }

    /// Drop a peer: it's removed and its connection told to end.
    pub fn disconnect(&self, peer: u64) {
        if let Some(p) = self.peers.lock().remove(&peer) {
            p.closer.notify_one();
        }
    }

    pub fn next_peer_id(&self) -> u64 {
        self.next_peer_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn hello(&self) -> Hello {
        let c = self.chain.lock();
        Hello {
            magic: self.params.magic,
            protocol_version: PROTOCOL_VERSION,
            chain_id: self.params.chain_id,
            genesis: c.genesis_hash(),
            best_height: c.height(),
            best_work: c.cum_work(),
            listen_port: self.listen_port,
            user_agent: USER_AGENT.to_string(),
        }
    }

    /// Validate and connect a block from any source (peer, local miner, RPC).
    /// Proof of work and signatures are checked *before* taking the chain lock, so a flood of
    /// blocks can't stall RPC, and in that order, so a cheap block can't make us check thousands
    /// of signatures.
    pub fn submit_block_blocking(&self, b: Block) -> Result<Outcome, BlockError> {
        let pre = self.chain.lock().precheck(&b)?;
        let (seed, keep_body) = match pre {
            Precheck::AlreadyKnown => return Ok(Outcome::AlreadyKnown),
            Precheck::NeedHeaders => return Ok(Outcome::NeedHeaders),
            Precheck::Ignored => return Ok(Outcome::Ignored),
            Precheck::Go { seed, keep_body } => (seed, keep_body),
        };
        if let Some(seed) = seed {
            Chain::verify_pow(&seed, &b.header).map_err(BlockError::Invalid)?;
        }
        if keep_body {
            if !Chain::body_matches(&b) {
                return Err(BlockError::Mismatch("transactions don't match the header's transaction root".into()));
            }
            if let Err(e) = Chain::check_body(&b, self.params) {
                // The body is the one the header commits to, so the block itself is invalid.
                self.chain.lock().reject_block(b.hash());
                return Err(BlockError::Invalid(e));
            }
        }
        let mut c = self.chain.lock();
        let out = c.process_block_checked(b, true, keep_body)?;
        if let Outcome::NewTip { disconnected, reorg_depth } = &out {
            self.mempool.lock().on_new_tip(&c.state, self.params, disconnected.clone());
            let t = c.tip();
            tracing::info!(
                "new tip height {} hash {} difficulty {}{}",
                t.header.height,
                crate::crypto::to_hex(&t.hash[..8]),
                t.header.difficulty,
                if *reorg_depth > 0 { format!(" (reorg depth {reorg_depth})") } else { String::new() }
            );
        }
        Ok(out)
    }

    /// Handle a batch of headers from `peer`: collect, check proof of work outside the lock,
    /// judge the peer's branch, and keep it if it's worth keeping.
    pub fn on_headers_blocking(&self, peer: u64, headers: Vec<BlockHeader>) -> HeadersNext {
        let claimed = {
            let mut sync = self.sync.lock();
            match sync.get_mut(&peer).filter(|s| s.headers_asked.is_some()) {
                Some(s) => {
                    s.headers_asked = None;
                    s.claimed_work
                }
                None => {
                    return HeadersNext {
                        penalty: Some((20, "headers we didn't ask for".into())),
                        ..Default::default()
                    };
                }
            }
        };
        let done = headers.len() < MAX_HEADERS_PER_MSG;
        let staged = self.chain.lock().stage_headers(peer, &headers);
        let (jobs, stalled) = match staged {
            Ok(Staged::Busy) => return HeadersNext::default(),
            Ok(Staged::Verify { jobs, stalled }) => (jobs, stalled),
            Err(e) => {
                self.chain.lock().drop_pending(peer);
                return match e {
                    BlockError::Invalid(e) => {
                        HeadersNext { penalty: Some((100, format!("invalid header: {e}"))), ..Default::default() }
                    }
                    BlockError::Mismatch(e) => HeadersNext { penalty: Some((20, e)), ..Default::default() },
                    e => {
                        tracing::warn!("headers from peer {peer}: {e}");
                        HeadersNext::default()
                    }
                };
            }
        };
        let verified = match Chain::verify_pow_jobs(&jobs) {
            Ok(v) => v,
            Err((_, e)) => {
                self.chain.lock().drop_pending(peer);
                return HeadersNext {
                    penalty: Some((100, format!("header proof of work: {e}"))),
                    ..Default::default()
                };
            }
        };
        if done && !stalled {
            // The peer has sent everything up to its tip. Its tip's work is that of the last header
            // it sent, or, if it sent none, at most our best header's (we already had its tip).
            let c = self.chain.lock();
            let shown = match headers.last() {
                Some(h) => c.header_work(peer, &h.hash()),
                None => Some(c.best_header().cum_work.max(c.pending_work(peer).unwrap_or(0))),
            };
            if let Some(shown) = shown
                && shown < claimed
            {
                drop(c);
                self.chain.lock().drop_pending(peer);
                return HeadersNext {
                    penalty: Some((100, format!("claimed more work than its headers show ({claimed} > {shown})"))),
                    ..Default::default()
                };
            }
        }
        let judgement = self.chain.lock().judge_pending(peer, done, &verified);
        match judgement {
            Judgement::Nothing => HeadersNext { more_headers: !done && !stalled, bodies: true, penalty: None },
            Judgement::NeedMore => HeadersNext { more_headers: !stalled, ..Default::default() },
            Judgement::Discard(why) => {
                tracing::info!("not keeping headers from peer {peer}: {why}");
                HeadersNext::default()
            }
            Judgement::Commit(jobs) => {
                let verified = match Chain::verify_pow_jobs(&jobs) {
                    Ok(v) => v,
                    Err((_, e)) => {
                        self.chain.lock().drop_pending(peer);
                        return HeadersNext {
                            penalty: Some((100, format!("header proof of work: {e}"))),
                            ..Default::default()
                        };
                    }
                };
                let mut c = self.chain.lock();
                match c.commit_pending(peer, &verified) {
                    Ok(n) => tracing::info!(
                        "added {n} headers from peer {peer}; best header height {}",
                        c.best_header().header.height
                    ),
                    Err(e) => tracing::warn!("headers from peer {peer}: {e}"),
                }
                HeadersNext { more_headers: !done && !stalled, bodies: true, penalty: None }
            }
        }
    }

    /// A peer finished the handshake saying its chain has `claimed_work`.
    pub fn add_sync_peer(&self, peer: u64, claimed_work: u128) {
        self.sync.lock().insert(peer, PeerSync { claimed_work, ..Default::default() });
    }

    /// The locator for a header request to `peer`, or None if one is already waiting for an
    /// answer (so a burst of announcements can't make us send a burst of requests).
    pub fn want_headers(&self, peer: u64) -> Option<Vec<Hash>> {
        {
            let mut sync = self.sync.lock();
            let s = sync.get_mut(&peer)?;
            if s.headers_asked.is_some() {
                return None;
            }
            s.headers_asked = Some(Instant::now());
        }
        Some(self.chain.lock().header_locator(peer))
    }

    /// `peer` sent us a block we accepted (or already had), so its chain has at least that
    /// block's work and height. Only checked blocks move these numbers, never what a peer says.
    pub fn peer_has_block(&self, peer: u64, hash: &Hash) {
        let known = {
            let c = self.chain.lock();
            c.header_work(peer, hash).zip(c.header_height(hash))
        };
        let Some((work, height)) = known else { return };
        if let Some(s) = self.sync.lock().get_mut(&peer) {
            s.claimed_work = s.claimed_work.max(work);
        }
        if let Some(p) = self.peers.lock().get_mut(&peer) {
            p.best_height = p.best_height.max(height);
        }
    }

    /// Bodies to ask `peer` for now: missing ones on the best header chain that nobody else is
    /// already fetching (or that have been in flight too long). At most MAX_BODIES_IN_FLIGHT
    /// per peer at once.
    pub fn take_body_requests(&self, peer: u64, max: usize) -> Vec<Hash> {
        self.take_body_requests_at(peer, max, Instant::now())
    }

    pub fn take_body_requests_at(&self, peer: u64, max: usize, now: Instant) -> Vec<Hash> {
        let missing = self.chain.lock().missing_bodies((max + MAX_BODIES_IN_FLIGHT) * 2);
        let mut inflight = self.inflight.lock();
        let busy = inflight.values().filter(|r| r.peer == peer && now.duration_since(r.at) < BODY_TIMEOUT).count();
        let room = MAX_BODIES_IN_FLIGHT.saturating_sub(busy).min(max);
        let out: Vec<Hash> = missing
            .into_iter()
            .filter(|h| inflight.get(h).is_none_or(|r| now.duration_since(r.at) >= BODY_TIMEOUT))
            .take(room)
            .collect();
        for h in &out {
            inflight.insert(*h, Inflight { peer, at: now, late: false });
        }
        out
    }

    /// A body arrived from `peer`. True if we asked that peer for it (even if the request has
    /// since run out, as long as nobody else was asked instead); anything else is dropped unread.
    pub fn body_arrived(&self, peer: u64, hash: &Hash) -> bool {
        let mut inflight = self.inflight.lock();
        if inflight.get(hash).is_some_and(|r| r.peer == peer) {
            inflight.remove(hash);
            true
        } else {
            false
        }
    }

    /// Every few seconds: notice peers that sat on our requests, and pick who to ask next.
    /// Headers come from the peer claiming the most work beyond our best header. Bodies come
    /// from a random peer among those that have the branch and have let the fewest requests
    /// run out, so one slow or stalling peer can't hold up the download.
    pub fn sync_tick(&self, now: Instant) -> SyncTick {
        let mut out = SyncTick::default();
        let (best, missing) = {
            let c = self.chain.lock();
            (c.best_header().cum_work, !c.missing_bodies(1).is_empty())
        };
        let mut header_timeouts = Vec::new();
        {
            let mut inflight = self.inflight.lock();
            let mut sync = self.sync.lock();
            let mut late: Vec<u64> = Vec::new();
            for r in inflight.values_mut() {
                if !r.late && now.duration_since(r.at) >= BODY_TIMEOUT {
                    r.late = true;
                    if !late.contains(&r.peer) {
                        late.push(r.peer);
                    }
                }
            }
            inflight.retain(|_, r| now.duration_since(r.at) < BODY_FORGET);
            for p in late {
                if let Some(s) = sync.get_mut(&p) {
                    s.stalls += 1;
                    out.penalties.push((p, 10, "didn't send the bodies we asked for".into()));
                }
            }
            for (id, s) in sync.iter_mut() {
                if let Some(t) = s.headers_asked
                    && now.duration_since(t) >= HEADERS_TIMEOUT
                {
                    s.headers_asked = None;
                    header_timeouts.push(*id);
                    out.penalties.push((*id, 50, "didn't answer a header request".into()));
                }
            }
            out.headers_from = sync
                .iter()
                .filter(|(_, s)| s.claimed_work > best && s.headers_asked.is_none())
                .max_by_key(|(id, s)| (s.claimed_work, std::cmp::Reverse(**id)))
                .map(|(id, _)| *id);
            if missing {
                let have: Vec<(u64, u32)> =
                    sync.iter().filter(|(_, s)| s.claimed_work >= best).map(|(id, s)| (*id, s.stalls)).collect();
                if let Some(least) = have.iter().map(|(_, st)| *st).min() {
                    let fit: Vec<u64> = have.iter().filter(|(_, st)| *st == least).map(|(id, _)| *id).collect();
                    out.bodies_from = Some(fit[rand::random::<u64>() as usize % fit.len()]);
                }
            }
        }
        // A peer that sat on a header request loses what it was feeding us, which frees its
        // slot for someone else.
        let mut c = self.chain.lock();
        for p in header_timeouts {
            c.drop_pending(p);
        }
        out
    }

    /// A peer went away: forget what we were collecting from it and what it was fetching for us.
    pub fn forget_peer(&self, peer: u64) {
        self.chain.lock().drop_pending(peer);
        self.inflight.lock().retain(|_, r| r.peer != peer);
        self.sync.lock().remove(&peer);
    }

    pub async fn submit_block(self: &Arc<Self>, b: Block, from_peer: Option<u64>) -> Result<Outcome, BlockError> {
        // hold blocks dated slightly ahead until their time, so a fast clock can't sneak a
        // block in before the spacing is up
        let ahead = b.header.timestamp.saturating_sub(crate::chain::now());
        if ahead > 1 && ahead <= self.params.future_time_limit {
            tokio::time::sleep(std::time::Duration::from_secs(ahead - 1)).await;
        }
        let node = self.clone();
        let out = tokio::task::spawn_blocking(move || node.submit_block_blocking(b))
            .await
            .map_err(|e| BlockError::Internal(e.to_string()))??;
        if matches!(out, Outcome::NewTip { .. }) {
            if let Some(id) = from_peer
                && let Some(p) = self.peers.lock().get_mut(&id)
            {
                p.last_block = Some(Instant::now());
            }
            let tip = {
                let c = self.chain.lock();
                c.block(&c.tip().hash).map(|b| (*b).clone())
            };
            if let Some(tip) = tip {
                self.broadcast(Message::NewBlock(tip), from_peer);
            }
        }
        Ok(out)
    }

    /// Validate a transaction against current state, add it to the mempool, and relay it.
    pub fn submit_tx(&self, tx: SignedTransaction, from_peer: Option<u64>) -> Result<Hash, String> {
        let h = {
            let c = self.chain.lock();
            let mut mp = self.mempool.lock();
            mp.add(tx.clone(), &c.state, self.params)?
        };
        self.broadcast(Message::NewTx(tx), from_peer);
        Ok(h)
    }

    pub fn broadcast(&self, m: Message, except: Option<u64>) {
        for p in self.peers.lock().values() {
            if Some(p.id) != except && !(p.block_only && not_for_block_only(&m)) {
                let _ = p.sender.try_send(m.clone());
            }
        }
    }

    pub fn send_to(&self, peer: u64, m: Message) {
        if let Some(p) = self.peers.lock().get(&peer)
            && !(p.block_only && not_for_block_only(&m))
        {
            let _ = p.sender.try_send(m);
        }
    }

    /// Penalize a peer; at 100 points it is disconnected (and its IP banned for an hour,
    /// except loopback so local devnets can't ban themselves wholesale).
    pub fn penalize(&self, peer: u64, points: u32, why: &str) -> bool {
        let mut peers = self.peers.lock();
        let Some(p) = peers.get_mut(&peer) else { return true };
        p.misbehavior += points;
        tracing::warn!("peer {} misbehaving (+{points} = {}): {why}", p.addr, p.misbehavior);
        if p.misbehavior >= 100 {
            if !p.addr.ip().is_loopback() {
                self.banned.lock().insert(p.addr.ip(), Instant::now());
            }
            if let Some(p) = peers.remove(&peer) {
                p.closer.notify_one();
            }
            return true;
        }
        false
    }

    pub fn is_banned(&self, ip: &IpAddr) -> bool {
        let mut b = self.banned.lock();
        b.retain(|_, t| t.elapsed().as_secs() < 3600);
        b.contains_key(ip)
    }
}
