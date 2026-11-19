//! The encrypted transport: handshake, framing, who gets refused, and a real pair of nodes
//! talking over it. Framing attacks on the reader are in src/transport.rs.

use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{Chain, Outcome, now};
use lokyx::net::Message;
use lokyx::node::Node;
use lokyx::params::{ChainParams, DEVNET, PROTOCOL_VERSION};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::transport::{CHUNK, MAX_FRAME, NetId, NodeKey, Secure, accept, connect};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::net::TcpStream;

fn net() -> NetId {
    NetId { chain_id: 77701, genesis: [9; 32] }
}

async fn pair_with(
    kc: &NodeKey,
    ks: &NodeKey,
    nc: NetId,
    ns: NetId,
    expect: &[[u8; 32]],
) -> (anyhow::Result<Secure<DuplexStream>>, anyhow::Result<Secure<DuplexStream>>) {
    let (a, b) = tokio::io::duplex(1 << 16);
    tokio::join!(connect(a, kc, &nc, expect), accept(b, ks, &ns))
}

async fn secure_pair() -> (Secure<DuplexStream>, Secure<DuplexStream>, NodeKey, NodeKey) {
    let (kc, ks) = (NodeKey::generate(), NodeKey::generate());
    let (c, s) = pair_with(&kc, &ks, net(), net(), &[]).await;
    let s = s.unwrap();
    (c.unwrap(), s, kc, ks)
}

// ---------- handshake ----------

#[tokio::test]
async fn both_sides_learn_the_others_key_and_frames_cross_in_both_directions() {
    let (mut c, mut s, kc, ks) = secure_pair().await;
    assert_eq!(c.remote, ks.public);
    assert_eq!(s.remote, kc.public);

    // Around every boundary of the chunking: the 4-byte length header shares the first chunk, so
    // CHUNK - 4 is the biggest frame that fits in one.
    let sizes = [0, 1, CHUNK - 5, CHUNK - 4, CHUNK - 3, CHUNK, CHUNK + 1, 2 * CHUNK, MAX_FRAME];
    for size in sizes {
        let data: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
        let (w, r) = tokio::join!(c.writer.write_frame(&data), s.reader.read_frame());
        w.unwrap();
        assert_eq!(r.unwrap(), data, "client to server, {size} bytes");
        let (w, r) = tokio::join!(s.writer.write_frame(&data), c.reader.read_frame());
        w.unwrap();
        assert_eq!(r.unwrap(), data, "server to client, {size} bytes");
    }
    assert!(c.writer.write_frame(&vec![0u8; MAX_FRAME + 1]).await.is_err());
}

/// The prologue binds a handshake to a network. Two nodes that differ in chain id or in genesis
/// can't finish one, so no message of either is ever read by the other.
#[tokio::test]
async fn nodes_on_different_networks_cannot_complete_a_handshake() {
    let (kc, ks) = (NodeKey::generate(), NodeKey::generate());
    for other in [NetId { chain_id: 77702, ..net() }, NetId { genesis: [8; 32], ..net() }] {
        let (c, s) = pair_with(&kc, &ks, net(), other, &[]).await;
        assert!(c.is_err() || s.is_err(), "{other:?}");
        // and neither yields a secure channel
        assert!(c.is_err() && !s.is_ok(), "{other:?}");
    }
}

#[tokio::test]
async fn a_pinned_key_must_match_and_a_mismatch_reveals_nothing_of_ours() {
    let (kc, ks) = (NodeKey::generate(), NodeKey::generate());
    let wrong = NodeKey::generate().public;

    // Wrong key: the dialer hangs up after the responder's message, before sending its own.
    let (c, s) = pair_with(&kc, &ks, net(), net(), &[wrong]).await;
    let e = c.err().expect("must refuse").to_string();
    assert!(e.contains("not the one expected"), "{e}");
    // The responder never got the third handshake message, which is where the dialer's key is.
    assert!(s.is_err(), "the responder must not complete a handshake");

    // Right key: fine.
    let (c, s) = pair_with(&kc, &ks, net(), net(), &[ks.public]).await;
    assert!(c.is_ok() && s.is_ok());
}

/// While a seed's key is being replaced, its entry names both keys, and either one is accepted.
/// A key that is neither is still refused, before ours is sent.
#[tokio::test]
async fn an_entry_with_two_keys_accepts_either_and_nothing_else() {
    let (kc, old, new, stranger) = (NodeKey::generate(), NodeKey::generate(), NodeKey::generate(), NodeKey::generate());
    let both = [old.public, new.public];
    for server in [&old, &new] {
        let (c, s) = pair_with(&kc, server, net(), net(), &both).await;
        assert!(c.is_ok() && s.is_ok());
    }
    let (c, s) = pair_with(&kc, &stranger, net(), net(), &both).await;
    assert!(c.err().expect("must refuse").to_string().contains("not the one expected"));
    assert!(s.is_err());
}

