//! A token: a fixed supply made at deploy, sent between accounts, with allowances so another
//! account or contract can spend on someone's behalf (the same shape as ERC-20).

#![no_std]

use lokyx_sdk::*;

static NAME: Item<String> = Item::new(b"name");
static SYMBOL: Item<String> = Item::new(b"symbol");
static SUPPLY: Item<u128> = Item::new(b"supply");
static BALANCES: Map<Address, u128> = Map::new(b"bal");
static ALLOWANCES: Map<(Address, Address), u128> = Map::new(b"allow");

fn balance_of(a: &Address) -> u128 {
    BALANCES.get(a).unwrap_or(0)
}

fn move_tokens(from: &Address, to: &Address, amount: u128) {
    let have = balance_of(from);
    require(have >= amount, "not enough tokens");
    BALANCES.set(from, &(have - amount));
    BALANCES.set(to, &(balance_of(to) + amount));
    emit("Transfer", (from, to, amount));
}

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let mut args = deploy_args();
    let name: String = args.next();
    let symbol: String = args.next();
    let supply: u128 = args.next();
    require(!name.is_empty() && symbol.len() <= 12, "bad name or symbol");
    NAME.set(&name);
    SYMBOL.set(&symbol);
    SUPPLY.set(&supply);
    let creator = caller();
    BALANCES.set(&creator, &supply);
    emit("Transfer", (Address::ZERO, creator, supply));
}

#[unsafe(no_mangle)]
pub extern "C" fn call() {
    let (method, mut args) = method();
    require(value() == 0, "this contract doesn't take LYX");
    match method.as_str() {
        "name" => ret(&NAME.get().unwrap_or_default()),
        "symbol" => ret(&SYMBOL.get().unwrap_or_default()),
        "decimals" => ret(&18u8),
        "total_supply" => ret(&SUPPLY.get().unwrap_or(0)),
        "balance_of" => {
            let who: Address = args.next();
            ret(&balance_of(&who));
        }
        "transfer" => {
            let to: Address = args.next();
            let amount: u128 = args.next();
            move_tokens(&caller(), &to, amount);
            ret(&true);
        }
        "approve" => {
            let spender: Address = args.next();
            let amount: u128 = args.next();
            let owner = caller();
            ALLOWANCES.set(&(owner, spender), &amount);
            emit("Approval", (owner, spender, amount));
            ret(&true);
        }
        "allowance" => {
            let owner: Address = args.next();
            let spender: Address = args.next();
            ret(&ALLOWANCES.get(&(owner, spender)).unwrap_or(0));
        }
        "transfer_from" => {
            let owner: Address = args.next();
            let to: Address = args.next();
            let amount: u128 = args.next();
            let spender = caller();
            let allowed = ALLOWANCES.get(&(owner, spender)).unwrap_or(0);
            require(allowed >= amount, "allowance too low");
            ALLOWANCES.set(&(owner, spender), &(allowed - amount));
            move_tokens(&owner, &to, amount);
            ret(&true);
        }
        _ => revert("unknown method"),
    }
}
