# Phase 3: p2p protocol 7

Design, 12 Nov 2026. Built the same day; "As built" at the end lists where the code differs from
the design. Compact relay stays out (decided in Phase 2).

Today: plain TCP, `Hello` in the clear, and an in-memory set of at most 1,000 addresses filled by
unsolicited `Peers` lists, lost on restart. The only isolation check is "zero peers".

## 1. Encrypted transport

**Pattern: Noise XX**, `Noise_XX_25519_ChaChaPoly_BLAKE2s`, through the `snow` crate. IK needs
the responder's key before dialling, and a key learned by gossip is worth no more than none. XX
exchanges both static keys in the handshake and still lets the node compare against one it expected.

What it buys: full protection from passive observers and from middleboxes rewriting plaintext.
Against an active man in the middle, on a peer whose key the node didn't know, nothing; that's BIP324's
position too, and the answer is the same: pin keys where they are known.

- **Prologue:** `"LOKYX/p2p/7" || chain_id || genesis hash`. A handshake between networks fails
  before any message is read.
- **Pinning:** seed entries become `host:port#pubkey`. On an outbound connection to a pinned
  address, the responder's static key from handshake message 2 must match, or the node hangs up before
  sending message 3. Addresses learned from peers carry the sender's claimed key; a mismatch on
  connect drops the address, it doesn't ban the IP (the key may simply have been rotated).
- **Identity key:** a random X25519 key created on first start, saved as `node.key` in the data
  directory with mode 0600, never derived from or near wallet keys. The same file holds the
  address-table secret (section 2). It replaces `node_nonce`: talking to its own static key is a
  self-connection; two connections from one key are a duplicate.
- **Framing:** frames (still up to 8 MB) are split into Noise messages of at most 65,519
  plaintext bytes. Any decryption failure ends the connection.
- **Hello** moves inside the channel, unchanged except that `node_nonce` goes.
- **Handshake limits:** 10 s to finish; at most 4 in flight per IP, 32 in total.
- **Refusing protocol 6:** a v7 connection opens with 8 clear bytes: `LYX7` and a u32 version.
  A v6 node sends a u32 frame length first, which can't equal `LYX7`. When a v7 listener sees a
  v6 frame, it answers with one plaintext v6 `Hello` saying `protocol_version: 7` and closes, so
  the old node logs the "this node needs updating" warning it already has. No v7 node ever sends
  application data in the clear.

**Tests.** A v7 pair handshakes and exchanges headers. Devnet and testnet nodes can't complete a
handshake (remove the chain id from the prologue → fails). Wrong pinned key → refused (remove the
check → fails). A flipped ciphertext byte ends the connection. A v6 client gets one v6 `Hello`
with version 7 and nothing else, and a plaintext `Hello` to a v7 node is never handled as a
message (any plaintext fallback → fails). Connecting to yourself is caught (remove the key
comparison → fails). Frames of 0, 65,519, 65,520 bytes and 8 MB round-trip.

## 2. Eclipse protection

Today an eclipse only takes filling the node's 1,000 addresses. The plan is a cut-down Bitcoin address
manager.

- **Groups:** an IPv4 /16 or an IPv6 /32. (An AS map would be better; see decisions.)
- **New table:** 256 buckets × 32 slots, for addresses heard about but never connected to.
  Bucket = `H(secret, group of the source, group of the address)`, so one source can reach at
  most 64 buckets whatever it sends. Slot = `H(secret, bucket, address)`. A full slot keeps the
  existing entry unless it's stale or has failed 3 times.
- **Tried table:** 64 × 32, only for addresses the node has completed an outbound handshake with.
  Bucket = `H(secret, address)` within `H(secret, group)`, so one group reaches at most 8 buckets.
  An eviction collision is resolved by test-connecting the incumbent; it stays if it answers.
- **The secret** is in `node.key`, so an attacker can't work out which addresses collide.
- **Gossip:** `Peers` only as an answer to its own `GetPeers`, at most once per 10 minutes per peer,
  at most 250 entries, each with a timestamp and (v7) the peer's key. Unsolicited lists cost
  points.
- **Choosing outbound peers:** half from tried, half from new, by random bucket then random slot,
  with at most **one outbound per group**. Plus two **block-relay-only** connections (headers and
  blocks, no transactions, no addresses), which leak nothing an attacker could use to find them.
- **Feelers:** every 2 minutes, one short connection to a random new-table address, moving it to
  tried if it answers.
- **Inbound eviction** when full: protect the 4 longest-connected, 4 lowest-ping and 4 that
  last gave the node a block; evict from the group with the most connections.
- **After a restart:** the tables are saved to the database every 15 minutes and on shutdown. The
  two block-relay peers are saved as **anchors** and dialled first. Seeds are used only if the
  tables have fewer than 50 addresses, or after 60 s with no connection.
- **Detecting isolation:** (a) the tip is older than 30 minutes, which at this block spacing is
  unlikely unless something's wrong: open one extra outbound to a group it has no peer in, and
  keep it if it has more work; (b) all outbound peers in fewer than 3 groups; (c) zero peers.
  Each sets a flag in a new `lyx_netHealth` RPC, logs a warning, and shows in the wallet.

**Tests,** on a simulated address table with a fixed secret, so they're exact. One source flooding
10,000 addresses from one /16 fills at most 64 of 256 new buckets (bucket by address only →
fails). Flooded addresses never reach tried without a handshake (skip that rule → fails). From a
table where 90% of addresses share a /16, the 8 outbound picks include at most 1 from it (drop
the group rule → fails). After a restart the first two dials are the anchors, and the tables
match what was saved. A stale tip at simulated time +31 min opens an extra connection and sets the
flag; at +29 min it doesn't (remove the check → fails). 32 inbound from one /16 plus one honest
inbound: the eviction takes from the flood and the protected peers stay. Unsolicited `Peers`
changes nothing in the tables.

