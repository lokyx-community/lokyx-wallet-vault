# Wallet contracts

Contracts the LOKYX wallet deploys for you, on top of the SDK from the node repo
(`contracts/sdk` in the repo root, copied here unchanged):

- `multisig`: a shared LYX account. Owners propose a payment; it goes out when enough of them approve.
- `board`: the swap offer board. Makers post offer codes, takers post acceptance codes. It only stores
  text: it never holds or moves coins.
- `tokenlock`: holds a token for someone until a block height (a team's share, a vesting cliff).

Built to WebAssembly by `.github/workflows/contracts.yml` (`cargo build --release --target
wasm32-unknown-unknown`); the wasm is copied into `src/lib/contracts.ts`.

## Tests

`node-test/wallet_contracts.rs` runs all three against the node's real contract runtime. To run it, copy it
into the node repo's `tests/`, put the built `.wasm` and `.abi.json` files in `testdata/contracts/`, and run
`cargo test --release --test wallet_contracts`. Last run: 4 passed (2-of-3 approvals, bad setups refused,
offers and answers on the board, a token lock that releases only at its height).
