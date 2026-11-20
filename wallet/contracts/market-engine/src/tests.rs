use super::*;
use std::vec;
use std::collections::BTreeMap as Map;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
struct A(u8);
impl Key for A {
    fn put(&self, out: &mut Vec<u8>) {
        out.push(self.0);
    }
    fn get(r: &mut Reader) -> Option<Self> {
        Some(A(r.u8()?))
    }
}

#[derive(Default)]
struct Led(Map<u8, u128>);
impl Ledger<A> for Led {
    fn credit(&mut self, w: A, n: u128) {
        *self.0.entry(w.0).or_insert(0) += n;
    }
    fn debit(&mut self, w: A, n: u128) -> bool {
        match self.0.get_mut(&w.0) {
            Some(b) if *b >= n => {
                *b -= n;
                true
            }
            _ => false,
        }
    }
}
impl Led {
    fn total(&self) -> u128 {
        self.0.values().sum()
    }
    fn of(&self, w: u8) -> u128 {
        self.0.get(&w).copied().unwrap_or(0)
    }
}

const U: u128 = 100; // one cent = 1 coin
fn setup() -> (Market<A>, Led) {
    let m = Market::new(A(1), 1000, U, vec![A(10), A(11), A(12), A(13), A(14)], 0).unwrap();
    let mut l = Led::default();
    for w in 1..=4 {
        l.credit(A(w), 10_000);
    }
    (m, l)
}
fn conserved(m: &Market<A>, l: &Led) {
    assert_eq!(l.total() + m.held_total(), 40_000, "coins must never appear or vanish");
    let (y, n): (u64, u64) = m.holdings.values().fold((0, 0), |a, h| (a.0 + h.0, a.1 + h.1));
    let (oy, on) = m.orders.iter().fold((0, 0), |a, o| match o.kind {
        Kind::Sell => (a.0 + o.qty, a.1),
        Kind::BurnNo => (a.0, a.1 + o.qty),
        _ => a,
    });
    assert_eq!(y + oy, m.supply);
    assert_eq!(n + on, m.supply);
    if m.state == State::Open {
        assert_eq!(m.pool, m.supply as u128 * m.unit);
    }
    let want_bonds = match (m.state, m.proposed, m.disputer) {
        (State::Open, Some(_), Some(_)) => 2 * m.bond(),
        (State::Open, Some(_), None) => m.bond(),
        _ => 0,
    };
    assert_eq!(m.bonds, want_bonds, "bonds are held only while an answer is pending");
}

#[test]
fn yes_buyer_meets_no_buyer_mints_a_pair() {
    let (mut m, mut l) = setup();
    m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 62, 10, 1).unwrap();
    m.place(&mut l, A(2), Outcome::No, Side::Buy, 38, 10, 2).unwrap();
    assert_eq!(m.shares(&A(1)), (10, 0));
    assert_eq!(m.shares(&A(2)), (0, 10));
    assert_eq!(m.supply, 10);
    assert_eq!(l.of(1), 10_000 - 620);
    assert_eq!(l.of(2), 10_000 - 380);
    conserved(&m, &l);
}

#[test]
fn trade_happens_at_the_waiting_price_and_difference_comes_back() {
    let (mut m, mut l) = setup();
    m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 60, 10, 1).unwrap(); // waits
    // a No buyer willing to pay 50 (= sells Yes at 50 equivalent) crosses at 60 -> pays 40
    m.place(&mut l, A(2), Outcome::No, Side::Buy, 50, 10, 2).unwrap();
    assert_eq!(l.of(1), 10_000 - 600);
    assert_eq!(l.of(2), 10_000 - 400, "the No buyer pays only 40 and gets the 10 difference back");
    conserved(&m, &l);
}

#[test]
fn yes_sale_pays_the_seller_and_moves_the_share() {
    let (mut m, mut l) = setup();
    m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 50, 5, 1).unwrap();
    m.place(&mut l, A(2), Outcome::No, Side::Buy, 50, 5, 1).unwrap();
    m.place(&mut l, A(1), Outcome::Yes, Side::Sell, 70, 5, 2).unwrap(); // waits at 70
    m.place(&mut l, A(3), Outcome::Yes, Side::Buy, 80, 5, 3).unwrap(); // trades at 70
    assert_eq!(m.shares(&A(3)), (5, 0));
    assert_eq!(m.shares(&A(1)), (0, 0));
    assert_eq!(l.of(1), 10_000 - 250 + 350);
    assert_eq!(l.of(3), 10_000 - 350, "buyer got back the 10 per share difference");
    conserved(&m, &l);
}

