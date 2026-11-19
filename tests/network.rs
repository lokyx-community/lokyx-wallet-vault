//! The connection manager on real nodes: what peers tell each other about addresses, blocks-only
//! connections, making room when full, what is kept across a restart, and that looking for more
//! connections never stops a miner.

use lokyx::address::Address;
use lokyx::addrman::PeerAddr;
use lokyx::chain::{Chain, now};
use lokyx::net::{Hello, MAX_INBOUND, Message};
use lokyx::node::{Node, PeerInfo, PeerSync};
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::store::Store;
use lokyx::transport::{NodeKey, Secure, connect};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

fn params() -> &'static ChainParams {
    static P: std::sync::OnceLock<ChainParams> = std::sync::OnceLock::new();
    lokyx::pow::test_pow::enable();
    let _ = tracing_subscriber::fmt().with_test_writer().try_init();
    P.get_or_init(|| ChainParams {
        initial_difficulty: 2,
        min_difficulty: 2,
        target_block_time: 10,
        min_block_spacing: 0,
        coinbase_maturity: 0,
        genesis_timestamp: now() - 1_000_000,
        ..DEVNET.clone()
    })
}

fn free_addr() -> SocketAddr {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap()
}

async fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
    for _ in 0..400 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("timed out waiting for {what}");
}

fn fast(n: &Node) {
    n.timing.lock().tick = Duration::from_millis(100);
}

/// A node, already listening, on a fresh address.
async fn spawn_node(seeds: Vec<SocketAddr>) -> (Arc<Node>, SocketAddr) {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, seeds);
    fast(&n);
    let addr = free_addr();
    lokyx::net::start(n.clone(), addr).await.unwrap();
    (n, addr)
}

type Raw = Secure<TcpStream>;

/// A bare client: handshakes with `n` under a key of its own, sends a Hello that claims no listening
/// port, and reads the node's Hello.
async fn raw(n: &Node, addr: SocketAddr) -> Raw {
    let mut s = connect(TcpStream::connect(addr).await.unwrap(), &NodeKey::generate(), &n.net_id(), &[]).await.unwrap();
    let hello = Hello { listen_port: 0, ..n.hello() };
    s.writer.write_frame(&borsh::to_vec(&Message::Hello(hello)).unwrap()).await.unwrap();
    let first = next(&mut s).await;
    assert!(matches!(first, Message::Hello(_)), "expected the node's hello, got {first:?}");
    s
}

async fn next(s: &mut Raw) -> Message {
    let f = tokio::time::timeout(Duration::from_secs(5), s.reader.read_frame()).await.expect("a message").unwrap();
    borsh::from_slice(&f).unwrap()
}

async fn send(s: &mut Raw, m: Message) {
    s.writer.write_frame(&borsh::to_vec(&m).unwrap()).await.unwrap();
}

fn loopback(port: u16) -> SocketAddr {
    SocketAddr::new(IpAddr::from([127, 0, 0, 1]), port)
}

fn misbehavior(n: &Node) -> u32 {
    n.peers.lock().values().map(|p| p.misbehavior).max().unwrap_or(0)
}

fn fake_peer(id: u64, addr: SocketAddr, inbound: bool, block_only: bool) -> (PeerInfo, mpsc::Receiver<Message>) {
    let (tx, rx) = mpsc::channel(16);
    (
        PeerInfo {
            id,
            addr,
            listen_addr: addr,
            inbound,
            sender: tx,
            best_height: 0,
            user_agent: String::new(),
            connected_at: Instant::now(),
            misbehavior: 0,
            key: [id as u8; 32],
            last_seen: Instant::now(),
            block_only,
            extra: false,
            closer: Default::default(),
            ping_sent: None,
            ping_best: None,
            last_block: None,
            asked_peers: None,
            awaiting_peers: false,
            answered_peers: None,
        },
        rx,
    )
}

// ---------- addresses ----------

/// What a node tells another about the addresses it knows includes the key each has.
#[tokio::test(flavor = "multi_thread")]
async fn addresses_come_with_their_keys() {
    let (b, b_addr) = spawn_node(vec![]).await;
    let (c_addr, c_key) = (free_addr(), NodeKey::generate().public);
    b.addrs.lock().add(c_addr, Some(c_key), None, now(), now());

    let (a, _) = spawn_node(vec![b_addr]).await;
    wait_for("a to hear of c from b", || a.addrs.lock().contains(&c_addr)).await;
    assert_eq!(a.addrs.lock().key_of(&c_addr), Some(c_key));
    // It arrived as hearsay: not tried, and attributed to b's group.
    assert!(!a.addrs.lock().is_tried(&c_addr));
    // b itself, which a connected to and shook hands with, is tried and has the key it proved.
    assert!(a.addrs.lock().is_tried(&b_addr));
    assert_eq!(a.addrs.lock().key_of(&b_addr), Some(b.key.public));
}

