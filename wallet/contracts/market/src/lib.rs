//! Yes/no prediction markets with an order book, paid in LYX. One contract holds every market; the rules
//! live in `market-engine` (tested natively). People deposit LYX into a free balance, trade with it, and
//! withdraw. The contract only ever sends LYX out on `withdraw`.

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
fn outcome(b: u8) -> Outcome {
    match b {
        0 => Outcome::Yes,
        1 => Outcome::No,
        _ => revert("outcome is 0 (Yes) or 1 (No)"),
    }
}
fn side(b: u8) -> Side {
    match b {
        0 => Side::Buy,
        1 => Side::Sell,
        _ => revert("side is 0 (buy) or 1 (sell)"),
    }
}
fn vote_of(b: u8) -> Vote {
    match b {
        0 => Vote::Yes,
        1 => Vote::No,
        2 => Vote::Invalid,
        _ => revert("vote is 0 (Yes), 1 (No) or 2 (Invalid)"),
    }
}
fn state_byte(s: State) -> u8 {
    match s {
        State::Open => 0,
        State::Yes => 1,
        State::No => 2,
        State::Invalid => 3,
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
            let (o, s, price, qty): (u8, u8, u8, u64) = (args.next(), args.next(), args.next(), args.next());
            let mut m = load(id);
            let oid = ok(m.place(&mut Free, W(me), outcome(o), side(s), price, qty, now));
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
        "vote" => {
            let id: u64 = args.next();
            let v: u8 = args.next();
            let mut m = load(id);
            ok(m.vote(W(me), vote_of(v), now));
            save(id, &m);
            emit("Voted", (id, me, v));
        }
        "finalize" => {
            let id: u64 = args.next();
            let mut m = load(id);
            let st = ok(m.finalize(now));
            save(id, &m);
            emit("Decided", (id, state_byte(st)));
        }
        "expire" => {
            let id: u64 = args.next();
            let mut m = load(id);
            ok(m.expire(now));
            save(id, &m);
            emit("Decided", (id, 3u8));
        }
        "claim" => {
            let id: u64 = args.next();
            let mut m = load(id);
            let paid = ok(m.claim(&mut Free, W(me)));
            save(id, &m);
            ret(&paid);
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
            let panel: Vec<Address> = m.panel.iter().map(|p| p.0).collect();
            let votes: Vec<u8> = m
                .votes
                .iter()
                .map(|v| match v {
                    None => 255,
                    Some(Vote::Yes) => 0,
                    Some(Vote::No) => 1,
                    Some(Vote::Invalid) => 2,
                })
                .collect();
            // nested tuples encode to the same bytes as one flat list (the SDK stops at five)
            ret(&((title, m.creator.0, m.close, m.unit, state_byte(m.state)), (m.supply, m.pool, panel, votes)));
        }
        "book" => {
            let id: u64 = args.next();
            let m = load(id);
            let rows: Vec<((u64, Address, u8), (u8, u8, u64))> = m
                .orders
                .iter()
                .map(|o| {
                    let (out, sd, p) = o.describe();
                    ((o.id, o.owner.0, (out == Outcome::No) as u8), (( sd == Side::Sell) as u8, p, o.qty))
                })
                .collect();
            ret(&rows);
        }
        "shares" => {
            let id: u64 = args.next();
            let who: Address = args.next();
            ret(&load(id).shares(&W(who)));
        }
        _ => revert("unknown method"),
    }
}
