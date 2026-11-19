# Protocol

This describes protocol version 8 and transaction, header and state formats as frozen in Phase 4
(release 0.5.0; the testnet restarts on them, chain id 77703). If this file and the code
disagree, the code wins. All the consensus constants are in `src/params.rs`.

## Proof of work

I use RandomX, the same algorithm Monero has run since late 2019.

The main reasons:

- It's built for ordinary CPUs. It runs random programs that lean on branch prediction,
  floating point, caches and a 2 GiB dataset, so a dedicated chip ends up looking a lot like a CPU.
  Nobody has shown an efficient ASIC for it. That's not a guarantee, but it's the best track
  record of any CPU-oriented PoW.
- It runs on x86-64 and ARM64. Laptops, desktops, Apple Silicon and Android phones can all
  verify and mine.
- It has been audited several times (Trail of Bits, X41, Kudelski, QuarksLab) and has years of
  production use behind it.
- The reference implementation is maintained, there's a Rust binding (`randomx-rs`, also used by
  Tari), and there are official test vectors. The test suite checks one of them.

Memory: verifying needs a 256 MiB cache ("light mode"). Fast mining needs the full ~2 GiB
dataset. Phones can run light mode but only manage tens of hashes per second, so realistically
they'd mine through a pool rather than solo.

Things I looked at and passed on: SHA-256 and Scrypt (owned by ASICs), Ethash and KawPow
(GPU-oriented), CryptoNight (ASICs showed up, everyone moved off it), and anything new or
home-grown. Designing a PoW function is designing cryptography, and I don't want to do that.

### Key rotation

The RandomX key for a block at height `h` is the hash of the block at `seed_height(h)`. The key
changes every 2048 blocks, 64 blocks after the epoch boundary. This is exactly Monero's scheme.
It stops anyone from precomputing datasets far in advance.

### Target

Read the 32-byte RandomX output as a little-endian 256-bit number `H`. The block is valid if
`H * difficulty < 2^256`. On average that takes `difficulty` hashes.

RandomX hashes the borsh-encoded header: version, height, previous hash, timestamp,
difficulty, tx root, state root, receipts root, coinbase and the proof-of-work enum (tag 0, then
the nonce, so the nonce is the last 8 bytes). The block ID is a separate, cheap hash:
`keccak256("LOKYX/header/v2" || header)`.

## Difficulty

LWMA-1 over the last 60 mined blocks. Genesis isn't counted because nobody mined it.

```
next = (sum(D) / n) * k / sum(i * solvetime_i)     where k = n(n+1)T / 2
```

Recent blocks get more weight, so it reacts within a few blocks when miners join or leave.

Each network also has a minimum block spacing S (50 s on testnet). No block can be valid in
the first S seconds after its parent, so nobody mines then, and LWMA runs on the part that is an
actual race: `solvetime - S` against a target of `T - S`. On testnet that's 10 s of racing per
60 s block, which keeps blocks between roughly 50 and 70 seconds instead of anywhere from one
second to several minutes.
That matters a lot on a CPU-mined chain where miners come and go.

Timestamp games are limited: solvetimes are forced monotonic and capped at 6T, the weighted sum
has a floor of k/10 (so difficulty rises at most 10x in one block), and difficulty never goes
below `min_difficulty`.

On a young chain with fewer than 60 mined blocks, the missing history is filled in as if those
blocks had arrived exactly on target at the starting difficulty. Otherwise two or three lucky
early blocks would dominate the average and send difficulty swinging. On testnet this keeps the
first hour steady instead of jumping several times over.

A block's timestamp must be later than the median of the previous 11 blocks and at least S
seconds after its parent. It can't be more than `future_time_limit` (15 s) ahead of the
validating node's clock. Such a block isn't treated as invalid, since it's usually just a fast
clock: the node ignores it without penalising the peer and will accept it once its time comes.
A block dated ahead by less than that is held until the node's clock reaches it, so setting
your clock forward doesn't get a block accepted any sooner.

## Fork choice

The best chain is the valid chain with the most cumulative work (sum of difficulties). On a
tie, the node keeps whichever it saw first, and remembers its tip across restarts so it doesn't
change its mind.

One place has a fixed rule instead of arrival order. When a header on the best header chain
turns out to be invalid, the node picks the best of the headers it has left: the most work, and
on equal work the lowest hash. Two nodes with the same headers then settle on the same one,
whatever order their hash maps happen to list them in. (It's about which branch to ask for next.
It decides nothing about validity.)