#[tokio::test(flavor = "multi_thread")]
async fn addresses_nobody_asked_for_change_nothing_and_cost_points() {
    let (n, addr) = spawn_node(vec![]).await;
    let mut c = raw(&n, addr).await;
    assert!(matches!(next(&mut c).await, Message::GetPeers), "the node asks for our addresses first");

    let junk = |i: u16| PeerAddr { addr: loopback(20_000 + i).to_string(), key: None, time: now() };
    // The answer it asked for is taken...
    send(&mut c, Message::Peers(vec![junk(1)])).await;
    wait_for("the answer to be taken", || n.addrs.lock().contains(&loopback(20_001))).await;
    assert_eq!(misbehavior(&n), 0);
    // ...a second list nobody asked for is not.
    send(&mut c, Message::Peers((10..20).map(junk).collect())).await;
    wait_for("the points", || misbehavior(&n) == 10).await;
    assert!(!n.addrs.lock().contains(&loopback(20_010)), "unsolicited addresses must not enter the tables");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_with_too_many_addresses_is_refused_whole() {
    let (n, addr) = spawn_node(vec![]).await;
    let mut c = raw(&n, addr).await;
    assert!(matches!(next(&mut c).await, Message::GetPeers));
    let many: Vec<PeerAddr> =
        (0..251u16).map(|i| PeerAddr { addr: loopback(30_000 + i).to_string(), key: None, time: now() }).collect();
    send(&mut c, Message::Peers(many)).await;
    wait_for("the points", || misbehavior(&n) == 20).await;
    assert_eq!(n.addrs.lock().len(), 0, "none of an oversized list is kept");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_peer_gets_its_addresses_once_and_asking_again_soon_costs_points() {
    let (n, addr) = spawn_node(vec![]).await;
    n.addrs.lock().add(loopback(40_001), None, None, now(), now());
    let mut c = raw(&n, addr).await;
    assert!(matches!(next(&mut c).await, Message::GetPeers));
    send(&mut c, Message::GetPeers).await;
    let Message::Peers(list) = next(&mut c).await else { panic!("expected an answer") };
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].addr, loopback(40_001).to_string());
    send(&mut c, Message::GetPeers).await;
    wait_for("the points for asking again", || misbehavior(&n) == 10).await;
}

// ---------- a wrong key ----------

#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_key_for_an_address_is_dealt_with_by_how_we_came_by_it() {
    let (b, b_addr) = spawn_node(vec![]).await;
    let (a, _) = spawn_node(vec![]).await;
    let wrong = NodeKey::generate().public;

    // We were only told the key: the claim goes, the address stays, and the next try works.
    a.addrs.lock().add(b_addr, Some(wrong), None, now(), now());
    assert!(!lokyx::net::feel(&a, b_addr).await, "the handshake must not complete with the wrong key");
    assert!(a.addrs.lock().contains(&b_addr));
    assert_eq!(a.addrs.lock().key_of(&b_addr), None);
    assert!(b.peers.lock().is_empty());
    assert!(lokyx::net::feel(&a, b_addr).await);
    assert!(a.addrs.lock().is_tried(&b_addr), "a feeler that gets through moves the address to tried");
    assert_eq!(a.addrs.lock().key_of(&b_addr), Some(b.key.public));

    // A key a handshake gave us is different now: the address changed hands. Forgotten.
    a.addrs.lock().good(b_addr, wrong, now());
    assert!(!lokyx::net::feel(&a, b_addr).await);
    assert!(!a.addrs.lock().contains(&b_addr));
}

// ---------- blocks only ----------

#[tokio::test(flavor = "multi_thread")]
async fn two_of_ten_outbound_connections_carry_blocks_only() {
    let mut nodes = vec![];
    for _ in 0..10 {
        nodes.push(spawn_node(vec![]).await);
    }
    let (a, _) = spawn_node(nodes.iter().map(|(_, addr)| *addr).collect()).await;
    wait_for("ten outbound connections", || a.peers.lock().values().filter(|p| !p.inbound).count() == 10).await;
    let (full, only): (Vec<_>, Vec<_>) =
        a.peers.lock().values().filter(|p| !p.inbound).map(|p| (p.key, p.block_only)).partition(|(_, b)| !b);
    assert_eq!((full.len(), only.len()), (8, 2));

    // The other end of a blocks-only connection knows it is one.
    for (key, _) in &only {
        let remote = nodes.iter().find(|(n, _)| n.key.public == *key).unwrap().0.clone();
        wait_for("the far end to learn the connection is blocks-only", || {
            remote.peers.lock().values().any(|p| p.inbound && p.block_only)
        })
        .await;
    }
    // Nobody asked for or gave addresses over those two.
    tokio::time::sleep(Duration::from_millis(500)).await;
    for p in a.peers.lock().values().filter(|p| p.block_only) {
        assert!(p.asked_peers.is_none() && p.answered_peers.is_none(), "peer {} traded addresses", p.id);
    }
    for (n, _) in &nodes {
        for p in n.peers.lock().values().filter(|p| p.block_only) {
            assert!(p.answered_peers.is_none(), "answered a blocks-only peer's request for addresses");
        }
    }
}

