//! Things that must come out the same on every machine and every run: fork choice among equal
//! headers, the order things are put into the state, a replayed chain, and how deep a contract may
//! recurse. Run on x86-64 and on aarch64 (see .github/workflows/ci.yml).

use k256::ecdsa::SigningKey;
use lokyx::address::Address;
use lokyx::block::{Block, BlockHeader};
use lokyx::chain::{BlockMeta, Chain, Outcome as Tip, best_header};
use lokyx::contract::{build_deploy, contract_address, simulate};
use lokyx::crypto::{Hash, keccak256, tagged_hash};
use lokyx::keys::address_of;
use lokyx::params::{COIN, ChainParams, DEVNET};
use lokyx::pow::{PowEngine, meets_difficulty};
use lokyx::state::{Account, State};
use lokyx::tx::{SignedTransaction, build_transfer};

fn key(n: u8) -> SigningKey {
    SigningKey::from_bytes((&[n; 32]).into()).unwrap()
}

// ---------- fork choice ----------

fn meta(template: &BlockHeader, hash: u8, work: u128) -> BlockMeta {
    BlockMeta { header: template.clone(), hash: [hash; 32], cum_work: work }
}

fn permutations<T: Clone>(v: &[T]) -> Vec<Vec<T>> {
    if v.len() <= 1 {
        return vec![v.to_vec()];
    }
    let mut out = vec![];
    for i in 0..v.len() {
        let mut rest = v.to_vec();
        let x = rest.remove(i);
        for mut p in permutations(&rest) {
            p.insert(0, x.clone());
            out.push(p);
        }
    }
    out
}

/// The headers left after a rejection come out of a hash map in an order no two nodes share. The
/// choice among equal work has to come out the same whatever the order.
#[test]
fn equal_work_headers_settle_on_the_lowest_hash_in_every_order() {
    lokyx::pow::test_pow::enable();
    let p: &'static ChainParams = Box::leak(Box::new(DEVNET.clone()));
    let template = Chain::new(p, None).unwrap().tip().header.clone();
    let others =
        vec![meta(&template, 5, 100), meta(&template, 3, 100), meta(&template, 9, 100), meta(&template, 1, 90)];
    for start_hash in [7u8, 2, 4] {
        let start = meta(&template, start_hash, 100);
        let expect = if start_hash < 3 { start_hash } else { 3 };
        for order in permutations(&others) {
            let best = best_header(&start, order.iter());
            assert_eq!(
                best.hash,
                [expect; 32],
                "start {start_hash}, order {:?}",
                order.iter().map(|m| m.hash[0]).collect::<Vec<_>>()
            );
        }
    }
    // More work beats a lower hash, wherever it is.
    let start = meta(&template, 7, 100);
    let heavier = vec![meta(&template, 200, 101), meta(&template, 3, 100)];
    for order in permutations(&heavier) {
        assert_eq!(best_header(&start, order.iter()).hash, [200; 32]);
    }
}

// ---------- the order things go into the state ----------

