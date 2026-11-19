//! Write LOKYX contracts in Rust.
//!
//! A contract is a `#![no_std]` library compiled to WebAssembly. It exports `call` (run for every
//! call) and, if it needs setting up, `deploy` (run once when it's deployed):
//!
//! ```ignore
//! #![no_std]
//! use lokyx_sdk::*;
//!
//! static COUNT: Item<u64> = Item::new(b"count");
//!
//! #[unsafe(no_mangle)]
//! pub extern "C" fn call() {
//!     let (method, _args) = method();
//!     match method.as_str() {
//!         "increment" => COUNT.set(&(COUNT.get().unwrap_or(0) + 1)),
//!         "get" => ret(&COUNT.get().unwrap_or(0)),
//!         _ => revert("unknown method"),
//!     }
//! }
//! ```
//!
//! Values cross the boundary in a simple binary format (the same as borsh): integers little
//! endian, `bool` as one byte, strings and lists with a 4-byte length first, addresses as their
//! 20 bytes.

#![no_std]

extern crate alloc;

pub use alloc::borrow::ToOwned;
pub use alloc::format;
pub use alloc::string::{String, ToString};
pub use alloc::vec;
pub use alloc::vec::Vec;
use core::marker::PhantomData;

mod sys {
    #[link(wasm_import_module = "lokyx")]
    unsafe extern "C" {
        pub fn input_len() -> i32;
        pub fn input_read(ptr: *mut u8);
        pub fn ret(ptr: *const u8, len: i32);
        pub fn revert(ptr: *const u8, len: i32) -> !;
        pub fn storage_read(kp: *const u8, kl: i32, out: *mut u8, cap: i32) -> i32;
        pub fn storage_write(kp: *const u8, kl: i32, vp: *const u8, vl: i32);
        pub fn storage_remove(kp: *const u8, kl: i32);
        pub fn caller(out: *mut u8);
        pub fn self_address(out: *mut u8);
        pub fn value(out: *mut u8);
        pub fn balance(addr: *const u8, out: *mut u8);
        pub fn height() -> i64;
        pub fn time() -> i64;
        pub fn gas_left() -> i64;
        pub fn transfer(to: *const u8, amount: *const u8) -> i32;
        pub fn call(to: *const u8, input: *const u8, len: i32, value: *const u8) -> i32;
        pub fn result_len() -> i32;
        pub fn result_read(ptr: *mut u8);
        pub fn emit(tp: *const u8, tl: i32, dp: *const u8, dl: i32);
        pub fn keccak256(p: *const u8, l: i32, out: *mut u8);
    }
}

// ---------- addresses ----------

/// A LOKYX address: 20 bytes. Wallets show it as `lyx1…`.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Debug)]
pub struct Address(pub [u8; 20]);

impl Address {
    pub const ZERO: Address = Address([0; 20]);
}

// ---------- encoding ----------

pub trait Encode {
    fn encode_to(&self, out: &mut Vec<u8>);
    fn encode(&self) -> Vec<u8> {
        let mut v = Vec::new();
        self.encode_to(&mut v);
        v
    }
}

pub trait Decode: Sized {
    fn decode_from(r: &mut Reader) -> Option<Self>;
    fn decode(bytes: &[u8]) -> Option<Self> {
        let mut r = Reader::new(bytes);
        let v = Self::decode_from(&mut r)?;
        r.is_done().then_some(v)
    }
}

/// Reads values one after another out of some bytes.
pub struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Reader { data, pos: 0 }
    }
    pub fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let s = self.data.get(self.pos..end)?;
        self.pos = end;
        Some(s)
    }
    pub fn is_done(&self) -> bool {
        self.pos == self.data.len()
    }
}

macro_rules! int {
    ($($t:ty),*) => {$(
        impl Encode for $t {
            fn encode_to(&self, out: &mut Vec<u8>) { out.extend_from_slice(&self.to_le_bytes()) }
        }
        impl Decode for $t {
            fn decode_from(r: &mut Reader) -> Option<Self> {
                Some(<$t>::from_le_bytes(r.take(core::mem::size_of::<$t>())?.try_into().ok()?))
            }
        }
    )*};
}
int!(u8, u16, u32, u64, u128, i32, i64, i128);