#[tokio::test]
async fn transactions_and_addresses_are_never_sent_to_a_blocks_only_peer() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let (only, mut only_rx) = fake_peer(1, loopback(1), false, true);
    let (full, mut full_rx) = fake_peer(2, loopback(2), false, false);
    n.peers.lock().insert(1, only);
    n.peers.lock().insert(2, full);

    let sk = k256::ecdsa::SigningKey::random(&mut rand::rngs::OsRng);
    let tx = lokyx::tx::build_transfer(&sk, p, 0, Address([2; 20]), COIN, None).unwrap();
    for m in [Message::NewTx(tx), Message::GetPeers, Message::Peers(vec![]), Message::Ping(5)] {
        n.broadcast(m.clone(), None);
        n.send_to(1, m);
    }
    // Only the pings got through (once by broadcast, once sent to it directly), and the full peer
    // got all four.
    let mut got = vec![];
    while let Ok(m) = only_rx.try_recv() {
        got.push(m);
    }
    assert!(
        got.len() == 2 && got.iter().all(|m| matches!(m, Message::Ping(5))),
        "a blocks-only peer must receive nothing but pings: {got:?}"
    );
    let mut kinds = vec![];
    while let Ok(m) = full_rx.try_recv() {
        kinds.push(std::mem::discriminant(&m));
    }
    assert_eq!(kinds.len(), 4);
}

#[tokio::test]
async fn the_connection_summary_counts_each_kind_and_only_outbound_groups() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let (full, _r1) = fake_peer(1, loopback(1), false, false);
    let (only, _r2) = fake_peer(2, loopback(2), false, true);
    let (mut extra, _r3) = fake_peer(3, loopback(3), false, false);
    extra.extra = true;
    let (inbound, _r4) = fake_peer(4, loopback(4), true, false);
    for p in [full, only, extra, inbound] {
        n.peers.lock().insert(p.id, p);
    }
    let c = n.connected(true, 7);
    assert_eq!((c.full, c.block_only, c.extra), (1, 1, 1));
    assert_eq!(c.groups.len(), 3, "inbound peers' groups don't count");
    assert_eq!(c.keys.len(), 4, "but their keys do: one node, one connection");
    assert!(c.stale_tip && c.alone_for == 7);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stale_tip_adds_one_extra_outbound_connection_beyond_the_targets_and_marks_it() {
    let mut nodes = vec![];
    for _ in 0..11 {
        nodes.push(spawn_node(vec![]).await);
    }
    // Every chain here is just the genesis block, a million seconds old.
    let (a, _) = spawn_node(nodes.iter().map(|(_, addr)| *addr).collect()).await;
    wait_for("eleven outbound connections", || a.peers.lock().values().filter(|p| !p.inbound).count() == 11).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let peers = a.peers.lock();
    let out: Vec<&PeerInfo> = peers.values().filter(|p| !p.inbound).collect();
    assert_eq!(out.len(), 11, "no more than one beyond the targets");
    assert_eq!(out.iter().filter(|p| p.extra).count(), 1);
    assert_eq!(out.iter().filter(|p| p.block_only).count(), 2);
    assert!(a.health.lock().stale_tip);
}

// ---------- making room ----------

