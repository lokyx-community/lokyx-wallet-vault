//! Limits on connections that are still shaking hands, and on who can fill the inbound slots.

use lokyx::chain::{Chain, now};
use lokyx::net::{HandshakeGate, MAX_HANDSHAKES_PER_IP, MAX_HANDSHAKES_TOTAL};
use lokyx::node::Node;
use lokyx::params::{ChainParams, DEVNET};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::{TcpSocket, TcpStream};

fn params() -> &'static ChainParams {
    static P: std::sync::OnceLock<ChainParams> = std::sync::OnceLock::new();
    lokyx::pow::test_pow::enable();
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

fn ip(last: u8) -> IpAddr {
    IpAddr::from([10, 0, 0, last])
}

#[test]
fn the_gate_caps_one_address_and_the_total_and_frees_places_when_they_are_given_up() {
    let g = HandshakeGate::default();
    let mut held: Vec<_> = (0..MAX_HANDSHAKES_PER_IP).map(|_| g.enter(ip(1)).expect("room")).collect();
    assert!(g.enter(ip(1)).is_none(), "one address may not hold more than {MAX_HANDSHAKES_PER_IP}");
    assert!(g.enter(ip(2)).is_some(), "another address is not affected");

    // Fill the total from many addresses.
    let mut i = 10u8;
    while g.in_flight() < MAX_HANDSHAKES_TOTAL {
        held.push(g.enter(ip(i)).expect("room"));
        i += 1;
    }
    assert!(g.enter(ip(200)).is_none(), "the total is capped at {MAX_HANDSHAKES_TOTAL}");

    // Giving a place up frees it, for its own address and for the total.
    held.truncate(held.len() - 1);
    assert!(g.enter(ip(200)).is_some());
    held.clear();
    assert_eq!(g.in_flight(), 0, "every place is back");
}

/// Connects from a given local address (127.0.0.x all reach a listener on 127.0.0.1... on Linux).
async fn connect_from(local: [u8; 4], to: SocketAddr) -> TcpStream {
    let s = TcpSocket::new_v4().unwrap();
    s.bind(SocketAddr::new(IpAddr::from(local), 0)).unwrap();
    s.connect(to).await.unwrap()
}

/// True if the node hung up on this connection within a moment.
async fn dropped(c: &mut TcpStream) -> bool {
    let mut b = [0u8; 1];
    matches!(tokio::time::timeout(Duration::from_millis(800), c.read(&mut b)).await, Ok(Ok(0)) | Ok(Err(_)))
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fifth_silent_connection_from_one_address_is_dropped_and_honest_ones_get_in_once_the_others_leave() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let addr = free_addr();
    lokyx::net::start(n.clone(), addr).await.unwrap();

    // Four connections that say nothing keep their places.
    let mut quiet = vec![];
    for _ in 0..MAX_HANDSHAKES_PER_IP {
        quiet.push(connect_from([127, 0, 0, 1], addr).await);
    }
    wait_for("four handshakes under way", || n.gate.in_flight() == MAX_HANDSHAKES_PER_IP).await;
    for c in &mut quiet {
        assert!(!dropped(c).await, "within the limit, a connection may take its time");
    }
    let mut fifth = connect_from([127, 0, 0, 1], addr).await;
    assert!(dropped(&mut fifth).await, "the fifth from the same address must be dropped");

    // Another address isn't affected.
    let mut other = connect_from([127, 0, 0, 2], addr).await;
    assert!(!dropped(&mut other).await);
    drop(other);

    // The quiet ones leave; their places come back.
    drop(quiet);
    wait_for("the places to be freed", || n.gate.in_flight() == 0).await;

    // And an honest node from the same address now connects.
    let b = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![addr]);
    lokyx::net::start(b.clone(), free_addr()).await.unwrap();
    wait_for("an honest peer to connect", || !n.peers.lock().is_empty()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_total_is_capped_across_addresses() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let addr = free_addr();
    lokyx::net::start(n.clone(), addr).await.unwrap();

    // 8 addresses x 4 = 32, all quiet.
    let mut quiet = vec![];
    for host in 1..=8u8 {
        for _ in 0..MAX_HANDSHAKES_PER_IP {
            quiet.push(connect_from([127, 0, 0, host], addr).await);
        }
    }
    wait_for("32 handshakes under way", || n.gate.in_flight() == MAX_HANDSHAKES_TOTAL).await;
    let mut ninth = connect_from([127, 0, 0, 9], addr).await;
    assert!(dropped(&mut ninth).await, "the 33rd must be dropped even though its address is new");
}