If a side chain gets heavier than the current one, the node:

1. finds the fork point;
2. rebuilds state along the new branch, validating every block;
3. switches only if every block is valid;
4. puts the transactions from the abandoned blocks back in the mempool.

Invalid blocks and anything built on them are remembered and never considered again.

Blocks are applied to the state in place, and the node notes the previous value of everything the
block touched (an undo note, one per block, for the last 256 blocks). Stepping a block off the tip
plays its note back, so a reorg costs the blocks involved and not the size of the state. If the
reorg reaches back past the notes (just after a restart, say), the node rebuilds from a snapshot
it keeps every 100 blocks (the newest 50 are kept) and replays from there. If a branch turns out
invalid part-way, its blocks are taken off and the old chain put back. Tests check that every
route gives exactly the state a node that only ever applied the winning chain would have.

### What the node keeps on disk

This is the node's own database, not part of the protocol, but it decides how fast a restart is.

- every block body in the best chain, plus side-chain bodies close enough to the tip to matter.
  Headers are held in memory; bodies are read from the database when asked for, and only the
  newest 128 are kept in memory;
- the receipts of contract transactions on the best chain;
- the full state as of the last snapshot height (a multiple of 100), with the hash of its block.

On start the node reads the headers, and if it has a saved state it uses it only if its block is
on the chain it was following, it hashes to that block's state root, and its books balance. Then
it applies just the blocks after it. Blocks up to the saved state are taken as already checked,
since this node checked them when it first accepted them. `lokyxd --reverify` ignores the saved
state and checks every stored block again from genesis.

## Sync

Nodes sync headers first, then download bodies only for the branch they've decided to follow.
None of this is consensus: two nodes running different sync code still agree on which chain is
valid. It decides what a node bothers to download and store.

A node keeps three views of the block tree: every header it knows, the header chain with the
most work, and the chain it has actually applied. Bodies are fetched for the most-work header
chain, in order, and applied as they arrive.

**What gets kept.** A side branch is only worth anything if it could overtake the node's chain, so:

- a header is accepted only if its branch has more work than the node's chain had 100 blocks ago;
- a body is downloaded or stored only for the most-work header chain, or for a side block with
  more work than the node's chain had 6 blocks ago (so ordinary one or two block races still reorg
  instantly);
- side headers and bodies that fall behind those lines are deleted, from memory and from disk,
  every 16 blocks. Blocks a node stored before v6 that fall outside the lines are cleaned up the
  first time it restarts.

Forking from an early block, where difficulty was low, used to be a cheap way to fill a node's
disk. It now costs nothing to turn away: the blocks are never stored, their proof of work isn't
even checked, and their transactions are never looked at.

**Deep forks.** A peer's headers are collected across batches (up to 200,000 headers per peer)
and judged only once the branch beats the node's tip or the peer has nothing more to send. So a
heavier branch that forked thousands of blocks ago is still found, even though its first
batches on their own look worse than its own chain. Only 2 peers at a time may hold more than 2,000
collected headers; others are asked to wait. A branch more than 200,000 blocks deep can't be
followed automatically.

**Checking headers.** Each header is checked fully (version, height, timestamp rules,
difficulty) except for RandomX, which is the slow part. On arrival, 1 in 32 headers is checked,
plus the last of each batch. Before anything is kept, the rest are checked too, on all cores.
One bad header rejects the whole batch and costs the peer 100 points.

**Body checks.** A body must match its header's transaction root. A mismatch is the sender's
fault, not the block's: the header stays and the body is fetched again, from someone else if
need be. A body that matches but has a bad transaction signature, too many transactions or too
much gas is invalid, and so is everything built on it. All of this is checked before the body
is stored.

**Fresh nodes.** Each release sets two numbers for its network:

- `min_chain_work`: a new node downloads no bodies until it's seen a header chain with at least
  this much work, so a fake low-work chain can't waste its time;
- `assume_valid`: a block hash. Headers on the way to it skip the RandomX check; everything after
  it, and every header on a chain that doesn't contain it, is checked as usual. Transactions are
  always checked.

Both are published in the release notes so anyone can check them against their own node (see
TESTNET.md, "Release values"). Getting them wrong can only make a node slower or more cautious;
neither can make it accept an invalid block.

