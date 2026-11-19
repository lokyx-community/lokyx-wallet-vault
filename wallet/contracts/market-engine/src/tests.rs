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
    assert_eq!(l.total() + m.pool + m.locked_total(), 40_000, "coins must never appear or vanish");
    let (y, n): (u64, u64) = m.holdings.values().fold((0, 0), |a, h| (a.0 + h.0, a.1 + h.1));
    let (oy, on) = m.orders.iter().fold((0, 0), |a, o| match o.kind {
        Kind::Sell => (a.0 + o.qty, a.1),
        Kind::BurnNo => (a.0, a.1 + o.qty),
        _ => a,
    });
    assert_eq!(y + oy, m.supply);
    assert_eq!(n + on, m.supply);
    assert_eq!(m.pool, m.supply as u128 * m.unit);
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
fn order_cap() {
    let (mut m, mut l) = setup();
    for _ in 0..MAX_ORDERS {
        m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 1, 1, 1).unwrap();
    }
    assert!(m.place(&mut l, A(1), Outcome::Yes, Side::Buy, 1, 1, 1).is_err());
}

fn trade_pair(m: &mut Market<A>, l: &mut Led) {
    m.place(l, A(1), Outcome::Yes, Side::Buy, 60, 10, 1).unwrap();
    m.place(l, A(2), Outcome::No, Side::Buy, 40, 10, 1).unwrap();
}

#[test]
fn panel_resolves_yes_after_window() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    assert!(m.vote(A(10), Vote::Yes, 999).is_err(), "too early");
    assert!(m.vote(A(99), Vote::Yes, 1000).is_err(), "not on the panel");
    m.vote(A(10), Vote::Yes, 1000).unwrap();
    m.vote(A(11), Vote::Yes, 1001).unwrap();
    assert!(m.finalize(1002).is_err(), "no majority yet");
    m.vote(A(12), Vote::Yes, 1002).unwrap();
    assert!(m.finalize(1003).is_err(), "window still open");
    assert_eq!(m.finalize(1002 + WINDOW).unwrap(), State::Yes);
    assert_eq!(m.claim(&mut l, A(1)).unwrap(), 1000);
    assert_eq!(m.claim(&mut l, A(2)).unwrap(), 0);
    assert_eq!(m.pool, 0);
    assert_eq!(l.total(), 40_000);
}

#[test]
fn a_changed_vote_restarts_the_window() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    for (i, w) in [10u8, 11, 12].into_iter().enumerate() {
        m.vote(A(w), Vote::Yes, 1000 + i as u64).unwrap();
    }
    m.vote(A(12), Vote::No, 2000).unwrap(); // majority gone
    assert!(m.finalize(1002 + WINDOW + 5).is_err());
    m.vote(A(13), Vote::No, 3000).unwrap();
    m.vote(A(14), Vote::No, 3001).unwrap(); // No now has 3
    assert!(m.finalize(3001 + WINDOW - 1).is_err());
    assert_eq!(m.finalize(3001 + WINDOW).unwrap(), State::No);
    assert_eq!(m.claim(&mut l, A(2)).unwrap(), 1000);
}

#[test]
fn invalid_pays_half_and_expiry_works() {
    let (mut m, mut l) = setup();
    trade_pair(&mut m, &mut l);
    assert!(m.expire(1000 + EXPIRE_AFTER - 1).is_err());
    m.expire(1000 + EXPIRE_AFTER).unwrap();
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
    m.expire(1000 + EXPIRE_AFTER).unwrap();
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
    m.vote(A(10), Vote::Yes, 1000).unwrap();
    let b = m.encode();
    let d = Market::<A>::decode(&b).unwrap();
    assert_eq!(d, m);
    assert!(Market::<A>::decode(&b[..b.len() - 1]).is_none());
}

#[test]
fn random_play_never_breaks_the_books() {
    let mut seed = 12345u64;
    let mut rnd = move |n: u64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) % n
    };
    let (mut m, mut l) = setup();
    for t in 0..2000 {
        let who = A(1 + rnd(4) as u8);
        match rnd(4) {
            0 | 1 => {
                let o = if rnd(2) == 0 { Outcome::Yes } else { Outcome::No };
                let s = if rnd(3) == 0 { Side::Sell } else { Side::Buy };
                let _ = m.place(&mut l, who, o, s, 1 + rnd(99) as u8, 1 + rnd(5), 1 + t % 900);
            }
            2 => {
                if let Some(o) = m.orders.get(rnd(m.orders.len().max(1) as u64) as usize) {
                    let (id, ow) = (o.id, o.owner);
                    m.cancel(&mut l, ow, id).unwrap();
                }
            }
            _ => {}
        }
        conserved(&m, &l);
    }
    m.expire(1000 + EXPIRE_AFTER).unwrap();
    for w in 1..=4 {
        m.claim(&mut l, A(w)).unwrap();
    }
    assert_eq!(l.total(), 40_000);
    assert_eq!(m.pool, 0);
}
