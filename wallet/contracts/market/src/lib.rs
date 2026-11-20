//! Yes/no prediction markets with an order book, paid in LYX. One contract holds every market; the rules
//! live in `market-engine` (tested natively). People deposit LYX into a free balance, trade with it, and
//! withdraw. The contract only ever sends LYX out on `withdraw`.
//!
//! Every argument and result uses only the types the wallet can already encode: address, amount (u128), bool,
//! string, u64 and a list of addresses. Small choices (outcome, side, vote) are therefore u64s.

#![no_std]

use lokyx_sdk::*;
use market_engine::{Key, Ledger, Market, Outcome, Side, State, Vote};

const MAX_TITLE: usize = 140;
const MIN_CLOSE_AHEAD: u64 = 3600;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct W(Address);
impl Key for W {
    fn put(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&(self.0).0);
    }
    fn get(r: &mut market_engine::Reader) -> Option<Self> {
        Some(W(Address(r.take(20)?.try_into().ok()?)))
    }
}

static COUNT: Item<u64> = Item::new(b"count");
static TITLES: Map<u64, String> = Map::new(b"t");
static MARKETS: Map<u64, Vec<u8>> = Map::new(b"m");
/// free LYX each person has in the contract
static FREE: Map<Address, u128> = Map::new(b"f");

struct Free;
impl Ledger<W> for Free {
    fn credit(&mut self, who: W, amount: u128) {
        FREE.set(&who.0, &(FREE.get(&who.0).unwrap_or(0) + amount));
    }
    fn debit(&mut self, who: W, amount: u128) -> bool {
        let b = FREE.get(&who.0).unwrap_or(0);
        if b < amount {
            return false;
        }
        FREE.set(&who.0, &(b - amount));
        true
    }
}