A node doesn't mine, and `lyx_getWork` refuses, while its best known header is more than 6 blocks
ahead of what it has applied.

## Coin and emission

| | |
|---|---|
| Unit | 1 LYX = 10^18 base units |
| Genesis | built from parameters, pays nobody |
| Premine / treasury / dev fund | none |
| Block reward | 10 LYX, halving every 1,051,200 blocks (about 2 years at 60s) |
| Tail | 0.5 LYX per block forever, from the 6th era |
| Supply after 5 eras | 20,367,000 LYX, then +262,800 LYX/year |
| Hard cap | none |
| Fees | go to the miner |
| Reward lock | rewards and fees unlock after `coinbase_maturity` blocks (60 on testnet, 10 on devnet) |
| Minimum fee | 10^12 base units per byte (a transfer costs about 0.000137 LYX) |

The tail emission is a deliberate choice. Once halvings run out, miners still need to be paid
for securing the chain. Fees alone are a big bet. Monero made the same call.

Treat these numbers as a draft until a public network launches. After that, changing them is a hard fork.

### Checking supply yourself

Block rewards are the only way LYX is created. Every node tracks total issuance while it
applies blocks, and the number is part of the state root in every header. `lyx_getSupply` gives
you three numbers computed independently:

- issuance tracked in state;
- the closed-form schedule;
- the sum of every account balance.

It also tells you whether all three agree. `inContracts` is how much of that is held by
contracts; it's part of the balances total, not on top of it.

Every node checks this for itself after every block it applies, and before it hands a miner a
block template: issuance has to match the schedule exactly, and balances plus locked rewards
plus open swaps plus pending vault withdrawals have to add up to it. If that ever fails, the
node stops applying blocks and stops mining, and says so loudly in its log and over RPC
(`halted` in `lyx_chainInfo`).

Stopping is deliberate. A supply check can only fail because of a bug in LOKYX, not because of
anything a peer can send, so carrying on would mean serving balances the node can't account for.
A node that has stopped is obvious; one quietly inflating its supply is not. Because it isn't
the sender's fault, the peer that happened to deliver the block isn't penalised and the block
isn't written off as invalid, so a fixed release can look at the same chain again.

## Addresses

```
lyx1 + bech32m( 0x00 || keccak256(uncompressed_pubkey[1..])[12..] )
```

- Bech32m (BIP-350). The checksum catches any error in up to 4 characters. Mixed case is
  rejected, and so is the older Bech32 checksum.
- The 20-byte payload is derived exactly the way Ethereum derives an account. The `lyx1...` string
  and the `0x...` hex are two spellings of the same bytes. LOKYX only uses the `lyx1` form.
- The leading version byte (0) leaves room for other address kinds later.
- HD path: `m/44'/7701'/0'/0/i`. 7701 is a placeholder until I register a SLIP-44 coin type.

## Transactions

```rust
Transaction {
    version: u8,              // 2; anything else is invalid
    chain_id: u64,
    from: Address,            // the account this acts on
    nonce: u64,
    expires: u64,             // last block it may be included in; 0 = never
    fee: u128,
    memo: Vec<u8>,            // public, opaque, at most 64 bytes
    op: Op,
}
SignedTransaction { tx, sig: Sig }
Sig::Secp256k1Recoverable { signature: [u8; 64], recovery_id: u8 }   // the only variant
enum Op { Transfer{to,value}, Batch(Vec<(Address,u128)>), Swap(SwapOp), Vault(VaultOp),
          Key(KeyOp), Timelock(TimelockOp), Token(TokenOp),
          Deploy{value,code,abi,input,gas}, Call{to,value,input,gas} }
```

- The signing hash is `keccak256("LOKYX/tx/v2" || borsh(tx))`. The prefix means a LOKYX
  signature can never double as an Ethereum one, or vice versa. The signature is an enum so
  that a post-quantum scheme can be added later without changing the transaction format; any
  variant other than `Secp256k1Recoverable` is rejected until then.
- The signature must be from the key that controls `from`: the account's own address until it
  rotates its key (below). `from` is in every transaction, so a rotated account needs no
  format change.
- Replay protection:
  - `chain_id` stops replays across networks (devnet 77701, testnet 77703);
  - a per-account sequential `nonce` stops replays on the same network;
  - `expires` stops an old signed transaction from being mined much later.
