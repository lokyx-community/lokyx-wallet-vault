# Phase 4: the format freeze

Design approved and **built**, 12 Nov 2026 (see "As built" at the end). After this phase the transaction, block header and
state formats are the ones a mainnet launches with. Later changes are new versions or hard forks,
not edits.

Today a transaction is `{ chain_id, nonce, to, value, fee, data }` (137 bytes for a transfer),
the sender is recovered from the signature, and system operations are marked by a magic `to`
address with borsh in `data`. The header is about 160 bytes, RandomX hashes all of it, and
`state_root` is the flat `"LOKYX/state/v4"` hash; the trie exists but nothing commits to it.

## 1. Transaction format v2

```
Transaction {
  version: u8,          // 2
  chain_id: u64,
  from: Address,        // the account; see section 4 for why it's needed
  nonce: u64,
  expires: u64,         // last height the tx may be included at; 0 = never
  fee: u128,
  max_out: u128,        // most LYX that may leave `from`, fee included (decision 5)
  memo: Vec<u8>,        // at most 64 bytes, public, opaque
  op: Op,
}
Op = Transfer { to, value } | Batch(Vec<(Address, u128)>) | Swap(SwapOp) | Vault(VaultOp)
   | Key(KeyOp) | Timelock(TimelockOp) | Token(TokenOp) | Deploy { .. } | Call { to, value, input, gas }
```

The signature stays recoverable secp256k1 under the new tag `"LOKYX/tx/v2"`. It's valid when the
recovered key is the one `from` is currently controlled by. A plain transfer is 183 bytes, 167
without `max_out`.

- **Typed operations instead of magic addresses.** "Vault ops carry no value" becomes something
  the encoding can't express, rather than a rule someone has to remember. Swap locks carry their
  amount inside `SwapOp::Lock`. The system addresses stay reserved so nobody can send to them.
- **`from`** is needed for rotation, and lets the mempool check nonce and balance before ECDSA
  recovery.
- **`expires`:** a block at a height above `expires` that contains the tx is invalid. The mempool
  drops expired transactions as the tip moves, along with the same sender's later nonces. By
  default the wallet sets the current height plus one day.
- **`memo`:** exchange deposit references and notes, charged per byte. Public forever; the
  wallet says so.
- **`Batch`:** LYX only, 1 to 256 payments, no zero amounts, no system addresses. Paying a
  contract address only credits it and doesn't call it, the same as `Transfer`. For a vault, the
  whole sum counts against the allowance.
- **Hello:** drop `node_nonce`, protocol 8. Safe because the version is in the clear preamble,
  checked before `Hello` is read. The plaintext notice to protocol 6 nodes goes too.

**Test plan.**
- Shared vectors (`testdata/vectors.json`) for every `Op`; the node, web app, Snap, lokyx-wallet
  and Spoke's `tx.ts` must produce the same bytes and hash.
- Decoding rejects trailing bytes, unknown version or `Op` tag, a memo over 64 bytes.
- Expiry: accepted at `expires`, rejected at `expires + 1`; later nonces leave the mempool with
  it; a reorg that brings back an expired tx drops it.
- `max_out` on a contract call that moves more than allowed; a valid signature whose key doesn't
  control `from`; batch overflow, 257 payments, a zero payment, a vault over its allowance.
- Every rule removed once, and a test must fail.

## 2. Built-in timelock and token

Both use the same pattern as swaps: an id equal to the hash of the creating transaction, a state
section, and an entry in the supply check.

**Timelock** (capsules, savings jars).
- `Lock { beneficiary, amount, unlock_height }` and `Claim { id }`.
- The beneficiary claims at or after `unlock_height`. The claim fee comes out of the locked
  amount, as with swap claims, so an empty account can still claim.
- A lock can't be revoked, because a savings jar the creator can break isn't one. It's limited
  to 10 years ahead.
- Height rather than time, like swaps and vaults. The wallet converts and shows an estimated date.
- Claimed, not released automatically, so a block's work stays proportional to its own
  transactions. (Vault pending items are released automatically and the whole set is scanned
  every block; that gets an index by release height, which changes no rule.)

**Token** (fungible: create, transfer, view).
- `Create { symbol ≤ 8 chars A–Z0–9, name ≤ 32, decimals ≤ 18, supply }` mints the whole
  supply to the creator.
- `Transfer { token, to, amount }`.
- `Burn { token, amount }`.
- There's no mint after creation (decision 8). Symbols aren't unique, so the wallet shows the id
  and warns when a symbol is already taken.
