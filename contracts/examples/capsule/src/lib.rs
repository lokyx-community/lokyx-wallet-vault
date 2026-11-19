//! A time capsule: LYX and a note for someone, sealed until a date. Anyone can add more LYX
//! while it's sealed. On the day, only the person it's for can open it, and the note can only
//! be read from then on.
//!
//! The note is stored as given. LOKYX Wallet locks it with time-based encryption (drand) before
//! sealing, so what's on the chain can't be read by anyone until the day, whoever looks.

#![no_std]

use lokyx_sdk::*;

static FROM: Item<Address> = Item::new(b"from");
static TO: Item<Address> = Item::new(b"to");
static OPENS: Item<u64> = Item::new(b"opens");
static NOTE: Item<String> = Item::new(b"note");
static SEALED: Item<u64> = Item::new(b"sealed");
static OPENED: Item<u64> = Item::new(b"opened");

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let mut args = deploy_args();
    let to: Address = args.next();
    let opens: u64 = args.next();
    let note: String = args.next();
    require(opens > time(), "pick a date in the future");
    require(note.len() <= 4000, "the note can be at most 4000 bytes");
    FROM.set(&caller());
    TO.set(&to);
    OPENS.set(&opens);
    NOTE.set(&note);
    SEALED.set(&time());
    emit("Sealed", (caller(), to, opens, value()));
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, _args) = method();
    let opens = OPENS.get().unwrap_or(0);
    let opened = OPENED.get().unwrap_or(0);
    match method.as_str() {
        "add" => {
            require(value() > 0, "send some LYX with the call");
            require(opened == 0, "this capsule is already open");
            emit("Added", (caller(), value()));
        }
        "open" => {
            require(value() == 0, "open doesn't take LYX");
            let to = TO.get().unwrap_or_default();
            require(caller() == to, "only the person it's for can open it");
            require(opened == 0, "already opened");
            require(time() >= opens, &format!("sealed until {opens}"));
            let all = balance(&self_address());
            OPENED.set(&time());
            if all > 0 {
                send(&to, all);
            }
            emit("Opened", (to, all));
            ret(&all);
        }
        "note" => {
            require(time() >= opens, &format!("sealed until {opens}"));
            ret(&NOTE.get().unwrap_or_default());
        }
        "sealed" => ret(&SEALED.get().unwrap_or(0)),
        "info" => ret(&(
            FROM.get().unwrap_or_default(),
            TO.get().unwrap_or_default(),
            opens,
            OPENED.get().unwrap_or(0),
            balance(&self_address()),
        )),
        _ => revert("unknown method"),
    }
}