- Signatures must be low-S. The signer is recovered from the signature.
- There is no spend-limit field. Nothing a transaction does can move more of `from`'s LYX than the
  operation's signed amounts plus the fee: they are debited up front, and a contract call only moves
  the contract's own balance.
- A `Batch` is 1 to 256 LYX payments, none of them zero, none to a system address or contract.
- Plain payments and batches can't go to a system address or a contract (a contract takes a
  `Call`).
- One function, `State::spend`, takes LYX out of a sender's account for every operation, and
  charges a vault's daily allowance there (`Op::allowance_cost`). A new operation that moves
  LYX cannot skip it: `tests/allowance.rs` lists every `Op` variant with no wildcard.
- The fee is at least the size of the signed transaction times 10^12 base units, plus the whole
  gas limit times the gas price for contract operations.
- A transaction only applies if its nonce equals the account's nonce and the balance covers
  what it moves plus the fee.
- Decoding is strict (trailing bytes are an error), so a transaction has exactly one valid
  encoding. `testdata/vectors.json` holds a signed example of every operation, which the web
  wallet, the Snap, the phone wallet and Spoke check themselves against.

### Timelocks

`Timelock::Lock { beneficiary, amount, unlock_height }` takes `amount` from the sender into the
state. From `unlock_height` the beneficiary (only) claims it with `Timelock::Claim { id }`; nothing
sends it automatically. It can't be revoked, and the height can be at most 10 years ahead. The id
is the hash of the lock transaction. Open timelocks count toward supply.

### Tokens

`Token::Create { symbol, name, decimals, supply }` makes a token whose whole supply goes to the
creator; there is no mint afterwards. It burns a fixed amount of LYX (`TOKEN_CREATE_BURN`, a
placeholder until the emission numbers are set), counted in `State::burned`. The token id is the
hash of the creating transaction. `Transfer` and `Burn` move or destroy tokens; balances are never
stored as zero. Vault accounts can't create or hold tokens, tokens can't be sent to a vault, and
an account that holds tokens can't become a vault.

### Key rotation

