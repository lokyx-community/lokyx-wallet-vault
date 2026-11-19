//! A shared LYX account. A fixed group of owners; a payment goes out only when `threshold` of them
//! approve it. Anyone can pay in. The owners and the threshold are set when it is made and never change
//! (to change them, make a new account and move the money with an approved payment).

#![no_std]

use lokyx_sdk::*;

const MAX_OWNERS: usize = 10;
const MAX_NOTE: usize = 140;
const OPEN: u64 = 0;
const SENT: u64 = 1;
const CANCELLED: u64 = 2;

static OWNERS: Item<Vec<Address>> = Item::new(b"owners");
static THRESHOLD: Item<u64> = Item::new(b"threshold");
static NEXT: Item<u64> = Item::new(b"next");
/// id -> (to, amount, note, proposer, state)
static PROPOSALS: Map<u64, (Address, u128, String, Address, u64)> = Map::new(b"p");
static APPROVALS: Map<u64, Vec<Address>> = Map::new(b"a");

fn owners() -> Vec<Address> {
    OWNERS.get().unwrap_or_default()
}
fn threshold() -> u64 {
    THRESHOLD.get().unwrap_or(u64::MAX)
}
fn only_owner() -> Address {
    let me = caller();
    require(owners().contains(&me), "only an owner of this account can do that");
    me
}
fn proposal(id: u64) -> (Address, u128, String, Address, u64) {
    match PROPOSALS.get(&id) {
        Some(p) => p,
        None => revert("no such payment"),
    }
}

/// Sends a proposal once it has enough approvals and the account holds enough. Returns true if it went out.
fn try_send(id: u64) -> bool {
    let (to, amount, note, by, state) = proposal(id);
    if state != OPEN {
        return false;
    }
    let n = APPROVALS.get(&id).unwrap_or_default().len() as u64;
    if n < threshold() || balance(&self_address()) < amount {
        return false;
    }
    PROPOSALS.set(&id, &(to, amount, note, by, SENT));
    send(&to, amount);
    emit("Sent", (id, to, amount));
    true
}

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let mut args = deploy_args();
    let list: Vec<Address> = args.next();
    let t: u64 = args.next();
    require(!list.is_empty() && list.len() <= MAX_OWNERS, "between 1 and 10 owners");
    for (i, a) in list.iter().enumerate() {
        require(*a != Address::ZERO, "an owner can't be the zero address");
        require(!list[..i].contains(a), "an owner is listed twice");
    }
    require(t >= 1 && t <= list.len() as u64, "the number of approvals must be between 1 and the number of owners");
    require(list.contains(&caller()), "whoever makes the account must be one of its owners");
    OWNERS.set(&list);
    THRESHOLD.set(&t);
    NEXT.set(&0);
    emit("Made", (list, t));
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, mut args) = method();
    if method != "deposit" {
        require(value() == 0, "only deposit takes LYX");
    }
    match method.as_str() {
        "deposit" => {
            require(value() > 0, "send some LYX with the call");
            emit("Deposit", (caller(), value()));
        }
        "propose" => {
            let me = only_owner();
            let to: Address = args.next();
            let amount: u128 = args.next();
            let note: String = args.next();
            require(to != Address::ZERO, "pay to a real address");
            require(amount > 0, "the amount must be more than zero");
            require(note.len() <= MAX_NOTE, "the note is too long");
            let id = NEXT.get().unwrap_or(0);
            NEXT.set(&(id + 1));
            PROPOSALS.set(&id, &(to, amount, note, me, OPEN));
            let mut v = Vec::new();
            v.push(me);
            APPROVALS.set(&id, &v);
            emit("Proposed", (id, me, to, amount));
            try_send(id);
            ret(&id);
        }
        "approve" => {
            let me = only_owner();
            let id: u64 = args.next();
            let (_, _, _, _, state) = proposal(id);
            require(state == OPEN, "that payment isn't waiting any more");
            let mut v = APPROVALS.get(&id).unwrap_or_default();
            require(!v.contains(&me), "you already approved it");
            v.push(me);
            APPROVALS.set(&id, &v);
            emit("Approved", (id, me));
            ret(&try_send(id));
        }
        "execute" => {
            only_owner();
            let id: u64 = args.next();
            require(try_send(id), "it needs more approvals, or more LYX in the account");
            ret(&true);
        }
        "revoke" => {
            let me = only_owner();
            let id: u64 = args.next();
            let (_, _, _, _, state) = proposal(id);
            require(state == OPEN, "that payment isn't waiting any more");
            let mut v = APPROVALS.get(&id).unwrap_or_default();
            let before = v.len();
            v.retain(|a| *a != me);
            require(v.len() < before, "you hadn't approved it");
            APPROVALS.set(&id, &v);
            emit("Revoked", (id, me));
        }
        "cancel" => {
            let me = only_owner();
            let id: u64 = args.next();
            let (to, amount, note, by, state) = proposal(id);
            require(state == OPEN, "that payment isn't waiting any more");
            require(by == me, "only whoever proposed it can cancel it");
            PROPOSALS.set(&id, &(to, amount, note, by, CANCELLED));
            emit("Cancelled", (id, me));
        }
        "info" => ret(&(owners(), threshold(), balance(&self_address()), NEXT.get().unwrap_or(0))),
        "proposal" => {
            let id: u64 = args.next();
            ret(&proposal(id));
        }
        "approvals" => {
            let id: u64 = args.next();
            ret(&APPROVALS.get(&id).unwrap_or_default());
        }
        _ => revert("unknown method"),
    }
}
