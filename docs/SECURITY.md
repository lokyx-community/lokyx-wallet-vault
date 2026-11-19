# Security

LOKYX hasn't been audited. It's pre-alpha and only runs as a testnet. Don't put anything of
value on it, and don't call it secure or production-ready. That needs independent audits and a
network run by more than a handful of people.

## What's in place

**Keys and wallet**
- Keys come from the OS random number generator. Recovery phrases are 24 BIP-39 words
  (256 bits), and keys are derived with BIP-32. Entropy and seed buffers are wiped after use.
- The wallet file is encrypted with XChaCha20-Poly1305, under a key derived from your
  password with Argon2id (64 MiB, 3 passes). It's written atomically with 0600 permissions.
  A wrong password or a modified file is detected.
- `lokyx-wallet restore` rebuilds the wallet from the phrase. It also supports an optional BIP-39
  passphrase via `LOKYX_BIP39_PASSPHRASE`.

**Transactions and consensus**
- secp256k1 ECDSA via RustCrypto's `k256`. Low-S is enforced, and the sender is recovered from the
  signature.
- Replay protection comes from the chain ID and sequential nonces. The signing hash is
  domain-separated.
- Double spends are blocked by the nonce and balance rules, a mempool check on total pending spend, and
  PoW fork choice.
- Every node checks every block in full: structure, tx root, timestamps, the exact expected
  difficulty, RandomX PoW, every transaction, and the state root.
- After every block, and before building a block template, a node checks that all LYX still adds
  up: issuance against the schedule, and balances (contracts included), locked rewards, open
  swaps and pending vault withdrawals against issuance. If it doesn't, the node stops applying
  blocks and stops mining instead of serving figures it can't account for. See PROTOCOL.md,
  "Checking supply yourself".
- Arithmetic in consensus code is checked rather than wrapping or saturating, so a value that
  can't fit is a refusal and not a quietly wrong number. A block whose gas limits overflow a
  64-bit total is refused identically in debug and release builds.

**Network and RPC**
- Peers on other networks are dropped at handshake. Message size and rate are limited,
  misbehaving peers are banned, and both inbound connections and idle time are capped.
- Sync only takes what it asked for, from peers that said they have more work, and penalises
  peers that can't back that up, sit on requests, or send headers nobody asked for. Each peer has
  a cap on headers it can make a node collect and bodies it can be fetching. See PROTOCOL.md, "P2P".
- RPC listens on 127.0.0.1 by default. It only accepts `Content-Type: application/json`.
  That forces browsers into a CORS preflight, so random web pages can't poke your node.
- CORS is off unless you pass an exact origin with `--rpc-cors`.
- The RPC body limit is 1 MiB. Control methods (`lyx_setMining`) need either the node's RPC
  token, sent as `Authorization: Bearer <token>`, or a request from the node's own machine that
  didn't come through a reverse proxy (any `X-Forwarded-For`, `Forwarded` or `X-Real-IP` header
  counts as remote). Setting a token with `--rpc-token-file` or `LOKYX_RPC_TOKEN` makes it the
  only way in, including from that machine, so a program or page running there can't start mining
  to its own address. The token is compared in constant time and every refusal reads the same,
  whatever was wrong. `--public-rpc` turns control methods off for everything but the token. The
  server install makes a token at `/etc/lokyx/rpc-token`.
- Public RPC is rate limited per IP.
- The faucet only runs on test networks, allows one claim per address and per IP per cooldown,
  and signs locally.

**MetaMask Snap**
- The key is derived inside MetaMask and never leaves it. The Snap has no network access.
- Every transfer is shown in a MetaMask dialog before signing: network, from, to, amount, fee and
  total. A wrong chain ID, a malformed address, or a fee below the network minimum is refused
  before the dialog even opens.
- Tests run the built Snap in MetaMask's simulator. They check its addresses and signed bytes
  against the node's vectors, and check that cancelling signs nothing.

**Code**
- I only use well-known crates for crypto: `k256`, `sha3`, `bech32`, `bip39`, `bip32`,
  `argon2`, `chacha20poly1305`, and `randomx-rs` over the reference RandomX. No home-made
  crypto.
- The browser wallet uses the audited `@noble` and `@scure` libraries. Its transaction encoding is
  checked against the Rust code using shared test vectors.
- Tests cover the official RandomX and Keccak vectors, malleated signatures, forged state roots,
  double spends inside a block, replays, deep reorgs, restarts, and attacks on sync (spam
  forks from early blocks, bad proof of work mid-batch, wrong bodies, low-work chains for new
  nodes, a 5,000-block fork).
- Sync tests use a cheap stand-in for RandomX (the `test-pow` feature, test builds only). CI and
  every release run `scripts/check-test-pow.sh`, which checks that no release `lokyxd` contains
  it, and `lokyxd` refuses to start if it does.
- Which headers get their RandomX checked on arrival is drawn from the operating system's random
  source, so a peer can't tell which of its headers it could get away with not mining. No header
  is kept, and no body is asked for, until its proof of work has been checked in full;
  `commit_pending` refuses headers that haven't been.
- Every push runs fmt, clippy with warnings as errors, all tests, `cargo audit`, the decoder
  fuzzing (a long pass from a fresh seed), the web app's tests and build, the Snap's tests, and
  the test-proof-of-work check. The decoders for
  blocks, transactions and p2p messages are fuzzed, and `cargo audit` runs before every release.

## Known gaps

These need fixing before anything of value depends on LOKYX:

1. **No external audit.** Consensus and P2P first, then the wallet.
2. **Fuzzing only covers decoding.** Block processing and the p2p state machine aren't fuzzed
   yet, and it's a randomized test rather than a coverage-guided fuzzer (no `cargo-fuzz` targets).
