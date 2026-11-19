# Where the work is

Updated 12 Nov 2026 (Phase 4). This is the file to read first if you're picking the work up cold: it says
what's done, what's next, what's still undecided, and what's known to be wrong. The other docs
describe the system; this one describes the state of it.

## The plan

Everything between here and a mainnet, in order:

| Phase | | |
|---|---|---|
| 1 | Spam, arithmetic, mempool, RPC | **done** |
| 2 | State trie, headers in RAM with bodies on disk, saved state, undo notes (compact relay dropped) | **done** (compact relay decided against) |
| 3 | P2P protocol 7: encrypted transport, address bucketing, determinism checks | **done** in the source (PHASE3.md); the testnet is still on protocol 6 until the 0.4.0 rollout (TESTNET.md) |
| 4 | Format freeze: transaction and block formats, built-in timelock and token operations, the merge-mining header, the state-trie root, the formats key rotation needs | **done** in the source (PHASE4.md) |
| 5 | Key rotation with a delay and a cancel (the rest of Phase 5 waits until after mainnet) | **done** in the source; the testnet resets to 0.5.0 (protocol 8, chain id 77703) at the next rollout (TESTNET.md) |
| 8 | The testing programme: coverage-guided fuzzing, a long public testnet, reproducible builds | |
| — | Two independent audits: consensus and p2p, then wallet and keystore | |

Phases 6 and 7, and the rest of 5, are after mainnet unless that changes.

## Phase 1, done

Six items, each with tests, including tests for the attack each one prevents. Every protection
was checked by deleting it and confirming a test fails.

1. **Side-chain spam**: headers-first sync (p2p protocol 6). Headers come first, bodies only for
   the branch worth following. A branch that can't overtake the node's chain isn't stored and its proof of work
   isn't even checked, which is what made forking from block 1 a cheap way to fill a node's disk.
   Deep forks are still followed because a peer's headers are collected across batches. Fresh
   nodes can be given a minimum chain work and an assume-valid block.
2. **Per-peer limits**: only headers the node asked for, one request per peer at a time, a peer that
   claims more chain work than it can show loses 100 points, timeouts on header and body
   requests, at most 128 bodies in flight per peer. What a peer *says* about its height never
   decides who the node syncs from; only blocks it has checked do.
3. **The supply invariant**: checked after every block and before every block template. If it
   fails the node stops applying blocks and mining, loudly. A failure can only be a bug of ours,
   so the peer that sent the block isn't penalised and the block isn't remembered as invalid.
4. **Checked arithmetic, no unsafe**: one `debit()` for every place money leaves an account,
   `deny(unsafe_code)` on the crate (allowed only on the two Send/Sync impls that state what
   randomx.h promises), and `overflow-checks` on in release builds so every build behaves the
   same. The wasmi linker is built per call now instead of living in a `static` behind a raw
   pointer; a simple contract call measures 23 µs end to end.
