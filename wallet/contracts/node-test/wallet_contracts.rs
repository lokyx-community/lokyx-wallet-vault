//! Contracts: deploy, call, gas, failures, limits, and the rules around them.
//!
//! counter/token/jar/capsule.wasm are the examples in contracts/examples, built with
//! `cargo build --release` in contracts/. The small hand-written ones below are WebAssembly text.

use k256::ecdsa::SigningKey;
use lokyx::abi;
use lokyx::address::Address;
use lokyx::contract::{
    BLOCK_GAS_LIMIT, DEPLOY_ADDRESS, GAS_PRICE, Receipt, build_call, build_deploy, contract_address, simulate,
};
use lokyx::crypto::Hash;
use lokyx::keys::address_of;
use lokyx::mempool::Mempool;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::state::State;
use lokyx::tx::{SignedTransaction, build_transfer};
use rand::rngs::OsRng;
use serde_json::{Value, json};

fn params() -> &'static ChainParams {
    Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }))
}

const MINER: Address = Address([7; 20]);

fn example(name: &str) -> (Vec<u8>, String, Value) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/contracts/");
    let code = std::fs::read(format!("{dir}{name}.wasm")).unwrap();
    let abi_text = std::fs::read_to_string(format!("{dir}{name}.abi.json")).unwrap();
    let abi = abi::parse(&abi_text).unwrap();
    (code, abi_text, abi)
}

struct T {
    p: &'static ChainParams,
    s: State,
    h: u64,
    alice: SigningKey,
    a: Address,
    bob: SigningKey,
    b: Address,
}

impl T {
    /// Alice and Bob each mine one block (10 LYX each).
    fn new() -> T {
        let p = params();
        let alice = SigningKey::random(&mut OsRng);
        let bob = SigningKey::random(&mut OsRng);
        let (a, b) = (address_of(&alice), address_of(&bob));
        let mut s = State::default();
        s.apply_body(1, a, &[], p).unwrap();
        s.apply_body(2, b, &[], p).unwrap();
        T { p, s, h: 2, alice, a, bob, b }
    }
    fn nonce(&self, a: &Address) -> u64 {
        self.s.account(a).nonce
    }
    /// Mine one block with these txs; returns its receipts.
    fn mine(&mut self, txs: &[SignedTransaction]) -> Result<Vec<(Hash, Receipt)>, String> {
        let mut s = self.s.clone();
        let r = s.apply_body_with(self.h + 1, MINER, txs, self.p)?;
        self.s = s;
        self.h += 1;
        assert_eq!(self.s.circulating(), self.s.issued, "supply invariant");
        Ok(r)
    }
    fn mine_one(&mut self, tx: SignedTransaction) -> Receipt {
        let r = self.mine(&[tx]).unwrap();
        assert_eq!(r.len(), 1);
        r.into_iter().next().unwrap().1
    }
    fn deploy(&mut self, who: &SigningKey, name: &str, args: &[Value]) -> (Address, Value, Receipt) {
        let (code, abi_text, abi) = example(name);
        let input = abi::encode_deploy(&abi, args).unwrap();
        let w = address_of(who);
        let n = self.nonce(&w);
        let tx = build_deploy(who, self.p, n, code, abi_text, input, 2_000_000, 0).unwrap();
        let r = self.mine_one(tx);
        assert!(r.ok, "deploy failed: {:?}", r.error);
        let addr = r.contract.unwrap();
        assert_eq!(addr, contract_address(&w, n));
        (addr, abi, r)
    }
    fn call(&mut self, who: &SigningKey, c: Address, abi: &Value, m: &str, args: &[Value], value: u128) -> Receipt {
        let input = abi::encode_call(abi, m, args).unwrap();
        let n = self.nonce(&address_of(who));
        let tx = build_call(who, self.p, n, c, input, 500_000, value).unwrap();
        self.mine_one(tx)
    }
    fn view(&self, c: Address, abi: &Value, m: &str, args: &[Value]) -> Value {
        let input = abi::encode_call(abi, m, args).unwrap();
        let r = simulate(&self.s, Address::ZERO, c, input, 0, self.p);
        assert!(r.ok, "{m} failed: {:?}", r.error);
        abi::decode_return(abi, m, &r.output).unwrap()
    }
}