- Creating a token burns a fixed amount of LYX. A miner would get a fee back, so a fee doesn't
  stop the miner from spamming. The burn is tracked as `burned` in the state, and the supply
  check becomes `issued − burned = everything held`.
- No tokens in vaults (decision 10). Otherwise "anyone can airdrop dust into your vault" makes a
  sweep unbounded. Transfers to vaults, contracts and system addresses are rejected. Contracts
  can't see built-in tokens in this version.

**State:** new trie sections `timelocks` (11), `tokens` (12) and `token_balances` (13, key =
token id ‖ address), plus `burned` next to `issued` in section 0.

**Test plan.**
- Claim one block early rejected, at the height accepted; only the beneficiary, only once, fee
  from the lock.
- Per-token invariant after every block (balances + burned = supply) and the LYX one with
  `burned`, each with a test that breaks the books and must be caught.
- Tokens to a vault, contract or system address rejected; symbol rules; create without the burn.
- Apply and undo a block touching every new section: root unchanged. Golden scenario extended.

## 3. Block header

```
BlockHeader { version: 2, height, prev_hash, timestamp, difficulty, tx_root,
              state_root,      // trie root
              receipts_root,   // Merkle root of contract receipts (decision 12)
              coinbase, pow: Pow }
Pow = Native { nonce: u64 } | MoneroAux(MoneroProof)   // MoneroAux: see below
```

**State-trie root.** `state_root` becomes `trie().root()` over the sections in `trie_entries()`
plus the new ones. The trie has to be kept up to date block by block, under the undo notes;
rebuilding it per block is O(state). A native header is about 200 bytes. RandomX still hashes the
borsh header, and the nonce is still at a fixed offset that `lyx_getWork` reports, so the Android
miner needs no change.

**Merge mining with Monero: how the proof works.** A Monero miner puts one 32-byte root into its
coinbase `tx_extra` (the merge-mining tag, `0x03`). That root is the top of a small Merkle tree of
aux chains. LOKYX's leaf is `aux_hash = H("LOKYX/mm/v1" ‖ header without pow)`. Its slot in the
tree is `SHA256(genesis hash ‖ aux_nonce ‖ "m") mod n`, which is p2pool's scheme. A RandomX hash
of that Monero block's hashing blob that meets LOKYX's difficulty proves LOKYX work.

`MoneroProof` holds:
- the Monero header (version, timestamp, prev_id, nonce),
- the RandomX seed hash,
- the transaction count,
- the coinbase as a Keccak midstate plus the tail of its prefix,
- the coinbase's branch to the Monero tx root,
- the aux branch.

A node verifies it in these steps:
1. Walk `aux_hash` up the aux branch at its slot to the tag's root.
2. Finish Keccak over the tail to get the prefix hash. The coinbase hash is
   `keccak(prefix ‖ keccak(0x00) ‖ 0³²)`.
3. Walk the coinbase branch, where the coinbase is leaf 0 of Monero's `tree_hash`.
4. Hash `header ‖ root ‖ varint(count)` with RandomX keyed by the seed hash, and compare it with
   LOKYX's target. The comparison is the same as Monero's, hash × difficulty < 2²⁵⁶.

Two rules make the proof safe:
- **Exactly one reading.** The tail must end with the tag. The verifier tries every length of
  the tag's parameter varint (1–10 bytes) and rejects the proof unless exactly one reading is
  well formed. Otherwise a crafted coinbase could name two slots and make one unit of work count
  for two LOKYX blocks at once. This assumes p2pool writes the tag last in `tx_extra`, which has
  to be checked against its source. If it doesn't, the proof carries the whole coinbase prefix
  and is parsed from the start.
- **The seed can't be fixed forever.** LOKYX can't check that a seed is really Monero's. A seed
  is valid only within 4,096 blocks of its first use on that branch, the same idea as Tari's
  3,000-block rule. Without this rule, someone could keep one dataset forever, which is what
  RandomX's key changes exist to prevent.

**Size.** About 0.9 KB, capped at 2 KiB, so 2,000 headers fit in the 8 MB frame. A node keeps
only the hash of a checked proof in RAM.

**What pools must do.**
- **p2pool:** no code changes. lokyxd implements p2pool's three merge-mining RPC methods
  (`merge_mining_get_chain_id`, `merge_mining_get_aux_block`, `merge_mining_submit_solution`),
  and an operator runs `--merge-mine <lokyx node> <lyx1 address>`. The LYX goes to the address
  that operator gave.