3. **A reorg reaching back past the undo notes replays from a snapshot.** Notes cover the last 256
   blocks; after a restart they only cover blocks applied since, so a reorg that reaches back
   past the saved state replays up to 100 blocks plus its depth. Bounded, and rare.
   **A restart trusts the node's own database up to its saved state.** The state has to hash to
   its block's state root and balance, and the block has to be on the stored chain, but the
   blocks before it are not checked again (`lokyxd --reverify` does). Someone who can write to
   the database can already do far worse.
   **`block_template` still copies the state** for every template it builds. Harmless at
   today's size; it should use the same record-and-undo as block application.
4. **Eclipse protection is new.** Connections are encrypted (Noise XX), seeds can be pinned, the
   address tables are bucketed by group and a per-node secret, there's one outbound peer per /16,
   two blocks-only connections, anchors and feelers, and isolation is reported. What it doesn't
   cover: an address learned from a peer is only checked against the key that peer claimed for
   it, so a man in the middle with no pinned key to run into isn't stopped (BIP324 has the same
   limit). Groups are /16 and /32 rather than networks, so an attacker with space across many
   /16s of one provider counts as many groups. No Tor or I2P. Detecting isolation only adds
   connections; it can't repair an eclipse, and nothing pauses mining. And it hasn't met a real
   network of strangers yet.
5. **Forks deeper than 200,000 blocks aren't followed automatically.** That's the per-peer
   header limit. Past that depth it's a social problem anyway (a new release with a checkpoint).
6. **A public node can still be loaded.** The read methods have no authentication by design, and
   the rate limit is per IP, so someone with many IPs can make a public node work hard. Control
   methods have a token (above).
7. **Mempool policy is simple.** Replace-by-fee and fee-based eviction are in, but there's no
   notion of a transaction's descendants, and the fee rate ignores the gas a contract call will
   actually use.
8. **Clock dependence.** The future-time rule (15 s) and the 50 s block spacing both lean on the
   local clock, so run NTP. A miner can start hashing a few seconds before the spacing ends by
   dating its block ahead; nodes hold such blocks until their time, so it can't get a block in
   early, but it does get a small head start on the race. Worth watching on testnet. A block
   rejected for being too far in the future is a temporary refusal, not an invalid block: it
   isn't marked bad, the peer isn't penalised, and it's accepted once its time comes. A node with
   a badly wrong clock can fall behind, but can't be split off for good.
9. **No `cargo-deny` yet** (licenses, duplicate crates). `cargo audit` runs before every release.
10. **The faucet keeps its cooldowns in memory.** A restart forgets them.
11. **The Snap hasn't been audited.** That's also why regular MetaMask won't install it yet; see snap/README.md.
12. **Swaps haven't been audited.** They're on testnet only, mainnets are switched off in
    the app. Things to know: the app trusts the Esplora server it reads bitcoin from (run your own
    to remove that), it claims or refunds one funding output (send the exact amount in one
    payment), the bitcoin fee rate is fixed per swap, and you need to come back to the page
    before the locks run out. A lock whose claim hasn't confirmed by the refund height can be
    refunded, so claim early, not at the last block. See docs/SWAPS.md.
13. **Vaults haven't been audited.** They only protect you if someone notices a withdrawal
    within the delay; there are no notifications yet. With the default safe address the
    recovery phrase alone controls everything, so it has to be kept as carefully as the wallet
    phrase. See docs/VAULTS.md.
14. **One dependency advisory is waived for now:** RUSTSEC-2026-0387, timing side channels in
    crypto-bigint 0.5 (via k256 0.13, which bip32 0.5 still pins). Nodes only verify
    signatures; the CLI wallet and faucet sign locally, so an attacker would need to time them
    from the same machine. The web wallet and the Snap use a different library. It goes away when
    I can move to k256 0.14. See `.cargo/audit.toml`.

15. **Contracts are new and unaudited.** The engine (wasmi) is widely used, but how LOKYX wires
    it in (gas costs, storage, calls between contracts, the state root) hasn't been reviewed by
    anyone else. `lyx_call` and `lyx_estimateGas` run while holding the chain lock, so a public
    node relies on the rate limit to stay responsive. A bug in a contract is the contract
    author's to fix, and code can't be changed once deployed. See docs/CONTRACTS.md. A network
    can launch with contracts switched off (`contracts_from`) and turn them on at a set height;
    a mainnet will start that way.

No chain is hack proof. I try to keep the risky parts small: there's no bridge or shared pot
of swap funds. Contracts can't be re-entered while running (the bug behind most contract
thefts), every node meters them the same way, and vault accounts can't touch them, so a vault
keeps its protection whatever contracts exist.

Already fixed: the supply invariant is now checked on every block instead of only in tests and
over RPC, side chains could be used to fill a node's disk cheaply (headers-first sync, v6),
block rewards unlock only after a maturity delay, reorgs step off blocks with undo notes
instead of replaying, control RPC is safe behind a proxy, and early difficulty no longer swings.

## Reporting a problem

Until there's a dedicated address, open a private security advisory on the GitHub repo
rather than a public issue.

## Phase 4 notes (protocol 8)

- **Key rotation does not help against key theft.** A thief with the key can start a rotation of
  their own or, on a plain account, simply spend. Rotation is for planned changes and lost devices;
  for a stolen key the answer is to sweep the vault or move funds now. The wallets say so.
- **One debit path.** Every operation that moves LYX out of an account goes through `State::spend`,
  which charges the vault allowance; `tests/allowance.rs` covers every Op variant, so a new one can't
  skip it (otherwise a stolen vault key could lock everything to itself with a Timelock).
- **The signature is a versioned enum** with one variant defined, so a post-quantum scheme needs no
  transaction format change.