#[test]
fn seller_meets_seller_destroys_the_pair() {
    let (mut m, mut l) = setup();
    m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 60, 4, 1).unwrap();
    m.place(&mut l, A(2), Outcome::No, Side::Buy, 40, 4, 1).unwrap();
    m.place(&mut l, A(1), Outcome::Yes, Side::Sell, 55, 4, 2).unwrap();
    m.place(&mut l, A(2), Outcome::No, Side::Sell, 45, 4, 3).unwrap(); // = bid Yes 55, crosses
    assert_eq!(m.supply, 0);
    assert_eq!(m.pool, 0);
    assert_eq!(l.of(1) + l.of(2), 20_000);
    assert_eq!(l.of(1), 10_000 - 240 + 220);
    assert_eq!(l.of(2), 10_000 - 160 + 180);
    conserved(&m, &l);
}

#[test]
fn best_price_then_oldest_first() {
    let (mut m, mut l) = setup();
    m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 40, 1, 1).unwrap();
    m.place(&mut l, A(2), Outcome::Yes, Side::Buy, 45, 1, 1).unwrap();
    m.place(&mut l, A(3), Outcome::Yes, Side::Buy, 45, 1, 1).unwrap();
    m.place(&mut l, A(4), Outcome::No, Side::Buy, 60, 1, 2).unwrap(); // matches the highest, oldest bid
    assert_eq!(m.shares(&A(2)).0, 0 + 1);
    assert_eq!(m.shares(&A(3)).0, 0);
    conserved(&m, &l);
}

#[test]
fn cancel_gives_back_everything_and_only_to_the_owner() {
    let (mut m, mut l) = setup();
    let id = m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 30, 10, 1).unwrap();
    assert!(m.cancel(&mut l, A(2), id).is_err());
    m.cancel(&mut l, A(1), id).unwrap();
    assert_eq!(l.of(1), 10_000);
    assert!(m.orders.is_empty());
    conserved(&m, &l);
}

#[test]
fn rejects_bad_orders() {
    let (mut m, mut l) = setup();
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 0, 1, 1).is_err());
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 100, 1, 1).is_err());
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 50, 0, 1).is_err());
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Sell, 50, 1, 1).is_err(), "can't sell what you don't hold");
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 50, 1_000_000, 1).is_err(), "can't lock more than deposited");
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 50, 1, 1000).is_err(), "closed");
    conserved(&m, &l);
}

#[test]
fn a_full_book_still_takes_orders_that_trade() {
    let (mut m, mut l) = setup();
    for _ in 0..MAX_ORDERS {
        m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 1, 1, 1).unwrap();
    }
    assert!(m.place(&mut l, A(2), Outcome::Yes, Side::Buy, 1, 1, 1).is_err(), "not better than the worst waiting bid");
    // a No buyer at 99 crosses the bids at 1: it trades even though the book is full
    m.place(&mut l, A(3), Outcome::No, Side::Buy, 99, 1, 1).unwrap();
    assert_eq!(m.shares(&A(3)), (0, 1));
    assert_eq!(m.orders.len(), MAX_ORDERS - 1);
    conserved(&m, &l);
}

#[test]
fn a_better_order_pushes_out_the_worst_and_the_owner_is_refunded() {
    let (mut m, mut l) = setup();
    for _ in 0..MAX_ORDERS {
        m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 1, 1, 1).unwrap();
    }
    let before = l.of(1);
    m.place(&mut l, A(2), Outcome::Yes, Side::Buy, 5, 1, 1).unwrap();
    assert_eq!(m.orders.len(), MAX_ORDERS);
    assert_eq!(l.of(1), before + 1, "the newest of the worst bids was pushed out and fully refunded");
    assert!(m.orders.iter().any(|o| o.owner == A(2) && o.price == 5));
    conserved(&m, &l);
}

#[test]
fn eviction_gives_a_waiting_sale_its_shares_back() {
    let (mut m, mut l) = setup();
    m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 50, 100, 1).unwrap();
    m.place(&mut l, A(2), Outcome::No, Side::Buy, 50, 100, 1).unwrap(); // A(1) holds 100 Yes
    for _ in 0..MAX_ORDERS {
        m.place(&mut l, A(1), Outcome::Yes, Side::Sell, 90, 1, 2).unwrap();
    }
    assert_eq!(m.shares(&A(1)).0, 0);
    m.place(&mut l, A(3), Outcome::No, Side::Buy, 30, 1, 2).unwrap(); // = Yes ask at 70, better than 90
    assert_eq!(m.shares(&A(1)).0, 1, "the pushed-out sale returned its share");
    assert_eq!(m.orders.len(), MAX_ORDERS);
    conserved(&m, &l);
}

