//! Choosing who to connect to, who to drop, and noticing when we may be cut off: the pure parts,
//! on simulated time.

use lokyx::addrman::{AddrMan, Group, group};
use lokyx::dialplan::{
    Connected, Dial, Kind, MIN_ADDRS, SEED_AFTER_SECS, Sources, TARGET_BLOCK_ONLY, TARGET_FULL, plan,
};
use lokyx::eviction::{Candidate, select_victim};
use lokyx::health::{Health, Inputs, STALE_TIP_SECS};
use rand::SeedableRng;
use rand::rngs::StdRng;
use std::collections::HashSet;
use std::net::{IpAddr, SocketAddr};

const NOW: u64 = 1_800_000_000;
type Anchors = Vec<(SocketAddr, Option<[u8; 32]>)>;
type Seeds = Vec<(SocketAddr, Vec<[u8; 32]>)>;

fn a(s: &str) -> SocketAddr {
    s.parse().unwrap()
}

/// `n` addresses, each in its own /16, all told by one source.
fn table(n: u32) -> AddrMan {
    let mut m = AddrMan::new([3; 32]);
    for i in 0..n {
        let addr = SocketAddr::new(IpAddr::from([30 + (i / 200) as u8, (i % 200) as u8 + 1, 1, 1]), 8000);
        m.add(addr, None, Some(IpAddr::from([9, (i % 100) as u8, 1, 1])), NOW, NOW);
    }
    m
}

fn rng() -> StdRng {
    StdRng::seed_from_u64(9)
}

fn dials(have: &Connected, m: &AddrMan, anchors: &Anchors, seeds: &Seeds) -> Vec<Dial> {
    plan(&mut rng(), NOW, have, &Sources { addrs: m, anchors, seeds }, |_| false)
}

// ---------- dialling ----------

#[test]
fn a_node_with_nothing_connected_asks_for_eight_full_and_two_block_only_in_ten_groups() {
    let m = table(500);
    let d = dials(&Connected::default(), &m, &vec![], &vec![]);
    assert_eq!(d.iter().filter(|x| x.kind == Kind::Full).count(), TARGET_FULL);
    assert_eq!(d.iter().filter(|x| x.kind == Kind::BlockOnly).count(), TARGET_BLOCK_ONLY);
    assert_eq!(d.iter().filter(|x| x.kind == Kind::Extra).count(), 0);
    let groups: HashSet<Group> = d.iter().map(|x| group(&x.addr)).collect();
    assert_eq!(groups.len(), d.len(), "one peer per group");
}

#[test]
fn what_is_already_connected_is_not_asked_for_again_and_its_group_is_left_alone() {
    let m = table(500);
    let have_addrs: Vec<SocketAddr> = m.addrs().into_iter().take(5).collect();
    let have = Connected {
        full: 5,
        block_only: 2,
        groups: have_addrs.iter().map(group).collect(),
        addrs: have_addrs.iter().copied().collect(),
        ..Default::default()
    };
    let d = dials(&have, &m, &vec![], &vec![]);
    assert_eq!(d.len(), TARGET_FULL - 5);
    for x in &d {
        assert!(!have.groups.contains(&group(&x.addr)), "{x:?} is in a group we already have");
        assert!(!have.addrs.contains(&x.addr));
    }
    // The same key at another address is the same node.
    let mut m2 = AddrMan::new([3; 32]);
    let (dup, other) = (a("40.1.1.1:8000"), a("41.1.1.1:8000"));
    m2.add(dup, Some([7; 32]), None, NOW, NOW);
    m2.add(other, Some([8; 32]), None, NOW, NOW);
    let have = Connected { full: 7, block_only: 2, keys: HashSet::from([[7u8; 32]]), ..Default::default() };
    for seed in 0..30 {
        let d = plan(
            &mut StdRng::seed_from_u64(seed),
            NOW,
            &have,
            &Sources { addrs: &m2, anchors: &[], seeds: &[] },
            |_| false,
        );
        assert_eq!(d.iter().map(|x| x.addr).collect::<Vec<_>>(), vec![other], "seed {seed}");
    }
}

