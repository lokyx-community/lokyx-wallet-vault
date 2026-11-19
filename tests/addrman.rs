//! The address tables, on a fixed secret and a seeded generator so every number is exact.

use lokyx::addrman::{AddrMan, Group, NEW_BUCKETS_PER_SOURCE, TRIED_BUCKETS_PER_GROUP, group};
use rand::SeedableRng;
use rand::rngs::StdRng;
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};

const SECRET: [u8; 32] = [7; 32];
const NOW: u64 = 1_800_000_000;

fn a(s: &str) -> SocketAddr {
    s.parse().unwrap()
}

fn ip(s: &str) -> IpAddr {
    s.parse().unwrap()
}

fn rng() -> StdRng {
    StdRng::seed_from_u64(42)
}

/// Where a fresh table would put this address.
fn probe_new(addr: SocketAddr, source: IpAddr) -> (usize, usize) {
    let mut m = AddrMan::new(SECRET);
    assert!(m.add(addr, None, Some(source), NOW, NOW));
    let (tried, b, s) = m.position(&addr).unwrap();
    assert!(!tried);
    (b, s)
}

/// Addresses spread over many /16s, so only the *source* can limit the buckets they reach.
fn spread(n: u32) -> impl Iterator<Item = SocketAddr> {
    (0..n).map(|i| {
        SocketAddr::new(
            IpAddr::from([20 + (i / 250 % 200) as u8, (i % 250) as u8 + 1, (i / 7 % 250) as u8, 9]),
            8000 + (i % 40) as u16,
        )
    })
}

// ---------- groups ----------

#[test]
fn groups_are_slash_16_for_v4_and_slash_32_for_v6_and_loopback_nodes_are_each_their_own() {
    assert_eq!(group(&a("81.2.3.4:1")), group(&a("81.2.200.9:5000")));
    assert_ne!(group(&a("81.2.3.4:1")), group(&a("81.3.3.4:1")));
    assert_eq!(group(&a("[2001:db8:1::1]:1")), group(&a("[2001:db8:ffff::9]:2")));
    assert_ne!(group(&a("[2001:db8::1]:1")), group(&a("[2001:db9::1]:1")));
    // An IPv4 address written as IPv6 is the same group as the plain one.
    assert_eq!(group(&a("[::ffff:81.2.3.4]:1")), group(&a("81.2.9.9:1")));
    assert_ne!(group(&a("127.0.0.1:8000")), group(&a("127.0.0.1:8001")));
}

// ---------- the new table ----------

#[test]
fn one_source_flooding_the_table_reaches_at_most_64_of_256_buckets() {
    let mut m = AddrMan::new(SECRET);
    let source = ip("66.6.6.6");
    for addr in spread(10_000) {
        m.add(addr, None, Some(source), NOW, NOW);
    }
    let buckets: HashSet<usize> = m.addrs().iter().map(|x| m.position(x).unwrap().1).collect();
    assert!(m.len_new() > 1000, "the flood should have landed somewhere ({})", m.len_new());
    assert!(
        buckets.len() as u64 <= NEW_BUCKETS_PER_SOURCE,
        "one source group reached {} buckets, the limit is {NEW_BUCKETS_PER_SOURCE}",
        buckets.len()
    );
    // ...and every other source group has its own pick of them, so honest addresses told by
    // others still have room.
    let mut honest = 0;
    for (i, addr) in (0..200u32).map(|i| SocketAddr::new(IpAddr::from([150, (i % 200) as u8, 3, 3]), 9000)).enumerate()
    {
        let src = IpAddr::from([100 + i as u8 % 100, 1, 1, 1]);
        if m.add(addr, None, Some(src), NOW, NOW) {
            honest += 1;
        }
    }
    assert!(honest > 150, "{honest} of 200 honest addresses fit");
}