/// Two states with the same contents, put together in different orders, have the same root. The
/// root is built from sorted maps; this fails if anything on the way to it depends on how a hash
/// map happened to iterate.
#[test]
fn the_state_root_does_not_depend_on_the_order_things_were_added() {
    let accounts: Vec<(Address, Account)> = (0..300u32)
        .map(|i| {
            (
                Address(keccak256(&i.to_le_bytes())[..20].try_into().unwrap()),
                Account { balance: i as u128 * 7 + 1, nonce: i as u64 % 5 },
            )
        })
        .collect();
    let pq: Vec<(Address, [u8; 32])> = (0..60u32).map(|i| (Address([i as u8 + 1; 20]), [i as u8; 32])).collect();
    let storage: Vec<(Address, Vec<u8>, Vec<u8>)> =
        (0..80u32).map(|i| (Address([(i % 4) as u8 + 100; 20]), i.to_le_bytes().to_vec(), vec![i as u8; 3])).collect();
    let immature: Vec<(u64, (Address, u128))> =
        (0..40u64).map(|i| (i, (Address([i as u8 + 1; 20]), COIN * i as u128))).collect();

    let build = |seed: u64| {
        let order = |n: usize| -> Vec<usize> {
            // A different, fixed shuffle for each seed.
            let mut v: Vec<usize> = (0..n).collect();
            let mut x = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            for i in (1..n).rev() {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                v.swap(i, (x >> 33) as usize % (i + 1));
            }
            v
        };
        let mut s = State::default();
        for i in order(accounts.len()) {
            s.accounts.insert(accounts[i].0, accounts[i].1);
        }
        for i in order(pq.len()) {
            s.pq.insert(pq[i].0, pq[i].1);
        }
        for i in order(storage.len()) {
            s.storage.put(storage[i].0, storage[i].1.clone(), Some(storage[i].2.clone()));
        }
        for i in order(immature.len()) {
            s.immature.insert(immature[i].0, immature[i].1);
        }
        s.issued = 12345;
        s
    };
    let first = build(1);
    for seed in 2..8 {
        let other = build(seed);
        assert_eq!(first.root(), other.root(), "seed {seed}");
        assert_eq!(first.trie().root(), other.trie().root(), "trie, seed {seed}");
        assert_eq!(first.to_bytes(), other.to_bytes(), "saved form, seed {seed}");
    }
    // And the root does depend on the contents, so the test above isn't comparing nothing.
    let mut changed = build(1);
    changed.accounts.insert(accounts[0].0, Account { balance: 1, nonce: 99 });
    assert_ne!(first.root(), changed.root());
}

// ---------- a replayed chain ----------

fn solve(seed: &Hash, h: &mut BlockHeader) {
    loop {
        if meets_difficulty(&PowEngine::global().hash(seed, &h.pow_input()).unwrap(), h.difficulty) {
            return;
        }
        h.bump_nonce();
    }
}

/// 160 blocks with transfers, rebuilt from fixed keys and timestamps: every header, with its state
/// root, is hashed into one digest. It is the same on every platform, or one of them would be
/// following a different chain.
#[test]
fn a_replayed_chain_gives_the_same_header_and_state_roots_on_every_platform() {
    lokyx::pow::test_pow::enable();
    let p: &'static ChainParams = Box::leak(Box::new(ChainParams {
        initial_difficulty: 2,
        min_difficulty: 2,
        target_block_time: 10,
        min_block_spacing: 0,
        coinbase_maturity: 0,
        genesis_timestamp: 1_700_000_000,
        ..DEVNET.clone()
    }));
    let keys = [key(11), key(12), key(13)];
    let addrs: Vec<Address> = keys.iter().map(address_of).collect();
    let mut nonces = [0u64; 3];
    let mut c = Chain::new(p, None).unwrap();
    let mut digest = Vec::new();
    for i in 0..160u64 {
        let miner = addrs[(i % 3) as usize];
        let mut txs: Vec<SignedTransaction> = vec![];
        if i >= 6 && i % 4 == 0 {
            let from = ((i / 4) % 3) as usize;
            let to = addrs[(from + 1) % 3];
            txs.push(build_transfer(&keys[from], p, nonces[from], to, COIN / 2 + i as u128, None).unwrap());
            nonces[from] += 1;
        }
        let (mut b, seed): (Block, Hash) = c.block_template(miner, txs).unwrap();
        b.header.timestamp = p.genesis_timestamp + (i + 1) * p.target_block_time;
        solve(&seed, &mut b.header);
        assert!(matches!(c.process_block(b.clone(), false).unwrap(), Tip::NewTip { .. }), "block {i}");
        digest.extend_from_slice(&b.hash());
        digest.extend_from_slice(&b.header.state_root);
    }
    let digest = hex::encode(tagged_hash(b"LOKYX/replay-test", &digest));
    println!("REPLAY {digest} tip {}", hex::encode(c.tip().hash));
    assert_eq!(digest, REPLAY_DIGEST);
}

const REPLAY_DIGEST: &str = "061af91bc9e7558b5ab8e0f06e7b3a553c75f28b6d6b8f5086d76466884c9d0a";

// ---------- how deep a contract may recurse ----------

const MINER: Address = Address([7; 20]);

struct World {
    p: &'static ChainParams,
    s: State,
    h: u64,
    sk: SigningKey,
    a: Address,
}