#[test]
fn after_a_restart_the_first_two_dials_are_the_anchors() {
    let m = table(500);
    let anchors: Anchors = vec![(a("70.1.1.1:8000"), Some([1; 32])), (a("71.1.1.1:8000"), Some([2; 32]))];
    let d = dials(&Connected::default(), &m, &anchors, &vec![]);
    assert_eq!(d[0], Dial { addr: anchors[0].0, keys: vec![[1; 32]], kind: Kind::BlockOnly, anchor: true });
    assert_eq!(d[1], Dial { addr: anchors[1].0, keys: vec![[2; 32]], kind: Kind::BlockOnly, anchor: true });
    assert!(d[2..].iter().all(|x| !x.anchor));
    // The two block-relay places are taken by them, so no other block-only dial.
    assert_eq!(d.iter().filter(|x| x.kind == Kind::BlockOnly).count(), 2);

    // Two anchors in one range count as one: it is one party's.
    let same: Anchors = vec![(a("70.1.1.1:8000"), None), (a("70.1.9.9:8000"), None)];
    let d = dials(&Connected::default(), &m, &same, &vec![]);
    assert_eq!(d.iter().filter(|x| x.anchor).count(), 1);
}

#[test]
fn seeds_are_used_with_a_small_table_or_after_a_minute_alone_and_not_otherwise() {
    let seeds: Seeds = vec![(a("80.1.1.1:8000"), vec![[5; 32], [6; 32]])];
    let big = table(MIN_ADDRS as u32 + 20);
    let small = table(MIN_ADDRS as u32 - 1);
    let uses_seed = |d: &[Dial]| d.iter().any(|x| x.addr == seeds[0].0);

    assert!(!uses_seed(&dials(&Connected { alone_for: 10, ..Default::default() }, &big, &vec![], &seeds)));
    let d = dials(&Connected { alone_for: SEED_AFTER_SECS, ..Default::default() }, &big, &vec![], &seeds);
    assert!(uses_seed(&d));
    assert_eq!(
        d.iter().find(|x| x.addr == seeds[0].0).unwrap().keys,
        vec![[5; 32], [6; 32]],
        "every pinned key goes along"
    );
    assert!(uses_seed(&dials(&Connected::default(), &small, &vec![], &seeds)));
    // A seed we have just failed to reach isn't dialled again at once.
    let d =
        plan(&mut rng(), NOW, &Connected::default(), &Sources { addrs: &small, anchors: &[], seeds: &seeds }, |x| {
            *x == seeds[0].0
        });
    assert!(!uses_seed(&d));
}

// ---------- noticing isolation ----------

fn health(age: u64, peers: usize, outbound: usize, groups: usize) -> Health {
    Health::assess(&Inputs { now: NOW, tip_time: NOW - age, peers, outbound, outbound_groups: groups })
}

#[test]
fn the_three_signs_are_each_set_on_their_own_and_a_healthy_node_has_none() {
    assert!(!health(0, 8, 8, 8).any());
    assert!(health(STALE_TIP_SECS + 1, 8, 8, 8).stale_tip);
    assert!(!health(STALE_TIP_SECS, 8, 8, 8).stale_tip);
    assert!(health(0, 0, 0, 0).no_peers);
    assert!(health(0, 3, 2, 2).few_groups);
    assert!(!health(0, 3, 3, 3).few_groups);
    // No outbound peers at all is "no peers" or nothing, not "few groups".
    assert!(!health(0, 2, 0, 0).few_groups);
}