#[test]
fn seed_entries_name_one_key_or_several_and_malformed_ones_are_refused() {
    use lokyx::net::split_pin;
    let (a, b) = (hex::encode([1u8; 32]), hex::encode([2u8; 32]));
    assert_eq!(split_pin("seed.example:27701").unwrap(), ("seed.example:27701", vec![]));
    assert_eq!(split_pin(&format!("seed.example:27701#{a}")).unwrap(), ("seed.example:27701", vec![[1; 32]]));
    assert_eq!(split_pin(&format!("seed.example:27701#{a},{b}")).unwrap().1, vec![[1; 32], [2; 32]]);
    for bad in [
        "seed.example:27701#".to_string(),
        "seed.example:27701#abcd".to_string(),
        format!("seed.example:27701#{a},"),
        format!("seed.example:27701#{a},zz"),
        format!("seed.example:27701#{a}{b}"),
    ] {
        assert!(split_pin(&bad).is_err(), "{bad}");
    }
}

#[tokio::test]
async fn a_peer_that_hangs_up_during_the_handshake_is_reported() {
    let (a, mut b) = tokio::io::duplex(1 << 16);
    let gone = tokio::spawn(async move {
        let mut len = [0u8; 4];
        b.read_exact(&mut len).await.unwrap();
        drop(b);
    });
    let e = connect(a, &NodeKey::generate(), &net(), &[]).await.err().expect("fails").to_string();
    gone.await.unwrap();
    assert!(e.contains("closed during the handshake"), "{e}");
}

