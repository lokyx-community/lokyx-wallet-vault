//! The swap offer board. A maker posts an offer code; a taker who wants it posts an acceptance code
//! under it; the maker picks one up and the swap goes on as usual. The board only stores text: it never
//! holds or moves coins, and what the codes say is checked by the wallets, not here.

#![no_std]

use lokyx_sdk::*;

const MAX_CODE: usize = 2048;
const MAX_ANSWERS: u64 = 20;

static COUNT: Item<u64> = Item::new(b"count");
/// id -> (maker, offer code, expires at height, open)
static OFFERS: Map<u64, (Address, String, u64, bool)> = Map::new(b"o");
static ANSWER_COUNT: Map<u64, u64> = Map::new(b"n");
/// (offer id, n) -> (taker, acceptance code)
static ANSWERS: Map<(u64, u64), (Address, String)> = Map::new(b"a");

fn offer(id: u64) -> (Address, String, u64, bool) {
    match OFFERS.get(&id) {
        Some(o) => o,
        None => revert("no such offer"),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    COUNT.set(&0);
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, mut args) = method();
    require(value() == 0, "the board doesn't take LYX");
    match method.as_str() {
        "post" => {
            let code: String = args.next();
            let expires: u64 = args.next();
            require(!code.is_empty() && code.len() <= MAX_CODE, "the offer code is empty or too long");
            require(expires > height(), "the offer would already be over");
            let id = COUNT.get().unwrap_or(0);
            COUNT.set(&(id + 1));
            let me = caller();
            OFFERS.set(&id, &(me, code, expires, true));
            emit("Posted", (id, me, expires));
            ret(&id);
        }
        "answer" => {
            let id: u64 = args.next();
            let code: String = args.next();
            let (maker, _, expires, open) = offer(id);
            require(open && height() < expires, "that offer is closed");
            let me = caller();
            require(me != maker, "you can't take your own offer");
            require(!code.is_empty() && code.len() <= MAX_CODE, "the acceptance code is empty or too long");
            let n = ANSWER_COUNT.get(&id).unwrap_or(0);
            require(n < MAX_ANSWERS, "that offer has enough answers already");
            ANSWERS.set(&(id, n), &(me, code));
            ANSWER_COUNT.set(&id, &(n + 1));
            emit("Answered", (id, me));
            ret(&n);
        }
        "close" => {
            let id: u64 = args.next();
            let (maker, code, expires, _) = offer(id);
            require(caller() == maker, "only whoever posted it can close it");
            OFFERS.set(&id, &(maker, code, expires, false));
            emit("Closed", id);
        }
        "count" => ret(&COUNT.get().unwrap_or(0)),
        "offer" => {
            let id: u64 = args.next();
            let (maker, code, expires, open) = offer(id);
            ret(&(maker, code, expires, open && height() < expires, ANSWER_COUNT.get(&id).unwrap_or(0)));
        }
        "answer_at" => {
            let id: u64 = args.next();
            let n: u64 = args.next();
            match ANSWERS.get(&(id, n)) {
                Some(a) => ret(&a),
                None => revert("no such answer"),
            }
        }
        _ => revert("unknown method"),
    }
}