- **Centralised pools:** they have to change their software. They put the tag in their coinbase,
  call the same RPC and pay LYX out to their miners.
- **Solo Monero miners:** a small proxy between XMRig and monerod, like Tari's; not consensus.
- lokyxd hands out aux jobs only once the parent is `min_block_spacing − 15` s old.

**If no pool adopts it,** nothing breaks. Native mining goes on and `MoneroAux` is never used.
The chain is then secured by its own small RandomX hash rate: any Monero pool, or rented hash
rate, bigger than that can out-mine it, and at today's sizes that's a sliver of Monero's. That's
true with or without merge mining. Merge mining
only makes honest Monero hash power free to join, and it also makes an attack by a Monero pool
free. What it costs even unused is a verifier in the consensus code that has to be audited.

**The option of an empty, versioned field now.** Freeze `pow` as an enum with only `Native`
defined, and reject any other variant. `MoneroAux` is added later at an activation height. That
is a hard fork, but a small one: the header layout, block id, `lyx_getWork` and every header
parser stay as they are, and the enum costs one byte per header. This option is recommended
(decision 11). It should be built before mainnet once p2pool operators or a pool have said
they'll run it, because after launch every fork costs more.

**Test plan.**
- Golden roots and replay digest regenerated once, in their own commit, reason stated: the one
  sanctioned change of those values.
- Incremental trie root equals a from-scratch build after every block of the golden scenario and
  a 2,000-block random run with reorgs.
- Unknown `pow` variant rejected; `lyx_getWork` offsets round-trip; the phone example miner mines
  on devnet.
- `MoneroAux`, when built: vectors from real Monero blocks (the blob and hash equal Monero's PoW
  hash); p2pool on stagenet with `--merge-mine` against devnet; mutations (tag twice, two
  readings, wrong slot, old seed, oversize proof, header changed after proving); the seed rule
  across a reorg.

## 4. Key rotation with delay and cancel

**Yes, it changes both formats, so it belongs in this freeze.** Today an account is whoever's key
recovers to its address. After a rotation the signer's key hashes to a different address, so a
transaction has to name its account (`from`, section 1). The state has to record which key
controls an account, plus any rotation waiting. Adding `from` later would be a second
transaction format change.

- **Ops:** `KeyOp::Rotate { new_key: Address }` and `KeyOp::CancelRotate`. `new_key` is the
  hash of the new public key, in the same form as an address.
- **State:** section 9, `keys` (account → controlling key, present only once rotated), and
  section 10, `key_pending` (account → new key, release height). `Account` itself doesn't
  change.
- **Timing:** the rotation applies at `release`. Until then the old key still signs and can
  cancel. On a vault account, the delay is the vault's delay and the recovery key can also
  cancel. Elsewhere the delay is a fixed one day.
- **What it doesn't do:** the account nonce carries on, and the quantum commitment (`pq`) belongs
  to the account and isn't touched. A thief with the current key can still spend at once from a
  plain account. Rotation stops them from locking the owner out; only vaults stop the spending.
  The wallet should say so.

**Test plan.** Old key only before release, new key only after; the new key's own account is
untouched. Cancel by the old key or vault recovery works, by anyone else fails. A second rotation
while one is pending fails. Undo across the release height. Rotation in the golden scenario.

## 5. Moving the testnet

**Reset, not an activation height.** An activation height would keep v1 transactions, the flat
root and the old header in the consensus code permanently, and all of it would have to be
audited. Testnet coins are worthless and the testnet has been reset before (contracts).

- Release 0.5.0, protocol 8, a new genesis timestamp, chain id 77703. Changing the chain id is
  cheap insurance: a v1 transaction can't decode as v2 anyway. The new chain starts empty, with
  no balances carried over and still no premine.
- Phrases and addresses carry over. Balances, contracts, vaults and Spoke's on-chain payments
  don't. Before the reset, confirm that Spoke's relay keeps its own record of payments it already
  verified (usernames, storage).
- In one rollout: node, web app, Snap, lokyx-wallet, Spoke's `tx.ts`, and the vectors file.
  Devnet moves first. After 0.5.0 the source has no v1 code.
- 0.4.0 (protocol 7) still ships first, as planned. It's ready, and it's a rehearsal without a
  consensus change.

