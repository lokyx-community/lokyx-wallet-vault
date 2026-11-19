//! Holds a token for someone until a block height: a team's share, or a vesting cliff. Send the tokens to
//! this contract's address with the token's own transfer; after `unlock`, anyone can call `release` and they
//! all go to the beneficiary. Nobody, including whoever made it, can take them out earlier.

#![no_std]

use lokyx_sdk::*;

static TOKEN: Item<Address> = Item::new(b"token");
static BENEFICIARY: Item<Address> = Item::new(b"to");
static UNLOCK: Item<u64> = Item::new(b"unlock");

fn held(token: &Address) -> u128 {
    let me = self_address();
    match lokyx_sdk::call(token, &encode_call("balance_of", (me,)), 0) {
        Ok(out) => u128::decode(&out).unwrap_or(0),
        Err(_) => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let mut args = deploy_args();
    let token: Address = args.next();
    let to: Address = args.next();
    let unlock: u64 = args.next();
    require(token != Address::ZERO && to != Address::ZERO, "token and beneficiary must be real addresses");
    require(unlock > height(), "the unlock height has already passed");
    TOKEN.set(&token);
    BENEFICIARY.set(&to);
    UNLOCK.set(&unlock);
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, _args) = method();
    require(value() == 0, "this contract doesn't take LYX");
    let token = TOKEN.get().unwrap_or_default();
    let to = BENEFICIARY.get().unwrap_or_default();
    let unlock = UNLOCK.get().unwrap_or(u64::MAX);
    match method.as_str() {
        "release" => {
            require(height() >= unlock, &format!("locked until block {unlock}"));
            let amount = held(&token);
            require(amount > 0, "nothing to release");
            if let Err(e) = lokyx_sdk::call(&token, &encode_call("transfer", (to, amount)), 0) {
                revert(&e);
            }
            emit("Released", (to, amount));
            ret(&amount);
        }
        "info" => ret(&(token, to, unlock, held(&token))),
        _ => revert("unknown method"),
    }
}
