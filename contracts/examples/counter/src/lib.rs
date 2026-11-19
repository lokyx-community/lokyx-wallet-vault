//! The smallest useful contract: a number anyone can add one to.

#![no_std]

use lokyx_sdk::*;

static COUNT: Item<u64> = Item::new(b"count");

/// Runs once, when the contract is deployed: start from the number given.
#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let mut args = deploy_args();
    let start: u64 = args.next();
    COUNT.set(&start);
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, _args) = method();
    match method.as_str() {
        "increment" => {
            let n = COUNT.get().unwrap_or(0) + 1;
            COUNT.set(&n);
            emit("Incremented", (caller(), n));
            ret(&n);
        }
        "get" => ret(&COUNT.get().unwrap_or(0)),
        _ => revert("unknown method"),
    }
}
