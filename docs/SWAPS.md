# Swaps

LYX <-> BTC and LYX <-> ETH atomic swaps. Two people trade directly, with no bridge or exchange
in between. Each side locks their own coins on their own chain behind the same secret, and either
both trades go through or both get refunded.

## How a swap goes

Whoever starts the swap holds the secret and locks first, with the longer timeout. The other side
locks second with a shorter one, so their refund always comes first.

A swap normally finishes in minutes (with bitcoin, however long its blocks take). The timeouts
only matter if someone stops halfway, and the person making the offer picks them:

| | First lock | Second lock |
|---|---|---|
| Fast (default) | 12 h | 4 h |
| Standard | 48 h | 24 h |

Fast means a stuck swap pays back sooner, but both people need to be around for the next couple
of hours. The second person has to lock while the first lock still has at least 6 hours more to
run than theirs; the app refuses to go ahead otherwise.

Selling LYX for BTC:

1. Alice makes an offer, Bob accepts. They swap two short codes (copy/paste, any chat app).
2. Alice locks LYX for Bob, refundable to her after 12 h.
3. Bob's app waits for 3 confirmations, checks the lock (amount, secret hash, addresses, time
   left) and only then shows him the bitcoin address to pay. That address is a contract, not a
   wallet: Alice can claim it with the secret, Bob can take it back after 4 h.
4. Alice claims the bitcoin. Doing that puts the secret on the bitcoin chain.
5. Bob's app reads the secret from Alice's claim and claims the LYX.

Buying LYX with BTC is the same with the chains swapped: Alice funds the bitcoin contract first,
Bob locks LYX, Alice claims the LYX (revealing the secret on LOKYX), Bob claims the bitcoin.

If anyone stops halfway, the locks run out and the coins go back. Nobody can take both sides.

## On LOKYX

A swap op is a normal transaction to `lyx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqym06fps` (a fixed
address nobody has a key for) with the op in the data field:

| Op | Value | Who signs | When |
|---|---|---|---|
| `Lock { hashlock, recipient, refund_height }` | the amount | anyone | refund height 1..20160 blocks ahead |
| `Claim { lock, secret }` | 0 | the recipient | before `refund_height`, `sha256(secret) == hashlock` |
| `Refund { lock }` | 0 | whoever locked | from `refund_height` on |

The lock id is the hash of the lock transaction. The secret is exactly 32 bytes and the hash is
sha256, the same as the bitcoin side. Claim and refund fees come out of the locked amount, so
someone with zero LYX can still claim. Open locks are part of the state root and count toward
supply, so `lyx_getSupply` still adds up.

RPC: `lyx_getSwap {id}` gives the status (`pending`, `open`, `claiming`, `claimed`, `refunding`,
`refunded`) and the secret once it's revealed, including from a claim still in the mempool.
`lyx_findSwaps {hashlock}` lists open or pending locks with that hash.

## On bitcoin

A P2WSH contract:

```
OP_IF
  OP_SIZE 32 OP_EQUALVERIFY OP_SHA256 <hashlock> OP_EQUALVERIFY <claim pubkey>
OP_ELSE
  <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP <refund pubkey>
OP_ENDIF
OP_CHECKSIG
```

`OP_SIZE 32` matters: without it, a secret of a different length could work on one chain and
fail on the other. The locktime is an absolute block height.

## On Ethereum

[contracts/LokyxSwap.sol](../contracts/LokyxSwap.sol), about 80 lines. `lock(hashlock, recipient,
refundTime)` with the ether attached, `claim(id, secret)` before the refund time (anyone can send
it; the ether always goes to the recipient), `refund(id)` after it. A lock's id is
`keccak256(abi.encode(sender, recipient, hashlock, refundTime, amount))`, so both apps know it in
advance and a lock found at that id is the agreed one by construction. The `Claimed` event carries
the secret, which is how the other side learns it.

The same contract works on any EVM chain (Ethereum, BNB Chain, Polygon, Base, Arbitrum). An
offer names the chain and the contract address. Before anyone accepts or locks anything, the
app reads the contract's code from the chain and compares it byte for byte with the real
LokyxSwap. An offer pointing at anything else is refused, so nobody can trick you
into locking ether in a contract that lets them keep it.

The ether side is signed in MetaMask. Times on the Ethereum side are unix timestamps.

## Keys

Nothing secret is stored. The swap secret and both bitcoin keys are worked out from your LOKYX key
and a random swap id each time they're needed (HMAC-SHA256). As long as you have your recovery
phrase and the swap id, you can always get to your coins.

## Trying it on testnet

The Swap page in the web app does everything. Bitcoin goes through testnet4 via mempool.space and
ether through Sepolia (change either under Swap settings). The Sepolia swap contract has to be
deployed once: Swap settings has a button that does it through MetaMask, after which you can
share the address. Mainnets are switched off.

You need the wallet in the browser (not MetaMask) and the page has to be open at each step. If
you close it, just come back: it works out where things are from the chains.

## Tested

- Rust: lock, claim, refund, wrong secret, wrong person, too early, too late, double claim,
  zero-balance claim, mempool handling, supply.
- The browser builds byte-identical swap transactions to the node (shared test vectors).
- Every bitcoin transaction the app builds is checked against bcoin's consensus script engine:
  claim, refund, wrong key, wrong secret, 33-byte secret, refund before the locktime.
- All four roles simulated through every path, including refunds and refusing bad locks.
- Full swaps in both directions with two browsers against a real LOKYX node and a regtest
  bitcoin server that validates scripts and locktimes.
- The same for ether against a Hardhat node: deploying the contract from the settings screen,
  swaps both ways, and an offer pointing at a fake contract being refused.
- Every ETH path simulated too, including locks with the wrong amount and claim events whose
  secret doesn't match.

## Limits

Not audited. Don't use real money on it. See SECURITY.md for the full list.
