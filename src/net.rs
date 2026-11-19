//! P2P over TCP, protocol 8. After a Noise handshake (see transport.rs) each frame is a borsh
//! `Message`.
//! Sync is headers-first: headers (located like bitcoin's block locators) are collected and
//! judged per peer, then bodies are fetched along the best header chain. New blocks and txs are
//! gossiped whole.

use crate::addrman::{PeerAddr, group_of_ip};
use crate::block::{Block, BlockHeader};
use crate::chain::{BlockError, MAX_HEADERS_PER_MSG, Outcome};
use crate::crypto::Hash;
use crate::dialplan::{self, Dial, Kind};
use crate::eviction::{self, Candidate};
use crate::node::{Node, PeerInfo};
use crate::params::PROTOCOL_VERSION;
use crate::transport::{self, SecureReader, SecureWriter};
use crate::tx::SignedTransaction;
use anyhow::{Result, anyhow, bail};
use borsh::{BorshDeserialize, BorshSerialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{ReadHalf, WriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;

pub use crate::transport::MAX_FRAME;

type Rd = SecureReader<ReadHalf<TcpStream>>;
type Wr = SecureWriter<WriteHalf<TcpStream>>;
pub const MAX_INBOUND: usize = 32;
/// Connections from one IP address that may be in the middle of their handshake at once.
pub const MAX_HANDSHAKES_PER_IP: usize = 4;
/// Connections, from anywhere, that may be in the middle of their handshake at once.
pub const MAX_HANDSHAKES_TOTAL: usize = 32;
pub const TARGET_OUTBOUND: usize = 8;
/// Most bodies asked for in one message.
const MAX_BODIES_PER_REQ: usize = 64;
const SYNC_BATCH_BYTES: usize = 4 * 1024 * 1024;
const MAX_MSGS_PER_SEC: u32 = 400;
const IDLE_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub struct Hello {
    pub magic: [u8; 4],
    pub protocol_version: u32,
    pub chain_id: u64,
    pub genesis: Hash,
    pub best_height: u64,
    pub best_work: u128,
    pub listen_port: u16,
    pub user_agent: String,
}

#[derive(Clone, Debug, BorshSerialize, BorshDeserialize)]
pub enum Message {
    Hello(Hello),
    /// Main-chain headers after the first locator hash the receiver recognizes.
    GetHeaders {
        locator: Vec<Hash>,
        max: u32,
    },
    Headers(Vec<BlockHeader>),
    /// Bodies for these block hashes (whichever the receiver has).
    GetBodies(Vec<Hash>),
    Bodies(Vec<Block>),
    NewBlock(Block),
    NewTx(SignedTransaction),
    GetPeers,
    /// Addresses, only ever as the answer to our `GetPeers`.
    Peers(Vec<PeerAddr>),
    Ping(u64),
    Pong(u64),
    /// Sent once, right after the Hello, by a node that opened this connection for blocks only.
    /// Neither side then sends transactions or addresses over it.
    BlockRelayOnly,
}

async fn read_msg(r: &mut Rd) -> Result<Message> {
    let buf = r.read_frame().await?;
    borsh::from_slice(&buf).map_err(|e| anyhow!("malformed message: {e}"))
}

async fn write_msg(w: &mut Wr, m: &Message) -> Result<()> {
    w.write_frame(&borsh::to_vec(m)?).await
}

/// Split `host:port#key` into the address and the 32-byte key (64 hex characters) it must have.
pub fn split_pin(entry: &str) -> Result<(&str, Vec<[u8; 32]>)> {
    match entry.split_once('#') {
        None => Ok((entry, vec![])),
        Some((addr, keys)) => {
            let parse = |k: &str| hex::decode(k).ok().and_then(|v| <[u8; 32]>::try_from(v).ok());
            let keys: Option<Vec<[u8; 32]>> = keys.split(',').map(parse).collect();
            match keys {
                Some(k) => Ok((addr, k)),
                None => {
                    bail!("{entry}: the part after # must be one or more 64-character hex keys, separated by commas")
                }
            }
        }
    }
}

/// Resolve `host:port` or `host:port#key` strings (names or IPs). Unresolvable or malformed
/// entries are logged and skipped.
pub async fn resolve(hosts: &[String]) -> Vec<(SocketAddr, Vec<[u8; 32]>)> {
    let mut out = Vec::new();
    for h in hosts {
        let (addr, key) = match split_pin(h) {
            Ok(x) => x,
            Err(e) => {
                tracing::warn!("{e}");
                continue;
            }
        };
        match tokio::net::lookup_host(addr).await {
            Ok(addrs) => out.extend(addrs.map(|a| (a, key.clone()))),
            Err(e) => tracing::warn!("can't resolve peer {addr}: {e}"),
        }
    }
    out
}

/// Counts inbound connections that haven't finished their handshake yet. A handshake costs us a
/// key agreement and holds a socket for up to 10 seconds, so without a cap a few hosts can keep
/// every slot busy doing nothing.
#[derive(Clone, Default)]
pub struct HandshakeGate(Arc<parking_lot::Mutex<GateInner>>);

#[derive(Default)]
struct GateInner {
    per_ip: std::collections::HashMap<std::net::IpAddr, usize>,
    total: usize,
}

/// A place in the gate. Giving it up (dropping it) frees the place.
pub struct HandshakePermit {
    gate: HandshakeGate,
    ip: std::net::IpAddr,
}

impl HandshakeGate {
    /// A place for a handshake from `ip`, or None if that IP or the node as a whole is full.
    pub fn enter(&self, ip: std::net::IpAddr) -> Option<HandshakePermit> {
        let mut g = self.0.lock();
        if g.total >= MAX_HANDSHAKES_TOTAL || g.per_ip.get(&ip).copied().unwrap_or(0) >= MAX_HANDSHAKES_PER_IP {
            return None;
        }
        g.total += 1;
        *g.per_ip.entry(ip).or_insert(0) += 1;
        Some(HandshakePermit { gate: self.clone(), ip })
    }

    pub fn in_flight(&self) -> usize {
        self.0.lock().total
    }
}

impl Drop for HandshakePermit {
    fn drop(&mut self) {
        let mut g = self.gate.0.lock();
        g.total -= 1;
        if let Some(n) = g.per_ip.get_mut(&self.ip) {
            *n -= 1;
            if *n == 0 {
                g.per_ip.remove(&self.ip);
            }
        }
    }
}

/// Peers we answer a request for addresses from at most this often.
const PEERS_ANSWER_EVERY: Duration = Duration::from_secs(600);
/// Addresses in one answer.
const PEERS_MAX: usize = 250;
const PING_EVERY_TICKS: u64 = 6;

/// What a connection was opened for.
pub enum Role {
    /// They called us. The permit holds a place among the handshakes under way until it's over.
    Inbound(HandshakePermit),
    Outbound(Dial),
}

fn unix_now() -> u64 {
    crate::chain::now()
}

/// Accept inbound peers and keep outbound connections topped up.
pub async fn start(node: Arc<Node>, listen: SocketAddr) -> Result<()> {
    let listener = TcpListener::bind(listen).await?;
    tracing::info!("p2p listening on {listen}");

    let n = node.clone();
    tokio::spawn(async move {
        loop {
            let Ok((stream, addr)) = listener.accept().await else { continue };
            if n.is_banned(&addr.ip()) {
                continue;
            }
            // Full: make room by dropping a peer from the biggest group (never one of those that
            // are expensive to fake), or turn this one away if everyone is protected.
            if n.peers.lock().values().filter(|p| p.inbound).count() >= MAX_INBOUND {
                match evict_one(&n) {
                    Some(id) => {
                        tracing::info!("inbound slots full: dropped peer {id} to make room for {addr}");
                        n.disconnect(id);
                    }
                    None => continue,
                }
            }
            let Some(permit) = n.gate.enter(addr.ip()) else {
                tracing::debug!("too many handshakes under way; dropping {addr}");
                continue;
            };
            let n = n.clone();
            tokio::spawn(async move {
                if let Err(e) = run_peer(n, stream, addr, Role::Inbound(permit)).await {
                    tracing::debug!("inbound {addr} closed: {e}");
                }
            });
        }
    });

    // Connection manager: dials, feelers, pings, address saves, isolation checks.
    let n = node.clone();
    tokio::spawn(async move {
        let mut failed: std::collections::HashMap<SocketAddr, Instant> = Default::default();
        let mut tick = 0u64;
        let mut alone_since: Option<Instant> = Some(Instant::now());
        let mut last_health = crate::health::Health::default();
        loop {
            tick += 1;
            let timing = *n.timing.lock();
            let now = unix_now();

            if n.peers.lock().is_empty() {
                alone_since.get_or_insert_with(Instant::now);
            } else {
                alone_since = None;
            }
            let alone_for = alone_since.map(|t| t.elapsed().as_secs()).unwrap_or(0);

            // How we're doing. Only ever a reason to look for more connections.
            let health = n.assess_health(now);
            if health != last_health {
                if health.any() {
                    tracing::warn!(
                        "network health: stale tip {}, few outbound groups {}, no peers {}",
                        health.stale_tip,
                        health.few_groups,
                        health.no_peers
                    );
                } else {
                    tracing::info!("network health is back to normal");
                }
                last_health = health;
            }
            *n.health.lock() = health;
            manage_extra_peers(&n, health.stale_tip);

            failed.retain(|_, t| t.elapsed() < Duration::from_secs(10));
            let have = n.connected(health.stale_tip, alone_for);
            let dials = {
                let addrs = n.addrs.lock();
                let anchors = n.anchors.lock();
                let seeds = n.seeds.lock();
                dialplan::plan(
                    &mut rand::thread_rng(),
                    now,
                    &have,
                    &dialplan::Sources { addrs: &addrs, anchors: &anchors, seeds: &seeds },
                    |a| failed.contains_key(a) || n.is_banned(&a.ip()),
                )
            };
            for d in dials {
                failed.insert(d.addr, Instant::now()); // cleared only by expiry; prevents tight redial loops
                if d.anchor {
                    n.anchors.lock().retain(|(a, _)| *a != d.addr);
                }
                n.addrs.lock().attempt(&d.addr, now);
                let n = n.clone();
                tokio::spawn(async move {
                    let a = d.addr;
                    match timeout(Duration::from_secs(5), TcpStream::connect(a)).await {
                        Ok(Ok(s)) => {
                            if let Err(e) = run_peer(n, s, a, Role::Outbound(d)).await {
                                tracing::debug!("outbound {a} closed: {e}");
                            }
                        }
                        _ => tracing::debug!("could not connect to {a}"),
                    }
                });
            }

            if tick.is_multiple_of(PING_EVERY_TICKS) {
                ping_peers(&n);
            }
            if tick.is_multiple_of(2) {
                sync_nudge(&n);
            }
            ask_for_addresses(&n);
            if tick.is_multiple_of(timing.feeler_ticks.max(1)) {
                let n2 = n.clone();
                tokio::spawn(async move { run_feeler(n2).await });
            }
            if tick.is_multiple_of(timing.save_ticks.max(1)) {
                n.save_net();
            }
            if tick.is_multiple_of(12) && alone_for >= dialplan::SEED_AFTER_SECS {
                // Look the seed hostnames up again (their IPs may have changed).
                let hosts = n.seed_hosts.lock().clone();
                let found = resolve(&hosts).await;
                n.add_resolved(found);
            }
            tokio::time::sleep(timing.tick).await;
        }
    });
    Ok(())
}

/// The inbound peer to drop to make room, if there is one that isn't protected.
fn evict_one(n: &Node) -> Option<u64> {
    let peers = n.peers.lock();
    let cands: Vec<Candidate> = peers
        .values()
        .filter(|p| p.inbound)
        .map(|p| Candidate {
            id: p.id,
            group: group_of_ip(&p.addr.ip()),
            age: p.connected_at.elapsed().as_millis() as u64,
            ping_ms: p.ping_best.map(|d| d.as_millis() as u64),
            block_ago: p.last_block.map(|t| t.elapsed().as_secs()),
        })
        .collect();
    eviction::select_victim(&cands)
}

/// A ping to every peer, remembering the nonce and the time so the answer gives a round trip.
fn ping_peers(n: &Node) {
    for p in n.peers.lock().values_mut() {
        let nonce: u64 = rand::random();
        p.ping_sent = Some((nonce, Instant::now()));
        let _ = p.sender.try_send(Message::Ping(nonce));
    }
}

/// Ask peers for their addresses when we haven't in a while (they answer once per ten minutes).
fn ask_for_addresses(n: &Node) {
    let due: Vec<u64> = n
        .peers
        .lock()
        .values()
        .filter(|p| {
            !p.block_only
                && !p.awaiting_peers
                && p.asked_peers.is_none_or(|t| t.elapsed() > PEERS_ANSWER_EVERY + Duration::from_secs(60))
        })
        .map(|p| p.id)
        .collect();
    for id in due {
        ask_peer(n, id);
    }
}

fn ask_peer(n: &Node, id: u64) {
    if let Some(p) = n.peers.lock().get_mut(&id) {
        p.asked_peers = Some(Instant::now());
        p.awaiting_peers = true;
        let _ = p.sender.try_send(Message::GetPeers);
    }
}

/// Extra outbound connections are for when the tip looks stale. One that isn't ahead of us is let
/// go once it has had its chance (or the tip is fresh again), so the next one goes somewhere new.
/// One that is ahead of us stays and counts like any other.
pub fn manage_extra_peers(n: &Node, stale: bool) {
    let ours = n.chain.lock().cum_work();
    let claimed: std::collections::HashMap<u64, u128> =
        n.sync.lock().iter().map(|(id, s)| (*id, s.claimed_work)).collect();
    let mut drop_ids = vec![];
    {
        let mut peers = n.peers.lock();
        for p in peers.values_mut().filter(|p| p.extra) {
            let theirs = claimed.get(&p.id).copied().unwrap_or(0);
            if theirs > ours {
                p.extra = false;
            } else if !stale || p.connected_at.elapsed() > Duration::from_secs(300) {
                drop_ids.push(p.id);
            }
        }
    }
    for id in drop_ids {
        tracing::info!("dropping extra connection {id}: it had nothing newer");
        n.disconnect(id);
    }
}

/// One short connection to an address from the new table: the handshake proves it answers and who
/// it is, and then we hang up. A success moves the address to tried. If a handshake that earned a
/// tried place found it taken, the occupant is tested first instead.
pub async fn run_feeler(n: Arc<Node>) {
    let now = unix_now();
    let collision = n.addrs.lock().collisions().first().copied();
    let target = match collision {
        Some((newcomer, incumbent)) => Some((incumbent, Some(newcomer))),
        None => {
            let connected = n.connected(false, 0);
            let banned_check = |a: &SocketAddr| n.is_banned(&a.ip());
            n.addrs
                .lock()
                .select_feeler(&mut rand::thread_rng(), now, |a| !connected.addrs.contains(a) && !banned_check(a))
                .map(|a| (a, None))
        }
    };
    let Some((addr, newcomer)) = target else { return };
    let alive = feel(&n, addr).await;
    if let Some(newcomer) = newcomer {
        n.addrs.lock().resolve_collision(&newcomer, &addr, alive);
    }
}

/// Handshake with `addr` and hang up. True if it answered with the key we expected. Updates the
/// tables: a success makes the address tried, a wrong key is dealt with as in `run_peer`.
pub async fn feel(n: &Arc<Node>, addr: SocketAddr) -> bool {
    let now = unix_now();
    let expect: Vec<[u8; 32]> = n.addrs.lock().key_of(&addr).into_iter().collect();
    n.addrs.lock().attempt(&addr, now);
    let Ok(Ok(stream)) = timeout(Duration::from_secs(5), TcpStream::connect(addr)).await else { return false };
    match transport::connect(stream, &n.key, &n.net_id(), &expect).await {
        Ok(s) => {
            n.addrs.lock().good(addr, s.remote, now);
            true
        }
        Err(e) => {
            if e.downcast_ref::<transport::KeyMismatch>().is_some() {
                n.addrs.lock().key_mismatch(&addr);
            }
            false
        }
    }
}

async fn run_peer(node: Arc<Node>, stream: TcpStream, addr: SocketAddr, role: Role) -> Result<()> {
    stream.set_nodelay(true)?;
    let net = node.net_id();
    let (permit, dial) = match role {
        Role::Inbound(p) => (Some(p), None),
        Role::Outbound(d) => (None, Some(d)),
    };
    let inbound = permit.is_some();
    let secure = match &dial {
        None => transport::accept(stream, &node.key, &net).await?,
        Some(d) => match transport::connect(stream, &node.key, &net, &d.keys).await {
            Ok(s) => s,
            Err(e) => {
                if e.downcast_ref::<transport::KeyMismatch>().is_some() {
                    let pinned = node.seeds.lock().iter().any(|(a, k)| *a == addr && !k.is_empty());
                    if pinned {
                        tracing::warn!("{addr} showed a different key than the one pinned for it; not connecting");
                    }
                    node.addrs.lock().key_mismatch(&addr);
                }
                return Err(e);
            }
        },
    };
    let remote = secure.remote;
    let (mut rd, mut wr) = (secure.reader, secure.writer);
    if remote == node.key.public {
        node.forget_address(&addr);
        bail!("connected to self");
    }
    write_msg(&mut wr, &Message::Hello(node.hello())).await?;
    let hello = match timeout(Duration::from_secs(10), read_msg(&mut rd)).await?? {
        Message::Hello(h) => h,
        _ => bail!("expected hello"),
    };
    let ours = node.hello();
    if hello.magic != ours.magic || hello.chain_id != ours.chain_id || hello.genesis != ours.genesis {
        bail!("peer is on a different network");
    }
    if hello.protocol_version != PROTOCOL_VERSION {
        tracing::warn!(
            "{addr} runs protocol {} and this node runs {PROTOCOL_VERSION}, so they can't connect",
            hello.protocol_version
        );
        bail!("unsupported protocol version {}", hello.protocol_version);
    }
    let listen_addr = if inbound { SocketAddr::new(addr.ip(), hello.listen_port) } else { addr };
    let block_only = dial.as_ref().is_some_and(|d| d.kind == Kind::BlockOnly);
    let extra = dial.as_ref().is_some_and(|d| d.kind == Kind::Extra) && hello.best_work <= ours.best_work;
    let (tx, mut rx) = mpsc::channel::<Message>(1024);
    let id = node.next_peer_id();
    let closer = Arc::new(tokio::sync::Notify::new());
    {
        let mut peers = node.peers.lock();
        if peers.values().any(|p| p.key == remote) {
            bail!("duplicate connection");
        }
        peers.insert(
            id,
            PeerInfo {
                id,
                addr,
                listen_addr,
                inbound,
                sender: tx.clone(),
                best_height: hello.best_height,
                user_agent: hello.user_agent.chars().take(64).collect(),
                connected_at: Instant::now(),
                misbehavior: 0,
                key: remote,
                last_seen: Instant::now(),
                block_only,
                extra,
                closer: closer.clone(),
                ping_sent: None,
                ping_best: None,
                last_block: None,
                asked_peers: None,
                awaiting_peers: false,
                answered_peers: None,
            },
        );
    }
    drop(permit); // the handshake is over; the connection counts as a peer from here
    {
        let now = unix_now();
        let mut k = node.addrs.lock();
        if inbound {
            // They called us: where they say they listen is worth remembering, not yet trusted.
            k.add(listen_addr, Some(remote), Some(addr.ip()), now, now);
        } else {
            // We called them and the handshake showed their key.
            k.good(addr, remote, now);
        }
    }
    tracing::info!(
        "peer connected {addr} ({}{}, height {})",
        if inbound { "inbound" } else { "outbound" },
        if block_only { ", blocks only" } else { "" },
        hello.best_height
    );

    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if write_msg(&mut wr, &m).await.is_err() {
                break;
            }
        }
    });

    if block_only {
        let _ = tx.send(Message::BlockRelayOnly).await;
    } else {
        ask_peer(&node, id);
    }
    node.add_sync_peer(id, hello.best_work);
    if hello.best_work > node.chain.lock().best_header().cum_work {
        request_headers(&node, id);
    }

    let result = read_loop(&node, id, &mut rd, closer).await;
    node.peers.lock().remove(&id);
    node.forget_peer(id);
    writer.abort();
    tracing::info!("peer disconnected {addr}");
    result
}

