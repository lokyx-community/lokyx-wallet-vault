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

#[test]
fn counter_deploys_counts_and_charges_only_gas_used() {
    let mut t = T::new();
    let before = t.s.account(&t.a).balance;
    let (code, abi_text, abi) = example("counter");
    let input = abi::encode_deploy(&abi, &[json!(41)]).unwrap();
    let tx = build_deploy(&t.alice, t.p, 0, code, abi_text, input, 2_000_000, 0).unwrap();
    let size_fee = tx.size() as u128 * lokyx::params::MIN_FEE_PER_BYTE;
    let r = t.mine_one(tx);
    assert!(r.ok, "{:?}", r.error);
    let c = r.contract.unwrap();
    assert!(r.gas_used > 0 && r.gas_used < 2_000_000);
    // paid the size fee plus gas actually used, not the whole gas limit
    assert_eq!(r.fee, size_fee + r.gas_used as u128 * GAS_PRICE);
    assert_eq!(t.s.account(&t.a).balance, before - r.fee);
    assert_eq!(t.view(c, &abi, "get", &[]), json!(41));

    let r = t.call(&t.bob.clone(), c, &abi, "increment", &[], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(abi::decode_return(&abi, "increment", &r.output).unwrap(), json!(42));
    assert_eq!(r.logs.len(), 1);
    assert_eq!(r.logs[0].topic, "Incremented");
    let ev = abi::decode_event(&abi, "Incremented", &r.logs[0].data).unwrap();
    assert_eq!(ev["by"], json!(t.b.to_string()));
    assert_eq!(t.view(c, &abi, "get", &[]), json!(42));
    // the miner got every fee
    assert!(t.s.account(&MINER).balance > 0);
}

#[test]
fn token_transfers_allowances_and_failed_calls_change_nothing() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let bob = t.bob.clone();
    let (c, abi, _) = t.deploy(&alice, "token", &[json!("Lokyx Test"), json!("LTT"), json!("1000")]);
    assert_eq!(t.view(c, &abi, "symbol", &[]), json!("LTT"));
    assert_eq!(t.view(c, &abi, "balance_of", &[json!(t.a.to_string())]), json!("1000"));

    let r = t.call(&alice, c, &abi, "transfer", &[json!(t.b.to_string()), json!("250.5")], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(t.view(c, &abi, "balance_of", &[json!(t.b.to_string())]), json!("250.5"));

    // Bob tries to send more than he has: fails, pays gas, nothing else changes.
    let storage_before = t.s.storage.clone();
    let bob_before = t.s.account(&t.b);
    let r = t.call(&bob, c, &abi, "transfer", &[json!(t.a.to_string()), json!("300")], 0);
    assert!(!r.ok);
    assert_eq!(r.error.as_deref(), Some("not enough tokens"));
    assert!(r.logs.is_empty());
    assert_eq!(t.s.storage, storage_before);
    let bob_after = t.s.account(&t.b);
    assert_eq!(bob_after.nonce, bob_before.nonce + 1);
    assert_eq!(bob_after.balance, bob_before.balance - r.fee);

    // allowance: Alice lets Bob move 100 of hers
    assert!(t.call(&alice, c, &abi, "approve", &[json!(t.b.to_string()), json!("100")], 0).ok);
    let r = t.call(&bob, c, &abi, "transfer_from", &[json!(t.a.to_string()), json!(t.b.to_string()), json!("101")], 0);
    assert_eq!(r.error.as_deref(), Some("allowance too low"));
    let r = t.call(&bob, c, &abi, "transfer_from", &[json!(t.a.to_string()), json!(t.b.to_string()), json!("100")], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(t.view(c, &abi, "balance_of", &[json!(t.a.to_string())]), json!("649.5"));
    assert_eq!(t.view(c, &abi, "allowance", &[json!(t.a.to_string()), json!(t.b.to_string())]), json!("0"));

    // sending LYX to it is refused, and the LYX comes back
    let before = t.s.account(&t.a).balance;
    let r = t.call(&alice, c, &abi, "name", &[], COIN);
    assert!(!r.ok);
    assert_eq!(t.s.account(&t.a).balance, before - r.fee);
    assert_eq!(t.s.account(&c).balance, 0);
}

#[test]
fn jar_holds_lyx_until_the_owner_can_take_it() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let bob = t.bob.clone();
    let unlock = t.h + 5;
    let (c, abi, _) = t.deploy(&alice, "jar", &[json!(unlock)]);
    assert!(t.call(&bob, c, &abi, "deposit", &[], 3 * COIN).ok);
    assert_eq!(t.s.account(&c).balance, 3 * COIN);

    let r = t.call(&bob, c, &abi, "withdraw", &[], 0);
    assert_eq!(r.error.as_deref(), Some("only the owner can withdraw"));
    let r = t.call(&alice, c, &abi, "withdraw", &[], 0);
    assert_eq!(r.error, Some(format!("locked until block {unlock}")));
    assert_eq!(t.s.account(&c).balance, 3 * COIN);

    let before = t.s.account(&t.a).balance;
    let r = t.call(&alice, c, &abi, "withdraw", &[], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(t.s.account(&c).balance, 0);
    assert_eq!(t.s.account(&t.a).balance, before + 3 * COIN - r.fee);
    let info = t.view(c, &abi, "info", &[]);
    assert_eq!(info, json!([t.a.to_string(), unlock, "0"]));
}

#[test]
fn capsule_stays_sealed_until_its_day() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let bob = t.bob.clone();
    t.s.time = 1_800_000_000;
    let opens = t.s.time + 10_000;

    let (code, abi_text, abi) = example("capsule");
    let input = abi::encode_deploy(&abi, &[json!(t.b.to_string()), json!(opens), json!("see you then")]).unwrap();
    let n = t.nonce(&t.a);
    let tx = build_deploy(&alice, t.p, n, code.clone(), abi_text.clone(), input, 2_000_000, 4 * COIN).unwrap();
    let r = t.mine_one(tx);
    assert!(r.ok, "{:?}", r.error);
    let c = r.contract.unwrap();
    assert_eq!(t.s.account(&c).balance, 4 * COIN);

    // a date in the past is refused
    let past = abi::encode_deploy(&abi, &[json!(t.b.to_string()), json!(1u64), json!("")]).unwrap();
    let n = t.nonce(&t.a);
    let r = t.mine_one(build_deploy(&alice, t.p, n, code, abi_text, past, 2_000_000, 0).unwrap());
    assert_eq!(r.error.as_deref(), Some("pick a date in the future"));

    // more can go in while it's sealed; nothing comes out, and the note stays hidden
    assert!(t.call(&alice, c, &abi, "add", &[], COIN).ok);
    let r = t.call(&bob, c, &abi, "open", &[], 0);
    assert_eq!(r.error, Some(format!("sealed until {opens}")));
    let early = simulate(&t.s, t.b, c, abi::encode_call(&abi, "note", &[]).unwrap(), 0, t.p);
    assert!(!early.ok);

    t.s.time = opens;
    let r = t.call(&alice, c, &abi, "open", &[], 0);
    assert_eq!(r.error.as_deref(), Some("only the person it's for can open it"));
    let before = t.s.account(&t.b).balance;
    let r = t.call(&bob, c, &abi, "open", &[], 0);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(t.s.account(&t.b).balance, before + 5 * COIN - r.fee);
    assert_eq!(t.s.account(&c).balance, 0);
    assert_eq!(t.view(c, &abi, "note", &[]), json!("see you then"));
    assert_eq!(t.call(&bob, c, &abi, "open", &[], 0).error.as_deref(), Some("already opened"));
    assert_eq!(t.call(&alice, c, &abi, "add", &[], COIN).error.as_deref(), Some("this capsule is already open"));
}

#[test]
fn rules_around_contracts() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let (c, abi, _) = t.deploy(&alice, "counter", &[json!(0)]);
    let p = t.p;

    // a plain transfer to a contract is refused (its code would never run)
    let plain = build_transfer(&alice, p, t.nonce(&t.a), c, COIN, None).unwrap();
    assert!(t.mine(&[plain]).unwrap_err().contains("not a plain transfer"));

    // a call to an address with no contract is refused
    let input = abi::encode_call(&abi, "get", &[]).unwrap();
    let nowhere = build_call(&alice, p, t.nonce(&t.a), Address([9; 20]), input.clone(), 100_000, 0).unwrap();
    assert!(t.mine(&[nowhere]).unwrap_err().contains("no contract"));

    // the fee has to cover the gas limit: the size fee alone is not enough
    let call = lokyx::tx::Op::Call { to: c, value: 0, input, gas: 100_000 };
    let probe = lokyx::tx::build_op(&alice, p, t.nonce(&t.a), call.clone()).unwrap();
    let size_fee = probe.size() as u128 * lokyx::params::MIN_FEE_PER_BYTE;
    let params = lokyx::tx::Params { nonce: t.nonce(&t.a), fee: Some(size_fee), ..Default::default() };
    let cheap = lokyx::tx::build_with(&alice, p, params, call).unwrap();
    assert!(cheap.check_stateless(p).unwrap_err().contains("below minimum"));

    // a call can't be aimed at a system address
    let sys = lokyx::tx::Op::Call { to: DEPLOY_ADDRESS, value: 0, input: vec![], gas: 10_000 };
    let wrong = lokyx::tx::build_op(&alice, p, 0, sys).unwrap();
    assert!(wrong.check_stateless(p).unwrap_err().contains("system address"));

    // gas limits in one block can't add up to more than the block limit
    let per = lokyx::contract::MAX_TX_GAS;
    assert!(3 * per > BLOCK_GAS_LIMIT && 2 * per <= BLOCK_GAS_LIMIT);
    let n = t.nonce(&t.a);
    let input = abi::encode_call(&abi, "increment", &[]).unwrap();
    let txs: Vec<_> = (0..3).map(|i| build_call(&alice, p, n + i, c, input.clone(), per, 0).unwrap()).collect();
    assert!(t.mine(&txs).unwrap_err().contains("over the block limit"));
    assert!(t.mine(&txs[..2]).is_ok());
}

