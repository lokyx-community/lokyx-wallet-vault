# Contracts

A contract is a small program that lives on LOKYX. You write it in Rust, compile it to
WebAssembly, and deploy it with a transaction. After that anyone can call it, and every node
runs it the same way and agrees on the result. Nobody has to trust whoever wrote or deployed it,
only the code.

Tokens, escrow, games, savings rules, voting: anything you can describe as "these rules, applied
to this data" can be a contract.

Contracts are on for testnet and devnet. A network can launch with them off and turn them on at
a fixed height later (`contracts_from` in the network's parameters); until then deploys and calls
are refused, and the wallet and web app hide the features that need them. A mainnet will launch
this way.

## Quick start

You need Rust and the WebAssembly target:

```bash
rustup target add wasm32-unknown-unknown
cd contracts
cargo build --release
```

That builds the three examples into `contracts/target/wasm32-unknown-unknown/release/`:

| Example | What it does |
|---|---|
| `counter` | a number anyone can add one to |
| `token` | a fixed-supply token with transfers and allowances (the same shape as ERC-20) |
| `jar` | LYX goes in, only the owner can take it out, and not before a chosen block |

Deploy one and use it with the command-line wallet (devnet shown; add `--network testnet` for
the testnet):

```bash
lokyx-wallet deploy contracts/target/wasm32-unknown-unknown/release/token.wasm \
  --abi contracts/examples/token/abi.json "My Token" MTK 1000000
lokyx-wallet call lyx1…contract transfer lyx1…friend 25
lokyx-wallet read lyx1…contract balance_of lyx1…friend
```

Or use the Contracts page in the web app: pick the .wasm and abi.json to deploy, or paste a
contract address to read it and send to it.

## Writing one

A contract is a `#![no_std]` library crate with `crate-type = ["cdylib"]` that depends on
`lokyx-sdk` (in `contracts/sdk`). It exports two functions:

- `call`, which runs on every call. It reads the method name and arguments and does the work.
- `deploy`, which runs once when the contract is deployed. It's optional.

```rust
#![no_std]
use lokyx_sdk::*;

static COUNT: Item<u64> = Item::new(b"count");

#[unsafe(no_mangle)]
pub extern "C" fn deploy() {
    let start: u64 = deploy_args().next();
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
```

What the SDK gives you:

| | |
|---|---|
| `method()`, `deploy_args()`, `args.next::<T>()` | read the input |
| `ret(&value)` | what the call returns |
| `revert("why")`, `require(cond, "why")` | stop and undo everything this call did |
| `caller()`, `self_address()`, `value()`, `balance(&addr)` | who's calling, with how much LYX |
| `height()`, `time()` | the block it runs in |
| `Item<T>`, `Map<K, V>`, `storage::*` | the contract's own storage |
| `transfer(&to, amount)`, `send(&to, amount)` | send LYX from the contract |
| `call(&contract, &input, value)`, `encode_call(method, args)` | call another contract |
| `emit("Name", data)` | an event that wallets and the explorer show |
| `keccak256(&bytes)` | hashing |

A panic reverts the call with the panic message, so `unwrap()` and `assert!` are safe to use:
they just make the call fail.

### The ABI

Next to the code goes an `abi.json` that describes the methods, so wallets, the explorer and the
CLI can turn `transfer(lyx1…, 25)` into bytes and show results and events as text. The chain
stores it with the contract but never reads it.

```json
{
  "name": "Token",
  "deploy": [["name", "string"], ["symbol", "string"], ["supply", "amount"]],
  "methods": [
    { "name": "transfer", "args": [["to", "address"], ["amount", "amount"]], "returns": "bool" },
    { "name": "balance_of", "args": [["who", "address"]], "returns": "amount", "view": true }
  ],
  "events": [
    { "name": "Transfer", "fields": [["from", "address"], ["to", "address"], ["amount", "amount"]] }
  ]
}
```

Types: `u8 u16 u32 u64 u128 i32 i64 i128 bool string bytes address amount list<T> option<T>`.
`amount` is a `u128` of base units shown as LYX (so "1.5" means 1.5 × 10^18). `view` marks
methods that only read; `payable` marks methods that accept LYX. `returns` can be a list of types
for a tuple.

Values are encoded with borsh: integers little endian, `bool` as one byte, strings, bytes and
lists with a 4-byte length first, addresses as their 20 bytes. A call's input is the method name
(a string) followed by its arguments. Deploy input is just the arguments.

## How it runs

- **Engine.** wasmi, a WebAssembly interpreter, in deterministic mode. Float instructions,
  start functions, SIMD and multiple memories are refused at deploy, since they're where results
  could differ between machines.
- **Gas.** Every instruction costs 1 gas, and storage, events, hashing, transfers and calls cost
  extra (the table is in `src/contract.rs`). Gas is paid in LYX at a fixed price of 10^9 base
  units each. The fee on the transaction must cover its size fee plus the whole gas limit, and
  whatever gas isn't used goes back to the sender. Fees go to the miner, like any other fee.
- **Failure.** If a call reverts, panics or runs out of gas, everything it did is undone,
  including LYX it was sent. It still goes in the block, the nonce moves on, and the sender pays
  for the gas it used. That's what stops people spamming failing calls for free.
- **Calls between contracts** are allowed up to 8 deep and 32 per transaction. A contract that's
  already running can't be called again until it finishes, so the re-entry attacks that drained
  The DAO and many contracts since simply can't happen.
- **Time.** `time()` is the previous block's time plus the minimum spacing, set by the chain
  rather than the miner, so a miner can't nudge it. There's no randomness source on purpose.
- **Vaults** can't deploy or call contracts. A stolen vault key could otherwise move coins
  through a contract and skip the allowance and delay. Use a normal account for apps.
- **Plain transfers to a contract are refused**, because its code would never run. Send LYX to
  a contract by calling a payable method with a value.

### Limits

| | |
|---|---|
| Code | 120,000 bytes |
| Gas per transaction | 20,000,000 |
| Gas per block (sum of limits) | 50,000,000 |
| Memory per contract | 2 MiB |
| Storage key / value | 256 bytes / 16 KiB |
| Events per transaction | 64, each up to 1 KiB |

### Addresses

A contract's address is `keccak256("LOKYX/contract/v1" || creator || nonce)[12..]`, so it's
known before the deploy is mined (the CLI prints it). Deploy transactions go to
`lyx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqspyshme` (0x…0104), which nobody holds a key for.

## RPC

| Method | |
|---|---|
| `lyx_call` | `{to, method, args}` or `{to, input}`: run a call without sending anything, for reading |
| `lyx_estimateGas` | the same for a call, or `{from, code, abi, args}` for a deploy; returns a gas limit with headroom |
| `lyx_getContract` | creator, block, code size and the ABI |
| `lyx_getCode` | the code, as hex |
| `lyx_getStorage` | `{address, key}` (hex, or text with `text: true`) |
| `lyx_encodeCall` / `lyx_encodeDeploy` | turn a method and arguments into input bytes using the ABI |

`lyx_getTransaction` adds a `receipt` for contract transactions: whether it worked, gas used,
the fee actually paid, what it returned and its events. `lyx_getAccount` has a `contract` field
for contract addresses.

## Not done yet

- Not audited. Testnet only, like everything else here.
- No upgrades: deployed code can't change. Deploy a new contract and move over.
- The state root is still one flat hash, now including contract storage, so it gets slower as
  storage grows. A Merkle trie is on the roadmap.
- MetaMask (the Snap) can't sign contract transactions yet; the browser wallet and the CLI can.
- `lyx_call` always reads the latest state; there's no historical state.