/// Ask `peer` for headers, unless a request to it is already waiting for an answer.
fn request_headers(node: &Node, peer: u64) {
    if let Some(locator) = node.want_headers(peer) {
        node.send_to(peer, Message::GetHeaders { locator, max: MAX_HEADERS_PER_MSG as u32 });
    }
}

fn request_bodies(node: &Node, peer: u64) {
    let want = node.take_body_requests(peer, MAX_BODIES_PER_REQ);
    if !want.is_empty() {
        node.send_to(peer, Message::GetBodies(want));
    }
}

/// Every ten seconds: penalise peers that sat on our requests, and ask the best candidates for
/// headers and bodies. Covers peers that went quiet mid-sync.
fn sync_nudge(node: &Arc<Node>) {
    let tick = node.sync_tick(Instant::now());
    for (peer, points, why) in &tick.penalties {
        node.penalize(*peer, *points, why);
    }
    if let Some(p) = tick.bodies_from {
        request_bodies(node, p);
    }
    if let Some(p) = tick.headers_from {
        request_headers(node, p);
    }
}

async fn read_loop(node: &Arc<Node>, id: u64, rd: &mut Rd, closer: Arc<tokio::sync::Notify>) -> Result<()> {
    let mut window = Instant::now();
    let mut count = 0u32;
    loop {
        let msg = tokio::select! {
            m = timeout(IDLE_TIMEOUT, read_msg(rd)) => m.map_err(|_| anyhow!("idle timeout"))??,
            _ = closer.notified() => bail!("disconnected"),
        };
        if window.elapsed() >= Duration::from_secs(1) {
            window = Instant::now();
            count = 0;
        }
        count += 1;
        if count > MAX_MSGS_PER_SEC {
            node.penalize(id, 100, "message flood");
            bail!("rate limit exceeded");
        }
        if let Some(p) = node.peers.lock().get_mut(&id) {
            p.last_seen = Instant::now();
        } else {
            bail!("peer removed");
        }
        handle(node, id, msg).await;
    }
}