#[test]
fn vaults_cant_use_contracts() {
    use lokyx::vault::{VaultOp, VaultSettings, build};
    let mut t = T::new();
    let alice = t.alice.clone();
    let (c, abi, _) = t.deploy(&alice, "counter", &[json!(0)]);
    let bob = t.bob.clone();
    let settings =
        VaultSettings { allowance: COIN, delay: 300, recovery: Address([5; 20]), safe: Address([6; 20]), heir: None };
    let make = build(&bob, t.p, t.nonce(&t.b), VaultOp::Create(settings)).unwrap();
    t.mine(&[make]).unwrap();

    let input = abi::encode_call(&abi, "increment", &[]).unwrap();
    let call = build_call(&bob, t.p, t.nonce(&t.b), c, input, 100_000, 0).unwrap();
    assert!(t.mine(std::slice::from_ref(&call)).unwrap_err().contains("vault accounts can't use contracts"));
    let mut pool = Mempool::default();
    assert!(pool.add(call, &t.s, t.p).unwrap_err().contains("vault accounts"));

    let (code, abi_text, _) = example("counter");
    let dep =
        build_deploy(&bob, t.p, t.nonce(&t.b), code, abi_text, 0u64.to_le_bytes().to_vec(), 2_000_000, 0).unwrap();
    assert!(t.mine(&[dep]).unwrap_err().contains("vault accounts"));
}

