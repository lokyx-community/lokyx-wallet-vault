# LOKYX

### A proof-of-work chain for people who hold their own keys

*Draft, November 2026. LOKYX runs as a public testnet. Nothing here is final until a mainnet
launches, and the numbers in particular are open for comment.*

---

## Why another chain

On 29 October 2026, $6.3 billion left Binance in about twenty minutes. Most of the people whose
money that was had never touched a private key. They had an account, a password and a balance on
a screen, and for twenty minutes the balance didn't mean what they thought it meant.

That sentence is written into block 0 of the LOKYX testnet, and it's the reason the project
exists. Not because exchanges are evil, but because "be your own bank" has been the slogan for
fifteen years and almost nobody does it. The reason is not that people don't care. It's that
holding your own keys is frightening. One mistake and the money is gone. A stolen phone, a phished
seed phrase, a moment of panic, and there is nobody to call.

So people hand their keys to someone who will pick up the phone. Then that someone has a bad
twenty minutes.

LOKYX is my attempt at the other half of the problem: making self-custody something an ordinary
person can survive. Not by adding a custodian back in, but by giving the person holding the keys
the same safety nets a bank account has, built into the chain where nobody can switch them off.

The rest of this paper is how.

## What it is, in one paragraph

LOKYX is a layer-1 chain with its own coin, LYX. It's mined with RandomX, the CPU-friendly proof
of work Monero has used since 2019, so a laptop can mine and verify it. Accounts work like
Ethereum's. On top of plain transfers it has a small set of built-in features aimed at keeping
your coins yours: vaults with a daily allowance and a delay on large withdrawals, a recovery
phrase that can cancel a theft in progress, an heir, atomic swaps with bitcoin and ether that
don't go through a bridge, and a post-quantum backup key. There is no premine, no treasury and no
founder allocation. Every coin that exists was mined.

## The problem with being your own bank

Here is what happens today if someone gets your seed phrase.

They move everything to an address they control. It takes one transaction and about a minute.
You find out when you open your wallet. There's no undo, no fraud department, no freeze. The
transaction is final the moment it's mined, which is exactly the property that makes the chain
trustworthy and exactly the property that makes you helpless.

Banks don't work like that, and it isn't because they're better at security. It's because they
have *time*. A large transfer can be held. A card can be frozen. Something that looks wrong can
be stopped before it settles. The money doesn't move the instant someone asks it to.

Self-custody gives you the keys and takes away the time. LOKYX gives the time back.

## Vaults

Any account can turn itself into a vault. A vault has three settings you choose yourself:

- **A daily allowance.** Up to this much can leave each day, straight away, like a normal
  account. Coffee, rent, whatever you actually spend.
- **A delay.** Anything over the allowance waits, for as long as you set (a day, a week). It
  shows up as pending and can be seen by anyone.
- **A safe address and a recovery key.** The recovery key, derived from your recovery phrase, can
  cancel any pending withdrawal, or sweep everything to the safe address, at any moment.

Now replay the theft. Someone steals the key on your phone. They can take one day's allowance
straight away. Anything more has to wait out the delay, in public, and the moment you notice you
cancel it with your recovery phrase and sweep the rest somewhere safe. The thief got a day's
spending money instead of your savings.

That's the whole idea, and it's deliberately boring. It doesn't try to stop theft. It caps the
damage and buys you time to react.

A vault can also name an heir: if the vault does nothing for a period you choose, the heir can
claim it. It's the answer to the other way people lose coins, which is dying without telling
anyone where the seed phrase is.

These are rules of the chain, not of an app. A wallet with a bug can't skip the delay, because the
nodes won't accept the transaction. And a stolen vault key can't route coins through a contract to
dodge the allowance, because vault accounts can't use contracts at all.

## Swaps without a bridge

Most of the money ever stolen in crypto was stolen from bridges: a pile of coins sitting in one
contract, guarded by a handful of keys, waiting for someone to find the flaw. LOKYX doesn't have
a bridge and isn't going to have one.

Trading LYX for bitcoin or ether works the old way, with an atomic swap. Both sides lock their
coins against the same secret hash. When one side claims with the secret, the secret becomes
public, and the other side can claim too. If anyone walks away, both locks expire and both sides
get their coins back. At no point does anyone hold anyone else's money, and there's no shared pot
to rob.

It's slower and less convenient than a bridge. That's the trade.

## Keys that outlive ECDSA

LOKYX signs with secp256k1, like bitcoin and Ethereum. If a large enough quantum computer ever
exists, that stops being safe, and every chain using it has the same problem.

LOKYX can't solve that today, but it can make sure accounts aren't stranded when it happens. An
account can commit, once, to a post-quantum public key (SLH-DSA, the NIST standard based on hash
functions). The key is derived from the same recovery phrase, so there's nothing new to back up.
The commitment can't be changed afterwards, so someone who steals the ordinary key can't swap in
their own.

Nothing uses that key yet. If ECDSA ever breaks, an upgrade can let committed accounts sign with
it instead, and the accounts that committed early keep their coins. It's insurance that costs one
small transaction.

## Mining

### RandomX

The proof of work is RandomX. It runs random programs that lean on everything a general-purpose
CPU is good at: branch prediction, floating point, caches, a big chunk of memory. A chip built
specially for it would end up looking a lot like a CPU, which is the point. It has been audited
four times and has seven years of real use behind it on Monero.

I want anyone with a computer to be able to mine and verify. A chain that can only be mined in a
warehouse in a cheap-power country is a chain run by whoever owns the warehouse. RandomX isn't a
guarantee against that, but it's the best record of any proof of work aimed at ordinary hardware.