#[test]
fn sending_shares() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l); // A(1): 10 Yes, A(2): 10 No
    assert!(m.send(A(1), A(1), Outcome::Yes, 1).is_err());
    assert!(m.send(A(1), A(3), Outcome::Yes, 0).is_err());
    assert!(m.send(A(1), A(3), Outcome::Yes, 11).is_err());
    assert!(m.send(A(1), A(3), Outcome::No, 1).is_err(), "A(1) holds no No shares");
    m.send(A(1), A(3), Outcome::Yes, 4).unwrap();
    assert_eq!(m.shares(&A(1)), (6, 0));
    assert_eq!(m.shares(&A(3)), (4, 0));
    // shares waiting in a sell order are not free to send
    m.place(&mut l, A(1), Outcome::Yes, Side::Sell, 90, 6, 2).unwrap();
    assert!(m.send(A(1), A(3), Outcome::Yes, 1).is_err());
    conserved(&m, &l);
    // and the recipient is paid when it wins
    m.propose(&mut l, A(4), Vote::Yes, 1000).unwrap();
    m.finalize(&mut l, 1000 + WINDOW).unwrap();
    assert_eq!(m.claim(&mut l, A(3)).unwrap(), 400);
}

fn trade_pair(m: &mut Market<A>, l: &mut Led) {
    m.place(l, A(1), Outcome::Yes, Side::Buy, 60, 10, 1).unwrap();
    m.place(l, A(2), Outcome::No, Side::Buy, 40, 10, 1).unwrap();
}

#[test]
fn an_undisputed_answer_stands_and_the_bond_comes_back() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    assert!(m.propose(&mut l, A(3), Vote::Yes, 999).is_err(), "too early");
    let before = l.of(3);
    m.propose(&mut l, A(3), Vote::Yes, 1000).unwrap();
    assert_eq!(l.of(3), before - m.bond());
    assert!(m.propose(&mut l, A(4), Vote::No, 1001).is_err(), "only one answer");
    assert!(m.finalize(&mut l, 1000 + WINDOW - 1).is_err(), "window still open");
    assert!(m.vote(&mut l, A(10), Vote::Yes, 1002).is_err(), "the panel only decides disputes");
    assert_eq!(m.finalize(&mut l, 1000 + WINDOW).unwrap(), State::Yes);
    assert_eq!(l.of(3), before);
    assert_eq!(m.claim(&mut l, A(1)).unwrap(), 1000);
    assert_eq!(m.claim(&mut l, A(2)).unwrap(), 0);
    assert_eq!(m.pool, 0);
    assert_eq!(l.total(), 40_000);
}

#[test]
fn propose_needs_a_bond_and_dispute_needs_the_window_and_someone_else() {
    let (mut m, mut l) = setup();
    assert!(m.propose(&mut l, A(99), Vote::Yes, 1000).is_err(), "no coins for the bond");
    assert!(m.dispute(&mut l, A(2), 1000).is_err(), "nothing to dispute yet");
    m.propose(&mut l, A(3), Vote::Yes, 1000).unwrap();
    assert!(m.dispute(&mut l, A(3), 1001).is_err(), "not your own answer");
    assert!(m.dispute(&mut l, A(2), 1000 + WINDOW).is_err(), "the window is over");
    m.dispute(&mut l, A(2), 1001).unwrap();
    assert!(m.dispute(&mut l, A(4), 1002).is_err(), "already disputed");
    assert!(m.finalize(&mut l, 1000 + WINDOW).is_err(), "a dispute can't be finalized around the panel");
    conserved(&m, &l);
}

#[test]
fn the_panel_overrules_the_proposal_and_the_disputer_takes_both_bonds() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    let (c3, c4) = (l.of(3), l.of(4));
    m.propose(&mut l, A(3), Vote::Yes, 1000).unwrap();
    m.dispute(&mut l, A(4), 1001).unwrap();
    assert!(m.vote(&mut l, A(99), Vote::No, 1002).is_err(), "not on the panel");
    assert_eq!(m.vote(&mut l, A(10), Vote::No, 1002).unwrap(), None);
    assert_eq!(m.vote(&mut l, A(11), Vote::No, 1003).unwrap(), None);
    assert_eq!(m.vote(&mut l, A(12), Vote::Yes, 1004).unwrap(), None, "2 No, 1 Yes: no majority yet");
    assert_eq!(m.vote(&mut l, A(12), Vote::No, 1005).unwrap(), Some(State::No), "a changed vote reaches the majority");
    assert_eq!(l.of(3), c3 - m.bond());
    assert_eq!(l.of(4), c4 + m.bond());
    assert!(m.vote(&mut l, A(13), Vote::Yes, 1006).is_err(), "final");
    assert!(m.expire(&mut l, 1000 + EXPIRE_AFTER).is_err(), "decided");
    conserved(&m, &l);
    assert_eq!(m.claim(&mut l, A(2)).unwrap(), 1000);
    assert_eq!(l.total() + m.held_total(), 40_000);
}