// ---------- hand-written contracts ----------

fn wat(src: &str) -> Vec<u8> {
    wat::parse_str(src).unwrap()
}

fn deploy_raw(t: &mut T, code: Vec<u8>, gas: u64) -> Receipt {
    let n = t.nonce(&t.a);
    let tx = build_deploy(&t.alice.clone(), t.p, n, code, "{\"methods\":[]}".into(), vec![], gas, 0).unwrap();
    t.mine_one(tx)
}

fn call_raw(t: &mut T, c: Address, input: Vec<u8>, gas: u64) -> Receipt {
    let n = t.nonce(&t.a);
    let tx = build_call(&t.alice.clone(), t.p, n, c, input, gas, 0).unwrap();
    t.mine_one(tx)
}

const LOOP: &str = r#"(module (memory (export "memory") 1)
  (func (export "call") (loop $l (br $l))))"#;

#[test]
fn endless_loop_runs_out_of_gas_and_pays_all_of_it() {
    let mut t = T::new();
    let r = deploy_raw(&mut t, wat(LOOP), 200_000);
    let c = r.contract.unwrap();
    let before = t.s.account(&t.a).balance;
    let r = call_raw(&mut t, c, vec![], 300_000);
    assert!(!r.ok);
    assert_eq!(r.error.as_deref(), Some("out of gas"));
    assert_eq!(r.gas_used, 300_000);
    assert_eq!(t.s.account(&t.a).balance, before - r.fee);
}

