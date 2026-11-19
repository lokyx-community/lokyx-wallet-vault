# Contracts

`sdk/` is the library contracts are written with, and `examples/` has four to start from:
a counter, a token, a savings jar and a time capsule (LYX and a note sealed until a date). Each example has an `abi.json` next to its code.

```bash
rustup target add wasm32-unknown-unknown
cargo build --release
```

The `.wasm` files land in `target/wasm32-unknown-unknown/release/`. Deploy one with
`lokyx-wallet deploy` or the Contracts page in the web app. Everything else is in
[docs/CONTRACTS.md](../docs/CONTRACTS.md).

`LokyxSwap.sol` is unrelated: it's the Ethereum side of LYX <-> ETH swaps (see docs/SWAPS.md).