fn load(id: u64) -> Market<W> {
    match MARKETS.get(&id).and_then(|b| Market::decode(&b)) {
        Some(m) => m,
        None => revert("no such market"),
    }
}
fn save(id: u64, m: &Market<W>) {
    MARKETS.set(&id, &m.encode());
}
fn ok<T>(r: Result<T, &'static str>) -> T {
    match r {
        Ok(v) => v,
        Err(e) => revert(e),
    }
}
fn outcome(b: u64) -> Outcome {
    match b {
        0 => Outcome::Yes,
        1 => Outcome::No,
        _ => revert("outcome is 0 (Yes) or 1 (No)"),
    }
}
fn side(b: u64) -> Side {
    match b {
        0 => Side::Buy,
        1 => Side::Sell,
        _ => revert("side is 0 (buy) or 1 (sell)"),
    }
}
fn vote_of(b: u64) -> Vote {
    match b {
        0 => Vote::Yes,
        1 => Vote::No,
        2 => Vote::Invalid,
        _ => revert("the answer is 0 (Yes), 1 (No) or 2 (Invalid)"),
    }
}
fn state_code(s: State) -> u64 {
    match s {
        State::Open => 0,
        State::Yes => 1,
        State::No => 2,
        State::Invalid => 3,
    }
}
/// 0 = none, 1 = Yes, 2 = No, 3 = Invalid
fn vote_code(v: Option<Vote>) -> u64 {
    match v {
        None => 0,
        Some(Vote::Yes) => 1,
        Some(Vote::No) => 2,
        Some(Vote::Invalid) => 3,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    COUNT.set(&0);
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, mut args) = method();
    let me = caller();
    let now = time();
    if method != "deposit" {
        require(value() == 0, "only deposit takes LYX");
    }
    match method.as_str() {
        "deposit" => {
            let v = value();
            require(v > 0, "send some LYX to deposit");
            Free.credit(W(me), v);
            emit("Deposit", (me, v));
        }
        "withdraw" => {
            let amount: u128 = args.next();
            require(Free.debit(W(me), amount), "not enough free LYX");
            send(&me, amount);
            emit("Withdraw", (me, amount));
        }
        "create" => {
            let title: String = args.next();
            let close: u64 = args.next();
            let unit: u128 = args.next();
            let panel: Vec<Address> = args.next();
            require(!title.is_empty() && title.len() <= MAX_TITLE, "the question is empty or too long");
            require(close >= now + MIN_CLOSE_AHEAD, "close at least an hour from now");
            let m = ok(Market::new(W(me), close, unit, panel.into_iter().map(W).collect(), now));
            let id = COUNT.get().unwrap_or(0);
            COUNT.set(&(id + 1));
            TITLES.set(&id, &title);
            save(id, &m);
            emit("Created", (id, me, close));
            ret(&id);
        }
        "place" => {
            let id: u64 = args.next();
            let (o, s, price, qty): (u64, u64, u64, u64) = (args.next(), args.next(), args.next(), args.next());
            require(price <= 255, "the price must be between 1 and 99");
            let mut m = load(id);
            let oid = ok(m.place(&mut Free, W(me), outcome(o), side(s), price as u8, qty, now));
            save(id, &m);
            emit("Order", (id, oid, me));
            ret(&oid);
        }
        "cancel" => {
            let (id, oid): (u64, u64) = (args.next(), args.next());
            let mut m = load(id);
            ok(m.cancel(&mut Free, W(me), oid));
            save(id, &m);
        }
        // ---- settling: propose, dispute, the panel decides disputes ----
        "propose" => {
            let id: u64 = args.next();
            let a: u64 = args.next();
            let mut m = load(id);
            ok(m.propose(&mut Free, W(me), vote_of(a), now));
            save(id, &m);
            emit("Proposed", (id, me, a));
        }
        "dispute" => {
            let id: u64 = args.next();
            let mut m = load(id);
            ok(m.dispute(&mut Free, W(me), now));
            save(id, &m);
            emit("Disputed", (id, me));
        }
        "vote" => {
            let id: u64 = args.next();
            let v: u64 = args.next();
            let mut m = load(id);
            let decided = ok(m.vote(&mut Free, W(me), vote_of(v), now));
            save(id, &m);
            emit("Voted", (id, me, v));
            if let Some(st) = decided {
                emit("Decided", (id, state_code(st)));
            }
        }
        "finalize" => {
            let id: u64 = args.next();
            let mut m = load(id);
            let st = ok(m.finalize(&mut Free, now));
            save(id, &m);
            emit("Decided", (id, state_code(st)));
        }
        "expire" => {
            let id: u64 = args.next();
            let mut m = load(id);
            ok(m.expire(&mut Free, now));
            save(id, &m);
            emit("Decided", (id, state_code(State::Invalid)));
        }
        "claim" => {
            let id: u64 = args.next();
            let mut m = load(id);
            let paid = ok(m.claim(&mut Free, W(me)));
            save(id, &m);
            ret(&paid);
        }
        "send" => {
            let id: u64 = args.next();
            let to: Address = args.next();
            let (o, n): (u64, u64) = (args.next(), args.next());
            let mut m = load(id);
            ok(m.send(W(me), W(to), outcome(o), n));
            save(id, &m);
            emit("Sent", (id, me, to, o, n));
        }
        // ---- views ----
        "count" => ret(&COUNT.get().unwrap_or(0)),
        "free" => {
            let who: Address = args.next();
            ret(&FREE.get(&who).unwrap_or(0));
        }
        "market" => {
            let id: u64 = args.next();
            let m = load(id);
            let title = TITLES.get(&id).unwrap_or_default();
            ret(&(title, m.creator.0, m.close, m.unit, state_code(m.state)));
        }
        "market_more" => {
            let id: u64 = args.next();
            let m = load(id);
            let panel: Vec<Address> = m.panel.iter().map(|p| p.0).collect();
            // two bits per panel member: 0 not voted, 1 Yes, 2 No, 3 Invalid
            let mut votes = 0u64;
            for (i, v) in m.votes.iter().enumerate() {
                votes |= vote_code(*v) << (2 * i);
            }
            ret(&(m.supply, m.pool, panel, votes));
        }
        "resolution" => {
            let id: u64 = args.next();
            let m = load(id);
            let (answer, proposer, at) = match m.proposed() {
                Some((v, who, at)) => (vote_code(Some(v)), who.0, at),
                None => (0, Address::ZERO, 0),
            };
            let (disputer, dat) = match m.disputer() {
                Some((who, at)) => (who.0, at),
                None => (Address::ZERO, 0),
            };
            ret(&(answer, proposer, at, disputer, dat));
        }
        "bond" => {
            // (coins held as bonds right now, the bond each side must lock)
            let id: u64 = args.next();
            let m = load(id);
            ret(&(m.bonds, m.bond()));
        }
        "order_count" => {
            let id: u64 = args.next();
            ret(&(load(id).orders.len() as u64));
        }
        "order_at" => {
            // (order id, owner, kind, price, shares waiting); kind: 0 buy Yes, 1 sell Yes, 2 buy No, 3 sell No;
            // the price is in the terms of that outcome
            let id: u64 = args.next();
            let index: u64 = args.next();
            let m = load(id);
            let o = match m.orders.get(index as usize) {
                Some(o) => o,
                None => revert("no order at that position"),
            };
            let (out, sd, p) = o.describe();
            let kind = (out == Outcome::No) as u64 * 2 + (sd == Side::Sell) as u64;
            ret(&(o.id, o.owner.0, kind, p as u64, o.qty));
        }
        "shares" => {
            let id: u64 = args.next();
            let who: Address = args.next();
            ret(&load(id).shares(&W(who)));
        }
        _ => revert("unknown method"),
    }
}