#[test]
fn bad_code_is_refused_at_deploy() {
    let mut t = T::new();
    let float = r#"(module (memory (export "memory") 1)
      (func (export "call") (drop (f64.add (f64.const 1) (f64.const 2)))))"#;
    let r = deploy_raw(&mut t, wat(float), 500_000);
    assert!(!r.ok && r.error.as_ref().unwrap().contains("invalid contract code"), "{:?}", r.error);

    let no_call = r#"(module (memory (export "memory") 1) (func (export "other")))"#;
    let r = deploy_raw(&mut t, wat(no_call), 500_000);
    assert_eq!(r.error.as_deref(), Some("contract has no `call` function"));

    let stranger = r#"(module (import "env" "abort" (func)) (memory (export "memory") 1) (func (export "call")))"#;
    let r = deploy_raw(&mut t, wat(stranger), 500_000);
    assert!(r.error.unwrap().contains("doesn't exist"));

    let start = r#"(module (memory (export "memory") 1) (func $s) (start $s) (func (export "call")))"#;
    assert!(!deploy_raw(&mut t, wat(start), 500_000).ok);

    let not_wasm = deploy_raw(&mut t, b"hello".to_vec(), 500_000);
    assert!(!not_wasm.ok);
    assert!(t.s.contracts.is_empty());
}

#[test]
fn memory_is_capped() {
    let mut t = T::new();
    let grow = r#"(module (memory (export "memory") 1)
      (func (export "call") (if (i32.eq (memory.grow (i32.const 100)) (i32.const -1)) (then unreachable))))"#;
    let c = deploy_raw(&mut t, wat(grow), 500_000).contract.unwrap();
    let r = call_raw(&mut t, c, vec![], 500_000);
    assert!(!r.ok, "growing past 2 MiB must fail");
    let big = r#"(module (memory (export "memory") 200) (func (export "call")))"#;
    let c = deploy_raw(&mut t, wat(big), 500_000).contract.unwrap();
    assert!(!call_raw(&mut t, c, vec![], 500_000).ok);
}

