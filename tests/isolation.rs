//! Isolation detection looks for more connections and does nothing else. In particular it never
//! stops a miner.
//!
//! This file doesn't switch on the cheap test proof of work: the miner hashes with RandomX itself,
//! so the chain it mines has to be checked with RandomX too. At difficulty 2 that is a few hashes
//! a block.

use lokyx::address::Address;
use lokyx::chain::{Chain, now};
use lokyx::node::Node;
use lokyx::params::{ChainParams, DEVNET};
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

fn params() -> &'static ChainParams {
    static P: std::sync::OnceLock<ChainParams> = std::sync::OnceLock::new();
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

/// A miner alone on the network, with a tip that is a million seconds old, trips two of the three
/// signs from the first moment. It has to go on mining.
#[tokio::test(flavor = "multi_thread")]
async fn isolation_never_pauses_mining() {
    let p = params();
    let n = Node::new(p, Chain::new(p, None).unwrap(), 0, vec![]);
    n.timing.lock().tick = Duration::from_millis(100);
    lokyx::miner::start(n.clone());
    n.miner.configure(true, Some(1), Some(Address([7; 20]))).unwrap();
    lokyx::net::start(n.clone(), free_addr()).await.unwrap();

    let mut flagged_while_mining = false;
    let started = Instant::now();
    let mut seen_height_while_flagged = 0;
    while n.chain.lock().height() < 4 {
        assert!(started.elapsed() < Duration::from_secs(90), "mining stopped at height {}", n.chain.lock().height());
        let h = *n.health.lock();
        assert!(n.miner.enabled.load(Ordering::Relaxed), "mining was switched off ({h:?})");
        if h.no_peers && h.stale_tip {
            flagged_while_mining = true;
            seen_height_while_flagged = n.chain.lock().height();
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(flagged_while_mining, "the signs were never seen, so this proved nothing");
    assert!(seen_height_while_flagged < 4, "blocks kept coming after the flag was seen");
    assert!(n.miner.enabled.load(Ordering::Relaxed));
    // Even now, with no peer at all.
    assert!(n.health.lock().no_peers);
}