/// Something between two nodes that changes one byte. With `flip` at an offset into the dialer's
/// stream, that byte is XORed; the rest passes through.
async fn tamper(
    flip: usize,
) -> (anyhow::Result<Secure<DuplexStream>>, anyhow::Result<Secure<DuplexStream>>, Option<String>) {
    let (kc, ks) = (NodeKey::generate(), NodeKey::generate());
    let (client, mid_a) = tokio::io::duplex(1 << 16);
    let (mid_b, server) = tokio::io::duplex(1 << 16);
    let (mut a_r, mut a_w) = tokio::io::split(mid_a);
    let (mut b_r, mut b_w) = tokio::io::split(mid_b);
    tokio::spawn(async move {
        let mut seen = 0usize;
        let mut buf = [0u8; 4096];
        while let Ok(n) = a_r.read(&mut buf).await {
            if n == 0 {
                break;
            }
            if (seen..seen + n).contains(&flip) {
                buf[flip - seen] ^= 1;
            }
            seen += n;
            if b_w.write_all(&buf[..n]).await.is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        let _ = tokio::io::copy(&mut b_r, &mut a_w).await;
    });
    let n = net();
    let (c, s) = tokio::join!(connect(client, &kc, &n, &[]), accept(server, &ks, &n));
    // If both got through, try one frame and report how it went.
    let mut note = None;
    let (c, s) = match (c, s) {
        (Ok(mut c), Ok(mut s)) => {
            let data = vec![5u8; 300];
            let (w, r) = tokio::join!(
                c.writer.write_frame(&data),
                tokio::time::timeout(Duration::from_secs(2), s.reader.read_frame())
            );
            w.unwrap();
            note = Some(match r {
                Ok(Ok(f)) if f == data => "delivered".to_string(),
                Ok(Ok(_)) => "delivered, but changed".to_string(),
                Ok(Err(e)) => e.to_string(),
                Err(_) => "timed out".to_string(),
            });
            (Ok(c), Ok(s))
        }
        other => other,
    };
    (c, s, note)
}

#[tokio::test]
async fn one_flipped_byte_anywhere_ends_the_connection() {
    // The dialer's stream: 8 preamble bytes, handshake message 1 (2 + 32), message 3 (2 + 64),
    // then data. Flip one byte in each part.
    let (c, s, _) = tamper(0).await; // the magic: no longer a Noise connection at all
    assert!(!(c.is_ok() && s.is_ok()));
    for at in [20, 60, 108 + 10] {
        let (c, s, note) = tamper(at).await;
        let ok = c.is_ok() && s.is_ok();
        if at < 108 {
            assert!(!ok, "a byte flipped at {at} in the handshake must not give a channel");
        } else {
            assert!(ok, "the handshake is untouched at {at}");
            assert_eq!(note.as_deref(), Some("decryption failed"), "data flipped at {at}");
        }
    }
}

// ---------- the real node ----------

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

fn solve(seed: &[u8; 32], h: &mut BlockHeader) {
    while !meets_difficulty(&PowEngine::global().hash(seed, &h.pow_input()).unwrap(), h.difficulty) {
        h.bump_nonce();
    }
}

fn mine(c: &Chain) -> Block {
    let (mut b, seed) = c.block_template(Address([3; 20]), vec![]).unwrap();
    b.header.timestamp = c.tip().header.timestamp.max(c.params.genesis_timestamp) + c.params.target_block_time;
    solve(&seed, &mut b.header);
    b
}

fn free_addr() -> SocketAddr {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.local_addr().unwrap()
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

#[tokio::test(flavor = "multi_thread")]
async fn two_nodes_connect_encrypted_and_sync() {
    let p = params();
    let mut chain = Chain::new(p, None).unwrap();
    for _ in 0..5 {
        let b = mine(&chain);
        assert!(matches!(chain.process_block(b, false).unwrap(), Outcome::NewTip { .. }));
    }
    let tip = chain.tip().hash;
    let a = Node::new(p, chain, 0, vec![]);
    let a_addr = free_addr();
    lokyx::net::start(a.clone(), a_addr).await.unwrap();

    let b = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![a_addr]);
    lokyx::net::start(b.clone(), free_addr()).await.unwrap();

    wait_for("b to sync", || b.chain.lock().height() == 5).await;
    assert_eq!(b.chain.lock().tip().hash, tip);
    // Each knows the other by the key the handshake proved.
    wait_for("both peer lists", || !a.peers.lock().is_empty() && !b.peers.lock().is_empty()).await;
    assert_eq!(b.peers.lock().values().next().unwrap().key, a.key.public);
    assert_eq!(a.peers.lock().values().next().unwrap().key, b.key.public);
}

/// A node told to expect another key at an address doesn't connect to it. This is the seed
/// pinning that stops a man in the middle where we know who we're calling.
#[tokio::test(flavor = "multi_thread")]
async fn a_node_will_not_stay_connected_to_an_address_that_has_the_wrong_key() {
    let p = params();
    let a = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let a_addr = free_addr();
    lokyx::net::start(a.clone(), a_addr).await.unwrap();

    let b = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    b.add_resolved(vec![(a_addr, vec![NodeKey::generate().public])]);
    lokyx::net::start(b.clone(), free_addr()).await.unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(b.peers.lock().is_empty() && a.peers.lock().is_empty(), "connected despite the wrong key");

    // With the right key it connects.
    let c = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    c.add_resolved(vec![(a_addr, vec![a.key.public])]);
    lokyx::net::start(c.clone(), free_addr()).await.unwrap();
    wait_for("the pinned connection", || !c.peers.lock().is_empty()).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_node_that_dials_itself_hangs_up_and_forgets_the_address() {
    let p = params();
    let me = free_addr();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![me]);
    lokyx::net::start(n.clone(), me).await.unwrap();
    wait_for("the address to be dropped", || n.known_address_count() == 0).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(n.peers.lock().is_empty(), "a node must not be its own peer");
}

/// A node that opens with a Hello in the clear (an older protocol) is hung up on without a word:
/// nothing is sent back, and its Hello is never handled as a message.
#[tokio::test(flavor = "multi_thread")]
async fn a_plaintext_hello_gets_silence_and_no_peer() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    let addr = free_addr();
    lokyx::net::start(n.clone(), addr).await.unwrap();

    let mut old = TcpStream::connect(addr).await.unwrap();
    let body = borsh::to_vec(&Message::Hello(n.hello())).unwrap();
    old.write_all(&(body.len() as u32).to_be_bytes()).await.unwrap();
    old.write_all(&body).await.unwrap();
    let mut rest = vec![];
    let _ = tokio::time::timeout(Duration::from_secs(3), old.read_to_end(&mut rest)).await;
    assert!(rest.is_empty(), "nothing is sent back to a plaintext peer");
    assert!(n.peers.lock().is_empty(), "the plaintext Hello must not make a peer");

    // Right magic, then plaintext where a handshake belongs: a failed handshake, not a hello.
    let mut liar = TcpStream::connect(addr).await.unwrap();
    liar.write_all(b"LYX8").await.unwrap();
    liar.write_all(&PROTOCOL_VERSION.to_be_bytes()).await.unwrap();
    liar.write_all(&(body.len() as u16).to_be_bytes()).await.unwrap();
    liar.write_all(&body).await.unwrap();
    let mut got = vec![];
    let _ = tokio::time::timeout(Duration::from_secs(3), liar.read_to_end(&mut got)).await;
    assert!(n.peers.lock().is_empty());
}

// ---------- the node key ----------

#[test]
fn the_node_key_is_made_once_kept_private_and_replaced_if_damaged() {
    let dir = std::env::temp_dir().join(format!("lokyx-key-{}", rand::random::<u64>()));
    let path = dir.join("node.key");
    let k1 = NodeKey::load_or_create(&path).unwrap();
    let k2 = NodeKey::load_or_create(&path).unwrap();
    assert_eq!(k1.public, k2.public, "the same key after a restart");
    assert_eq!(k1.table_secret, k2.table_secret);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    // Damaged: replaced, and the old file kept.
    std::fs::write(&path, b"not a key").unwrap();
    let k3 = NodeKey::load_or_create(&path).unwrap();
    assert_ne!(k3.public, k1.public);
    assert!(dir.join("node.key.bad").exists());
    assert_eq!(NodeKey::load_or_create(&path).unwrap().public, k3.public);
    // Two different nodes never share one.
    assert_ne!(NodeKey::generate().public, NodeKey::generate().public);
    let _ = std::fs::remove_dir_all(dir);
}