#[test]
fn the_panel_upholds_the_proposal_and_the_proposer_takes_both_bonds() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    let (c3, c4) = (l.of(3), l.of(4));
    m.propose(&mut l, A(3), Vote::Yes, 1000).unwrap();
    m.dispute(&mut l, A(4), 1001).unwrap();
    for w in [10u8, 11, 12] {
        m.vote(&mut l, A(w), Vote::Yes, 1002).unwrap();
    }
    assert_eq!(m.state, State::Yes);
    assert_eq!(l.of(3), c3 + m.bond());
    assert_eq!(l.of(4), c4 - m.bond());
    conserved(&m, &l);
}

#[test]
fn a_stuck_dispute_ends_invalid_and_both_get_their_bond_back() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    let (c3, c4) = (l.of(3), l.of(4));
    m.propose(&mut l, A(3), Vote::Yes, 1000).unwrap();
    m.dispute(&mut l, A(4), 1001).unwrap();
    assert!(m.expire(&mut l, 1001 + EXPIRE_AFTER - 1).is_err());
    m.expire(&mut l, 1001 + EXPIRE_AFTER).unwrap();
    assert_eq!((l.of(3), l.of(4)), (c3, c4));
    assert_eq!(m.state, State::Invalid);
    conserved(&m, &l);
}

#[test]
fn expiry_cannot_override_a_pending_answer() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    let late = 1000 + EXPIRE_AFTER - 10;
    m.propose(&mut l, A(3), Vote::Yes, late).unwrap();
    assert!(m.expire(&mut l, 1000 + EXPIRE_AFTER + 10).is_err(), "an answer is waiting");
    assert_eq!(m.finalize(&mut l, late + WINDOW).unwrap(), State::Yes);
}

#[test]
fn invalid_pays_half_and_expiry_works() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    assert!(m.expire(&mut l, 1000 + EXPIRE_AFTER - 1).is_err());
    m.expire(&mut l, 1000 + EXPIRE_AFTER).unwrap();
    assert_eq!(m.claim(&mut l, A(1)).unwrap(), 500);
    assert_eq!(m.claim(&mut l, A(2)).unwrap(), 500);
    assert_eq!(l.total(), 40_000);
    assert_eq!(m.pool, 0);
}

#[test]
fn claim_cancels_waiting_orders_first() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    m.place(&mut l, A(3), Outcome::Yes, Side::Buy, 10, 5, 2).unwrap();
    m.place(&mut l, A(1), Outcome::Yes, Side::Sell, 99, 10, 2).unwrap();
    m.expire(&mut l, 1000 + EXPIRE_AFTER).unwrap();
    m.claim(&mut l, A(3)).unwrap();
    m.claim(&mut l, A(1)).unwrap();
    m.claim(&mut l, A(2)).unwrap();
    assert_eq!(l.total(), 40_000);
    assert_eq!(m.pool, 0);
    assert!(m.orders.is_empty());
}

#[test]
fn validation_of_new_markets() {
    assert!(Market::new(A(1), 10, 150, vec![A(1), A(2), A(3)], 0).is_err());
    assert!(Market::new(A(1), 0, 100, vec![A(1), A(2), A(3)], 0).is_err());
    assert!(Market::new(A(1), 10, 100, vec![A(1), A(2)], 0).is_err());
    assert!(Market::new(A(1), 10, 100, vec![A(1), A(1), A(3)], 0).is_err());
}

#[test]
fn encode_decode_roundtrip() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    m.place(&mut l, A(3), Outcome::Yes, Side::Buy, 10, 5, 2).unwrap();
    for step in 0..3 {
        // a market is stored in every stage of settling: open, proposed, disputed, decided
        match step {
            0 => {}
            1 => m.propose(&mut l, A(3), Vote::Yes, 1000).unwrap(),
            _ => m.dispute(&mut l, A(4), 1001).unwrap(),
        }
        let b = m.encode();
        let d = Market::<A>::decode(&b).unwrap();
        assert_eq!(d, m);
        assert!(Market::<A>::decode(&b[..b.len() - 1]).is_none());
    }
    m.vote(&mut l, A(10), Vote::No, 1002).unwrap();
    m.vote(&mut l, A(11), Vote::No, 1002).unwrap();
    m.vote(&mut l, A(12), Vote::No, 1002).unwrap();
    let b = m.encode();
    assert_eq!(Market::<A>::decode(&b).unwrap(), m);
}