/// Writes key "k" = its input, then calls the contract whose address is in its input (if any),
/// then reverts if the input's last byte is 1.
fn caller_wat() -> String {
    r#"(module
  (import "lokyx" "input_len" (func $len (result i32)))
  (import "lokyx" "input_read" (func $read (param i32)))
  (import "lokyx" "storage_write" (func $sw (param i32 i32 i32 i32)))
  (import "lokyx" "call" (func $call (param i32 i32 i32 i32) (result i32)))
  (import "lokyx" "revert" (func $revert (param i32 i32)))
  (import "lokyx" "ret" (func $ret (param i32 i32)))
  (memory (export "memory") 1)
  (data (i32.const 0) "k")
  (data (i32.const 8) "boom")
  (func (export "call") (local $n i32) (local $r i32)
    (local.set $n (call $len))
    (call $read (i32.const 100))
    (call $sw (i32.const 0) (i32.const 1) (i32.const 100) (local.get $n))
    ;; 21 bytes = 20-byte address to call + flag; the zero value is read from offset 300
    (if (i32.ge_u (local.get $n) (i32.const 21))
      (then
        (local.set $r (call $call (i32.const 100) (i32.const 200) (i32.const 0) (i32.const 300)))
        (i32.store8 (i32.const 400) (local.get $r))
        (call $ret (i32.const 400) (i32.const 1))))
    (if (i32.eq (i32.load8_u (i32.add (i32.const 99) (local.get $n))) (i32.const 1))
      (then (call $revert (i32.const 8) (i32.const 4))))))"#
        .to_string()
}

fn key_of(s: &State, c: &Address) -> Option<Vec<u8>> {
    s.storage.get(c).and_then(|m| m.get(b"k".as_slice())).cloned()
}

#[test]
fn calls_between_contracts_undo_on_failure_and_cant_reenter() {
    let mut t = T::new();
    let a = deploy_raw(&mut t, wat(&caller_wat()), 500_000).contract.unwrap();
    let b = deploy_raw(&mut t, wat(&caller_wat()), 500_000).contract.unwrap();

    // A calls B with an empty input: both write, the call returns 0 (worked)
    let mut input = b.0.to_vec();
    input.push(0);
    let r = call_raw(&mut t, a, input.clone(), 1_000_000);
    assert!(r.ok, "{:?}", r.error);
    assert_eq!(r.output, vec![0]);
    assert_eq!(key_of(&t.s, &a), Some(input));
    assert_eq!(key_of(&t.s, &b), Some(vec![]));

    // B calls A while A is running (A -> B -> A) is refused: B's call returns 1, A carries on
    let mut back = a.0.to_vec();
    back.push(0);
    let r = call_raw(&mut t, b, back, 1_000_000);
    assert!(r.ok);
    // only B ran, and it called A, which isn't running here, so that works
    assert_eq!(r.output, vec![0]);

    // A calling itself is re-entry and is refused
    let mut me = a.0.to_vec();
    me.push(0);
    let r = call_raw(&mut t, a, me, 1_000_000);
    assert!(r.ok);
    assert_eq!(r.output, vec![1], "re-entering a running contract must fail");

    // the whole call reverting undoes everything, including what the inner call did
    let before_a = key_of(&t.s, &a);
    let before_b = key_of(&t.s, &b);
    let mut boom = b.0.to_vec();
    boom.push(1);
    let r = call_raw(&mut t, a, boom, 1_000_000);
    assert!(!r.ok);
    assert_eq!(r.error.as_deref(), Some("boom"));
    assert_eq!(key_of(&t.s, &a), before_a);
    assert_eq!(key_of(&t.s, &b), before_b);
}

#[test]
fn state_root_covers_contract_storage_and_replays_the_same() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let start = t.s.clone();
    let (code, abi_text, abi) = example("counter");
    let input = abi::encode_deploy(&abi, &[json!(1)]).unwrap();
    let dep = build_deploy(&alice, t.p, 0, code, abi_text, input, 2_000_000, 0).unwrap();
    let c = contract_address(&t.a, 0);
    let inc = build_call(&alice, t.p, 1, c, abi::encode_call(&abi, "increment", &[]).unwrap(), 200_000, 0).unwrap();
    let txs = vec![dep, inc];
    t.mine(&txs).unwrap();
    let root = t.s.root();
    assert_ne!(root, start.root());

    // the same block on a fresh copy gives the same root
    let mut again = start.clone();
    again.apply_body(3, MINER, &txs, t.p).unwrap();
    assert_eq!(again.root(), root);

    // changing one storage value changes the root
    let mut tampered = t.s.clone();
    tampered.storage.put(c, b"count".to_vec(), Some(99u64.to_le_bytes().to_vec()));
    assert_ne!(tampered.root(), root);
}