#[test]
fn a_full_slot_keeps_what_it_has_unless_that_is_stale_or_keeps_failing() {
    let source = ip("66.6.6.6");
    // Two addresses that want the same slot.
    let first = a("30.1.1.1:8000");
    let pos = probe_new(first, source);
    let second = spread(5000).find(|x| *x != first && probe_new(*x, source) == pos).expect("a collision exists");

    // A healthy incumbent stays.
    let mut m = AddrMan::new(SECRET);
    assert!(m.add(first, None, Some(source), NOW, NOW));
    assert!(!m.add(second, None, Some(source), NOW, NOW));
    assert!(m.contains(&first) && !m.contains(&second));

    // One that failed three times without ever answering goes.
    for _ in 0..3 {
        m.attempt(&first, NOW - 3600);
    }
    assert!(m.add(second, None, Some(source), NOW, NOW));
    assert!(m.contains(&second) && !m.contains(&first));

    // One nobody has mentioned for a month goes too.
    let mut m = AddrMan::new(SECRET);
    m.add(first, None, Some(source), NOW - 29 * 86400, NOW - 29 * 86400);
    assert!(!m.add(second, None, Some(source), NOW, NOW), "29 days is not yet stale");
    let mut m = AddrMan::new(SECRET);
    m.add(first, None, Some(source), NOW - 29 * 86400, NOW - 29 * 86400);
    assert!(m.add(second, None, Some(source), NOW + 2 * 86400, NOW + 2 * 86400));
}

#[test]
fn addresses_that_cannot_be_dialled_are_not_kept() {
    let mut m = AddrMan::new(SECRET);
    assert!(!m.add(a("8.8.8.8:0"), None, None, NOW, NOW));
    assert!(!m.add(a("0.0.0.0:8000"), None, None, NOW, NOW));
    assert!(!m.add(a("224.0.0.1:8000"), None, None, NOW, NOW));
    assert!(!m.add(a("8.8.8.8:8000"), None, None, NOW - 31 * 86400, NOW), "already stale when heard");
    assert!(m.is_empty());
}

// ---------- the tried table ----------

#[test]
fn nothing_reaches_tried_without_a_handshake() {
    let mut m = AddrMan::new(SECRET);
    for addr in spread(5000) {
        m.add(addr, Some([1; 32]), Some(ip("66.6.6.6")), NOW, NOW);
    }
    assert!(m.len_new() > 0);
    assert_eq!(m.len_tried(), 0, "gossip alone can't make an address tried");
    for addr in m.addrs() {
        assert!(!m.is_tried(&addr));
    }
    // Hearing of the same address again and again doesn't either.
    for addr in spread(100) {
        m.add(addr, None, Some(ip("1.2.3.4")), NOW + 1, NOW + 1);
    }
    assert_eq!(m.len_tried(), 0);

    // A handshake does.
    let one = m.addrs()[0];
    assert!(m.good(one, [5; 32], NOW));
    assert!(m.is_tried(&one));
    assert_eq!(m.len_tried(), 1);
    assert_eq!(m.key_of(&one), Some([5; 32]));
}

#[test]
fn one_group_reaches_at_most_8_tried_buckets() {
    let mut m = AddrMan::new(SECRET);
    for i in 0..3000u32 {
        let addr = SocketAddr::new(IpAddr::from([44, 9, (i / 250) as u8, (i % 250) as u8 + 1]), 8000);
        m.good(addr, [1; 32], NOW);
    }
    let buckets: HashSet<usize> =
        m.addrs().iter().filter(|x| m.is_tried(x)).map(|x| m.position(x).unwrap().1).collect();
    assert!(!buckets.is_empty());
    assert!(buckets.len() as u64 <= TRIED_BUCKETS_PER_GROUP, "{} buckets", buckets.len());
}

/// Two addresses that want the same slot in the tried table.
fn tried_pair() -> (SocketAddr, SocketAddr) {
    let probe = |x: SocketAddr| {
        let mut m = AddrMan::new(SECRET);
        assert!(m.good(x, [1; 32], NOW));
        m.position(&x).unwrap()
    };
    let first = a("45.1.1.1:8000");
    let pos = probe(first);
    let second = (1..5000u32)
        .map(|i| SocketAddr::new(IpAddr::from([45, 1, (i / 250) as u8, (i % 250) as u8 + 1]), 8000))
        .find(|x| *x != first && probe(*x) == pos)
        .expect("a collision exists");
    (first, second)
}