/// Plays whole lives of a market at random: orders of every kind, cancels, share transfers, floods that fill the book,
/// then settling by any of the four routes and claims. After every single step the coins and shares must still add up.
#[test]
fn random_play_never_breaks_the_books() {
    let mut totals = (0u32, 0u32, 0u32, 0u32, 0u32, 0u32); // evictions, sends, finalized, panel decided, stuck, expired unanswered
    for game in 0..200u64 {
        let mut seed = 12345u64 + game * 7919;
        let mut rnd = move |n: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % n
        };
        let (mut m, mut l) = setup();
        for t in 0..400u64 {
            let who = A(1 + rnd(4) as u8);
            match rnd(8) {
                0..=2 => {
                    let o = if rnd(2) == 0 { Outcome::Yes } else { Outcome::No };
                    let s = if rnd(3) == 0 { Side::Sell } else { Side::Buy };
                    let _ = m.place(&mut l, who, o, s, 1 + rnd(99) as u8, 1 + rnd(5), 1 + t % 900);
                }
                3 => {
                    if let Some(o) = m.orders.get(rnd(m.orders.len().max(1) as u64) as usize) {
                        let (id, ow) = (o.id, o.owner);
                        m.cancel(&mut l, ow, id).unwrap();
                    }
                }
                4 => {
                    let to = A(1 + rnd(4) as u8);
                    let o = if rnd(2) == 0 { Outcome::Yes } else { Outcome::No };
                    if m.send(who, to, o, 1 + rnd(4)).is_ok() {
                        totals.1 += 1;
                    }
                }
                5 if rnd(25) == 0 => {
                    // flood the book with the lowest bids so the next better order has to push one out
                    for _ in 0..MAX_ORDERS {
                        let _ = m.place(&mut l, who, Outcome::Yes, Side::Buy, 1, 1, 1 + t % 900);
                    }
                    let before = m.orders.len();
                    if m.place(&mut l, A(1 + rnd(4) as u8), Outcome::Yes, Side::Buy, 2 + rnd(3) as u8, 1, 1 + t % 900).is_ok() && before == MAX_ORDERS {
                        totals.0 += 1;
                        assert!(m.orders.len() <= MAX_ORDERS);
                    }
                }
                _ => {}
            }
            assert!(m.orders.len() <= MAX_ORDERS);
            conserved(&m, &l);
        }
        // settle by one of four routes
        let proposer = A(1 + rnd(4) as u8);
        let ans = [Vote::Yes, Vote::No, Vote::Invalid][rnd(3) as usize];
        match rnd(4) {
            0 => {
                m.expire(&mut l, 1000 + EXPIRE_AFTER).unwrap();
                totals.5 += 1;
            }
            1 => {
                m.propose(&mut l, proposer, ans, 1000).unwrap();
                conserved(&m, &l);
                m.finalize(&mut l, 1000 + WINDOW).unwrap();
                totals.2 += 1;
            }
            2 => {
                m.propose(&mut l, proposer, ans, 1000).unwrap();
                let disputer = A(if proposer.0 == 1 { 2 } else { 1 });
                m.dispute(&mut l, disputer, 1001).unwrap();
                conserved(&m, &l);
                let pick = [Vote::Yes, Vote::No, Vote::Invalid][rnd(3) as usize];
                for w in [10u8, 11, 12] {
                    let _ = m.vote(&mut l, A(w), pick, 1002);
                    conserved(&m, &l);
                }
                assert_ne!(m.state, State::Open);
                totals.3 += 1;
            }
            _ => {
                m.propose(&mut l, proposer, ans, 1000).unwrap();
                let disputer = A(if proposer.0 == 1 { 2 } else { 1 });
                m.dispute(&mut l, disputer, 1001).unwrap();
                m.expire(&mut l, 1001 + EXPIRE_AFTER).unwrap();
                totals.4 += 1;
            }
        }
        conserved(&m, &l);
        for w in 1..=4 {
            m.claim(&mut l, A(w)).unwrap();
        }
        assert_eq!(l.total(), 40_000, "every coin is back in a free balance, none lost or made");
        assert_eq!(m.pool, 0);
        assert_eq!(m.bonds, 0);
        assert!(m.orders.is_empty());
    }
    // the run really reached the hard cases
    assert!(totals.0 > 0 && totals.1 > 0 && totals.2 > 0 && totals.3 > 0 && totals.4 > 0 && totals.5 > 0, "{:?}", totals);
}