impl Encode for bool {
    fn encode_to(&self, out: &mut Vec<u8>) {
        out.push(*self as u8)
    }
}
impl Decode for bool {
    fn decode_from(r: &mut Reader) -> Option<Self> {
        match r.take(1)?[0] {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        }
    }
}

impl Encode for Address {
    fn encode_to(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.0)
    }
}
impl Decode for Address {
    fn decode_from(r: &mut Reader) -> Option<Self> {
        Some(Address(r.take(20)?.try_into().ok()?))
    }
}

impl Encode for str {
    fn encode_to(&self, out: &mut Vec<u8>) {
        (self.len() as u32).encode_to(out);
        out.extend_from_slice(self.as_bytes())
    }
}
impl Encode for String {
    fn encode_to(&self, out: &mut Vec<u8>) {
        self.as_str().encode_to(out)
    }
}
impl Decode for String {
    fn decode_from(r: &mut Reader) -> Option<Self> {
        let n = u32::decode_from(r)? as usize;
        String::from_utf8(r.take(n)?.to_vec()).ok()
    }
}

impl<T: Encode> Encode for Vec<T> {
    fn encode_to(&self, out: &mut Vec<u8>) {
        self.as_slice().encode_to(out)
    }
}
impl<T: Encode> Encode for [T] {
    fn encode_to(&self, out: &mut Vec<u8>) {
        (self.len() as u32).encode_to(out);
        for x in self {
            x.encode_to(out)
        }
    }
}
impl<T: Decode> Decode for Vec<T> {
    fn decode_from(r: &mut Reader) -> Option<Self> {
        let n = u32::decode_from(r)? as usize;
        let mut v = Vec::with_capacity(n.min(1024));
        for _ in 0..n {
            v.push(T::decode_from(r)?);
        }
        Some(v)
    }
}

impl<T: Encode> Encode for Option<T> {
    fn encode_to(&self, out: &mut Vec<u8>) {
        match self {
            None => out.push(0),
            Some(x) => {
                out.push(1);
                x.encode_to(out)
            }
        }
    }
}
impl<T: Decode> Decode for Option<T> {
    fn decode_from(r: &mut Reader) -> Option<Self> {
        match r.take(1)?[0] {
            0 => Some(None),
            1 => Some(Some(T::decode_from(r)?)),
            _ => None,
        }
    }
}

impl<T: Encode + ?Sized> Encode for &T {
    fn encode_to(&self, out: &mut Vec<u8>) {
        (**self).encode_to(out)
    }
}

macro_rules! tuple {
    ($($n:ident),+) => {
        impl<$($n: Encode),+> Encode for ($($n,)+) {
            #[allow(non_snake_case)]
            fn encode_to(&self, out: &mut Vec<u8>) { let ($($n,)+) = self; $($n.encode_to(out);)+ }
        }
        impl<$($n: Decode),+> Decode for ($($n,)+) {
            fn decode_from(r: &mut Reader) -> Option<Self> { Some(($($n::decode_from(r)?,)+)) }
        }
    };
}
impl Encode for () {
    fn encode_to(&self, _: &mut Vec<u8>) {}
}
tuple!(A);
tuple!(A, B);
tuple!(A, B, C);
tuple!(A, B, C, D);
tuple!(A, B, C, D, E);

// ---------- input and output ----------

/// The raw input of this call.
pub fn input() -> Vec<u8> {
    let n = unsafe { sys::input_len() } as usize;
    let mut v = vec![0u8; n];
    unsafe { sys::input_read(v.as_mut_ptr()) };
    v
}

/// The arguments of a call, read in order with `next`.
pub struct Args {
    data: Vec<u8>,
    pos: usize,
}

impl Args {
    /// The next argument. Reverts if it isn't there or isn't the expected type.
    pub fn next<T: Decode>(&mut self) -> T {
        let mut r = Reader { data: &self.data, pos: self.pos };
        match T::decode_from(&mut r) {
            Some(v) => {
                self.pos = r.pos;
                v
            }
            None => revert("wrong or missing arguments"),
        }
    }
}

/// The method being called and its arguments. Input is the method name (a string) followed by
/// the arguments.
pub fn method() -> (String, Args) {
    let data = input();
    let mut r = Reader::new(&data);
    let Some(m) = String::decode_from(&mut r) else { revert("input doesn't start with a method name") };
    let pos = r.pos;
    (m, Args { data, pos })
}