Verifying needs 256 MB of memory. That runs on phones too, slowly, and there's an Android miner
that works while the phone charges and stops when it gets warm.

### Block times that don't wander

Plain proof of work gives you random block times. On a 60-second target, around 40% of blocks
arrive in under half a minute and some take several minutes. That's annoying on a big chain and
it's a real problem on a small CPU-mined one, where miners come and go and difficulty is always
catching up.

LOKYX adds a minimum spacing: a block can't be valid until 50 seconds after its parent. Nobody
mines during those 50 seconds, and difficulty is tuned for the remaining 10. Blocks land between
about 50 and 70 seconds apart instead of anywhere from one second to five minutes.

Difficulty adjusts every block (LWMA over the last 60), so it follows miners joining and leaving
within a few blocks.

## The coin

| | |
|---|---|
| Premine, treasury, founder or dev allocation | none |
| Block reward | 10 LYX, halving every 1,051,200 blocks (about two years) |
| After five halvings | 0.5 LYX per block, forever |
| Supply after five eras | about 20.4 million LYX |
| After that | about 263,000 LYX a year, a shrinking percentage |
| Fees | go to the miner |
| Rewards | locked for 60 blocks before they can be spent |

There's no hard cap, and that's deliberate. Once the halvings run out, miners still have to be
paid to secure the chain. Bitcoin is betting that fees alone will do it. Monero decided not to
take that bet and added a small permanent reward, and LOKYX does the same. The tail is a fixed
number of coins, so as a percentage of supply it shrinks every year.

These numbers are a draft. They'll be published for comment before a mainnet, and after that
changing them would be a hard fork.

The 60-block lock on rewards is a safety measure: a reorg can't erase coins that have already been
spent onward.

## Checking the supply yourself

Every node keeps three numbers and checks that they agree after every single block: what the
chain says has been issued, what the reward schedule says should have been issued, and the sum
of every balance, locked reward, open swap and pending vault withdrawal. Anyone can ask a node for
all three.

If they ever disagree, the node stops. It stops applying blocks, stops mining, and says so in its
log. That can only happen through a bug in LOKYX itself, never because of something a peer sent,
and a node that has stopped is obvious in a way a node quietly inflating the supply is not. I'd
rather the chain halt than be wrong about how many coins exist.

## Contracts, later

LOKYX can run contracts: programs written in Rust, compiled to WebAssembly, metered with gas paid
in LYX, and protected against the re-entry bug that drained The DAO and plenty of contracts since.
They run on the testnet today.

They will be switched off when a mainnet launches.

The engine that runs them is about 100,000 lines of someone else's code, sitting inside consensus.
That's more than the rest of the node put together, and it hasn't been audited as part of LOKYX.
Shipping it on day one would mean the most complicated part of the chain is also the least
reviewed. So the code stays, it keeps being tested on the testnet, and contracts get turned on at
a fixed block height in a later release, after an audit and serious fuzzing.

In the meantime the two things people actually used contracts for on the testnet, locking coins
until a date and making a simple token, become built-in operations that don't need the engine at
all.

## How it holds together

A few things that matter more than they sound:

- **Every node checks everything.** Block structure, timestamps, the exact difficulty it should
  have, the RandomX proof, every signature, every transaction, and the resulting state. No node
  trusts another's word for any of it.
- **Side chains that can't win aren't stored.** Nodes sync headers first and only download blocks
  for the branch worth following. A long fork from an early block, where difficulty was low, used
  to be a cheap way to fill someone's disk. Now it costs the node nothing to ignore.
- **Signatures can't be reused across chains.** Everything signed is prefixed with a LOKYX tag
  and the chain's ID, so a LOKYX signature is never valid on Ethereum or the other way round.
- **The arithmetic is checked.** Money can't overflow, wrap round or quietly go negative. If it
  ever would, the transaction is invalid.
- **No `unsafe` code in consensus.** The only exception is the two lines that tell the compiler
  what the RandomX library already guarantees about threads.

The node is written in Rust. The wallet runs in a browser, on a phone, inside MetaMask, or from a
terminal, and all of them check their signatures against the same test vectors so they agree to
the byte.

## What it isn't

It isn't finished. It hasn't been audited. It runs as a testnet, the coins on it are worthless,
and nobody should put anything of value on it. Before a mainnet there will be two independent
audits, at least three months of public testnet with people outside the project running nodes,
and the coin's numbers published for comment.

It isn't trying to be fast. Sixty-second blocks and a few thousand transactions per block are
plenty for a chain whose job is to hold savings safely.

It isn't trying to be everything. No bridge, no lending, no NFTs, no governance token. The aim is
narrow on purpose: a chain where holding your own keys is something you can live with.

## Where it stands

The testnet is public at testnet.lokyx.xyz, with a web wallet, an explorer, a faucet, downloads
for Windows, Mac and Linux, a phone wallet, an Android miner, and a MetaMask Snap. In November it
went through its first protocol upgrade without a reset.

The next pieces of work are a Merkle trie for the state (so a phone can check its balance against a
proof instead of trusting a server), hardening the network layer, and freezing the transaction and
block formats for good. Then audits. Then, if all of that goes well, a mainnet.

If you run a node, mine a few blocks, or try to break a vault, I'd like to hear what happened.

---

*Technical details are in PROTOCOL.md, the known weaknesses are listed honestly in SECURITY.md,
and the plan is in ROADMAP.md.*