## 3. Determinism

Consensus is integer-only: emission, LWMA difficulty and gas are u64/u128, wasm floats are off,
borsh fixes the byte order, and overflow checks are on in release. The remaining risks:

- **Iteration order.** The state is all BTreeMaps (sorted), and the commitment and trie sort by
  key. `HashMap` is used in the chain index and a module cache, which don't feed the state root,
  but `recompute_best_header` scans a `HashMap` and could pick different equal-work headers on two
  nodes. That's fork choice, not validity, but it should be deterministic anyway: on equal work,
  the lower hash.
- **Time.** Validity uses header timestamps and median time past only. The local clock decides
  only when a future block is looked at again (held, not rejected); documented, stays.
- **RandomX** has different JITs on x86-64 and aarch64, plus the interpreter.
- **wasmi**'s call-depth limit should not depend on the native stack. Assumed, not checked.
- **32-bit**: heights are cast to `usize`. Fine for centuries, but untested.

**Tests.** The golden state roots (`tests/golden.rs`) and the RandomX vectors run on x86-64 and,
through `cross` and QEMU, on aarch64 and armv7, plus once per release on a real ARM board and a
phone. A replay fixture: the first 3,000 testnet blocks exported to a file and replayed, checking
every header's state root; it has to pass on every target. A test that builds the same state
twice in one process with different insertion orders and compares roots (a `HashMap` in the
commitment → fails, deterministically, because each `HashMap` gets its own hasher seed). A
`clippy::float_arithmetic` deny on the consensus modules (add a float → the lint fails). The wasm
recursion test checks the exact depth at which it traps, on every target.

## 4. Upgrade

Protocol 7 changes no consensus rule, so the chain can't fork; but v6 and v7 nodes can't talk, so
the network splits until everyone has upgraded. Mainnet will launch on v7, so a mixed network only
matters on the testnet. That's why I'd do a hard cut, as with 0.3.0, and not carry a plaintext
fallback that would have to be removed later.

1. Rehearse on a local devnet with one 0.3.0 and two 0.4.0 nodes: the old one logs the update
   message, the new ones sync and mine.
2. Publish 0.4.0 with the seed's new static key in `seeds` and in the release notes.
3. Upgrade the seed node. Its `node.key` gets backed up then, since pinned keys depend on it.
4. Announce: "upgrade now; 0.3.0 nodes will see no peers".
5. Record in TESTNET.md what happened, as last time.

## 5. Risks

- `snow` joins the network path: pinned version, covered by `cargo audit`.
- Active MITM still works against unpinned peers.
- One outbound per /16 may starve a small network where nodes share hosting; the testnet will
  show it.
- Stale-tip detection fires on real hashrate drops too, so it only ever adds connections.

## Decisions for you

1. Noise XX with pinned seed keys (recommended), or IK with keys in every address.
2. Cipher suite `25519_ChaChaPoly_BLAKE2s` through the `snow` crate (recommended), or a
   hand-written transport on `chacha20poly1305` and `x25519-dalek`.
3. Gossiped addresses carry the sender's static key in v7 (recommended).
4. A missing or unreadable `node.key`: make a new one with a warning (recommended), or refuse to
   start. Seeds should back theirs up either way.
5. Hard cut on the testnet, no plaintext fallback (recommended).
6. Outbound diversity by /16 now (recommended), or ship an AS map now.
7. Isolation: warn and add connections only (recommended), or also pause mining.
8. Two block-relay-only outbound connections (recommended).
9. Which platforms consensus officially supports: x86-64 and aarch64 (recommended), and whether
   armv7 phones are in or out.
10. Tie-break equal-work headers by lower hash when the best header is recomputed (recommended;
    node behaviour, not consensus).
11. Tor and I2P: not in v7 (recommended).

## As built

Decisions 1 to 11 as recommended; armv7 is out (decision 9); `node_nonce` goes in the Phase 4
freeze. Where the code differs from the text above:

- **Gossiped keys** are kept with the address, but a key a handshake gave the node is never replaced by
  hearsay, and a mismatch is handled by where the key came from: only told, drop the claim and keep
  the address; proven, forget the address. (Dropping on any mismatch would let anyone get honest
  addresses thrown out by gossiping wrong keys.)
- **Seed pins take a list** (`host:port#k1,k2`) so a seed's key can be replaced without locking
  anyone out. This is the rotation procedure in TESTNET.md.
- **Seeds live outside the tables.** They're dialled only when the tables hold fewer than 50
  addresses or no peer has been connected for 60 s, and enter the tried table when a handshake
  with them works.
- **Blocks-only connections** are marked by a new `BlockRelayOnly` message right after `Hello`
  (the `Hello` layout can't change: protocol 6 nodes read it in the update reply).
- **Eviction** counts group by IP only (the port is ignored), and the protected sets are 4/4/4.
- **Extra connection:** kept if the peer has more work than the node has, otherwise dropped after 5
  minutes (or when the tip is fresh again), after which the next one goes to another group.
- **Determinism tests** that mutate nothing in production code: the miner's own VM can't run under
  the cheap test hash, so the "isolation never pauses mining" test uses real RandomX at difficulty 2
  (`tests/isolation.rs`).
- **Not done:** running on aarch64 (needs the ARM runner in CI), an AS map, Tor and I2P.