#[test]
fn mempool_takes_calls_and_picks_within_the_gas_limit() {
    let mut t = T::new();
    let alice = t.alice.clone();
    let (c, abi, _) = t.deploy(&alice, "counter", &[json!(0)]);
    let mut pool = Mempool::default();
    let input = abi::encode_call(&abi, "increment", &[]).unwrap();
    let n = t.nonce(&t.a);
    for i in 0..3 {
        pool.add(build_call(&alice, t.p, n + i, c, input.clone(), 20_000_000, 0).unwrap(), &t.s, t.p).unwrap();
    }
    let picked = pool.select(&t.s, t.p);
    assert_eq!(picked.len(), 2, "two 20M-gas calls fit under 50M, a third doesn't");
    t.mine(&picked).unwrap();
    let plain = build_transfer(&alice, t.p, t.nonce(&t.a) + 1, c, 1, None).unwrap();
    assert!(pool.add(plain, &t.s, t.p).is_err());
}

#[test]
fn runaway_recursion_traps_instead_of_crashing_the_node() {
    let mut t = T::new();
    let rec = r#"(module (memory (export "memory") 1)
      (func $f (call $f))
      (func (export "call") (call $f)))"#;
    let c = deploy_raw(&mut t, wat(rec), 500_000).contract.unwrap();
    // run on a small stack, like a busy node thread might have
    let r = std::thread::Builder::new()
        .stack_size(256 * 1024)
        .spawn(move || call_raw(&mut t, c, vec![], 5_000_000))
        .unwrap()
        .join()
        .unwrap();
    assert!(!r.ok);
    assert!(r.error.unwrap().contains("trapped"));
}

/// Contracts can be switched off for a network and turned on at a fixed height. Before it, a
/// block with any contract transaction is invalid and the mempool won't take one. Plain
/// transfers are unaffected.
#[test]
fn contracts_only_from_their_activation_height() {
    let mut t = T::new(); // at height 2
    t.p = Box::leak(Box::new(ChainParams { contracts_from: Some(5), ..t.p.clone() }));
    let alice = t.alice.clone();
    let (code, abi_text, _) = example("counter");
    let input = abi::encode_deploy(&abi::parse(&abi_text).unwrap(), &[json!(0)]).unwrap();
    let deploy = |t: &T| {
        build_deploy(&alice, t.p, t.nonce(&t.a), code.clone(), abi_text.clone(), input.clone(), 2_000_000, 0).unwrap()
    };
    // A data-carrying transaction to an ordinary address counts as a contract call.
    let call = |t: &T| build_call(&alice, t.p, t.nonce(&t.a), t.b, vec![1, 2, 3], 50_000, 0).unwrap();

    for _ in 3..5 {
        for tx in [deploy(&t), call(&t)] {
            let e = t.mine(std::slice::from_ref(&tx)).unwrap_err();
            assert!(e.contains("contracts aren't active"), "{e}");
            let e = Mempool::default().add(tx, &t.s, t.p).unwrap_err();
            assert!(e.contains("contracts aren't active"), "{e}");
        }
        let pay = build_transfer(&alice, t.p, t.nonce(&t.a), t.b, COIN, None).unwrap();
        t.mine(&[pay]).unwrap();
    }
    assert_eq!(t.h, 4);
    // The block at height 5 may carry them.
    Mempool::default().add(deploy(&t), &t.s, t.p).unwrap();
    assert!(t.mine_one(deploy(&t)).ok);

    // None: never.
    let mut t = T::new();
    t.p = Box::leak(Box::new(ChainParams { contracts_from: None, ..t.p.clone() }));
    t.h = 10_000_000;
    let tx =
        build_deploy(&t.alice.clone(), t.p, 0, code.clone(), abi_text.clone(), input.clone(), 2_000_000, 0).unwrap();
    assert!(t.mine(&[tx]).unwrap_err().contains("contracts aren't active"));
}
