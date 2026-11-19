# Vaults

A vault is a normal account with two extra rules: only a daily allowance can leave right away,
and anything bigger waits a while before it arrives. A second key, kept on paper, can stop a
withdrawal during the wait or move everything somewhere safe.

The point: if someone gets your wallet (a phished phrase, malware, a stolen phone), they get
today's allowance at most. Anything bigger shows up as a pending withdrawal you can cancel.

## Setting one up

The Vault page in the web app does it in a few steps:

1. It makes a new 12-word recovery phrase. Write it down; the app doesn't keep it.
2. Pick a daily allowance (default 50 LYX) and how long bigger withdrawals wait (1 hour, 1 day,
   3 days or a week; default 1 day).
3. Optionally: a different safe address, and an heir.

The recovery phrase gives two addresses. The first (index 0) is the default safe address, so
restoring the phrase as a normal wallet lets you spend whatever was moved there. The second
(index 1) is the recovery key that signs cancels and sweeps.

## What each key can do

| Action | Who | Waits? |
|---|---|---|
| Spend up to the daily allowance (transfers, swap locks, fees) | owner | no |
| Withdraw more | owner | yes, the full delay |
| Change settings or close the vault | owner | yes, the full delay |
| Cancel anything pending | owner or recovery key | no |
| Move everything to the safe address | recovery key | no |
| Claim everything after a long inactivity | heir | yes, the full delay, and the owner can cancel |

What someone gets:

- **Your wallet only:** today's allowance. Bigger withdrawals and settings changes wait in the
  open, and you cancel them with the recovery phrase.
- **The recovery phrase only:** with the default safe address, everything (it can sweep to an
  address it controls). Set the safe address to a separate wallet and the recovery phrase alone
  can only move coins to you.
- **Both:** everything, like any wallet. Keep them apart.

Cancels and sweeps signed by the recovery key pay their fee from the vault, so the recovery key
never needs LYX of its own.

## Alerts

The website shows a warning on every page while something is waiting to leave your vault. The
Android app (lokyx-miner-android) checks the vault behind its rewards address every 15 minutes,
mining or not, and sends a notification when a withdrawal, settings change or heir claim starts.
It can watch other vault addresses too.

## On-chain

A vault op is a transaction to `lyx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqg23ursh` (0x…0102, nobody
has the key) with value 0 and a borsh `VaultOp` in the data field:

```rust
enum VaultOp {
    Create(VaultSettings),
    Withdraw { to: Address, amount: u128 },
    Update(VaultSettings),
    Close,
    Cancel { id: Hash },
    Sweep { vault: Address },
    HeirClaim { vault: Address },
}
struct VaultSettings { recovery: Address, safe: Address, delay: u64, allowance: u128, heir: Option<Heir> }
struct Heir { address: Address, inactive_blocks: u64 }
```

- `delay` is in blocks, between 1 hour and 30 days' worth.
- The allowance resets every day's worth of blocks (1,440 on testnet). Everything an owner-signed
  transaction takes out of the account counts, fees included, except the amount of a delayed
  withdrawal.
- Withdrawals, setting changes and closing are stored as pending items keyed by the id of the
  transaction that started them. They take effect at the start of the block at
  `height + delay`. Pending withdrawals count toward supply.
- An heir's waiting period is at least 30 days and at least twice the delay. Any transaction
  from the owner resets the clock.
- Vaults and pending items are part of the state root.

RPC: `lyx_getAccount` includes `vault` (settings, allowance left, pending items),
`recoveryFor` and `heirOf`. `lyx_getVault {address}` returns just the vault.

## Prior art

Bitcoin's OP_VAULT proposal (BIP-345, withdrawn in 2025 for the more general BIP-443) has the
same shape: a delay on withdrawals and a recovery path to a fixed address. It needs a soft fork
that hasn't happened. Revault built vaults from pre-signed transactions. On Ethereum, smart
contract wallets (Argent, Safe modules) offer guardians and delays, per wallet, as contracts.
On LOKYX it's built into accounts.

## Tested

- Node: allowance and its daily reset, swap locks counting against it, delayed withdrawals
  arriving on time, cancels by the recovery key with zero balance, sweeps including pending
  withdrawals, the owner key unable to sweep, the recovery key unable to withdraw, delayed
  settings changes and closing, the heir's claim and the owner cancelling it, bad settings, and
  the mempool rules. Supply is checked after every block.
- The browser builds byte-identical vault transactions to the node (shared test vectors).
- End to end on a devnet with two phones: setting up a vault through the app, a send over the
  allowance refused, a withdrawal waiting, and the recovery phrase on another device cancelling
  it and sweeping everything to the safe address.

## Limits

Not audited. Someone has to notice a withdrawal they didn't make within the delay. The phone
app's alerts check every 15 minutes, so very short delays (1 hour) leave little room; pick a
day or more for savings. Vault ops
need the wallet in the browser for now; the MetaMask Snap doesn't sign them yet.