async fn handle(node: &Arc<Node>, id: u64, msg: Message) {
    match msg {
        Message::Hello(_) => {
            node.penalize(id, 50, "duplicate hello");
        }
        Message::Ping(n) => node.send_to(id, Message::Pong(n)),
        Message::Pong(n) => {
            if let Some(p) = node.peers.lock().get_mut(&id)
                && let Some((nonce, at)) = p.ping_sent
                && nonce == n
            {
                let rtt = at.elapsed();
                p.ping_best = Some(p.ping_best.map_or(rtt, |b| b.min(rtt)));
                p.ping_sent = None;
            }
        }
        Message::BlockRelayOnly => {
            if let Some(p) = node.peers.lock().get_mut(&id) {
                p.block_only = true;
                p.awaiting_peers = false;
            }
        }
        Message::GetPeers => {
            let list = {
                let mut peers = node.peers.lock();
                let Some(p) = peers.get_mut(&id) else { return };
                if p.block_only {
                    return; // it said it wants blocks only; and we say nothing about whom we know
                }
                if p.answered_peers.is_some_and(|t| t.elapsed() < PEERS_ANSWER_EVERY) {
                    drop(peers);
                    node.penalize(id, 10, "asked for addresses again too soon");
                    return;
                }
                p.answered_peers = Some(Instant::now());
                node.addrs.lock().sample(&mut rand::thread_rng(), PEERS_MAX, unix_now())
            };
            node.send_to(id, Message::Peers(list));
        }
        Message::Peers(list) => {
            // Addresses are only taken as the answer to a request of ours. Anything else is
            // someone choosing what we learn.
            let asked = node.peers.lock().get_mut(&id).map(|p| std::mem::take(&mut p.awaiting_peers)).unwrap_or(false);
            if !asked {
                node.penalize(id, 10, "addresses we didn't ask for");
                return;
            }
            if list.len() > PEERS_MAX {
                node.penalize(id, 20, "oversized peer list");
                return;
            }
            let (source, now) = (node.peers.lock().get(&id).map(|p| p.addr.ip()), unix_now());
            let mut k = node.addrs.lock();
            for pa in list {
                if let Ok(a) = pa.addr.parse::<SocketAddr>() {
                    k.add(a, pa.key, source, pa.time, now);
                }
            }
        }
        Message::GetHeaders { locator, max } => {
            if locator.len() > 128 {
                node.penalize(id, 20, "oversized locator");
                return;
            }
            let headers = node.chain.lock().headers_after_locator(&locator, (max as usize).min(MAX_HEADERS_PER_MSG));
            node.send_to(id, Message::Headers(headers));
        }
        Message::Headers(headers) => {
            if headers.len() > MAX_HEADERS_PER_MSG {
                node.penalize(id, 100, "too many headers in one message");
                return;
            }
            let n = node.clone();
            let next = tokio::task::spawn_blocking(move || n.on_headers_blocking(id, headers)).await;
            let Ok(next) = next else { return };
            if let Some((points, why)) = next.penalty {
                node.penalize(id, points, &why);
                return;
            }
            if next.more_headers {
                request_headers(node, id);
            }
            if next.bodies {
                request_bodies(node, id);
            }
        }
        Message::GetBodies(hashes) => {
            if hashes.len() > 4 * MAX_BODIES_PER_REQ {
                node.penalize(id, 20, "asked for too many bodies at once");
                return;
            }
            let bodies = node.chain.lock().bodies_for(&hashes, SYNC_BATCH_BYTES);
            node.send_to(id, Message::Bodies(bodies));
        }
        Message::Bodies(blocks) => {
            if blocks.len() > 4 * MAX_BODIES_PER_REQ {
                node.penalize(id, 100, "too many bodies in one message");
                return;
            }
            let mut progressed = false;
            for b in blocks {
                let (h, hash) = (b.header.height, b.hash());
                if !node.body_arrived(id, &hash) {
                    continue; // not asked for, or already asked of someone else
                }
                match node.submit_block(b, Some(id)).await {
                    Ok(Outcome::NewTip { .. } | Outcome::SideChain) => {
                        progressed = true;
                        node.peer_has_block(id, &hash);
                    }
                    Ok(Outcome::NeedHeaders) => request_headers(node, id),
                    Ok(_) => {}
                    Err(BlockError::TooEarly(e)) => {
                        tracing::debug!("ignoring block {h} for now: {e}");
                        break;
                    }
                    Err(e) => {
                        if let Some((points, what)) = crate::node::block_penalty(&e) {
                            node.penalize(id, points, &format!("{what} at height {h}: {e}"));
                        } else {
                            tracing::debug!("block {h} from peer {id}: {e}");
                        }
                        return;
                    }
                }
            }
            if progressed {
                request_bodies(node, id);
            }
        }
        Message::NewBlock(b) => {
            let (h, hash) = (b.header.height, b.hash());
            // Handled in its own task: a block dated slightly ahead waits for its time to come,
            // and that shouldn't hold up the rest of this peer's messages.
            let node = node.clone();
            tokio::spawn(async move {
                match node.submit_block(b, Some(id)).await {
                    Ok(Outcome::NeedHeaders) => request_headers(&node, id),
                    Ok(Outcome::NewTip { .. } | Outcome::SideChain | Outcome::AlreadyKnown) => {
                        node.peer_has_block(id, &hash)
                    }
                    Ok(_) => {}
                    Err(BlockError::TooEarly(e)) => tracing::debug!("ignoring block {h} for now: {e}"),
                    Err(e) => match crate::node::block_penalty(&e) {
                        Some((points, what)) => {
                            node.penalize(id, points, &format!("{what}: {e}"));
                        }
                        None => tracing::debug!("announced block {h} from peer {id}: {e}"),
                    },
                }
            });
        }
        Message::NewTx(tx) => {
            if node.peers.lock().get(&id).is_some_and(|p| p.block_only) {
                node.penalize(id, 10, "a transaction on a blocks-only connection");
                return;
            }
            if node.mempool.lock().contains(&tx.hash()) {
                return;
            }
            if let Err(e) = node.submit_tx(tx, Some(id)) {
                // Signature/format errors are provably bad; state-dependent errors (nonce races,
                // reorgs) can happen to honest peers, so they cost nothing.
                if e.contains("signature") || e.contains("chain id") || e.contains("too large") {
                    node.penalize(id, 20, &e);
                }
            }
        }
    }
}