/// The arguments given at deploy (there's no method name).
pub fn deploy_args() -> Args {
    Args { data: input(), pos: 0 }
}

/// Set what this call returns. The last `ret` wins.
pub fn ret<T: Encode + ?Sized>(v: &T) {
    let b = v.encode();
    unsafe { sys::ret(b.as_ptr(), b.len() as i32) }
}

/// Stop, undo everything this call did, and fail with `msg`. The caller still pays for gas.
pub fn revert(msg: &str) -> ! {
    unsafe { sys::revert(msg.as_ptr(), msg.len() as i32) }
}

/// Revert with `msg` unless `cond` holds.
pub fn require(cond: bool, msg: &str) {
    if !cond {
        revert(msg)
    }
}

// ---------- who, what, when ----------

/// Whoever called: the account that signed the transaction, or the contract that called this one.
pub fn caller() -> Address {
    let mut a = [0u8; 20];
    unsafe { sys::caller(a.as_mut_ptr()) };
    Address(a)
}

/// This contract's own address.
pub fn self_address() -> Address {
    let mut a = [0u8; 20];
    unsafe { sys::self_address(a.as_mut_ptr()) };
    Address(a)
}

/// LYX (in base units, 10^18 per LYX) sent along with this call. It's already in this
/// contract's balance.
pub fn value() -> u128 {
    let mut b = [0u8; 16];
    unsafe { sys::value(b.as_mut_ptr()) };
    u128::from_le_bytes(b)
}

pub fn balance(of: &Address) -> u128 {
    let mut b = [0u8; 16];
    unsafe { sys::balance(of.0.as_ptr(), b.as_mut_ptr()) };
    u128::from_le_bytes(b)
}

/// The height of the block this runs in.
pub fn height() -> u64 {
    unsafe { sys::height() as u64 }
}

/// The earliest time the current block could have (previous block's time plus the minimum
/// spacing). Set by the chain, not the miner, so it can't be nudged.
pub fn time() -> u64 {
    unsafe { sys::time() as u64 }
}

pub fn gas_left() -> u64 {
    unsafe { sys::gas_left() as u64 }
}

pub const LYX: u128 = 1_000_000_000_000_000_000;

// ---------- moving coins, calling contracts ----------

#[derive(Debug, PartialEq, Eq)]
pub enum TransferError {
    InsufficientBalance,
    /// The node's own system addresses can't receive coins from contracts.
    Forbidden,
}

/// Send LYX from this contract. Doesn't run any code at `to`, even if it's a contract.
pub fn transfer(to: &Address, amount: u128) -> Result<(), TransferError> {
    let a = amount.to_le_bytes();
    match unsafe { sys::transfer(to.0.as_ptr(), a.as_ptr()) } {
        0 => Ok(()),
        1 => Err(TransferError::InsufficientBalance),
        _ => Err(TransferError::Forbidden),
    }
}

/// Like `transfer`, but reverts if it can't.
pub fn send(to: &Address, amount: u128) {
    if transfer(to, amount).is_err() {
        revert("transfer failed")
    }
}

/// Input for calling `method` on another contract with `args` (use a tuple for several).
pub fn encode_call<A: Encode>(method: &str, args: A) -> Vec<u8> {
    let mut v = method.encode();
    args.encode_to(&mut v);
    v
}

/// Call another contract. Ok holds what it returned; Err holds why it failed. A failed call's
/// changes are undone, but this contract carries on. A contract that is already running (this
/// one, or one further up) can't be called again.
pub fn call(contract: &Address, input: &[u8], value: u128) -> Result<Vec<u8>, String> {
    let v = value.to_le_bytes();
    let r = unsafe { sys::call(contract.0.as_ptr(), input.as_ptr(), input.len() as i32, v.as_ptr()) };
    let n = unsafe { sys::result_len() } as usize;
    let mut out = vec![0u8; n];
    unsafe { sys::result_read(out.as_mut_ptr()) };
    if r == 0 { Ok(out) } else { Err(String::from_utf8_lossy(&out).into_owned()) }
}

/// Record an event that apps and explorers can read. `name` is at most 32 bytes.
pub fn emit<T: Encode>(name: &str, data: T) {
    let d = data.encode();
    unsafe { sys::emit(name.as_ptr(), name.len() as i32, d.as_ptr(), d.len() as i32) }
}

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    unsafe { sys::keccak256(data.as_ptr(), data.len() as i32, out.as_mut_ptr()) };
    out
}