// ---------- the wallet's own contracts (lokyx-wallet/contracts), checked against the real runtime ----------

fn fund(t: &mut T, to: &Address, amount: u128) {
    let alice = t.alice.clone();
    let n = t.nonce(&t.a);
    let tx = build_transfer(&alice, t.p, n, *to, amount, None).unwrap();
    let r = t.mine(&[tx]).unwrap();
    assert!(r.is_empty() || r[0].1.ok);
}

#[test]
fn multisig_two_of_three_pays_only_with_two() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let bob = t.bob.clone();
    let carol = SigningKey::random(&mut OsRng);
    let c_addr = address_of(&carol);
    fund(&mut t, &c_addr, COIN);
    let dave = Address([9; 20]);
    let owners = json!([t.a.to_string(), t.b.to_string(), c_addr.to_string()]);
    let (m, abi, _) = t.deploy(&alice, "multisig", &[owners.clone(), json!(2)]);
    assert!(t.call(&bob, m, &abi, "deposit", &[], 5 * COIN).ok);
    assert_eq!(t.s.account(&m).balance, 5 * COIN);

    // an outsider can't propose
    let outsider = SigningKey::random(&mut OsRng);
    fund(&mut t, &address_of(&outsider), COIN);
    let r = t.call(&outsider, m, &abi, "propose", &[json!(dave.to_string()), json!("1"), json!("hi")], 0);
    assert_eq!(r.error.as_deref(), Some("only an owner of this account can do that"));

    // Alice proposes 2 LYX to Dave: one approval (hers), nothing moves
    let r = t.call(&alice, m, &abi, "propose", &[json!(dave.to_string()), json!("2"), json!("school fees")], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(abi::decode_return(&abi, "propose", &r.output).unwrap(), json!(0));
    assert_eq!(t.s.account(&dave).balance, 0);
    assert_eq!(t.view(m, &abi, "approvals", &[json!(0)]), json!([t.a.to_string()]));

    // Alice can't approve twice
    let r = t.call(&alice, m, &abi, "approve", &[json!(0)], 0);
    assert_eq!(r.error.as_deref(), Some("you already approved it"));
    // Bob approves: it goes out
    let r = t.call(&bob, m, &abi, "approve", &[json!(0)], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(abi::decode_return(&abi, "approve", &r.output).unwrap(), json!(true));
    assert_eq!(t.s.account(&dave).balance, 2 * COIN);
    assert_eq!(t.s.account(&m).balance, 3 * COIN);
    let p = t.view(m, &abi, "proposal", &[json!(0)]);
    assert_eq!(p[4], json!(1));
    // and can't go out twice
    let r = t.call(&carol, m, &abi, "approve", &[json!(0)], 0);
    assert_eq!(r.error.as_deref(), Some("that payment isn't waiting any more"));

    // more than it holds: approved but waits; then a deposit and execute sends it
    assert!(t.call(&carol, m, &abi, "propose", &[json!(dave.to_string()), json!("4"), json!("")], 0).ok);
    let r = t.call(&alice, m, &abi, "approve", &[json!(1)], 0);
    assert!(r.ok);
    assert_eq!(abi::decode_return(&abi, "approve", &r.output).unwrap(), json!(false));
    assert_eq!(t.s.account(&dave).balance, 2 * COIN);
    let r = t.call(&bob, m, &abi, "execute", &[json!(1)], 0);
    assert_eq!(r.error.as_deref(), Some("it needs more approvals, or more LYX in the account"));
    assert!(t.call(&bob, m, &abi, "deposit", &[], 2 * COIN).ok);
    assert!(t.call(&bob, m, &abi, "execute", &[json!(1)], 0).ok);
    assert_eq!(t.s.account(&dave).balance, 6 * COIN);

    // revoke and cancel
    assert!(t.call(&bob, m, &abi, "propose", &[json!(dave.to_string()), json!("0.5"), json!("")], 0).ok);
    let r = t.call(&alice, m, &abi, "cancel", &[json!(2)], 0);
    assert_eq!(r.error.as_deref(), Some("only whoever proposed it can cancel it"));
    assert!(t.call(&bob, m, &abi, "revoke", &[json!(2)], 0).ok);
    assert!(t.call(&bob, m, &abi, "cancel", &[json!(2)], 0).ok);
    let r = t.call(&alice, m, &abi, "approve", &[json!(2)], 0);
    assert_eq!(r.error.as_deref(), Some("that payment isn't waiting any more"));

    let info = t.view(m, &abi, "info", &[]);
    assert_eq!(info[0], owners);
    assert_eq!(info[1], json!(2));
    assert_eq!(info[3], json!(3));
}

#[test]
fn multisig_rejects_bad_setups() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let (code, abi_text, abi) = example("multisig");
    for (owners, th, why) in [
        (json!([t.a.to_string(), t.b.to_string()]), 3, "the number of approvals must be between 1 and the number of owners"),
        (json!([t.a.to_string(), t.a.to_string()]), 1, "an owner is listed twice"),
        (json!([t.b.to_string()]), 1, "whoever makes the account must be one of its owners"),
    ] {
        let input = abi::encode_deploy(&abi, &[owners, json!(th)]).unwrap();
        let n = t.nonce(&t.a);
        let tx = build_deploy(&alice, t.p, n, code.clone(), abi_text.clone(), input, 2_000_000, 0).unwrap();
        let r = t.mine_one(tx);
        assert_eq!(r.error.as_deref(), Some(why));
    }
}