#[test]
fn a_collision_in_tried_is_settled_by_testing_the_incumbent() {
    let (first, second) = tried_pair();

    // The incumbent answers: it keeps its place, the newcomer stays in new.
    let mut m = AddrMan::new(SECRET);
    assert!(m.good(first, [1; 32], NOW));
    m.add(second, None, Some(ip("66.6.6.6")), NOW, NOW);
    assert!(!m.good(second, [2; 32], NOW));
    assert_eq!(m.collisions(), &[(second, first)]);
    m.resolve_collision(&second, &first, true);
    assert!(m.is_tried(&first) && !m.is_tried(&second) && m.contains(&second));
    assert!(m.collisions().is_empty());

    // The incumbent is gone: the newcomer takes the slot.
    let mut m = AddrMan::new(SECRET);
    m.good(first, [1; 32], NOW);
    m.good(second, [2; 32], NOW);
    m.resolve_collision(&second, &first, false);
    assert!(m.is_tried(&second) && !m.contains(&first));
    assert_eq!(m.len_tried(), 1);
}

// ---------- keys ----------

#[test]
fn a_told_key_can_be_dropped_but_a_proven_one_is_not_replaced_by_gossip() {
    let mut m = AddrMan::new(SECRET);
    let x = a("50.1.1.1:8000");
    m.add(x, Some([1; 32]), Some(ip("66.6.6.6")), NOW, NOW);
    // Another peer claims a different key: the first claim stands.
    m.add(x, Some([2; 32]), Some(ip("77.7.7.7")), NOW + 1, NOW + 1);
    assert_eq!(m.key_of(&x), Some([1; 32]));

    // A mismatch against a key we were only told: the claim goes, the address stays.
    m.key_mismatch(&x);
    assert!(m.contains(&x));
    assert_eq!(m.key_of(&x), None);

    // After a handshake the key is proven. Gossip can't change it.
    m.good(x, [9; 32], NOW + 2);
    m.add(x, Some([3; 32]), Some(ip("88.8.8.8")), NOW + 3, NOW + 3);
    assert_eq!(m.key_of(&x), Some([9; 32]));

    // A mismatch against a proven key: the address changed hands, so it is forgotten.
    m.key_mismatch(&x);
    assert!(!m.contains(&x));
}

// ---------- choosing outbound peers ----------

#[test]
fn with_90_percent_of_the_table_in_one_range_eight_picks_include_at_most_one_from_it() {
    let mut m = AddrMan::new(SECRET);
    let source = ip("66.6.6.6");
    // 9000 addresses in 77.88.0.0/16, told by many different sources so they all fit.
    let mut crowd = 0;
    for i in 0..30_000u32 {
        let addr =
            SocketAddr::new(IpAddr::from([77, 88, (i / 250 % 250) as u8, (i % 250) as u8 + 1]), 8000 + (i % 7) as u16);
        let src = IpAddr::from([(i % 200) as u8 + 20, (i / 200 % 250) as u8, 1, 1]);
        if m.add(addr, None, Some(src), NOW, NOW) {
            crowd += 1;
        }
    }
    // ...and 10% of that elsewhere, each in its own /16.
    let mut others = 0;
    for i in 0..1500u32 {
        let addr = SocketAddr::new(IpAddr::from([100 + (i / 250) as u8, (i % 250) as u8 + 1, 5, 5]), 8000);
        if m.add(addr, None, Some(source), NOW, NOW) {
            others += 1;
        }
    }
    assert!(crowd > 8 * others / 2, "the range should dominate: {crowd} against {others}");

    let crowded: Group = group(&a("77.88.1.1:1"));
    let mut r = rng();
    for round in 0..50 {
        let mut used: HashSet<Group> = HashSet::new();
        let mut chosen = vec![];
        while chosen.len() < 8 {
            let Some(x) = m.select_outbound(&mut r, NOW, &used, |x| chosen.contains(x)) else {
                panic!("round {round}: found only {} suitable addresses", chosen.len());
            };
            used.insert(group(&x));
            chosen.push(x);
        }
        let from_crowd = chosen.iter().filter(|x| group(x) == crowded).count();
        assert!(from_crowd <= 1, "round {round}: {from_crowd} of 8 from one range: {chosen:?}");
        let groups: HashSet<Group> = chosen.iter().map(group).collect();
        assert_eq!(groups.len(), 8);
    }
}

