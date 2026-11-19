//! The rules of one yes/no prediction market with an order book. No chain code is in here, so the same
//! rules run in the LOKYX contract (WebAssembly) and are tested natively with plain `cargo test`.
//!
//! How it works, in one paragraph. A pair of shares (one Yes, one No) is backed by `unit` coins locked in the
//! market; whichever side is right is paid `unit` per share. People trade shares at a price of 1 to 99 "cents"
//! of a unit. Everything is a limit order on one book priced in Yes terms: buying No at 38 is the same as
//! selling Yes at 62 without owning any (it locks coins instead of shares), so the book never splits in two.
//! Orders match by price, then by age, at the price of the order that was waiting. When a Yes buyer meets a
//! No buyer, a new pair is made from their coins. When a Yes seller meets a No seller, the pair is destroyed
//! and the coins go back to them. Everything else moves shares or coins between two people.
//!
//! Coins never leave the market during trading: people deposit into a free balance, orders lock from it, and
//! the contract pays out only on a withdrawal. A [`Ledger`] is that free balance.
//!
//! Who decides: a panel chosen when the market is made. After the close, each member votes Yes, No or Invalid.
//! When a majority agrees, a window starts (members may still change their votes); when it ends, anyone can
//! finalize. If nothing is decided 30 days after the close, anyone can expire the market as Invalid. On
//! Invalid every share is worth half a unit.

#![no_std]

extern crate alloc;

use alloc::collections::BTreeMap;
use alloc::vec::Vec;

/// Most resting orders a market keeps. Matching walks the book, so it is kept small on purpose.
pub const MAX_ORDERS: usize = 100;
/// Seconds between a majority forming and the market being final.
pub const WINDOW: u64 = 24 * 3600;
/// Seconds after the close when an undecided market may be expired as Invalid.
pub const EXPIRE_AFTER: u64 = 30 * 24 * 3600;
/// Keeps one market's stored bytes under the chain's 16 KiB value limit: a new order may add at most two
/// holders per order it can fill, so a market must stay clear of this bound to take one.
pub const HOLDER_BOUND: usize = 250;
pub const MIN_PANEL: usize = 3;
pub const MAX_PANEL: usize = 9;

/// Whoever owns shares or coins: an account on the chain.
pub trait Key: Copy + Ord {
    fn put(&self, out: &mut Vec<u8>);
    fn get(r: &mut Reader) -> Option<Self>;
}

/// Free balances of coins, held outside the market (in the contract's storage).
pub trait Ledger<K> {
    fn credit(&mut self, who: K, amount: u128);
    /// Takes `amount` if there is that much; says whether it did.
    fn debit(&mut self, who: K, amount: u128) -> bool;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Yes,
    No,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Buy,
    Sell,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Vote {
    Yes,
    No,
    Invalid,
}
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Open,
    Yes,
    No,
    Invalid,
}