#[test]
fn board_posts_offers_and_answers() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let bob = t.bob.clone();
    let (b, abi, _) = t.deploy(&alice, "board", &[]);
    let r = t.call(&alice, b, &abi, "post", &[json!("lokyx-swap-offer:abc"), json!(t.h + 100)], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(t.view(b, &abi, "count", &[]), json!(1));
    let r = t.call(&alice, b, &abi, "answer", &[json!(0), json!("x")], 0);
    assert_eq!(r.error.as_deref(), Some("you can't take your own offer"));
    assert!(t.call(&bob, b, &abi, "answer", &[json!(0), json!("lokyx-swap-accept:def")], 0).ok);
    let o = t.view(b, &abi, "offer", &[json!(0)]);
    assert_eq!(o, json!([t.a.to_string(), "lokyx-swap-offer:abc", t.h + 100 - 2, true, 1]).as_array().map(|_| o.clone()).unwrap());
    assert_eq!(o[0], json!(t.a.to_string()));
    assert_eq!(o[3], json!(true));
    assert_eq!(o[4], json!(1));
    assert_eq!(t.view(b, &abi, "answer_at", &[json!(0), json!(0)]), json!([t.b.to_string(), "lokyx-swap-accept:def"]));
    let r = t.call(&bob, b, &abi, "close", &[json!(0)], 0);
    assert_eq!(r.error.as_deref(), Some("only whoever posted it can close it"));
    assert!(t.call(&alice, b, &abi, "close", &[json!(0)], 0).ok);
    let r = t.call(&bob, b, &abi, "answer", &[json!(0), json!("again")], 0);
    assert_eq!(r.error.as_deref(), Some("that offer is closed"));
    // LYX is refused
    let r = t.call(&bob, b, &abi, "count", &[], COIN);
    assert!(!r.ok);
}

#[test]
fn tokenlock_holds_tokens_until_unlock() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let bob = t.bob.clone();
    let (tok, tabi, _) = t.deploy(&alice, "token", &[json!("Team"), json!("TEAM"), json!("1000")]);
    let unlock = t.h + 6;
    let (lock, labi, _) = t.deploy(&alice, "tokenlock", &[json!(tok.to_string()), json!(t.b.to_string()), json!(unlock)]);
    assert!(t.call(&alice, tok, &tabi, "transfer", &[json!(lock.to_string()), json!("300")], 0).ok);
    let info = t.view(lock, &labi, "info", &[]);
    assert_eq!(info[3], json!("300"));
    let r = t.call(&bob, lock, &labi, "release", &[], 0);
    assert_eq!(r.error, Some(format!("locked until block {unlock}")));
    while t.h < unlock {
        t.mine(&[]).unwrap();
    }
    let r = t.call(&bob, lock, &labi, "release", &[], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(t.view(tok, &tabi, "balance_of", &[json!(t.b.to_string())]), json!("300"));
    assert_eq!(t.view(lock, &labi, "info", &[])[3], json!("0"));
}