#[test]
fn selection_draws_from_both_tables_and_skips_recently_dialled_and_unsuitable_addresses() {
    let mut m = AddrMan::new(SECRET);
    let (n, t) = (a("60.1.1.1:8000"), a("61.1.1.1:8000"));
    m.add(n, None, None, NOW, NOW);
    m.good(t, [1; 32], NOW - 1000);
    let mut r = rng();
    let mut seen = HashSet::new();
    for _ in 0..200 {
        seen.insert(m.select(&mut r, NOW, |_| true).unwrap());
    }
    assert_eq!(seen.len(), 2, "both tables are used");

    // Just dialled: left alone for a minute.
    m.attempt(&n, NOW);
    for _ in 0..100 {
        assert_eq!(m.select(&mut r, NOW + 10, |_| true), Some(t));
    }
    // ...and after it, available again.
    assert!((0..100).any(|_| m.select(&mut r, NOW + 61, |_| true) == Some(n)));
    // `ok` rules addresses out.
    assert_eq!(m.select(&mut r, NOW + 100, |x| *x != t), Some(n));
    assert_eq!(m.select(&mut r, NOW + 100, |_| false), None);

    // Feelers only look at addresses we haven't connected to.
    for _ in 0..50 {
        assert_eq!(m.select_feeler(&mut r, NOW + 100, |_| true), Some(n));
    }
}

// ---------- telling others ----------

#[test]
fn the_sample_has_no_more_than_asked_and_leaves_out_what_is_stale_or_never_answers() {
    let mut m = AddrMan::new(SECRET);
    for addr in spread(600) {
        m.add(addr, Some([4; 32]), Some(ip("66.6.6.6")), NOW, NOW);
    }
    let mut r = rng();
    let s = m.sample(&mut r, 250, NOW);
    assert_eq!(s.len(), 250);
    let unique: HashSet<&str> = s.iter().map(|p| p.addr.as_str()).collect();
    assert_eq!(unique.len(), 250);
    assert!(s.iter().all(|p| p.key == Some([4; 32]) && p.time == NOW));

    let bad = m.addrs()[0];
    for _ in 0..3 {
        m.attempt(&bad, NOW - 600);
    }
    let all = m.sample(&mut r, 100_000, NOW);
    assert_eq!(all.len(), m.len() - 1);
    assert!(!all.iter().any(|p| p.addr == bad.to_string()), "an address that never answers isn't passed on");
    assert!(m.sample(&mut r, 100_000, NOW + 31 * 86400).is_empty(), "nor is anything stale");
}

// ---------- saving ----------

#[test]
fn a_saved_table_comes_back_the_same() {
    let mut m = AddrMan::new(SECRET);
    for addr in spread(2000) {
        m.add(addr, Some([4; 32]), Some(ip("66.6.6.6")), NOW, NOW);
    }
    for (i, x) in m.addrs().into_iter().take(40).enumerate() {
        m.good(x, [i as u8; 32], NOW);
    }
    m.attempt(&m.addrs()[100], NOW);

    let back = AddrMan::from_bytes(SECRET, &m.to_bytes(), NOW + 5).unwrap();
    assert_eq!((back.len(), back.len_new(), back.len_tried()), (m.len(), m.len_new(), m.len_tried()));
    for x in m.addrs() {
        assert_eq!(back.position(&x), m.position(&x), "{x}");
        assert_eq!(back.key_of(&x), m.key_of(&x), "{x}");
    }
    assert_eq!(back.to_bytes(), m.to_bytes());

    // Under another secret everything still loads, but not in the same places.
    let other = AddrMan::from_bytes([8; 32], &m.to_bytes(), NOW).unwrap();
    assert!(other.len() > m.len() / 2, "{} of {}", other.len(), m.len());
    let moved = m.addrs().iter().filter(|x| other.position(x).is_some_and(|p| p != m.position(x).unwrap())).count();
    assert!(moved > m.len() / 2, "the secret decides where addresses go ({moved} moved)");

    assert!(AddrMan::from_bytes(SECRET, &[1, 2, 3], NOW).is_none());
}

#[test]
fn the_secret_decides_which_addresses_collide() {
    // An attacker who doesn't know it can't pick addresses that land in a chosen slot: the same
    // addresses fall differently under two secrets.
    let source = ip("66.6.6.6");
    let xs: Vec<_> = spread(50).collect();
    let pos = |secret| {
        let mut m = AddrMan::new(secret);
        xs.iter()
            .map(|x| {
                m.add(*x, None, Some(source), NOW, NOW);
                m.position(x)
            })
            .collect::<Vec<_>>()
    };
    assert_ne!(pos([1; 32]), pos([2; 32]));
    assert_eq!(pos([1; 32]), pos([1; 32]));
}
