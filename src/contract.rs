//! Contracts: programs written in Rust, compiled to WebAssembly, run by the node.
//!
//! A contract is deployed with a transaction to DEPLOY_ADDRESS carrying `ContractOp::Deploy`, and
//! used with a transaction to the contract's own address carrying `ContractOp::Call`. Code runs
//! in wasmi, an interpreter: deterministic, no floats, no start function, metered with fuel. Fuel
//! is gas, and gas is paid in LYX at a fixed price. A call that fails still pays for the gas it
//! used, but everything else it did is undone.
//!
//! The contract side of the interface is in `contracts/sdk`. See docs/CONTRACTS.md.
#![deny(clippy::float_arithmetic)]

use crate::address::Address;
use crate::crypto::{Hash, keccak256, tagged_hash};
use crate::state::State;
use borsh::{BorshDeserialize, BorshSerialize};
use parking_lot::Mutex;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};
use wasmi::{
    Caller, CompilationMode, Config, Engine, Error, Extern, Linker, Memory, Module, Store, StoreLimits,
    StoreLimitsBuilder, TrapCode,
};

/// Deploy transactions go here. Like the swap and vault addresses, nobody holds a key for it.
pub const DEPLOY_ADDRESS: Address = Address([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4]);

/// 10^9 base units (one billionth of a LYX) per unit of gas.
pub const GAS_PRICE: u128 = 1_000_000_000;
pub const MAX_TX_GAS: u64 = 20_000_000;
/// The declared gas of all contract transactions in a block can't add up to more than this.
pub const BLOCK_GAS_LIMIT: u64 = 50_000_000;

pub const MAX_CODE_BYTES: usize = 120_000;
pub const MAX_ABI_BYTES: usize = 8_000;
pub const MAX_CALL_DEPTH: usize = 8;
/// Contract-to-contract calls in one transaction, all depths together.
pub const MAX_CALLS: usize = 32;
pub const MAX_MEMORY_BYTES: usize = 2 << 20;
pub const MAX_KEY_BYTES: usize = 256;
pub const MAX_VALUE_BYTES: usize = 16_384;
pub const MAX_RETURN_BYTES: usize = 16_384;
pub const MAX_TOPIC_BYTES: usize = 32;
pub const MAX_LOG_BYTES: usize = 1_024;
pub const MAX_LOGS: usize = 64;