impl World {
    fn new() -> World {
        let p: &'static ChainParams = Box::leak(Box::new(ChainParams { coinbase_maturity: 0, ..DEVNET.clone() }));
        let sk = key(21);
        let a = address_of(&sk);
        let mut s = State::default();
        for h in 1..=30 {
            s.apply_body(h, a, &[], p).unwrap();
        }
        World { p, s, h: 30, sk, a }
    }

    fn deploy(&mut self, wat: &str) -> Address {
        let code = wat::parse_str(wat).unwrap();
        let n = self.s.account(&self.a).nonce;
        let tx = build_deploy(&self.sk, self.p, n, code, "{\"methods\":[]}".into(), vec![], 2_000_000, 0).unwrap();
        self.h += 1;
        let r = self.s.apply_body_with(self.h, MINER, &[tx], self.p).unwrap();
        assert!(r[0].1.ok, "deploy failed: {:?}", r[0].1.error);
        contract_address(&self.a, n)
    }

    fn run(&self, c: Address) -> (bool, u64, Option<String>) {
        let r = simulate(&self.s, Address::ZERO, c, vec![], 0, self.p);
        (r.ok, r.gas_used, r.error)
    }
}

/// A contract that recurses `n` levels deep and returns.
fn recursion(n: u32) -> String {
    format!(
        r#"(module (memory (export "memory") 1)
  (func $r (param $n i32)
    local.get $n
    i32.eqz
    if else
      local.get $n
      i32.const 1
      i32.sub
      call $r
    end)
  (func (export "call") i32.const {n} call $r))"#
    )
}

/// Eight contracts, each recursing `n` deep and then calling the next one; the last doesn't. A call
/// that fails makes the whole thing trap, so success means all eight ran to the end.
fn chain_of_calls(w: &mut World, n: u32) -> Address {
    let mut next: Option<Address> = None;
    for _ in 0..8 {
        let (data, call) = match next {
            Some(a) => (
                format!("(data (i32.const 0) \"{}\")", a.0.iter().map(|b| format!("\\{b:02x}")).collect::<String>()),
                "i32.const 0 i32.const 64 i32.const 0 i32.const 32 call $call i32.eqz if else unreachable end",
            ),
            None => (String::new(), ""),
        };
        let wat = format!(
            r#"(module (import "lokyx" "call" (func $call (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1) {data}
  (func $r (param $n i32)
    local.get $n
    i32.eqz
    if else
      local.get $n
      i32.const 1
      i32.sub
      call $r
    end)
  (func (export "call") i32.const {n} call $r {call}))"#
        );
        next = Some(w.deploy(&wat));
    }
    next.unwrap()
}

/// Run `f` on a thread whose stack is `kib` KiB.
fn on_stack<T: Send + 'static>(kib: usize, f: impl FnOnce() -> T + Send + 'static) -> T {
    std::thread::Builder::new().stack_size(kib * 1024).spawn(f).unwrap().join().expect("the run overflowed its stack")
}

type Outcome = (bool, u64, Option<String>);

/// Deploy a contract that recurses `n` deep and run it.
fn outcome(w: &mut World, n: u32) -> Outcome {
    let c = w.deploy(&recursion(n));
    w.run(c)
}