#[tokio::test(flavor = "multi_thread")]
async fn when_the_inbound_places_are_full_the_newest_unprotected_peer_makes_room() {
    let (n, addr) = spawn_node(vec![]).await;
    let mut clients: Vec<Raw> = vec![];
    for i in 0..MAX_INBOUND {
        clients.push(raw(&n, addr).await);
        wait_for("the peer to be registered", || n.peers.lock().len() == i + 1).await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let keys: Vec<[u8; 32]> = clients.iter().map(|c| c.remote).collect();
    let _ = keys;
    let mut newcomer = raw(&n, addr).await;
    wait_for("the newcomer to be registered", || {
        n.peers.lock().len() == MAX_INBOUND
            && n.peers.lock().values().any(|p| p.connected_at.elapsed() < Duration::from_millis(400))
    })
    .await;
    assert_eq!(n.peers.lock().len(), MAX_INBOUND, "one out, one in");

    // Exactly one of the first clients has been hung up on: the newest of them, since the oldest
    // four are protected and nobody else has earned any protection.
    let mut dead = vec![];
    for (i, c) in clients.iter_mut().enumerate() {
        let r = tokio::time::timeout(Duration::from_millis(600), async {
            loop {
                if c.reader.read_frame().await.is_err() {
                    return;
                }
            }
        })
        .await;
        if r.is_ok() {
            dead.push(i);
        }
    }
    assert_eq!(dead, vec![MAX_INBOUND - 1]);
    // And the newcomer is alive.
    send(&mut newcomer, Message::Ping(1)).await;
}

// ---------- extra connections ----------

#[tokio::test]
async fn an_extra_connection_is_kept_only_if_the_peer_has_more_work_than_we_do() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let ours = n.chain.lock().cum_work();
    let add = |id: u64, work: u128, age: u64| {
        let (mut peer, rx) = fake_peer(id, loopback(id as u16), false, false);
        peer.extra = true;
        peer.connected_at = Instant::now() - Duration::from_secs(age);
        n.peers.lock().insert(id, peer);
        n.sync.lock().insert(id, PeerSync { claimed_work: work, ..Default::default() });
        rx
    };
    let _r = (add(1, ours + 1, 10), add(2, ours, 10), add(3, ours, 400));

    // Stale tip, and a short while: the one that's ahead becomes an ordinary connection, the
    // others get their time.
    lokyx::net::manage_extra_peers(&n, true);
    {
        let peers = n.peers.lock();
        assert!(!peers[&1].extra, "ahead of us: it stays, as a normal peer");
        assert!(peers[&2].extra && peers.contains_key(&2), "not ahead, but it has had no time yet");
        assert!(!peers.contains_key(&3), "had its five minutes and had nothing newer");
    }
    // The tip is fresh again: no reason to keep one that isn't ahead.
    lokyx::net::manage_extra_peers(&n, false);
    assert!(!n.peers.lock().contains_key(&2));
    assert!(n.peers.lock().contains_key(&1));
}

// ---------- restarts ----------

#[tokio::test(flavor = "multi_thread")]
async fn the_tables_and_the_blocks_only_peers_come_back_after_a_restart() {
    let p = params();
    let dir = std::env::temp_dir().join(format!("lokyx-net-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("chain.redb");
    let _ = std::fs::remove_file(&db);
    let key = NodeKey::generate();

    let (saved_positions, anchor);
    {
        let n = Node::with_key(p, Chain::new(p, Some(Store::open(&db).unwrap())).unwrap(), 0, vec![], key.clone());
        for i in 0..200u16 {
            let a = SocketAddr::new(IpAddr::from([20 + (i / 100) as u8, (i % 100) as u8 + 1, 1, 1]), 8000);
            n.addrs.lock().add(a, Some([i as u8; 32]), Some(IpAddr::from([9, 9, 9, 9])), now(), now());
        }
        let first = n.addrs.lock().addrs()[0];
        n.addrs.lock().good(first, [1; 32], now());
        anchor = (loopback(7001), Some([5u8; 32]));
        let (mut peer, _rx) = fake_peer(9, anchor.0, false, true);
        peer.key = anchor.1.unwrap();
        n.peers.lock().insert(9, peer);
        n.save_net();
        let t = n.addrs.lock();
        saved_positions = t.addrs().into_iter().map(|a| (a, t.position(&a), t.key_of(&a))).collect::<Vec<_>>();
    }
    {
        let n = Node::with_key(p, Chain::new(p, Some(Store::open(&db).unwrap())).unwrap(), 0, vec![], key.clone());
        assert_eq!(n.addrs.lock().len(), 0);
        n.load_net();
        let t = n.addrs.lock();
        assert_eq!(t.len(), saved_positions.len());
        for (a, pos, k) in &saved_positions {
            assert_eq!(t.position(a), *pos, "{a}");
            assert_eq!(t.key_of(a), *k, "{a}");
        }
        assert_eq!(&*n.anchors.lock(), &[anchor]);
        drop(t);
        // With no blocks-only peer connected, saving again keeps the anchors from before.
        n.save_net();
    }
    {
        let n = Node::with_key(p, Chain::new(p, Some(Store::open(&db).unwrap())).unwrap(), 0, vec![], key);
        n.load_net();
        assert_eq!(&*n.anchors.lock(), &[anchor]);
    }
    let _ = std::fs::remove_dir_all(&dir);
}
