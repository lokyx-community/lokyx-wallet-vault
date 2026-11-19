# LOKYX

LOKYX is an independent Layer 1 blockchain, written from scratch in Rust. Its coin is LYX,
addresses start with `lyx1`, and anyone can mine it on an ordinary CPU with RandomX, the same
proof of work Monero uses.

There's a public testnet at https://testnet.lokyx.xyz. Test coins are worth nothing and the
testnet gets reset when the rules change. Nothing has been audited and there is no mainnet yet
(`--network mainnet` is refused on purpose), so please don't treat it as anything more than a
testnet. Known gaps are listed in [docs/SECURITY.md](docs/SECURITY.md).

No premine, no dev fund. Block rewards are the only way new LYX is created.

Block 0 was made the week Binance lost $6.3 billion in twenty minutes. Its parent hash is the
hash of this sentence, so every block traces back to it:

> 29 Oct 2026: $6.3 billion left Binance in twenty minutes. Whoever holds your keys holds your
> coins. LOKYX begins holding no keys for anyone.

## What's in the repo

`lokyxd` is the node. It validates blocks, mines, talks to peers and serves JSON-RPC.
`lokyx-wallet` is a command-line wallet (24-word phrase, encrypted file) and `lokyx-faucet`
hands out testnet coins.

Phones can mine too: get the Android app at https://testnet.lokyx.xyz/app.

`wallet/` is the phone wallet (Expo, Android first): LYX, Bitcoin, Ethereum, Solana and Tron from
one set of 24 words, with vaults and alerts for LYX. It's still testnet only, see
[wallet/README.md](wallet/README.md) and [wallet/docs/WALLET_SECURITY.md](wallet/docs/WALLET_SECURITY.md).

`app/` is the web wallet and block explorer. It talks to a node directly and signs in the
browser, or through MetaMask using the Snap in `snap/`. `scripts/release.sh` builds a release:
the node and wallet for Windows, macOS and Linux, and a server bundle whose `install.sh` sets
up a public testnet server (node, faucet, web app, downloads, HTTPS) without compiling
anything. `scripts/devnet.sh` starts a three-node network on your machine for development.

LYX can be swapped for bitcoin or ether directly between two people, with no bridge and nobody
holding the coins in between. See [docs/SWAPS.md](docs/SWAPS.md).

Vaults put a daily limit on what can leave an account and make anything bigger wait, with a
recovery phrase that can stop it. A stolen wallet gets one day's allowance at most. See
[docs/VAULTS.md](docs/VAULTS.md).

Contracts are written in Rust and compiled to WebAssembly: tokens, escrow, games, anything that's
rules applied to data. The SDK and three examples are in `contracts/`; see
[docs/CONTRACTS.md](docs/CONTRACTS.md). Not done yet: a mining pool, an iPhone app. See
[docs/ROADMAP.md](docs/ROADMAP.md).

## Building

Needs Rust 1.94 or newer, a C++ compiler and CMake, since RandomX gets compiled from source.
The web app needs Node 20+.

```bash
cargo build --release
cargo test --release
```

Local devnet plus the web app:

```bash
scripts/devnet.sh ./devnet-data
cd app && npm install && npm run dev     # http://localhost:5173
```

`scripts/devnet.sh stop ./devnet-data` shuts it down again.

## Mining on the testnet

Download the node for your computer from https://testnet.lokyx.xyz/#/download and run
`mine.bat` or `mine.sh`. From a build of your own:

```bash
./target/release/lokyx-wallet --network testnet new
./target/release/lokyxd --network testnet --mine --coinbase lyx1... --threads 2
```

The node finds the testnet seed by itself. Keep your system clock synced: blocks dated more
than 15 seconds ahead are ignored. More in [docs/TESTNET.md](docs/TESTNET.md).

Blocks come about once a minute. A new block can't be dated less than 50 seconds after the
previous one, so most blocks land between 50 and 70 seconds apart.

## Wallet

```bash
lokyx-wallet address
lokyx-wallet balance [lyx1...]
lokyx-wallet send --to lyx1... --amount 1.5 --wait 2
lokyx-wallet tx <hash>
lokyx-wallet restore
lokyx-wallet export-phrase
lokyx-wallet export-key
```

The wallet file lives in `~/.lokyx/<network>/wallet.json`. You get asked for the password;
`LOKYX_WALLET_PASSWORD` is there for scripts.

## RPC

JSON-RPC 2.0 over POST, `Content-Type: application/json`, params by name. Default port is
18701 on devnet and 28701 on testnet. Amounts are strings in base units (1 LYX = 10^18), with an
extra `...Lyx` field that's easier to read.

```bash
curl -s -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"lyx_getSupply","params":{}}' \
  http://127.0.0.1:18701
```

Methods: `lyx_chainInfo`, `lyx_getBlock` (by `height` or `hash`), `lyx_getBlocks`,
`lyx_getTransaction`, `lyx_getAccount`, `lyx_getAddressHistory`, `lyx_sendRawTransaction`,
`lyx_getMempool`, `lyx_getPeers`, `lyx_getSupply`, `lyx_getEmissionSchedule`,
`lyx_getMiningInfo`, `lyx_setMining` (localhost only), `lyx_search`, `lyx_validateAddress`,
`lyx_estimateFee`, `lyx_getSwap`, `lyx_findSwaps`, `lyx_getVault`, `lyx_getWork` and
`lyx_submitWork` (mining without a node). For contracts: `lyx_call`, `lyx_estimateGas`,
`lyx_getContract`, `lyx_getCode`, `lyx_getStorage`, `lyx_encodeCall` and `lyx_encodeDeploy`
(see docs/CONTRACTS.md). Batches of up to 50 requests work.

## Where things are

```
src/params.rs       consensus constants for each network
src/chain.rs        validation, fork choice, reorgs
src/state.rs        balances and applying blocks
src/difficulty.rs   LWMA
src/pow.rs          RandomX
src/net.rs          p2p
src/rpc.rs          JSON-RPC
src/miner.rs        built-in miner
src/swap.rs         hash-locked swaps
src/vault.rs        vaults
src/pqkey.rs        quantum backup key commitments
contracts/          LokyxSwap.sol (the ether side of swaps, runs on Ethereum)
src/bin/            lokyxd, lokyx-wallet, lokyx-faucet
tests/              consensus tests (they mine real RandomX blocks)
testdata/           test vectors shared with the web wallet, the phone wallet and the Snap
wallet/             the phone wallet (its own package.json, tests and docs)
```

How it all fits together: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## License

MIT