`Key::Rotate { new_key }` hands `from` to another key (the hash of its public key) after a delay:
the vault's own delay on a vault account, one day otherwise. Until then the old key signs as before
and can cancel with `Key::CancelRotate { account }`, and so can a vault's recovery address (the
vault pays the fee). One rotation can be waiting per account. The nonce and the quantum commitment
stay with the account. Rotating a plain account does not stop someone who holds its current key from
spending it at once: wallets say so ("Key stolen? Rotation won't save your funds. Sweep your vault
or move your funds now.") and offer rotation for planned changes and lost devices.

Mempool policy (not consensus: a node can choose differently without disagreeing about which
chain is valid):

- A transaction with the same sender and nonce as one already waiting replaces it if it pays the
  old fee plus at least the minimum for its own size. So raising a fee costs what the network
  spends carrying the second copy, and replacing is never cheaper than paying properly the first
  time. The replacement still has to be affordable alongside the sender's other pending
  transactions.
- When the pool is full, the lowest fee per byte is dropped to make room, and a sender's later
  nonces go with it, since nothing after a gap could be mined. A transaction that pays less than
  everything already waiting is turned away rather than displacing anything.

## Block 0

Block 0 has no transactions, no reward and no miner, and every node builds the same one from
the network parameters. It has no block before it, so its parent hash is used for something
else: `keccak256("LOKYX/genesis/v1" || message)`. Every block after it chains back to that
hash, so the message is part of the chain's identity, and changing one character gives a
different chain. Anyone can recompute it.

The testnet message:

> 29 Oct 2026: $6.3 billion left Binance in twenty minutes. Whoever holds your keys holds your
> coins. LOKYX begins holding no keys for anyone.

## Blocks and state

- Blocks are limited to 1 MB and 5,000 transactions, and the gas limits of the contract
  transactions in a block can't add up to more than 50,000,000.
- The tx root is a merkle tree with separate leaf and node prefixes, so there's no
  duplicate-leaf trick.
- The header (version 2) is `version, height, prev_hash, timestamp, difficulty, tx_root,
  state_root, receipts_root, coinbase, pow`, hashed under `"LOKYX/header/v2"`. `pow` is an enum
  with one variant, `Native { nonce }` (RandomX over the header bytes, the nonce last); any other
  tag fails to decode. A second kind of proof (merge mining) can be added later at an activation
  height without a new header format.
- `state_root` is the root of the state trie below. Nodes keep it up to date by touching only
  the entries a block changed; a from-scratch rebuild is the reference and tests check the two
  agree after every block.
- `receipts_root` is a merkle root over the block's contract transactions, in order. A leaf
  commits to the receipt's ordinal, the tx hash, success, gas used, fee paid, logs, the deployed
  address, and the output only if the call succeeded (an error message is not committed). A block
  with no contract transactions has the zero hash.

### The state trie

A binary trie over 32-byte keys, compressed so it only has a node where two keys part ways. Its
shape depends on which keys are present and not on the order they were added.

    leaf    keccak256(0x00 || key || value)
    branch  keccak256(0x01 || split bit (u16 BE) || the key bits before it, zero-padded || left || right)
    empty   keccak256(0x02)

A state entry's key is `keccak256("LOKYX/trie/key/v1" || section || key bytes)` and its value is
`keccak256("LOKYX/trie/value/v1" || borsh(value))`. Sections: 0 issued and burned, 1 accounts, 2
locked rewards, 3 open swaps, 4 vaults, 5 pending vault items, 6 quantum commitments, 7
contracts, 8 contract storage (contract address then slot key), 9 rotated keys, 10 pending key
rotations, 11 timelocks, 12 tokens, 13 token balances (token id then holder). Contract code and ABIs are named by hash
inside the contract entry, so they aren't separate entries.

A proof is the sibling hashes along the path, bottom first, and what the path ends in. It proves
a value is there, or that the key isn't (the path ends in a different leaf, or in a branch the
key doesn't belong under). The prefix is part of every branch hash; without it a present key
could be "proven" absent by showing its real parent branch with a made-up prefix, and a test
covers that exact attack.
- The coinbase earns `reward(height) + fees`, but it's held as a locked reward until
  `coinbase_maturity` more blocks are built on top. Then it moves into the miner's balance. This
  way a reorg can't erase coins that were already spent onward. Locked rewards count toward supply,
  so the supply check still adds up.

## Swaps

Hash-locked lock / claim / refund operations (`Op::Swap`), used for atomic
swaps with bitcoin and ether. Open locks are in the state and count toward supply. Details in
[SWAPS.md](SWAPS.md).

## Vaults

Accounts can turn themselves into vaults: a daily allowance, a delay on bigger withdrawals, and
a recovery key that can cancel or move everything to a safe address. Ops are `Op::Vault`. Pending withdrawals count toward supply. Details in [VAULTS.md](VAULTS.md).

## Quantum backup keys

An account can commit, once, to a post-quantum public key: a transaction with
`Op::Key(KeyOp::CommitPq { hash })`, where `hash = sha3-256(SLH-DSA-SHA2-128s public key)`.
It can't be replaced afterwards, so someone who steals the ECDSA key can't swap in their own.
Nothing uses it yet. If ECDSA ever becomes breakable, a planned upgrade can make committed
accounts sign with that key instead. Wallets derive the key from the recovery phrase
(`HMAC-SHA512("LOKYX/pq/v1", BIP-39 seed)`, first 48 bytes as the SLH-DSA seed), so there's
nothing extra to back up.

## Contracts

Contracts are Rust compiled to WebAssembly and run by the node in a deterministic interpreter,
metered with gas paid in LYX. A deploy is a transaction to a fixed deploy address (0x…0104) and
a call is a transaction to the contract's address. A failed call is still valid: it pays for the
gas it used and changes nothing else. A running contract can't be re-entered, and vault accounts
can't use contracts. Details in [CONTRACTS.md](CONTRACTS.md).

Each network says from which height contracts are allowed (`contracts_from`). Before that height,
or on a network where it isn't set, a block with a deploy or call in it is invalid, and the
mempool won't take one. Testnet and devnet have them from block 0. A mainnet would launch with
them off and turn them on at a fixed height in a later release, once the contract engine has been
audited and fuzzed.

## P2P

TCP, encrypted (protocol 8). Every message is a borsh-encoded frame of at most 8 MiB, carried
inside a Noise channel.

### Transport

- A connection opens with 8 clear bytes: `LYX8` and the protocol version (u32 BE). Anything else
  is hung up on without a reply.
- Then a `Noise_XX_25519_ChaChaPoly_BLAKE2s` handshake, each handshake message sent as a u16 length
  and the message. The prologue is `"LOKYX/p2p/8" || chain_id (u64 BE) || genesis hash`, so
  handshakes between networks fail. The whole handshake has 10 seconds.
- Afterwards each frame is a u32 BE length followed by the data, together cut into Noise messages
  of at most 65,519 plaintext bytes; each goes out as a u16 length and ciphertext. The nonce is a
  per-direction counter. A frame declared larger than 8 MiB, an empty message, bytes past the end
  of a frame, a message that fails to decrypt, and a replayed or reordered message each end the
  connection.
- A node's identity is its static X25519 key, kept in `node.key` (mode 0600) in the data
  directory with the secret for its address tables. A missing key is created; an unreadable one
  is moved to `node.key.bad` and replaced, with a warning. It replaces the old random nonce:
  connecting to your own key is a self-connection, two connections to one key are a duplicate.
- Seed entries may be `host:port#<64 hex characters>`. Dialling such an address, a different key
  from the responder ends the handshake before the node's key is sent. Gossiped addresses are not pinned.
- Nothing is ever sent in the clear after the 8 opening bytes, and a plaintext message is never
  handled as one. A node on another protocol version is disconnected during the handshake or
  at `Hello`, and logs the version it runs.

| Message | |
|---|---|
| `Hello` | magic, protocol version, chain id, genesis hash, best height and work, listen port, user agent |
| `GetHeaders` / `Headers` | locator-based header sync, up to 2,000 headers per reply |
| `GetBodies` / `Bodies` | full blocks by hash, up to 64 per request (more than 256 asked at once is a protocol violation) |
| `NewBlock` | announce a new tip |
| `NewTx` | relay a mempool transaction |
| `GetPeers` / `Peers` | address exchange: each address comes with its last-heard time and the static key it is said to have. `Peers` is only taken as the answer to a `GetPeers` the node sent; one nobody asked for costs 10 points and changes nothing. At most 250 addresses (more costs 20 points and none are kept). A peer answers a given peer's `GetPeers` once per 10 minutes. Asking again sooner costs 10 points |
| `BlockRelayOnly` | sent once, right after `Hello`, by the side that opened a blocks-only connection. Neither side then sends transactions, `GetPeers` or `Peers` over it. A transaction on it costs 10 points |
| `Ping` / `Pong` | keepalive and round trip time; idle peers are dropped after 90s |

A message added at the end of the list doesn't renumber the ones before it, so `BlockRelayOnly`
was added without changing anything else on the wire. `Peers` changed from a list of strings to
a list of (address, key, time) in the same release as the transport, which nothing deployed
speaks.

Peers can be given as hostnames or IPs. Each network can list built-in seeds in
`ChainParams::seeds`, as `host:port` or `host:port#<key>[,<key>]` (the key is 64 hex characters;
two while a seed's key is being replaced, and either is accepted). A node with no peers looks
those names up again every minute.

### Addresses

The node keeps the addresses it knows in two tables, built like Bitcoin's address manager and
for the same reason: whoever controls many addresses, or a whole hosting range, must not be able
to fill the tables and decide who the node talks to.

- A **group** is an IPv4 /16 or an IPv6 /32. (An address on this machine counts as a group of its
  own, so a local test network can connect to itself.)
- The **new** table (256 buckets of 32) holds addresses heard of and never connected to. The
  bucket depends on a secret kept in `node.key`, the group of the peer that told it and the
  group of the address, so one source group can reach at most 64 buckets however many addresses
  it sends. A taken slot keeps its address unless that one is stale (not heard of for 30 days) or
  has failed 3 dials without ever answering.
- The **tried** table (64 buckets of 32) holds only addresses the node completed an outbound handshake
  with. One group reaches at most 8 buckets of it. If the slot is taken, the occupant is dialled
  as a test: it keeps its place if it answers, and the newcomer stays in new if so.
- The key an address is said to have is kept with it. A key shown in a handshake replaces what the node
  was told and is never replaced by hearsay. If a connection shows another key than the one it
  holds: when it was only told it, the claim is dropped and the address stays; when a handshake gave
  it to the node, the address is forgotten. (Otherwise gossiping wrong keys would get honest addresses
  thrown out.)
- **Outbound connections:** 8 full ones, and 2 that carry blocks only (nothing leaks about whom
  it trades transactions with). At most one outbound connection per group. Each pick is from tried
  or new with equal chance, a random bucket and a random slot in it. Seeds are used only when the
  tables hold fewer than 50 addresses or no peer has been connected for 60 seconds.
- **Anchors:** the blocks-only peers are saved and dialled first after a restart. The tables are
  saved every 15 minutes and at shutdown, in the node's database.
- **Feelers:** every 2 minutes one short connection to a random address from new. If the
  handshake works, the address moves to tried and the node hangs up.
- **Inbound slots** (32): when they're full and another node connects, one is dropped, unless
  every one is protected. Protected are the 4 connected the longest, the 4 quickest to answer a
  ping and the 4 that last gave the node a block that became its tip. The victim is the newest
  connection from the address group with the most of them. At most 4 connections per IP, and 32
  in all, can be in the middle of their handshake at once.
- **Isolation:** `lyx_netHealth` reports three signs, and the node logs a warning when they
  change: the tip is more than 30 minutes old; there are outbound peers but in fewer than 3
  groups; there are no peers. A stale tip opens one extra outbound connection to a group it has
  no peer in. It is kept if its peer has more work than the node does, and dropped after 5 minutes (or when
  the tip is fresh again) if not, and the next goes elsewhere. **Nothing else happens: mining is
  never paused.** A stale tip may be an eclipse or a real fall in hashrate, and a miner that
  stopped itself on the first would be doing the attacker's job.

At the handshake, a node drops peers on a different network (magic, chain id or genesis).
It also notices when it has connected to itself or twice to the same peer.

Defences against bad peers:

- frame size and per-peer message rate limits (400/s);
- misbehaviour scores: an invalid block or header costs 100 points, which means a disconnect and a one-hour ban (loopback is never banned); a body that doesn't match its header costs 50;
- at most 32 inbound peers (see Addresses for who gets dropped when full), and the node tries to keep 8 full outbound connections and 2 blocks-only ones;
- PoW is checked before the chain lock is taken;
- headers are only taken from a peer the node asked, with one request to each peer at a time; headers
  nobody asked for cost 20 points;
- a peer is only asked for headers if it says (at the handshake) its chain has more work than
  ours. If its headers then end with less work than it said, that's a lie and costs 100 points;
- a header request not answered in 60 s costs 50 points and frees whatever the peer was holding,
  so a quiet peer can't keep one of the two long-sync slots;
- a peer may be fetching at most 128 bodies for the node at once. A body request not answered in 60 s
  costs 10 points and goes to another peer; bodies come from a random peer among those that have
  let the fewest requests run out. Bodies nobody asked for are dropped unread;
- what a peer says about its height never decides who the node syncs from. Only claims at the handshake
  (checked as above) and blocks accepted from it count.

Version 6 replaced `GetBlocks`/`Blocks` and the orphan pool with the header sync above. Nodes on
different protocol versions don't connect.

Not built: compact block relay (decided against for now, see STATUS.md), and Tor or I2P.
Seeds can be pinned, but an address learned from a peer is only checked against the key that peer
claimed for it, so a man in the middle on an address nothing certain is known about isn't stopped.

## Networks

| | devnet | testnet |
|---|---|---|
| Chain ID | 77701 | 77703 |
| Block time | 15s | 60s |
| Minimum spacing | 10s | 50s |
| Max time ahead | 15s | 15s |
| Starting / minimum difficulty | 100 / 10 | 400 / 40 |
| Reward lock | 10 blocks | 60 blocks |
| P2P / RPC ports | 17701 / 18701 | 27701 / 28701 |
| Seeds | none | testnet.lokyx.xyz:27701 (pinned to its key) |
| P2P protocol | 8 | 8 |
| Contracts from | block 0 | block 0 |

Consensus is supported on x86-64 and aarch64 only. Nothing in it depends on the platform, and
the state roots, a replayed chain and the contract recursion depth are checked to come out the
same on both (see STATUS.md). 32-bit targets, armv7 included, are not supported; the Android
miner ships arm64 builds only.

The testnet's starting difficulty assumes a handful of laptops mining in light mode. LWMA moves it
to wherever the real hashrate is within a few dozen blocks.