// ---------- storage ----------

/// Raw storage: bytes in, bytes out. Keys are at most 256 bytes, values 16 KiB.
pub mod storage {
    use super::*;

    pub fn get_raw(key: &[u8]) -> Option<Vec<u8>> {
        let mut buf = vec![0u8; 64];
        let n = unsafe { sys::storage_read(key.as_ptr(), key.len() as i32, buf.as_mut_ptr(), buf.len() as i32) };
        if n < 0 {
            return None;
        }
        let n = n as usize;
        if n > buf.len() {
            buf = vec![0u8; n];
            unsafe { sys::storage_read(key.as_ptr(), key.len() as i32, buf.as_mut_ptr(), n as i32) };
        }
        buf.truncate(n);
        Some(buf)
    }
    pub fn set_raw(key: &[u8], value: &[u8]) {
        unsafe { sys::storage_write(key.as_ptr(), key.len() as i32, value.as_ptr(), value.len() as i32) }
    }
    pub fn remove(key: &[u8]) {
        unsafe { sys::storage_remove(key.as_ptr(), key.len() as i32) }
    }
    pub fn get<T: Decode>(key: &[u8]) -> Option<T> {
        get_raw(key).map(|b| T::decode(&b).unwrap_or_else(|| revert("stored value has the wrong type")))
    }
    pub fn set<T: Encode + ?Sized>(key: &[u8], v: &T) {
        set_raw(key, &v.encode())
    }
}

/// One value in storage under a fixed key.
pub struct Item<T> {
    key: &'static [u8],
    _t: PhantomData<T>,
}

impl<T: Encode + Decode> Item<T> {
    pub const fn new(key: &'static [u8]) -> Self {
        Item { key, _t: PhantomData }
    }
    pub fn get(&self) -> Option<T> {
        storage::get(self.key)
    }
    pub fn set(&self, v: &T) {
        storage::set(self.key, v)
    }
    pub fn remove(&self) {
        storage::remove(self.key)
    }
}

// Items are only ever touched by the contract's single thread.
unsafe impl<T> Sync for Item<T> {}

/// A map in storage: each entry is stored under `prefix` + the encoded key.
pub struct Map<K, V> {
    prefix: &'static [u8],
    _t: PhantomData<(K, V)>,
}

impl<K: Encode, V: Encode + Decode> Map<K, V> {
    pub const fn new(prefix: &'static [u8]) -> Self {
        Map { prefix, _t: PhantomData }
    }
    fn key(&self, k: &K) -> Vec<u8> {
        let mut v = self.prefix.to_vec();
        v.push(b':');
        k.encode_to(&mut v);
        v
    }
    pub fn get(&self, k: &K) -> Option<V> {
        storage::get(&self.key(k))
    }
    pub fn set(&self, k: &K, v: &V) {
        storage::set(&self.key(k), v)
    }
    pub fn remove(&self, k: &K) {
        storage::remove(&self.key(k))
    }
}

unsafe impl<K, V> Sync for Map<K, V> {}

// ---------- runtime ----------

/// Memory is handed out from the end of the contract's memory and never given back: a contract
/// call is short, and its memory is thrown away when it ends.
#[cfg(target_arch = "wasm32")]
struct Bump;

#[cfg(target_arch = "wasm32")]
static mut NEXT: usize = 0;

#[cfg(target_arch = "wasm32")]
unsafe impl core::alloc::GlobalAlloc for Bump {
    unsafe fn alloc(&self, l: core::alloc::Layout) -> *mut u8 {
        use core::arch::wasm32::{memory_grow, memory_size};
        unsafe {
            if NEXT == 0 {
                NEXT = memory_size(0) * 65536;
            }
            let start = (NEXT + l.align() - 1) & !(l.align() - 1);
            let end = start + l.size();
            let have = memory_size(0) * 65536;
            if end > have && memory_grow(0, (end - have).div_ceil(65536)) == usize::MAX {
                revert("out of memory");
            }
            NEXT = end;
            start as *mut u8
        }
    }
    unsafe fn dealloc(&self, _: *mut u8, _: core::alloc::Layout) {}
}

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOC: Bump = Bump;

/// A panic reverts the call with the panic's message.
#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(info: &core::panic::PanicInfo) -> ! {
    let msg = format!("{}", info.message());
    revert(&msg)
}