/// What a resting order is, in Yes terms.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    /// buys Yes (bid): locks coins
    Buy,
    /// sells Yes it owns (ask): locks Yes shares
    Sell,
    /// buys No (ask in Yes terms): locks coins
    MintNo,
    /// sells No it owns (bid in Yes terms): locks No shares
    BurnNo,
}
impl Kind {
    fn is_bid(self) -> bool {
        matches!(self, Kind::Buy | Kind::BurnNo)
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Order<K> {
    pub id: u64,
    pub owner: K,
    kind: Kind,
    /// price in Yes terms, 1 to 99
    pub price: u8,
    /// shares still waiting
    pub qty: u64,
    /// coins still locked (Buy and MintNo only)
    pub locked: u128,
}

impl<K> Order<K> {
    /// The person-facing outcome and side of this order, and its price in that outcome's own terms.
    pub fn describe(&self) -> (Outcome, Side, u8) {
        match self.kind {
            Kind::Buy => (Outcome::Yes, Side::Buy, self.price),
            Kind::Sell => (Outcome::Yes, Side::Sell, self.price),
            Kind::MintNo => (Outcome::No, Side::Buy, 100 - self.price),
            Kind::BurnNo => (Outcome::No, Side::Sell, 100 - self.price),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Market<K: Key> {
    pub creator: K,
    pub close: u64,
    /// coins one winning share is worth; a multiple of 100
    pub unit: u128,
    pub panel: Vec<K>,
    pub votes: Vec<Option<Vote>>,
    decided: Option<(Vote, u64)>,
    pub state: State,
    next_id: u64,
    pub orders: Vec<Order<K>>,
    holdings: BTreeMap<K, (u64, u64)>,
    /// pairs of shares in existence (Yes and No supply are always equal)
    pub supply: u64,
    /// coins backing the shares
    pub pool: u128,
}

impl<K: Key> Market<K> {
    pub fn new(creator: K, close: u64, unit: u128, panel: Vec<K>, now: u64) -> Result<Self, &'static str> {
        if unit < 100 || unit % 100 != 0 {
            return Err("the share value must be a multiple of 100 base units");
        }
        if close <= now {
            return Err("the close time must be in the future");
        }
        if panel.len() < MIN_PANEL || panel.len() > MAX_PANEL {
            return Err("the panel needs between 3 and 9 people");
        }
        for (i, p) in panel.iter().enumerate() {
            if panel[..i].contains(p) {
                return Err("a panel member is listed twice");
            }
        }
        let n = panel.len();
        Ok(Market { creator, close, unit, panel, votes: alloc::vec![None; n], decided: None, state: State::Open, next_id: 0, orders: Vec::new(), holdings: BTreeMap::new(), supply: 0, pool: 0 })
    }

    pub fn threshold(&self) -> usize {
        self.panel.len() / 2 + 1
    }
    fn cu(&self) -> u128 {
        self.unit / 100
    }
    pub fn shares(&self, who: &K) -> (u64, u64) {
        self.holdings.get(who).copied().unwrap_or((0, 0))
    }
    fn add_yes(&mut self, who: K, n: u64) {
        self.holdings.entry(who).or_insert((0, 0)).0 += n;
    }
    fn add_no(&mut self, who: K, n: u64) {
        self.holdings.entry(who).or_insert((0, 0)).1 += n;
    }
    fn take_yes(&mut self, who: K, n: u64) -> bool {
        match self.holdings.get_mut(&who) {
            Some(h) if h.0 >= n => {
                h.0 -= n;
                true
            }
            _ => false,
        }
    }
    fn take_no(&mut self, who: K, n: u64) -> bool {
        match self.holdings.get_mut(&who) {
            Some(h) if h.1 >= n => {
                h.1 -= n;
                true
            }
            _ => false,
        }
    }

    /// Places a limit order and matches it straight away against what is waiting. `price` is in the terms of
    /// `outcome` (62 means 62 cents of a unit per share). Returns the order's id.
    pub fn place<L: Ledger<K>>(&mut self, led: &mut L, owner: K, outcome: Outcome, side: Side, price: u8, qty: u64, now: u64) -> Result<u64, &'static str> {
        if self.state != State::Open || now >= self.close {
            return Err("this market is not taking orders");
        }
        if !(1..=99).contains(&price) {
            return Err("the price must be between 1 and 99");
        }
        if qty == 0 {
            return Err("buy or sell at least one share");
        }
        if self.orders.len() >= MAX_ORDERS {
            return Err("too many orders are waiting in this market");
        }
        if self.holdings.len() + 2 * (self.orders.len() + 1) > HOLDER_BOUND {
            return Err("this market is full of traders; no new orders");
        }
        let cu = self.cu();
        let (kind, yp) = match (outcome, side) {
            (Outcome::Yes, Side::Buy) => (Kind::Buy, price),
            (Outcome::Yes, Side::Sell) => (Kind::Sell, price),
            (Outcome::No, Side::Buy) => (Kind::MintNo, 100 - price),
            (Outcome::No, Side::Sell) => (Kind::BurnNo, 100 - price),
        };
        let mut locked = 0u128;
        match kind {
            Kind::Buy | Kind::MintNo => {
                locked = (price as u128) * (qty as u128) * cu;
                if !led.debit(owner, locked) {
                    return Err("not enough coins deposited");
                }
            }
            Kind::Sell => {
                if !self.take_yes(owner, qty) {
                    return Err("you don't hold that many Yes shares");
                }
            }
            Kind::BurnNo => {
                if !self.take_no(owner, qty) {
                    return Err("you don't hold that many No shares");
                }
            }
        }
        let id = self.next_id;
        self.next_id += 1;
        let mut o = Order { id, owner, kind, price: yp, qty, locked };
        self.match_order(led, &mut o);
        if o.qty > 0 {
            self.orders.push(o);
        }
        Ok(id)
    }

    fn best_resting(&self, incoming: &Order<K>) -> Option<usize> {
        let mut best: Option<usize> = None;
        for (i, r) in self.orders.iter().enumerate() {
            if r.kind.is_bid() == incoming.kind.is_bid() {
                continue;
            }
            let crosses = if incoming.kind.is_bid() { r.price <= incoming.price } else { r.price >= incoming.price };
            if !crosses {
                continue;
            }
            best = match best {
                None => Some(i),
                Some(b) => {
                    let cur = &self.orders[b];
                    let better = if incoming.kind.is_bid() {
                        r.price < cur.price || (r.price == cur.price && r.id < cur.id)
                    } else {
                        r.price > cur.price || (r.price == cur.price && r.id < cur.id)
                    };
                    if better { Some(i) } else { Some(b) }
                }
            };
        }
        best
    }

    fn match_order<L: Ledger<K>>(&mut self, led: &mut L, inc: &mut Order<K>) {
        let cu = self.cu();
        while inc.qty > 0 {
            let Some(i) = self.best_resting(inc) else { break };
            let mut rest = self.orders[i].clone();
            let q = inc.qty.min(rest.qty);
            let t = rest.price as u128; // trade at the price of the order that was waiting
            let qq = q as u128;
            let (bid, ask) = if inc.kind.is_bid() { (&mut *inc, &mut rest) } else { (&mut rest, &mut *inc) };
            match (bid.kind, ask.kind) {
                (Kind::Buy, Kind::Sell) => {
                    led.credit(ask.owner, t * qq * cu);
                    let (b, _) = (bid.owner, ());
                    self.add_yes(b, q);
                }
                (Kind::Buy, Kind::MintNo) => {
                    self.add_yes(bid.owner, q);
                    self.add_no(ask.owner, q);
                    self.supply += q;
                    self.pool += 100 * qq * cu;
                }
                (Kind::BurnNo, Kind::Sell) => {
                    led.credit(ask.owner, t * qq * cu);
                    led.credit(bid.owner, (100 - t) * qq * cu);
                    self.supply -= q;
                    self.pool -= 100 * qq * cu;
                }
                (Kind::BurnNo, Kind::MintNo) => {
                    led.credit(bid.owner, (100 - t) * qq * cu);
                    self.add_no(ask.owner, q);
                }
                _ => unreachable!(),
            }
            // coins locked by a buyer: pay what was due at the trade price, give back any difference
            if bid.kind == Kind::Buy {
                let held = (bid.price as u128) * qq * cu;
                bid.locked -= held;
                led.credit(bid.owner, held - t * qq * cu);
            }
            if ask.kind == Kind::MintNo {
                let held = (100 - ask.price as u128) * qq * cu;
                ask.locked -= held;
                led.credit(ask.owner, held - (100 - t) * qq * cu);
            }
            bid.qty -= q;
            ask.qty -= q;
            // `inc` was one of the two; write the resting one back
            if inc.kind.is_bid() {
                // rest was the ask
                if rest.qty == 0 {
                    self.orders.remove(i);
                } else {
                    self.orders[i] = rest;
                }
            } else if rest.qty == 0 {
                self.orders.remove(i);
            } else {
                self.orders[i] = rest;
            }
        }
    }

    /// Takes one of your waiting orders off the book and gives back what it locked.
    pub fn cancel<L: Ledger<K>>(&mut self, led: &mut L, who: K, id: u64) -> Result<(), &'static str> {
        let i = self.orders.iter().position(|o| o.id == id).ok_or("no such order")?;
        if self.orders[i].owner != who {
            return Err("that order isn't yours");
        }
        let o = self.orders.remove(i);
        self.refund(led, o);
        Ok(())
    }

    fn refund<L: Ledger<K>>(&mut self, led: &mut L, o: Order<K>) {
        match o.kind {
            Kind::Buy | Kind::MintNo => led.credit(o.owner, o.locked),
            Kind::Sell => self.add_yes(o.owner, o.qty),
            Kind::BurnNo => self.add_no(o.owner, o.qty),
        }
    }

    /// A panel member's vote, after the close. Can be changed until the market is final.
    pub fn vote(&mut self, who: K, v: Vote, now: u64) -> Result<(), &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        if now < self.close {
            return Err("voting opens when the market closes");
        }
        let i = self.panel.iter().position(|p| *p == who).ok_or("only the panel can vote")?;
        self.votes[i] = Some(v);
        let need = self.threshold();
        let count = |x: Vote| self.votes.iter().filter(|y| **y == Some(x)).count();
        let winner = [Vote::Yes, Vote::No, Vote::Invalid].into_iter().find(|x| count(*x) >= need);
        self.decided = match (winner, self.decided) {
            (Some(w), Some((d, at))) if w == d => Some((d, at)),
            (Some(w), _) => Some((w, now)),
            (None, _) => None,
        };
        Ok(())
    }

    /// Makes the panel's decision final once the window has passed. Anyone can call it.
    pub fn finalize(&mut self, now: u64) -> Result<State, &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        let (v, at) = self.decided.ok_or("the panel has not agreed yet")?;
        if now < at + WINDOW {
            return Err("the objection window is still open");
        }
        self.state = match v {
            Vote::Yes => State::Yes,
            Vote::No => State::No,
            Vote::Invalid => State::Invalid,
        };
        Ok(self.state)
    }