**Test plan.** Devnet rehearsal on two machines: new genesis, mining, every `Op` from the web
app and Snap, explorer and phone miner. A protocol 7 node refused at the preamble. Full suite,
`check-test-pow.sh` and `consensus-arm64` green before the tag.

## 6. Decisions for you

1. **Typed `Op` enum instead of magic addresses plus `data`.** Recommend yes.
2. **`from` in every transaction (+20 bytes).** Recommend yes; rotation needs it.
3. **`expires` with 0 meaning never.** Recommend yes, with a wallet default of one day.
4. **Memo of 64 bytes, public.** Recommend 64.
5. **`max_out` (DESIGN.md's spend limit).** It was on hold "until there's a VM", and there is one
   now. Recommend yes (+16 bytes). Signing over rendered text stays out; it can come later as tx
   version 3.
6. **Batch:** LYX only, at most 256 payments. Recommend as written.
7. **Timelock:** claimed rather than released automatically, height-based, can't be revoked,
   10 years at most. Recommend as written.
8. **Token supply:** fixed at creation, with burn and no mint. Recommend fixed; mint can be a
   later op.
9. **Token creation burns a fixed amount of LYX** (the amount to be set with the emission
   numbers). Recommend a burn rather than a fee.
10. **Vault accounts can't hold tokens** in this version. Recommend yes.
11. **Merge mining:** freeze `pow` with only `Native` now (recommended), or build `MoneroAux` in
    this phase.
12. **Add `receipts_root` to the header** so contract results can be proven to light clients.
    Recommend yes; this is the only time the header changes cheaply.
13. **Key rotation:** formats and rules in this freeze, not just the formats. Recommend both. The
    rules are small given the vault delay code, and a frozen field that nothing uses is
    untested.
14. **Rotation delay** is the vault delay on vaults and one day elsewhere. Cancel by the current
    key or the vault recovery key. Recommend as written.
15. **Testnet:** reset with chain id 77703 and no carry-over. Recommend yes.
16. **Remove the protocol 6 notice in protocol 8.** Recommend yes.

## As built

Decisions 1-16 were approved as recommended, with seven changes:

1. **Vault allowance has one debit path.** Every Op that moves LYX out of an account (Transfer,
   Batch, Swap lock, Timelock lock, Token create burn, Call value, Deploy) goes through
   `State::spend`, which charges `Op::allowance_cost`. `tests/allowance.rs` lists every Op variant
   with no wildcard arm, so a new Op doesn't compile until it is added there.
2. **`sig` is a versioned enum**; only `Secp256k1Recoverable` is defined, others are rejected.
3. **Vault Create is rejected** while the account holds any token balance.
4. **`max_out` was made `Option<u128>`, then removed** after review: a static check against the signed amounts can never reject what value + fee doesn't already reject, and no path moves more of the sender's LYX than those amounts (`State::spend` debits outflow + fee up front; a contract call only moves the contract's own balance; gas refunds only return LYX). A signed transfer is 168 bytes.
5. **Merge mining:** `Pow` has only `Native` now. `MoneroAux` is built later at an activation
   height once a pool or p2pool operators commit; it doesn't block mainnet.
6. **Wallet notice on key theft:** "Key stolen? Rotation won't save your funds. Sweep your vault or
   move your funds now." Rotation is for planned changes and lost devices.
7. **Pending vault releases are indexed by release height** (`ReleaseIndex`), no rule change.

Where the build differs from, or settles, the text above:

- A Transfer or Batch payment to a contract address is rejected, not credited.
- `CancelRotate` names the `account` it cancels, so the recovery address can cancel from outside.
- A recovery-address cancel pays its fee from the vault.
- `begin_block(height)` (release pending vault payments and rotations) also runs on the scratch
  state in the mempool's `select`, so a miner isn't handed transactions a rotation has made invalid.
- The receipts leaf includes the receipt's ordinal in the block; no contract txs gives the zero hash.
- Due releases are sorted by id, which keeps the order the pre-index code had.
- The state trie has 14 sections (0-13), the last five being keys, key_pending, timelocks, tokens
  and token_balances (see PROTOCOL.md); the root is kept incrementally and checked against the
  from-scratch root in tests.

Placeholders, still open: the token-creation burn is 5 LYX; emission numbers, the mainnet chain id
and the SLIP-44 number are undecided.

The golden and replay constants were regenerated three times during the phase, each in its own
commit. They are expected to stay fixed from here until a deliberate format change.