/// The largest depth at which the call stack limit has not yet been hit.
fn deepest_ok(w: &mut World) -> u32 {
    let (mut lo, mut hi) = (1u32, 4000u32);
    assert!(outcome(w, lo).0, "depth {lo} should work");
    assert!(!outcome(w, hi).0, "depth {hi} should not");
    while hi - lo > 1 {
        let mid = (lo + hi) / 2;
        if outcome(w, mid).0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo
}

/// The most levels of recursion a contract can reach, on the engine as configured. If this changes,
/// a contract that ran before traps, or the reverse, and chains that disagree about it fork.
const DEPTH_LIMIT: u32 = 1022;

#[test]
fn the_recursion_limit_is_one_fixed_number_whatever_the_native_stack() {
    let mut w = World::new();
    let limit = deepest_ok(&mut w);
    println!("DEPTH {limit}");
    assert_eq!(limit, DEPTH_LIMIT);

    // Contracts either side of the limit, and a trivial one.
    let around: Vec<(u32, Address)> =
        [0, 1, limit - 1, limit, limit + 1, limit + 2].iter().map(|&n| (n, w.deploy(&recursion(n)))).collect();
    let w = std::sync::Arc::new(w);
    let run_all = |w: &World| -> Vec<(u32, Outcome)> { around.iter().map(|(n, c)| (*n, w.run(*c))).collect() };
    let reference = run_all(&w);
    for (n, (ok, _, err)) in &reference {
        assert_eq!(*ok, *n <= limit, "depth {n}: {err:?}");
        if !ok {
            assert!(err.as_deref().unwrap_or("").contains("stack"), "depth {n}: {err:?}");
        }
    }
    // Gas grows with the depth reached, so the same gas means the same depth.
    assert!(reference[3].1.1 > reference[2].1.1);

    // The same runs on threads with very different stacks. If the limit came from the machine's
    // stack, these would differ, or the small ones would crash.
    for kib in [32usize, 128, 2048, 262_144] {
        let (w, around) = (w.clone(), around.clone());
        let got = on_stack(kib, move || around.iter().map(|(n, c)| (*n, w.run(*c))).collect::<Vec<(u32, Outcome)>>());
        assert_eq!(got, reference, "stack of {kib} KiB");
    }
}

/// Eight contracts calling one another, each recursing to the limit first, is the most native
/// nesting a transaction can make: eight engine runs inside one another.
#[test]
fn the_deepest_nesting_of_calls_and_recursion_gives_the_same_result_on_a_small_stack_and_a_large_one() {
    let mut w = World::new();
    let first = chain_of_calls(&mut w, DEPTH_LIMIT);
    let w = std::sync::Arc::new(w);
    let reference = w.run(first);
    assert!(reference.0, "the nested run failed: {:?}", reference.2);
    for kib in [64usize, 2048, 262_144] {
        let w = w.clone();
        let got = on_stack(kib, move || w.run(first));
        assert_eq!(got, reference, "stack of {kib} KiB");
    }
}

/// Code made of blocks nested as deep as the size limit allows. Reading it must not use the
/// machine's stack in proportion to the nesting, or a node with a small stack would crash on a
/// contract that a node with a large one accepts.
fn deeply_nested(levels: usize) -> Vec<u8> {
    fn leb(mut n: usize) -> Vec<u8> {
        let mut v = vec![];
        loop {
            let b = (n & 0x7f) as u8;
            n >>= 7;
            if n == 0 {
                v.push(b);
                return v;
            }
            v.push(b | 0x80);
        }
    }
    let mut body = vec![0u8]; // no locals
    for _ in 0..levels {
        body.extend([0x02, 0x40]); // block
    }
    body.extend(std::iter::repeat_n(0x0b, levels)); // end
    body.push(0x0b); // end of the function
    let mut m = b"\0asm\x01\0\0\0".to_vec();
    m.extend([1, 4, 1, 0x60, 0, 0]); // one type: () -> ()
    m.extend([3, 2, 1, 0]); // one function
    m.extend([5, 3, 1, 0, 1]); // one memory
    m.extend([7, 17, 2, 6]);
    m.extend(b"memory");
    m.extend([2, 0, 4]);
    m.extend(b"call");
    m.extend([0, 0]);
    let mut code = leb(1);
    code.extend(leb(body.len()));
    code.extend(body);
    m.push(10);
    m.extend(leb(code.len()));
    m.extend(code);
    m
}

#[test]
fn contract_code_nested_as_deep_as_allowed_is_read_the_same_on_any_stack() {
    // The module is well formed to begin with: a few levels pass.
    lokyx::contract::validate(&deeply_nested(3)).expect("a lightly nested module is valid");
    let code = deeply_nested(39_000);
    assert!(code.len() <= lokyx::contract::MAX_CODE_BYTES, "{} bytes", code.len());
    let reference = lokyx::contract::validate(&code);
    println!("NESTED {:?}", reference.as_ref().map(|_| "accepted").map_err(|e| e.clone()));
    for kib in [64usize, 2048, 262_144] {
        let code = code.clone();
        let got = on_stack(kib, move || lokyx::contract::validate(&code));
        assert_eq!(got, reference, "stack of {kib} KiB");
    }
}
