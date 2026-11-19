//! A savings jar: anyone can put LYX in, only the owner can take it out, and not before a
//! block height chosen at deploy.

#![no_std]

use lokyx_sdk::*;

static OWNER: Item<Address> = Item::new(b"owner");
static UNLOCK: Item<u64> = Item::new(b"unlock");

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let mut args = deploy_args();
    let unlock: u64 = args.next();
    OWNER.set(&caller());
    UNLOCK.set(&unlock);
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, _args) = method();
    match method.as_str() {
        "deposit" => {
            require(value() > 0, "send some LYX with the call");
            emit("Deposit", (caller(), value()));
        }
        "withdraw" => {
            require(value() == 0, "withdraw doesn't take LYX");
            let owner = OWNER.get().unwrap_or_default();
            require(caller() == owner, "only the owner can withdraw");
            let unlock = UNLOCK.get().unwrap_or(0);
            require(height() >= unlock, &format!("locked until block {unlock}"));
            let all = balance(&self_address());
            send(&owner, all);
            emit("Withdraw", (owner, all));
            ret(&all);
        }
        "info" => ret(&(OWNER.get().unwrap_or_default(), UNLOCK.get().unwrap_or(0), balance(&self_address()))),
        _ => revert("unknown method"),
    }
}
