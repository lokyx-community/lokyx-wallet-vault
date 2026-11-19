# Roadmap

Rough order. Most of it depends on the step before.

## Done so far

**Node.** RandomX proof of work, LWMA difficulty with a minimum block spacing, fork choice and
reorgs, account-based state, `lyx1` addresses, HD wallet with an encrypted keystore, mempool,
p2p sync, JSON-RPC, CLI wallet, and a devnet script.

**Web app.** Explorer and browser wallet in one React app that only talks to a node. There's no
backend in between, and the app doesn't show anything the node didn't report. Transactions move
through signed, broadcast, pending and confirmed as the node actually sees them. The app can
also start and stop mining on your own node (browsers are far too slow for RandomX themselves).

**Testnet.** Reward maturity, reorg snapshots, steadier difficulty on a young chain, a faucet, a
one-command server install, and release builds for Linux, macOS and Windows. Public at
testnet.lokyx.xyz.

**MetaMask Snap.** MetaMask can hold the LOKYX key and approve transfers, and the web app uses
it. Works in MetaMask Flask for now.

**Swaps.** LYX <-> BTC and LYX <-> ETH atomic swaps: hash-locked transactions on LOKYX, a P2WSH
contract on bitcoin, a small contract on Ethereum, and a Swap page that walks both people
through it. No bridge, nothing custodial. On testnets for now. See SWAPS.md.


**Vaults.** A daily allowance, a delay on bigger withdrawals, a recovery phrase that can cancel
them or move everything to a safe address, and an optional heir. A stolen wallet gets one day's
allowance at most. See VAULTS.md.

**Phone miner.** An Android app that mines while the phone charges and pauses when it gets warm,
using two new RPC methods to mine against a public node. Get it at testnet.lokyx.xyz/app.

**Contracts.** Programs written in Rust, compiled to WebAssembly and run by every node with gas
paid in LYX. An SDK and three examples (counter, token, savings jar), deploy and call from the CLI
wallet and the web app, and receipts and events in the explorer. A contract can't be re-entered
while it runs, and vaults can't touch contracts. See CONTRACTS.md.

**Sync.** Headers first, then bodies only for the branch worth following (protocol v6). Side
branches that can't win aren't stored, deep forks are still followed, and new nodes can be given
a minimum chain work and an assume-valid block. See PROTOCOL.md, "Sync".

**Quantum backup keys.** Accounts can commit to a post-quantum (SLH-DSA) key derived from their
recovery phrase, from the Security page. Vault alerts on the website and in the phone app.

## Hardening, in order

Working through these one at a time, each with its own tests (attacks included) before the next:

1. Side-chain spam and sync: **done**, headers-first sync above.
2. Per-peer limits on sync: **done**. Only solicited headers, one request at a time, liars about
   chain work penalised, timeouts on header and body requests, at most 128 bodies in flight per
   peer.
3. A supply check that runs on every block: **done**. A failure halts the node rather than
   inflating quietly, without blaming the peer that sent the block.
4. Checked arithmetic everywhere in consensus code, and no `unsafe` outside the RandomX binding:
   **done**. Overflow checks are on in release builds too, so every build behaves the same.
5. Replace-by-fee and fee-based eviction in the mempool: **done**.
6. Authentication for control RPC: **done**. Phase 1 is finished.

Decided along the way: contracts stay in the code but a mainnet launches with them off and turns
them on at a fixed height after audit and fuzzing. For the format freeze (with the state trie
root and the merge-mining header), two built-in operations so the wallet doesn't need the VM at
launch: a timelock for capsules and savings jars, and a simple fungible token (create, transfer,
view).

## Next

**Vaults, part 2.** A watch service that cancels anything you didn't confirm, vault signing in
the Snap, and quantum-safe recovery keys.

**Contracts, part 2.** MetaMask signing for contract calls, a contract verifier in the explorer
(build from source, compare the code hash), a standard token interface so wallets can list
tokens, and a template for multisig accounts.

**Swaps, part 2.** An offer board so people can find each other (it only matches offers, never
touches coins), ERC-20 tokens like USDC, Litecoin and Dogecoin, MetaMask signing for the LYX side,
and an outside review before any real money.

**More seed nodes**, run by people other than me. One seed is one point of failure.

**MetaMask for everyone.** Publish the Snap on npm, get it audited, then submit it to MetaMask's
Snaps Directory so normal MetaMask can install it.

**Hardening.** Coverage-guided fuzzing (`cargo-fuzz`) for block processing and p2p; the decoders
have a randomized test that CI runs long passes of. Grouping addresses by network (AS) instead of /16. RandomX fast mode for desktops (needs 2 GiB,
roughly 5-10x faster than light mode). A CPU limit for the miner. `cargo-deny`.

**Mining pool.** A Stratum pool that shows real accepted and rejected shares. Solo mining keeps
things decentralised, but a small miner can wait a long time for a block, and pools fix that at
the cost of concentrating block templates. I want both, and a P2Pool-style option later like
Monero has.

## Later

**Quantum switch-over.** The rules for actually signing with the committed post-quantum key, ready
to activate if ECDSA ever becomes breakable.

**State trie.** Built and tested (`src/trie.rs`); the header commits to it at the format freeze.

**Phone apps, part 2.** Wallet and explorer in the Android app, a dashboard for a desktop miner,
and an iPhone app without mining (Apple doesn't allow it on the device).

## Before a mainnet

Two independent audits (consensus/p2p, and wallet/keystore). At least three months of public
testnet with outside node operators. Final emission numbers published for comment first. A
registered chain ID and SLIP-44 coin type. Reproducible builds.