    /// Ends an undecided market as Invalid, long after the close, so coins are never stuck for ever.
    pub fn expire(&mut self, now: u64) -> Result<(), &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        if now < self.close + EXPIRE_AFTER {
            return Err("not yet: the panel still has time");
        }
        self.state = State::Invalid;
        Ok(())
    }

    /// After the market is decided: cancels your waiting orders and pays out your shares into your free balance.
    pub fn claim<L: Ledger<K>>(&mut self, led: &mut L, who: K) -> Result<u128, &'static str> {
        if self.state == State::Open {
            return Err("this market is not decided yet");
        }
        let mine: Vec<u64> = self.orders.iter().filter(|o| o.owner == who).map(|o| o.id).collect();
        for id in mine {
            self.cancel(led, who, id)?;
        }
        let (y, n) = self.holdings.remove(&who).unwrap_or((0, 0));
        let pay = match self.state {
            State::Yes => (y as u128) * self.unit,
            State::No => (n as u128) * self.unit,
            State::Invalid => ((y as u128) + (n as u128)) * (self.unit / 2),
            State::Open => 0,
        };
        self.pool -= pay;
        led.credit(who, pay);
        Ok(pay)
    }

    // ---------- storing a market ----------

    pub fn encode(&self) -> Vec<u8> {
        let mut o = Vec::new();
        self.creator.put(&mut o);
        o.extend_from_slice(&self.close.to_le_bytes());
        o.extend_from_slice(&self.unit.to_le_bytes());
        o.extend_from_slice(&(self.panel.len() as u32).to_le_bytes());
        for (p, v) in self.panel.iter().zip(&self.votes) {
            p.put(&mut o);
            o.push(match v {
                None => 0,
                Some(Vote::Yes) => 1,
                Some(Vote::No) => 2,
                Some(Vote::Invalid) => 3,
            });
        }
        match self.decided {
            None => o.push(0),
            Some((v, at)) => {
                o.push(match v {
                    Vote::Yes => 1,
                    Vote::No => 2,
                    Vote::Invalid => 3,
                });
                o.extend_from_slice(&at.to_le_bytes());
            }
        }
        o.push(match self.state {
            State::Open => 0,
            State::Yes => 1,
            State::No => 2,
            State::Invalid => 3,
        });
        o.extend_from_slice(&self.next_id.to_le_bytes());
        o.extend_from_slice(&self.supply.to_le_bytes());
        o.extend_from_slice(&self.pool.to_le_bytes());
        o.extend_from_slice(&(self.orders.len() as u32).to_le_bytes());
        for x in &self.orders {
            o.extend_from_slice(&x.id.to_le_bytes());
            x.owner.put(&mut o);
            o.push(match x.kind {
                Kind::Buy => 0,
                Kind::Sell => 1,
                Kind::MintNo => 2,
                Kind::BurnNo => 3,
            });
            o.push(x.price);
            o.extend_from_slice(&x.qty.to_le_bytes());
            o.extend_from_slice(&x.locked.to_le_bytes());
        }
        o.extend_from_slice(&(self.holdings.len() as u32).to_le_bytes());
        for (k, (y, n)) in &self.holdings {
            k.put(&mut o);
            o.extend_from_slice(&y.to_le_bytes());
            o.extend_from_slice(&n.to_le_bytes());
        }
        o
    }

    pub fn decode(bytes: &[u8]) -> Option<Self> {
        let mut r = Reader { d: bytes, p: 0 };
        let creator = K::get(&mut r)?;
        let close = r.u64()?;
        let unit = r.u128()?;
        let np = r.u32()? as usize;
        if np > MAX_PANEL {
            return None;
        }
        let mut panel = Vec::new();
        let mut votes = Vec::new();
        for _ in 0..np {
            panel.push(K::get(&mut r)?);
            votes.push(match r.u8()? {
                0 => None,
                1 => Some(Vote::Yes),
                2 => Some(Vote::No),
                3 => Some(Vote::Invalid),
                _ => return None,
            });
        }
        let vote_of = |b: u8| match b {
            1 => Some(Vote::Yes),
            2 => Some(Vote::No),
            3 => Some(Vote::Invalid),
            _ => None,
        };
        let decided = match r.u8()? {
            0 => None,
            b => Some((vote_of(b)?, r.u64()?)),
        };
        let state = match r.u8()? {
            0 => State::Open,
            1 => State::Yes,
            2 => State::No,
            3 => State::Invalid,
            _ => return None,
        };
        let next_id = r.u64()?;
        let supply = r.u64()?;
        let pool = r.u128()?;
        let no = r.u32()? as usize;
        if no > MAX_ORDERS {
            return None;
        }
        let mut orders = Vec::new();
        for _ in 0..no {
            let id = r.u64()?;
            let owner = K::get(&mut r)?;
            let kind = match r.u8()? {
                0 => Kind::Buy,
                1 => Kind::Sell,
                2 => Kind::MintNo,
                3 => Kind::BurnNo,
                _ => return None,
            };
            let price = r.u8()?;
            let qty = r.u64()?;
            let locked = r.u128()?;
            orders.push(Order { id, owner, kind, price, qty, locked });
        }
        let nh = r.u32()? as usize;
        let mut holdings = BTreeMap::new();
        for _ in 0..nh {
            let k = K::get(&mut r)?;
            holdings.insert(k, (r.u64()?, r.u64()?));
        }
        if r.p != bytes.len() {
            return None;
        }
        Some(Market { creator, close, unit, panel, votes, decided, state, next_id, orders, holdings, supply, pool })
    }

    /// Sum of coins locked in waiting orders (for checks).
    pub fn locked_total(&self) -> u128 {
        self.orders.iter().map(|o| o.locked).sum()
    }
}

pub struct Reader<'a> {
    d: &'a [u8],
    p: usize,
}
impl<'a> Reader<'a> {
    pub fn new(d: &'a [u8]) -> Self {
        Reader { d, p: 0 }
    }
    pub fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let e = self.p.checked_add(n)?;
        let s = self.d.get(self.p..e)?;
        self.p = e;
        Some(s)
    }
    pub fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    pub fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }
    pub fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }
    pub fn u128(&mut self) -> Option<u128> {
        Some(u128::from_le_bytes(self.take(16)?.try_into().ok()?))
    }
}

#[cfg(test)]
extern crate std;
#[cfg(test)]
mod tests;