/// What things cost, in gas. Running code costs one unit per instruction (wasmi's fuel), on top.
pub mod cost {
    pub const TX: u64 = 5_000;
    /// Loading a contract, per byte of its code. Charged on every call, cached or not, so gas
    /// never depends on what a node happens to have in memory.
    pub const LOAD_PER_4_BYTES: u64 = 1;
    /// Keeping code and ABI on chain forever, per byte.
    pub const DEPLOY_PER_BYTE: u64 = 50;
    pub const READ: u64 = 500;
    pub const READ_PER_BYTE: u64 = 2;
    pub const WRITE: u64 = 2_000;
    pub const WRITE_PER_BYTE: u64 = 30;
    pub const REMOVE: u64 = 500;
    pub const EMIT: u64 = 300;
    pub const EMIT_PER_BYTE: u64 = 10;
    pub const HASH: u64 = 100;
    pub const HASH_PER_BYTE: u64 = 1;
    pub const TRANSFER: u64 = 2_000;
    pub const CALL: u64 = 2_000;
    pub const COPY_PER_BYTE: u64 = 1;
    pub const ENV: u64 = 20;
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum ContractOp {
    /// `input` goes to the contract's `deploy` function, if it has one.
    Deploy {
        code: Vec<u8>,
        abi: String,
        input: Vec<u8>,
        gas: u64,
    },
    Call {
        input: Vec<u8>,
        gas: u64,
    },
}

impl ContractOp {
    pub fn gas(&self) -> u64 {
        match self {
            ContractOp::Deploy { gas, .. } | ContractOp::Call { gas, .. } => *gas,
        }
    }
    /// Checks that don't need state.
    pub fn check(&self) -> Result<(), String> {
        let gas = self.gas();
        if gas < cost::TX {
            return Err(format!("gas limit below the minimum of {}", cost::TX));
        }
        if gas > MAX_TX_GAS {
            return Err(format!("gas limit above the maximum of {MAX_TX_GAS}"));
        }
        if let ContractOp::Deploy { code, abi, .. } = self {
            if code.is_empty() || code.len() > MAX_CODE_BYTES {
                return Err(format!("contract code must be 1 to {MAX_CODE_BYTES} bytes"));
            }
            if abi.len() > MAX_ABI_BYTES {
                return Err(format!("ABI over {MAX_ABI_BYTES} bytes"));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct ContractInfo {
    /// keccak256 of the code; the code itself is in `State::blobs`.
    pub code: Hash,
    /// keccak256 of the ABI text (also in blobs). The ABI is only a description for wallets and
    /// explorers; the chain never reads it.
    pub abi: Hash,
    pub creator: Address,
    pub height: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Log {
    pub contract: Address,
    pub topic: String,
    pub data: Vec<u8>,
}

/// What happened when a contract transaction ran. Kept by the node, not part of consensus.
#[derive(Clone, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub struct Receipt {
    pub ok: bool,
    pub gas_used: u64,
    /// What the sender actually paid: size fee plus gas used.
    pub fee: u128,
    /// The return data, or the revert message if it failed.
    pub output: Vec<u8>,
    pub error: Option<String>,
    pub logs: Vec<Log>,
    /// Set on a successful deploy.
    pub contract: Option<Address>,
}

/// Merkle root over the contract transactions of a block, in order. A leaf commits to the
/// receipt's ordinal, the tx hash, whether it succeeded, gas used, the fee paid, the logs and the
/// deployed address, and the output only when it succeeded: a failure's error text is for humans
/// and is not committed. No contract transactions gives the zero hash.
pub fn receipts_root(receipts: &[(crate::crypto::Hash, Receipt)]) -> crate::crypto::Hash {
    let leaves: Vec<crate::crypto::Hash> = receipts
        .iter()
        .enumerate()
        .map(|(i, (h, r))| {
            let out: Option<&Vec<u8>> = r.ok.then_some(&r.output);
            let body =
                borsh::to_vec(&(i as u32, h, r.ok, r.gas_used, r.fee, &r.logs, &r.contract, out)).expect("borsh");
            crate::crypto::tagged_hash(b"LOKYX/receipt/v1", &body)
        })
        .collect();
    crate::crypto::merkle_root(&leaves)
}

pub fn contract_address(creator: &Address, nonce: u64) -> Address {
    let mut d = creator.0.to_vec();
    d.extend(nonce.to_le_bytes());
    let h = tagged_hash(b"LOKYX/contract/v1", &d);
    Address(h[12..].try_into().expect("20 bytes"))
}

pub fn is_system(a: &Address) -> bool {
    *a == DEPLOY_ADDRESS
        || *a == crate::swap::SWAP_ADDRESS
        || *a == crate::vault::VAULT_ADDRESS
        || *a == crate::pqkey::KEY_ADDRESS
        || *a == crate::timelock::TIMELOCK_ADDRESS
        || *a == crate::token::TOKEN_ADDRESS
}

/// Everything a transaction changed, applied to the state only if the whole thing succeeds.
#[derive(Clone, Default, Debug)]
pub struct Changes {
    pub balances: BTreeMap<Address, u128>,
    pub storage: BTreeMap<(Address, Vec<u8>), Option<Vec<u8>>>,
    pub contracts: BTreeMap<Address, ContractInfo>,
    pub blobs: BTreeMap<Hash, Arc<Vec<u8>>>,
    pub logs: Vec<Log>,
}

impl Changes {
    pub fn balance(&self, base: &State, a: &Address) -> u128 {
        self.balances.get(a).copied().unwrap_or_else(|| base.account(a).balance)
    }
    pub fn contract(&self, base: &State, a: &Address) -> Option<ContractInfo> {
        self.contracts.get(a).cloned().or_else(|| base.contracts.get(a).cloned())
    }
    fn blob(&self, base: &State, h: &Hash) -> Option<Arc<Vec<u8>>> {
        self.blobs.get(h).cloned().or_else(|| base.blobs.get(h).cloned())
    }
    fn read(&self, base: &State, c: &Address, key: &[u8]) -> Option<Vec<u8>> {
        match self.storage.get(&(*c, key.to_vec())) {
            Some(v) => v.clone(),
            None => base.storage.get(c).and_then(|m| m.get(key)).cloned(),
        }
    }
    /// Move `amount` between two accounts. Fails without changing anything if `from` is short.
    fn transfer(&mut self, base: &State, from: &Address, to: &Address, amount: u128) -> Result<(), String> {
        if amount == 0 || from == to {
            return Ok(());
        }
        let f = self.balance(base, from);
        if f < amount {
            return Err("insufficient balance".into());
        }
        let t = self.balance(base, to).checked_add(amount).ok_or("balance overflow")?;
        self.balances.insert(*from, f - amount);
        self.balances.insert(*to, t);
        Ok(())
    }
    pub fn apply(self, s: &mut State) {
        for (a, b) in self.balances {
            s.accounts.entry(a).or_default().balance = b;
        }
        for ((c, k), v) in self.storage {
            s.storage.put(c, k, v);
        }
        s.contracts.extend(self.contracts);
        s.blobs.extend(self.blobs);
    }
}

// ---------- the engine ----------

fn engine() -> &'static Engine {
    static E: OnceLock<Engine> = OnceLock::new();
    E.get_or_init(|| {
        let mut c = Config::default();
        c.consume_fuel(true)
            .floats(false)
            .allow_start_fn(false)
            .compilation_mode(CompilationMode::Eager)
            .set_max_recursion_depth(1024)
            .wasm_multi_memory(false)
            .wasm_reference_types(true)
            .wasm_tail_call(false)
            .wasm_wide_arithmetic(false)
            .wasm_custom_page_sizes(false);
        Engine::new(&c)
    })
}

/// Compiled modules by code hash. Compiling is the slow part of a call; gas doesn't depend on
/// whether a module was cached.
fn module(code_hash: &Hash, code: &[u8]) -> Result<Module, String> {
    static CACHE: OnceLock<Mutex<HashMap<Hash, Module>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(m) = cache.lock().get(code_hash) {
        return Ok(m.clone());
    }
    let m = Module::new(engine(), code).map_err(|e| format!("invalid contract code: {e}"))?;
    let mut c = cache.lock();
    if c.len() >= 256 {
        c.clear();
    }
    c.insert(*code_hash, m.clone());
    Ok(m)
}

const IMPORTS: &[&str] = &[
    "input_len",
    "input_read",
    "ret",
    "revert",
    "storage_read",
    "storage_write",
    "storage_remove",
    "caller",
    "self_address",
    "value",
    "balance",
    "height",
    "time",
    "transfer",
    "call",
    "result_len",
    "result_read",
    "emit",
    "keccak256",
    "gas_left",
];

/// Deploy-time checks on the code itself.
pub fn validate(code: &[u8]) -> Result<(), String> {
    let m = Module::new(engine(), code).map_err(|e| format!("invalid contract code: {e}"))?;
    for i in m.imports() {
        if i.module() != "lokyx" || !IMPORTS.contains(&i.name()) {
            return Err(format!("contract imports {}::{}, which doesn't exist", i.module(), i.name()));
        }
    }
    let exports: Vec<String> = m.exports().map(|e| e.name().to_string()).collect();
    if !exports.iter().any(|e| e == "call") {
        return Err("contract has no `call` function".into());
    }
    if !exports.iter().any(|e| e == "memory") {
        return Err("contract doesn't export its memory".into());
    }
    Ok(())
}

/// Block-level facts a contract can see. Both are fixed before the block is mined.
#[derive(Clone, Copy, Debug)]
pub struct Env {
    pub height: u64,
    pub time: u64,
}

struct Frame {
    me: Address,
    caller: Address,
    value: u128,
    input: Vec<u8>,
    ret: Vec<u8>,
}

#[derive(Debug)]
struct Revert(String);
impl std::fmt::Display for Revert {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl wasmi::errors::HostError for Revert {}

struct Host<'a> {
    /// The state this call reads. Borrowed for the length of the call, which is all a `Store`
    /// lives for. This used to be a raw pointer so the linker could be built once into a
    /// `static`; a borrow costs one linker per call and no `unsafe`.
    base: &'a State,
    ch: Changes,
    frames: Vec<Frame>,
    /// Return data, or revert message, of the last contract-to-contract call.
    last: Vec<u8>,
    calls: usize,
    env: Env,
    limits: StoreLimits,
}

impl Host<'_> {
    fn base(&self) -> &State {
        self.base
    }
    fn frame(&self) -> &Frame {
        self.frames.last().expect("a frame is always active while code runs")
    }
}

type C<'a, 'b> = Caller<'a, Host<'b>>;

fn charge(c: &mut C, n: u64) -> Result<(), Error> {
    let f = c.get_fuel()?;
    if f < n {
        c.set_fuel(0)?;
        return Err(Error::from(TrapCode::OutOfFuel));
    }
    c.set_fuel(f - n)
}

fn memory(c: &C) -> Result<Memory, Error> {
    c.get_export("memory").and_then(Extern::into_memory).ok_or_else(|| Error::new("contract has no memory"))
}

fn read(c: &C, ptr: i32, len: i32, max: usize) -> Result<Vec<u8>, Error> {
    let len = len as u32 as usize;
    if len > max {
        return Err(Error::host(Revert(format!("input to the node too long ({len} > {max} bytes)"))));
    }
    let mut buf = vec![0u8; len];
    memory(c)?.read(c, ptr as u32 as usize, &mut buf).map_err(|_| Error::new("memory access out of bounds"))?;
    Ok(buf)
}

fn write(c: &mut C, ptr: i32, data: &[u8]) -> Result<(), Error> {
    let m = memory(c)?;
    m.write(c, ptr as u32 as usize, data).map_err(|_| Error::new("memory access out of bounds"))
}

fn addr(c: &C, ptr: i32) -> Result<Address, Error> {
    Ok(Address(read(c, ptr, 20, 20)?.try_into().expect("20")))
}

fn amount(c: &C, ptr: i32) -> Result<u128, Error> {
    Ok(u128::from_le_bytes(read(c, ptr, 16, 16)?.try_into().expect("16")))
}

/// The host functions a contract can call. Built per call, because `Host` borrows the state.
fn linker<'a>() -> Linker<Host<'a>> {
    {
        let mut l: Linker<Host<'a>> = Linker::new(engine());
        let m = "lokyx";
        l.func_wrap(m, "input_len", |c: C<'_, '_>| -> i32 { c.data().frame().input.len() as i32 }).unwrap();
        l.func_wrap(m, "input_read", |mut c: C<'_, '_>, p: i32| -> Result<(), Error> {
            let inp = c.data().frame().input.clone();
            charge(&mut c, inp.len() as u64 * cost::COPY_PER_BYTE)?;
            write(&mut c, p, &inp)
        })
        .unwrap();
        l.func_wrap(m, "ret", |mut c: C<'_, '_>, p: i32, n: i32| -> Result<(), Error> {
            charge(&mut c, n.max(0) as u64 * cost::COPY_PER_BYTE)?;
            let d = read(&c, p, n, MAX_RETURN_BYTES)?;
            c.data_mut().frames.last_mut().expect("frame").ret = d;
            Ok(())
        })
        .unwrap();
        l.func_wrap(m, "revert", |c: C<'_, '_>, p: i32, n: i32| -> Result<(), Error> {
            let d = read(&c, p, n, MAX_RETURN_BYTES)?;
            Err(Error::host(Revert(String::from_utf8_lossy(&d).into_owned())))
        })
        .unwrap();
        l.func_wrap(m, "storage_read", |mut c: C<'_, '_>, kp: i32, kn: i32, op: i32, cap: i32| -> Result<i32, Error> {
            let key = read(&c, kp, kn, MAX_KEY_BYTES)?;
            let me = c.data().frame().me;
            let v = c.data().ch.read(c.data().base(), &me, &key);
            let Some(v) = v else {
                charge(&mut c, cost::READ)?;
                return Ok(-1);
            };
            charge(&mut c, cost::READ + (key.len() + v.len()) as u64 * cost::READ_PER_BYTE)?;
            let n = v.len().min(cap.max(0) as usize);
            write(&mut c, op, &v[..n])?;
            Ok(v.len() as i32)
        })
        .unwrap();
        l.func_wrap(m, "storage_write", |mut c: C<'_, '_>, kp: i32, kn: i32, vp: i32, vn: i32| -> Result<(), Error> {
            charge(&mut c, cost::WRITE + (kn.max(0) + vn.max(0)) as u64 * cost::WRITE_PER_BYTE)?;
            let key = read(&c, kp, kn, MAX_KEY_BYTES)?;
            let val = read(&c, vp, vn, MAX_VALUE_BYTES)?;
            let me = c.data().frame().me;
            c.data_mut().ch.storage.insert((me, key), Some(val));
            Ok(())
        })
        .unwrap();
        l.func_wrap(m, "storage_remove", |mut c: C<'_, '_>, kp: i32, kn: i32| -> Result<(), Error> {
            charge(&mut c, cost::REMOVE)?;
            let key = read(&c, kp, kn, MAX_KEY_BYTES)?;
            let me = c.data().frame().me;
            c.data_mut().ch.storage.insert((me, key), None);
            Ok(())
        })
        .unwrap();
        l.func_wrap(m, "caller", |mut c: C<'_, '_>, p: i32| -> Result<(), Error> {
            charge(&mut c, cost::ENV)?;
            let a = c.data().frame().caller;
            write(&mut c, p, &a.0)
        })
        .unwrap();
        l.func_wrap(m, "self_address", |mut c: C<'_, '_>, p: i32| -> Result<(), Error> {
            charge(&mut c, cost::ENV)?;
            let a = c.data().frame().me;
            write(&mut c, p, &a.0)
        })
        .unwrap();
        l.func_wrap(m, "value", |mut c: C<'_, '_>, p: i32| -> Result<(), Error> {
            charge(&mut c, cost::ENV)?;
            let v = c.data().frame().value;
            write(&mut c, p, &v.to_le_bytes())
        })
        .unwrap();
        l.func_wrap(m, "balance", |mut c: C<'_, '_>, ap: i32, op: i32| -> Result<(), Error> {
            charge(&mut c, cost::READ)?;
            let a = addr(&c, ap)?;
            let b = c.data().ch.balance(c.data().base(), &a);
            write(&mut c, op, &b.to_le_bytes())
        })
        .unwrap();
        l.func_wrap(m, "height", |c: C<'_, '_>| -> i64 { c.data().env.height as i64 }).unwrap();
        l.func_wrap(m, "time", |c: C<'_, '_>| -> i64 { c.data().env.time as i64 }).unwrap();
        l.func_wrap(m, "gas_left", |c: C<'_, '_>| -> i64 { c.get_fuel().unwrap_or(0) as i64 }).unwrap();
        l.func_wrap(m, "transfer", |mut c: C<'_, '_>, tp: i32, ap: i32| -> Result<i32, Error> {
            charge(&mut c, cost::TRANSFER)?;
            let to = addr(&c, tp)?;
            let amt = amount(&c, ap)?;
            if is_system(&to) {
                return Ok(2);
            }
            let me = c.data().frame().me;
            let h = c.data_mut();
            let base = h.base;
            Ok(if h.ch.transfer(base, &me, &to, amt).is_ok() { 0 } else { 1 })
        })
        .unwrap();
        l.func_wrap(m, "emit", |mut c: C<'_, '_>, tp: i32, tn: i32, dp: i32, dn: i32| -> Result<(), Error> {
            charge(&mut c, cost::EMIT + (tn.max(0) + dn.max(0)) as u64 * cost::EMIT_PER_BYTE)?;
            let topic = read(&c, tp, tn, MAX_TOPIC_BYTES)?;
            let data = read(&c, dp, dn, MAX_LOG_BYTES)?;
            let me = c.data().frame().me;
            let h = c.data_mut();
            if h.ch.logs.len() >= MAX_LOGS {
                return Err(Error::host(Revert(format!("more than {MAX_LOGS} events in one transaction"))));
            }
            let topic = String::from_utf8(topic).map_err(|_| Error::host(Revert("event name isn't text".into())))?;
            h.ch.logs.push(Log { contract: me, topic, data });
            Ok(())
        })
        .unwrap();
        l.func_wrap(m, "keccak256", |mut c: C<'_, '_>, p: i32, n: i32, op: i32| -> Result<(), Error> {
            charge(&mut c, cost::HASH + n.max(0) as u64 * cost::HASH_PER_BYTE)?;
            let d = read(&c, p, n, MAX_VALUE_BYTES)?;
            write(&mut c, op, &keccak256(&d))
        })
        .unwrap();
        l.func_wrap(m, "result_len", |c: C<'_, '_>| -> i32 { c.data().last.len() as i32 }).unwrap();
        l.func_wrap(m, "result_read", |mut c: C<'_, '_>, p: i32| -> Result<(), Error> {
            let d = c.data().last.clone();
            charge(&mut c, d.len() as u64 * cost::COPY_PER_BYTE)?;
            write(&mut c, p, &d)
        })
        .unwrap();
        l.func_wrap(m, "call", |mut c: C<'_, '_>, tp: i32, ip: i32, il: i32, vp: i32| -> Result<i32, Error> {
            charge(&mut c, cost::CALL + il.max(0) as u64 * cost::COPY_PER_BYTE)?;
            let to = addr(&c, tp)?;
            let input = read(&c, ip, il, MAX_VALUE_BYTES)?;
            let value = amount(&c, vp)?;
            sub_call(&mut c, to, input, value)
        })
        .unwrap();
        l
    }
}

/// One contract calling another. 0 = it worked, 1 = it failed (its changes are undone and the
/// reason is in `result_read`). Running out of gas inside it leaves the caller with none either.
fn sub_call(c: &mut C, to: Address, input: Vec<u8>, value: u128) -> Result<i32, Error> {
    let fail = |c: &mut C, msg: &str| {
        c.data_mut().last = msg.as_bytes().to_vec();
        Ok(1)
    };
    let h = c.data();
    if h.frames.len() >= MAX_CALL_DEPTH {
        return fail(c, "calls nested too deep");
    }
    if h.calls >= MAX_CALLS {
        return fail(c, "too many contract calls in one transaction");
    }
    if h.frames.iter().any(|f| f.me == to) {
        return fail(c, "a contract can't be re-entered while it's running");
    }
    let Some(info) = h.ch.contract(h.base(), &to) else {
        return fail(c, "no contract at that address");
    };
    let code = h.ch.blob(h.base(), &info.code).expect("code of a known contract");
    charge(c, code.len() as u64 / 4 * cost::LOAD_PER_4_BYTES)?;
    let module = module(&info.code, &code).map_err(Error::new)?;
    let me = c.data().frame().me;
    let saved = c.data().ch.clone();
    {
        let h = c.data_mut();
        let base = h.base;
        if h.ch.transfer(base, &me, &to, value).is_err() {
            return fail(c, "not enough balance to send that value");
        }
        h.calls += 1;
        h.frames.push(Frame { me: to, caller: me, value, input, ret: vec![] });
    }
    let r = invoke(c, &module, "call");
    let frame = c.data_mut().frames.pop().expect("pushed");
    match r {
        Ok(()) => {
            c.data_mut().last = frame.ret;
            Ok(0)
        }
        Err(e) => {
            c.data_mut().ch = saved;
            let msg = error_text(&e);
            c.data_mut().last = msg.into_bytes();
            if c.get_fuel()? == 0 {
                return Err(Error::from(TrapCode::OutOfFuel));
            }
            Ok(1)
        }
    }
}

fn invoke<'a>(c: &mut impl wasmi::AsContextMut<Data = Host<'a>>, module: &Module, entry: &str) -> Result<(), Error> {
    let inst = linker().instantiate_and_start(&mut *c, module)?;
    let f = inst.get_typed_func::<(), ()>(&mut *c, entry)?;
    f.call(&mut *c, ())
}

fn error_text(e: &Error) -> String {
    if let Some(r) = e.downcast_ref::<Revert>() {
        return r.0.clone();
    }
    match e.as_trap_code() {
        Some(TrapCode::OutOfFuel) => "out of gas".into(),
        Some(TrapCode::UnreachableCodeReached) => "the contract panicked".into(),
        Some(t) => format!("contract trapped: {t}"),
        None => format!("{e}"),
    }
}

/// The result of running one contract transaction against a state.
pub struct Run {
    pub ok: bool,
    pub gas_used: u64,
    pub output: Vec<u8>,
    pub error: Option<String>,
    /// Only kept when `ok`.
    pub changes: Changes,
    pub contract: Option<Address>,
}

impl Run {
    fn failed(gas_used: u64, msg: String) -> Self {
        Run {
            ok: false,
            gas_used,
            output: msg.clone().into_bytes(),
            error: Some(msg),
            changes: Changes::default(),
            contract: None,
        }
    }
}

/// Run a deploy or a call. The sender's fee and nonce are handled by the caller; `value` has
/// already left the sender's balance in `base` and is credited to the contract here.
pub fn run(base: &State, sender: Address, nonce: u64, to: Address, value: u128, op: &ContractOp, env: Env) -> Run {
    run_with(base, Changes::default(), sender, nonce, to, value, op, env)
}

/// `run`, starting from some changes already made on top of `base`.
#[allow(clippy::too_many_arguments)]
fn run_with(
    base: &State,
    mut ch: Changes,
    sender: Address,
    nonce: u64,
    to: Address,
    value: u128,
    op: &ContractOp,
    env: Env,
) -> Run {
    let gas = op.gas();
    let (target, code_hash, code, input, entry, deploying) = match op {
        ContractOp::Deploy { code, abi, input, .. } => {
            let pre = cost::TX + (code.len() + abi.len()) as u64 * cost::DEPLOY_PER_BYTE;
            if pre > gas {
                return Run::failed(gas, "out of gas".into());
            }
            if let Err(e) = validate(code) {
                return Run::failed(pre, e);
            }
            let addr = contract_address(&sender, nonce);
            if base.contracts.contains_key(&addr) {
                return Run::failed(pre, "a contract already exists at that address".into());
            }
            let code_hash = keccak256(code);
            let abi_hash = keccak256(abi.as_bytes());
            let code = Arc::new(code.clone());
            ch.blobs.insert(code_hash, code.clone());
            ch.blobs.insert(abi_hash, Arc::new(abi.as_bytes().to_vec()));
            ch.contracts
                .insert(addr, ContractInfo { code: code_hash, abi: abi_hash, creator: sender, height: env.height });
            (addr, code_hash, code, input.clone(), "deploy", true)
        }
        ContractOp::Call { input, .. } => {
            let Some(info) = base.contracts.get(&to) else {
                return Run::failed(cost::TX.min(gas), "no contract at that address".into());
            };
            let code = base.blobs.get(&info.code).cloned().expect("code of a known contract");
            (to, info.code, code, input.clone(), "call", false)
        }
    };
    let pre = match op {
        ContractOp::Deploy { code, abi, .. } => cost::TX + (code.len() + abi.len()) as u64 * cost::DEPLOY_PER_BYTE,
        ContractOp::Call { .. } => cost::TX,
    } + code.len() as u64 / 4 * cost::LOAD_PER_4_BYTES;
    if pre > gas {
        return Run::failed(gas, "out of gas".into());
    }
    let module = match module(&code_hash, &code) {
        Ok(m) => m,
        Err(e) => return Run::failed(pre, e),
    };
    // Checked, not saturating: with the real supply this can't overflow, but a saturating add
    // would quietly destroy coins if it ever did, and the supply check would then halt the node.
    let target_bal = ch.balance(base, &target);
    let Some(credited) = target_bal.checked_add(value) else {
        return Run::failed(pre, "balance overflow".into());
    };
    ch.balances.insert(target, credited);

    let has_entry = module.exports().any(|e| e.name() == entry);
    if deploying && !has_entry {
        if !input.is_empty() {
            return Run::failed(pre, "this contract has no deploy function, so it takes no deploy arguments".into());
        }
        return Run { ok: true, gas_used: pre, output: vec![], error: None, changes: ch, contract: Some(target) };
    }

    let limits = StoreLimitsBuilder::new()
        .memory_size(MAX_MEMORY_BYTES)
        .memories(MAX_CALLS + 1)
        .tables(MAX_CALLS + 1)
        .table_elements(10_000)
        .instances(MAX_CALLS + 1)
        .trap_on_grow_failure(false)
        .build();
    let host = Host {
        base,
        ch,
        frames: vec![Frame { me: target, caller: sender, value, input, ret: vec![] }],
        last: vec![],
        calls: 0,
        env,
        limits,
    };
    let mut store = Store::new(engine(), host);
    store.limiter(|h| &mut h.limits);
    store.set_fuel(gas - pre).expect("fuel is on");
    let r = invoke(&mut store, &module, entry);
    let left = store.get_fuel().unwrap_or(0);
    let gas_used = gas - left;
    let host = store.into_data();
    match r {
        Ok(()) => {
            let output = host.frames.into_iter().next().map(|f| f.ret).unwrap_or_default();
            Run { ok: true, gas_used, output, error: None, changes: host.ch, contract: deploying.then_some(target) }
        }
        Err(e) => Run::failed(gas_used, error_text(&e)),
    }
}

// ---------- building transactions ----------

/// A deploy. `input` is the encoded deploy arguments (empty if the contract takes none).
#[allow(clippy::too_many_arguments)]
pub fn build_deploy(
    sk: &k256::ecdsa::SigningKey,
    p: &crate::params::ChainParams,
    nonce: u64,
    code: Vec<u8>,
    abi: String,
    input: Vec<u8>,
    gas: u64,
    value: u128,
) -> anyhow::Result<crate::tx::SignedTransaction> {
    crate::tx::build_op(sk, p, nonce, crate::tx::Op::Deploy { value, code, abi, input, gas })
}

/// A call. `input` is the method name and arguments, encoded (see abi.rs).
pub fn build_call(
    sk: &k256::ecdsa::SigningKey,
    p: &crate::params::ChainParams,
    nonce: u64,
    contract: Address,
    input: Vec<u8>,
    gas: u64,
    value: u128,
) -> anyhow::Result<crate::tx::SignedTransaction> {
    crate::tx::build_op(sk, p, nonce, crate::tx::Op::Call { to: contract, value, input, gas })
}

/// Run a call against `state` without keeping anything: for reading contracts and estimating
/// gas. `from` is who the contract sees as the caller.
pub fn simulate(
    state: &State,
    from: Address,
    to: Address,
    input: Vec<u8>,
    value: u128,
    p: &crate::params::ChainParams,
) -> Run {
    let op = ContractOp::Call { input, gas: MAX_TX_GAS };
    simulate_op(state, from, to, value, &op, p)
}

/// Like `simulate`, for a deploy.
pub fn simulate_deploy(
    state: &State,
    from: Address,
    code: Vec<u8>,
    abi: String,
    input: Vec<u8>,
    value: u128,
    p: &crate::params::ChainParams,
) -> Run {
    let op = ContractOp::Deploy { code, abi, input, gas: MAX_TX_GAS };
    simulate_op(state, from, DEPLOY_ADDRESS, value, &op, p)
}

fn simulate_op(
    state: &State,
    from: Address,
    to: Address,
    value: u128,
    op: &ContractOp,
    p: &crate::params::ChainParams,
) -> Run {
    let mut ch = Changes::default();
    let have = state.account(&from).balance;
    if have < value {
        return Run::failed(0, "not enough balance for that value".into());
    }
    ch.balances.insert(from, have - value);
    let env = Env { height: state.height + 1, time: state.time + p.min_block_spacing };
    run_with(state, ch, from, state.account(&from).nonce, to, value, op, env)
}