5. **Mempool**: replace-by-fee (the old fee plus at least the minimum for the new one's size),
   and when full the lowest fee per byte is dropped, with the sender's later nonces.
6. **Control RPC**: a token, sent as `Authorization: Bearer`. Setting one makes it the only way
   in, including from the node's own machine.

Released as 0.3.0 and running on testnet since 11 Nov. Protocol 6 doesn't talk to protocol 5, so
that was also the first upgrade rehearsal; what happened is written up in TESTNET.md.

## Phase 2, done

1. **State trie** (`src/trie.rs`, `State::trie()`). A compressed binary Merkle trie over every
   section of the state, with proofs of presence and of absence. Not in the block header: the
   header still carries the flat root, and changes once in the Phase 4 freeze. A golden test
   (`tests/golden.rs`) holds the state root after every block of a scripted scenario touching
   every section, taken before any of the internals changed, so nothing in this phase could have
   changed what the testnet commits to.
2. **Undo notes.** Blocks apply to the state in place (`State::record`/`finish`/`undo`, with
   `journal::Tracked` wrapping every map so there is no way to change one without a note). No
   state copy per block. A reorg steps blocks off with their notes (last 256 blocks), puts the
   new branch on, and if the branch fails part-way takes it off again and puts the old chain
   back. Reaching back past the notes falls back to the snapshot rebuild.
3. **Bodies on disk.** All headers stay in memory; bodies are read from the database, with the
   newest 128 cached. A fresh node no longer holds the whole chain in RAM.
4. **Saved state, fast restart.** The state is written at every snapshot height with its block
   hash. On start it is used only if its block is on the stored chain, it hashes to that block's
   state root and its books balance; otherwise the node replays and says why. Receipts of
   contract transactions are in the database too. `lokyxd --reverify` ignores the saved state
   and checks every stored block again.
5. **Compact block relay: not built, decided against.** Not part of protocol 7 either.

Checked by removing each protection and watching a test fail: trie (collapse on removal, depth and
prefix in the hash, the "belongs under this branch" check), undo notes (every way of changing a
map, restore order, the scalar fields), failed-branch recovery (old chain put back, partial branch
taken off, failed block taken back, supply failure taken back), saved state (root check,
indexing of skipped blocks, receipts, the "block is on the node's chain" check, and the supply check on a
saved state, which has a test where the root matches and the books don't).

## Phase 3, done

Protocol 7. Devnet runs it; testnet moves at the 0.4.0 rollout, which is a hard cut (0.3.0 nodes
are told to update and see no peers). No consensus change: the chain, state and wallets carry
over. Design and the decisions behind it: PHASE3.md; the wire details: PROTOCOL.md.

1. **Encrypted transport.** Noise XX (`snow`), a node key in `node.key`, seeds pinned as
   `host:port#key` (two keys while one is being replaced), protocol 6 peers told to update and
   nothing more. `lokyxd --node-key` makes the key and prints the pinned entry. Procedure for the
   seed's key, its backup and its replacement: TESTNET.md.
2. **Handshake limits.** At most 4 connections per IP and 32 in all in the middle of a handshake.
3. **Address tables.** New and tried tables with a per-node secret, bucketing by group (/16, /32)
   and by source; keys travel in `Peers`; `Peers` only as an answer to a request, at most 250 and
   once per 10 minutes per peer; one outbound connection per group; 2 of the 10 outbound
   connections carry blocks only; anchors, feelers, inbound eviction with protected peers; tables
   and anchors are saved and loaded.
4. **Isolation detection.** `lyx_netHealth` (also reports the node's public key). A stale tip opens
   one extra connection. It only ever adds connections: a test mines with all signs set.
5. **Determinism.** Equal-work header choice is lowest hash (was map order). `deny(float_arithmetic)`
   on the consensus modules. Tests: state root independent of insertion order, a replayed 160-block
   chain with a fixed digest, the contract recursion limit (1022 levels, the same on stacks from 32 KiB
   to 256 MiB, with eight nested contracts at the limit), contract code nested as deep as the size
   limit allows. The golden roots, the replay digest and the recursion limit run on aarch64 in CI
   (`consensus-arm64`).
6. **Supported platforms:** x86-64 and aarch64. armv7 and other 32-bit targets are out; the Android
   miner ships arm64 builds only.

Every protection above was checked by removing it and watching a test fail.

**What isn't done or isn't verified:**

- The aarch64 runs have not happened yet. This machine is x86-64 and can't reach a cross toolchain or
  QEMU, so every number above was produced on x86-64. The `consensus-arm64` job in `ci.yml` runs
  them on an ARM runner; until that has gone green the claim "identical on aarch64" is untested.
- The wasmi call-depth test shows the limit does not come from the native stack (the same result on
  stacks from 32 KiB to 256 MiB). It doesn't show the limit is the same on aarch64, for the same
  reason as above.
- Gossiped keys are claims. A man in the middle on an address learned from a peer, with no pinned
  key, isn't stopped.
- Groups are by /16 and /32, not by network (AS). An attacker with space in many /16s of one
  provider counts as many groups.
- `Hello` still has a dead `node_nonce` field (always 0). It goes in the Phase 4 freeze.
- The testnet seed is unpinned until its key is made and 0.4.0 is built with it.

## Open decisions

These need the person running the project, not whoever is writing the code.

- **The merge-mining header field.** Agreed to decide it together with the Phase 4 freeze, so
  the header changes exactly once.
- **Final emission numbers.** The current ones are a draft and have to be published for comment
  before a mainnet. Changing them afterwards is a hard fork.
- **The chain ID and SLIP-44 coin type.** 7701 is a placeholder.

Decided already, for the record:

- **Contracts.** The code stays, but a mainnet launches with them switched off
  (`contracts_from` unset) and turns them on at a fixed height after audit and fuzzing. Testnet
  and devnet have them from block 0 so they keep being tested. The wallet and web app hide the
  features that need them on a network where they're off.
- **Built-in operations for the Phase 4 freeze**, so the wallet works at launch without the VM: a
  timelock (for capsules and savings jars) and a simple fungible token (create, transfer, view).
- **Checkpoints**: assume-valid rather than hard checkpoints, with the hash published in each
  release's notes so anyone can check it against their own node.
- **The clock rule** (a block more than 15 s in the future is held, not rejected) is documented
  rather than removed.
- **Key rotation** ships in stages, rotation with a delay and a cancel first.

## Known to be wrong, or missing

- **Ethereum vault recovery (option B) is built** (wallet repo, `docs/ETH_VAULT.md`). A new vault ends with the Safe's
  owner set to a dead address, and the recovery key can only cancel the queue and send coins to the safe address, through a
  narrow Roles role. 35 vault tests on the real contract bytecode cover it, including that the recovery key cannot send
  anywhere else. Vaults made before this build still have the recovery key as owner. **Still needed before mainnet:** pinned
  code hashes for the Allowance Module, Delay and Roles (the script needs network access), a run on a live testnet and a real
  phone, and an independent review.
- **Ethereum vault delegatecall: closed in the wallet code, not yet reviewed or run live.** New vaults put a second Roles module
  (the gate) in front of the Delay. The phone can queue only ETH and listed tokens to the safe address: no other target, no
  delegatecall, no setting change, and the vault's rules can never be changed after it is made (to change them, make a new
  vault). Tests on the real bytecode cover each refusal, and each protection was removed once to see a test fail. Vaults made
  before this build still let the phone queue anything, behind the wait and the alert. Still needed: the independent review,
  and a run on a live testnet and a phone.
- **Ethereum vault is experimental** (labelled in the app) until it has run on a live testnet and a real phone (`docs/ETH_VAULT_RUNBOOK.md` in the wallet repo).

- **Spoke `rings are stable and differ` test fails** (`protocol/src/protocol.test.ts`, pre-existing,
  not caused by Phase 4). Fix before Spoke ships on the new testnet.

- **Phase 4/5 leftovers.** Emission numbers, the mainnet chain id and the SLIP-44 number are undecided
  (the token-creation burn is a 5 LYX placeholder). `MoneroAux` merge mining is built later at an
  activation height. The aarch64 CI job hasn't been run. The devnet rehearsal ran both nodes on one
  machine, and a rotation's release is covered by unit tests, not live. The web wallet can't start or
  operate a rotated account (the CLI wallet can, with `--from`) and has no UI for batch, timelock or
  token; it sends transfers with no expiry where the other wallets use one day.

The full list is in SECURITY.md. The ones that matter most:

- No external audit yet. Nothing of value should depend on this.
- Fuzzing covers the decoders only, and as a randomized test rather than a coverage-guided
  fuzzer. Block processing and the p2p state machine aren't fuzzed.
- The state root is a flat hash, so light clients have no proofs yet (the trie exists; the header commits to it at the Phase 4 freeze).
- Eclipse protection is built (Phase 3) but young, and hasn't met a real network of strangers yet.
  See SECURITY.md for what it doesn't cover.
- A reorg that reaches back past the undo notes (the last 256 blocks, fewer just after a restart)
  replays from a snapshot. Normal reorgs use the notes.
- Forks deeper than 200,000 blocks aren't followed automatically. Past that it needs a release.
- One dependency advisory is waived with a reason in `.cargo/audit.toml`.

## Working on it

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test --release`
  all have to pass before a commit. 195 tests at the moment.
- CI runs the same on every push, plus `cargo audit`, a long fuzz pass from a fresh seed, the web
  app's tests and build, the Snap's tests, and `scripts/check-test-pow.sh`.
- Tests needing thousands of blocks use the cheap `test-pow` feature instead of RandomX. It only
  exists in test builds, `lokyxd` refuses to start if it's compiled in, and
  `scripts/check-test-pow.sh` proves no release binary contains it.
- Never weaken a check or a test to make something pass. If a test has to change, it should get
  stronger, and the change should be called out.
- A new protection isn't finished until it has been checked by removing it and watching a test
  fail.
