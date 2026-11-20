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
//! Who decides, the way an optimistic oracle does it. After the close anyone can propose the answer (Yes, No or
//! Invalid) and lock a bond. For a day anyone can dispute it by locking an equal bond. If nobody does, anyone can
//! finalize and the proposer gets the bond back. A dispute goes to the panel chosen when the market was made: when
//! a majority of the panel agrees, that is final, and whoever the panel sided with takes both bonds. If nobody
//! proposes, or the panel never settles a dispute, anyone can expire the market as Invalid 30 days later (bonds
//! are returned). On Invalid every share is worth half a unit.

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
/// How many shares' worth of coins the proposer, and a disputer, must lock as a bond.
pub const BOND_SHARES: u128 = 20;
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
    /// the proposed answer, who proposed it and when
    proposed: Option<(Vote, K, u64)>,
    /// who disputed it and when
    disputer: Option<(K, u64)>,
    /// coins held as bonds
    pub bonds: u128,
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
        Ok(Market { creator, close, unit, panel, votes: alloc::vec![None; n], proposed: None, disputer: None, bonds: 0, state: State::Open, next_id: 0, orders: Vec::new(), holdings: BTreeMap::new(), supply: 0, pool: 0 })
    }

    pub fn threshold(&self) -> usize {
        self.panel.len() / 2 + 1
    }
    fn cu(&self) -> u128 {
        self.unit / 100
    }
    pub fn bond(&self) -> u128 {
        self.unit * BOND_SHARES
    }
    pub fn proposed(&self) -> Option<(Vote, K, u64)> {
        self.proposed
    }
    pub fn disputer(&self) -> Option<(K, u64)> {
        self.disputer
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
        // A full book still takes an order that can trade. One that can't must be priced better than the worst order
        // waiting on its own side, which it then pushes out. This is settled before anything is changed.
        let probe = Order { id: self.next_id, owner, kind, price: yp, qty, locked: 0 };
        if self.orders.len() >= MAX_ORDERS && self.best_resting(&probe).is_none() && self.worse_waiting(&probe).is_none() {
            return Err("the book is full of better-priced orders");
        }
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
            if self.orders.len() >= MAX_ORDERS {
                // A trade always frees a slot, so this only happens to an order that could not trade at all.
                match self.worse_waiting(&o) {
                    Some(w) => {
                        let pushed_out = self.orders.remove(w);
                        self.refund(led, pushed_out);
                    }
                    None => {
                        // not reachable after the check above; if it ever were, give everything back
                        self.refund(led, o);
                        return Ok(id);
                    }
                }
            }
            self.orders.push(o);
        }
        Ok(id)
    }

    /// The worst order waiting on the same side as `inc`, if `inc` is strictly better priced than it.
    /// The worst bid has the lowest price and the worst ask the highest; among equals the newest is the worst.
    fn worse_waiting(&self, inc: &Order<K>) -> Option<usize> {
        let mut worst: Option<usize> = None;
        for (i, r) in self.orders.iter().enumerate() {
            if r.kind.is_bid() != inc.kind.is_bid() {
                continue;
            }
            worst = match worst {
                None => Some(i),
                Some(w) => {
                    let cur = &self.orders[w];
                    let worse = if inc.kind.is_bid() {
                        r.price < cur.price || (r.price == cur.price && r.id > cur.id)
                    } else {
                        r.price > cur.price || (r.price == cur.price && r.id > cur.id)
                    };
                    if worse { Some(i) } else { Some(w) }
                }
            };
        }
        let w = worst?;
        let better = if inc.kind.is_bid() { inc.price > self.orders[w].price } else { inc.price < self.orders[w].price };
        if better { Some(w) } else { None }
    }

    /// Sends some of your shares to someone else. Shares waiting in a sell order can't be sent: cancel first.
    pub fn send(&mut self, from: K, to: K, outcome: Outcome, n: u64) -> Result<(), &'static str> {
        if from == to {
            return Err("you can't send shares to yourself");
        }
        if n == 0 {
            return Err("send at least one share");
        }
        let have = match outcome {
            Outcome::Yes => self.shares(&from).0,
            Outcome::No => self.shares(&from).1,
        };
        if have < n {
            return Err("you don't hold that many shares");
        }
        if !self.holdings.contains_key(&to) && self.holdings.len() + 2 * self.orders.len() + 2 > HOLDER_BOUND {
            return Err("this market is full of traders; no new holders");
        }
        match outcome {
            Outcome::Yes => {
                self.take_yes(from, n);
                self.add_yes(to, n);
            }
            Outcome::No => {
                self.take_no(from, n);
                self.add_no(to, n);
            }
        }
        Ok(())
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

    fn state_of(v: Vote) -> State {
        match v {
            Vote::Yes => State::Yes,
            Vote::No => State::No,
            Vote::Invalid => State::Invalid,
        }
    }

    /// Step 1. After the close anyone can propose the answer and lock a bond from their free coins.
    pub fn propose<L: Ledger<K>>(&mut self, led: &mut L, who: K, v: Vote, now: u64) -> Result<(), &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        if now < self.close {
            return Err("answers open when the market closes");
        }
        if self.proposed.is_some() {
            return Err("an answer has already been proposed");
        }
        let b = self.bond();
        if !led.debit(who, b) {
            return Err("not enough free coins for the bond");
        }
        self.bonds += b;
        self.proposed = Some((v, who, now));
        Ok(())
    }

    /// Step 2, if someone thinks the answer is wrong: inside the window, with an equal bond. The panel then decides.
    pub fn dispute<L: Ledger<K>>(&mut self, led: &mut L, who: K, now: u64) -> Result<(), &'static str> {
        let (_, proposer, at) = match (self.state, self.proposed) {
            (State::Open, Some(p)) => p,
            _ => return Err("there is no answer to dispute"),
        };
        if self.disputer.is_some() {
            return Err("already disputed");
        }
        if who == proposer {
            return Err("you can't dispute your own answer");
        }
        if now >= at + WINDOW {
            return Err("the challenge window is over: finalize it");
        }
        let b = self.bond();
        if !led.debit(who, b) {
            return Err("not enough free coins for the bond");
        }
        self.bonds += b;
        self.disputer = Some((who, now));
        Ok(())
    }

    /// Step 3 when nobody disputed: once the window has passed anyone can call it; the proposer's bond goes back.
    pub fn finalize<L: Ledger<K>>(&mut self, led: &mut L, now: u64) -> Result<State, &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        let (v, proposer, at) = match (self.proposed, self.disputer) {
            (Some(p), None) => p,
            _ => return Err("there is no undisputed answer"),
        };
        if now < at + WINDOW {
            return Err("the challenge window is still open");
        }
        let b = self.bond();
        self.bonds -= b;
        led.credit(proposer, b);
        self.state = Self::state_of(v);
        Ok(self.state)
    }

    /// Step 3 when someone disputed: a panel member's vote, changeable until a majority agrees. That majority is
    /// final: whoever it sided with (the proposer if it matches the proposal, the disputer if not) takes both bonds.
    pub fn vote<L: Ledger<K>>(&mut self, led: &mut L, who: K, v: Vote, _now: u64) -> Result<Option<State>, &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        let ((pv, proposer, _), (disputer, _)) = match (self.proposed, self.disputer) {
            (Some(p), Some(d)) => (p, d),
            _ => return Err("the panel only decides disputed answers"),
        };
        let i = self.panel.iter().position(|p| *p == who).ok_or("only the panel can vote")?;
        self.votes[i] = Some(v);
        let need = self.threshold();
        let count = |x: Vote| self.votes.iter().filter(|y| **y == Some(x)).count();
        let winner = [Vote::Yes, Vote::No, Vote::Invalid].into_iter().find(|x| count(*x) >= need);
        let Some(w) = winner else { return Ok(None) };
        let b = self.bond();
        self.bonds -= 2 * b;
        led.credit(if w == pv { proposer } else { disputer }, 2 * b);
        self.state = Self::state_of(w);
        Ok(Some(self.state))
    }

    /// Ends a stuck market as Invalid so coins are never held for ever: no answer 30 days after the close, or a
    /// dispute the panel did not settle within 30 days (both bonds go back). A pending undisputed answer can't be
    /// overridden: it has to be finalized or disputed.
    pub fn expire<L: Ledger<K>>(&mut self, led: &mut L, now: u64) -> Result<(), &'static str> {
        if self.state != State::Open {
            return Err("this market is already decided");
        }
        if let Some((disputer, at)) = self.disputer {
            if now < at + EXPIRE_AFTER {
                return Err("not yet: the panel still has time");
            }
            let proposer = self.proposed.map(|p| p.1).ok_or("not yet: the panel still has time")?;
            let b = self.bond();
            self.bonds -= 2 * b;
            led.credit(proposer, b);
            led.credit(disputer, b);
        } else {
            if self.proposed.is_some() {
                return Err("an answer is waiting: finalize it or dispute it");
            }
            if now < self.close + EXPIRE_AFTER {
                return Err("not yet: there is still time to propose");
            }
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
        match self.proposed {
            None => o.push(0),
            Some((v, who, at)) => {
                o.push(match v {
                    Vote::Yes => 1,
                    Vote::No => 2,
                    Vote::Invalid => 3,
                });
                who.put(&mut o);
                o.extend_from_slice(&at.to_le_bytes());
            }
        }
        match self.disputer {
            None => o.push(0),
            Some((who, at)) => {
                o.push(1);
                who.put(&mut o);
                o.extend_from_slice(&at.to_le_bytes());
            }
        }
        o.extend_from_slice(&self.bonds.to_le_bytes());
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
        let proposed = match r.u8()? {
            0 => None,
            b => Some((vote_of(b)?, K::get(&mut r)?, r.u64()?)),
        };
        let disputer = match r.u8()? {
            0 => None,
            1 => Some((K::get(&mut r)?, r.u64()?)),
            _ => return None,
        };
        let bonds = r.u128()?;
        if disputer.is_some() && proposed.is_none() {
            return None;
        }
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
        Some(Market { creator, close, unit, panel, votes, proposed, disputer, bonds, state, next_id, orders, holdings, supply, pool })
    }

    /// What the market's coins are made of, for checks: the pool, coins locked in waiting orders, and bonds.
    pub fn held_total(&self) -> u128 {
        self.pool + self.locked_total() + self.bonds
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