#[test]
fn a_stale_tip_opens_one_extra_connection_to_a_new_group_but_only_after_30_minutes() {
    let m = table(500);
    let have_addrs: Vec<SocketAddr> = m.addrs().into_iter().take(8).collect();
    let mut have = Connected {
        full: 8,
        block_only: 2,
        groups: have_addrs.iter().map(group).collect(),
        addrs: have_addrs.iter().copied().collect(),
        ..Default::default()
    };
    let simulated = |minutes: u64, have: &mut Connected| {
        let h = Health::assess(&Inputs {
            now: NOW + minutes * 60,
            tip_time: NOW,
            peers: 10,
            outbound: 10,
            outbound_groups: 10,
        });
        have.stale_tip = h.stale_tip;
        (h, dials(have, &m, &vec![], &vec![]))
    };

    let (h, d) = simulated(29, &mut have);
    assert!(!h.stale_tip);
    assert!(d.is_empty(), "29 minutes: nothing to do, got {d:?}");

    let (h, d) = simulated(31, &mut have);
    assert!(h.stale_tip, "31 minutes: the flag is set");
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].kind, Kind::Extra);
    assert!(!have.groups.contains(&group(&d[0].addr)), "the extra one goes to a group we have no peer in");

    // Where nearly everything we know is in groups we already use, the extra one still goes to the
    // one address that isn't.
    let mut crowded = AddrMan::new([3; 32]);
    for x in &have_addrs {
        crowded.add(SocketAddr::new(x.ip(), 8001), None, None, NOW, NOW);
    }
    let free = a("99.9.9.9:8000");
    crowded.add(free, None, None, NOW, NOW);
    let mut full_up = Connected { stale_tip: true, ..Default::default() };
    full_up.full = 8;
    full_up.block_only = 2;
    full_up.groups = have.groups.clone();
    full_up.addrs = have.addrs.clone();
    for seed in 0..30 {
        let d = plan(
            &mut StdRng::seed_from_u64(seed),
            NOW,
            &full_up,
            &Sources { addrs: &crowded, anchors: &[], seeds: &[] },
            |_| false,
        );
        assert_eq!(d.iter().map(|x| x.addr).collect::<Vec<_>>(), vec![free], "seed {seed}");
    }

    // Having one already, it doesn't ask for another.
    have.extra = 1;
    let (_, d) = simulated(31, &mut have);
    assert!(d.is_empty());
}

// ---------- evicting ----------

fn cand(id: u64, group: u8, age: u64, ping: Option<u64>, block: Option<u64>) -> Candidate {
    Candidate { id, group: vec![4, group, 0], age, ping_ms: ping, block_ago: block }
}

/// 32 inbound places full: 28 from one /16 (ids 1..=28) and 4 honest ones from four others
/// (ids 101..=104).
fn crowded() -> Vec<Candidate> {
    let mut v = vec![];
    for id in 1..=28u64 {
        // Age grows with the id's distance from 28: id 28 is the newest.
        v.push(cand(id, 50, 1000 - id * 10, None, None));
    }
    for (i, id) in (101..=104u64).enumerate() {
        v.push(cand(id, 60 + i as u8, 500, None, None));
    }
    v
}

#[test]
fn eviction_takes_from_the_biggest_group_and_never_from_a_protected_peer() {
    let mut v = crowded();
    // Make the flood's newest peers the quickest to answer and the latest to give blocks. Without
    // protection they'd be the first to go.
    for c in v.iter_mut().filter(|c| (25..=28).contains(&c.id)) {
        c.ping_ms = Some(c.id);
    }
    for c in v.iter_mut().filter(|c| (21..=24).contains(&c.id)) {
        c.block_ago = Some(c.id);
    }
    let victim = select_victim(&v).expect("a victim");
    let protected_young: Vec<u64> = (21..=28).collect();
    assert!(!protected_young.contains(&victim), "{victim} is protected");
    assert!(
        v.iter().find(|c| c.id == victim).unwrap().group == vec![4, 50, 0],
        "taken from the flood, not an honest group"
    );
    // The newest unprotected one of the flood.
    assert_eq!(victim, 20);

    // The oldest four of the flood are protected as well: take everything else away from the flood
    // until only protected peers and honest ones remain.
    let few: Vec<Candidate> = v.iter().filter(|c| c.id <= 4 || c.id >= 101).cloned().collect();
    let victim = select_victim(&few).unwrap();
    assert!(victim >= 101, "the four oldest are kept: {victim}");
}

#[test]
fn an_honest_peer_in_its_own_group_is_not_the_victim_even_when_it_is_the_newest() {
    let mut v = crowded();
    v.push(cand(200, 70, 1, None, None)); // brand new, no ping, no block
    let victim = select_victim(&v).unwrap();
    assert_ne!(victim, 200);
    assert!(victim <= 28);
}

#[test]
fn when_everyone_is_protected_nobody_is_dropped() {
    let v: Vec<Candidate> = (1..=4).map(|i| cand(i, i as u8, 100 * i, Some(i), Some(i))).collect();
    assert_eq!(select_victim(&v), None);
}
