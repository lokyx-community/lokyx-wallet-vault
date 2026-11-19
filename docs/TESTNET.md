# Testnet

Public test network. Coins are worthless and the chain gets reset whenever a rule change needs
it (last reset: 12 Nov 2026, for the Phase 4 formats: release 0.5.0, protocol 8).

Web wallet and explorer: https://testnet.lokyx.xyz

| | |
|---|---|
| Chain ID | 77703 |
| Block time | ~60 s, never less than 50 s after the previous block |
| P2P port | 27701 |
| RPC port | 28701 (localhost only unless you change it) |
| Reward | 10 LYX per block, spendable after 60 blocks |
| Seed | `testnet.lokyx.xyz:27701` (built in) |

## Mining

Download the node for Windows, Mac or Linux from https://testnet.lokyx.xyz/#/download, unpack
it and double-click `mine.bat` (Windows) or run `./mine.sh`. The first time it makes a wallet
(write the 24 words down), then it mines. On Linux or a Mac you can also install from the
terminal:

```bash
curl -fsSL https://testnet.lokyx.xyz/install.sh | sh
lokyx-mine
```

Or by hand:

```bash
lokyx-wallet --network testnet new        # write the 24 words down
lokyxd --network testnet --mine --threads 2 \
  --coinbase $(lokyx-wallet --network testnet address)
```

The wallet and chain live in `~/.lokyx/testnet` (Windows: `%APPDATA%\LOKYX\testnet`, Mac:
`~/Library/Application Support/LOKYX/testnet`).

The node connects to the seed on its own and finds other peers from there.

Make sure your clock is right (Windows: Settings → Time → Sync now). A block dated more than 15
seconds in the future gets ignored by other nodes until its time comes, so a fast clock means
your blocks lose races. A slow one just makes you start late.

Rewards show as locked at first and unlock 60 blocks later, about an hour.
`lokyx-wallet --network testnet balance` shows both.

To use the web app against your own node, run it with `--rpc-cors http://localhost:5173`,
start the app (`cd app && npm install && npm run dev`) and pick "Testnet node on this computer"
in Settings.

### Why blocks are at least 50 s apart

With plain proof of work, block times are random. On a 60 s target, around 40% of blocks would
come in under 30 seconds and some would take several minutes. LOKYX requires each block's
timestamp to be at least 50 s after its parent and only really races over the last 10 s.
Difficulty is tuned for that 10 s, so most blocks land 50 to 70 seconds apart. The built-in
miner sits idle during the 50 s.

Nodes hold a block that's dated slightly ahead of their own clock until that time arrives, so
nobody gets a block accepted early by setting their clock forward.

### On a phone

Android phones can mine too, while charging. Get the app at https://testnet.lokyx.xyz/app.

## Running a server

Ubuntu 20.04 or newer (or Debian 11+), 2 cores, 4 GB RAM, and a domain pointing at the box if
you want the web app and faucet. Servers are set up from the server bundle,
`lokyx-server-<version>.tar.gz`, which has the programs already built, the web app, and the
downloads the site offers. Copy it to the server, then:

```bash
tar -xzf lokyx-server-0.3.0.tar.gz && cd lokyx-server-0.3.0
sudo DOMAIN=testnet.example.org ./install.sh
```

Nothing gets compiled on the server. It installs the node, a miner that pays into a faucet wallet, the
faucet, the web app and the downloads behind Caddy (HTTPS, `/rpc` and `/faucet` proxied).
Add `APK=/root/lokyx-miner.apk` to publish the Android miner at `/app`. Ports 22, 80, 443
and 27701 get opened. The faucet stays empty for the first hour or so, until the first rewards
unlock. Back up `/root/lokyx-faucet-recovery.txt` somewhere offline and then delete it.

An extra seed node (please do run one, a single seed is a single point of failure):

```bash
sudo WEB=0 FAUCET=0 MINE_THREADS=0 EXTRA_PEERS="--peer testnet.example.org:27701" ./install.sh
```

To update to a new release, unpack the new bundle and run its `install.sh` the same way. Data
and wallets are kept.

Logs: `journalctl -u lokyxd -f` and `journalctl -u lokyx-faucet -f`.

### After a testnet reset

The last reset (9 Nov 2026) added contracts: protocol version 5, a new block 0, and old
nodes are turned away at the handshake. Every node has to update, and testnet balances started
again from zero.

Install the new bundle with `RESET=1`, which wipes the old chain and keeps the faucet wallet and the node key (so a pinned seed keeps its identity):

```bash
sudo RESET=1 DOMAIN=testnet.example.org ./install.sh
```

### Upgrading to protocol 6

Protocol 6 changes how nodes sync (headers first, see PROTOCOL.md). It's not a reset: the chain,
balances and wallets carry over. But version 6 and version 5 nodes won't talk to each other, so
everyone has to move within the same window, or the old nodes end up on their own and anything
they mine afterwards is thrown away when they update.

This is the first upgrade I'm doing without a reset, so it's also the practice run for how
upgrades will work later. The plan:

1. Announce a date and time at least 48 hours ahead, with the new version number (0.3.0). Ask
   miners to stop mining at the start of the window and only start again on 0.3.0 (see the
   rehearsal below for why).
2. Before the window, run the new release on one spare server against a copy of a seed node's
   database, to check the first restart (it cleans up stored side branches) and the sync.
3. At the start of the window, update every seed node, one right after another, with the plain
   update command above (no `RESET`).
4. Check each seed: `journalctl -u lokyxd -f` should show peers connecting, and any old node
   shows up as a warning like `... runs protocol 5 and this node runs 6, so they can't connect`.
   `lyx_chainInfo` should show `"synced": true` and the same `bestHash` on every seed.
5. Miners and other node operators update. Mining stops by itself until the node has caught up.
6. After an hour, compare `bestHash` across every node I know of, and look for the protocol 5
   warnings in the seed logs to see who hasn't updated.
7. Write down below what went wrong, how long each step took, and what to do differently.

#### Rehearsal on a local devnet (11 Nov 2026)

Before touching testnet, the same upgrade on three local devnet nodes: two 0.2.1 (protocol 5)
nodes mining together for four minutes, then upgraded one at a time on their own databases, plus
a fresh 0.3.0 node. What happened:

| Step | Result |
|---|---|
| Fresh v6 node pointed at two v5 nodes | Stayed at height 0, as it should. But its log said nothing about why: the refusal was only logged at debug level. **Fixed**: a new node now logs a warning naming the side that needs updating (old nodes still stay quiet). |
| First v6 node started on a v5 database (24 blocks) | Up in 0.6 s, same tip as before. It deleted 1 stored block, a side block from an earlier race between the two miners. |
| One node on v6, one on v5, both mining (2 minutes) | The network split, as expected: both reached height 32 on different chains. |
| Second node upgraded | All three agreed again within seconds. The v5 node's chain had more work, so the v6 nodes reorganised 9 blocks deep onto it. Every block the v6 side mined during the split was thrown away. |
| Restart of an already upgraded node | Up in 0.6 s, nothing to clean. |

What to take from it:

- Whichever side of a split has more work wins, and the other side's blocks (and their rewards)
  are lost. A short window and miners pausing during it keeps that small. On testnet it only
  costs test coins, but it's the habit I want for later.
- The node gave no sign it was refusing old peers. That would have made the real upgrade hard to
  follow, which is the reason for the new warning.
- Nothing needed to be done to existing databases.

#### Testnet run (11 Nov 2026)

Done on the seed node at testnet.lokyx.xyz, 0.2.1 to 0.3.0, no reset.

| Step | What happened |
|---|---|
| `install.sh` from the 0.3.0 bundle | Nothing to do by hand. It stopped the node, swapped the binaries, the web app and the downloads, and started it again. |
| First start on the existing database | `removed 1 stale blocks from the database`, then `loaded 2669 stored blocks; tip height 2668`: the same tip and the same genesis as before. The one removed block was a side block that can no longer win. |
| Mining | Found block 2669 about 13 seconds later. |
| `lyx_chainInfo` | `"synced": true`, `"version": "lokyxd/0.3.0"`, `"contractsActive": true`, `"contractsFrom": 0`. |
| Other nodes | `"peers": 0` straight after. The seed was the first node on protocol 6, so anything still on 0.2.1 couldn't reach it until it updated. Expected, but worth saying out loud when announcing the next one: until most nodes have moved, a seed can sit with no peers. |

Nothing went wrong, and nothing had to be done to the database by hand. What the rehearsal
changed about the plan (pausing miners, and the warning when an old node tries to connect) is
what made this boring, so keep both for the next upgrade.

### Node keys and the seed's pinned key

From protocol 7 every node has an identity key, `node.key`, in its data directory (on a server
`/var/lib/lokyx/node/node.key`, on Windows `%APPDATA%\LOKYX\testnet\node.key`). Nodes make it
themselves on first start, mode 0600, and it has nothing to do with wallet keys. For most nodes
it doesn't matter if it's lost: the node makes a new one, logs a warning, and is a new node on the
network. For a **seed** it does matter, because releases pin the seed's public key: a node
that dials the seed's address and meets another key hangs up before sending anything.

Check what key a running node has, over HTTPS (a different road than the p2p connection, so it
is a real check against what a release says):

```bash
curl -s https://testnet.lokyx.xyz/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"lyx_netHealth","params":{}}'   # "nodeKey": "..."
```

#### Making the seed's key before the 0.4.0 release is built

`lokyxd --node-key` makes `node.key` in the data directory if there isn't one, prints the public key
and the seed entry that pins it, and exits without starting the node. It doesn't open the
database, so it's safe next to a running node, and an existing valid key is only printed. (A running 0.3.0 node ignores the file.) You need a `lokyxd` from this source tree or the
0.4.0 bundle, because 0.3.0 doesn't have the flag.

On the seed, from the unpacked 0.4.0 bundle (`bin/arm64` instead of `bin/x64` on an ARM server):

```bash
sudo ./bin/x64/lokyxd --network testnet --datadir /var/lib/lokyx/node --node-key
sudo chown lokyx:lokyx /var/lib/lokyx/node/node.key && sudo chmod 600 /var/lib/lokyx/node/node.key
ls -l /var/lib/lokyx/node/node.key        # -rw------- lokyx lokyx, 96 bytes
```

It prints three lines. The `public key:` line is the 64 hex characters to pin, and `seed entry:`
is the exact string to put in `seeds` in `src/params.rs`:

```
node key file: /var/lib/lokyx/node/node.key
public key:    <64 hex characters>
seed entry:    testnet.lokyx.xyz:27701#<64 hex characters>
```

If the output above those lines says `isn't a valid node key; moving it`, stop. The file that was
there is damaged, it was moved to `node.key.bad` and a new key was made. Put the backup back
(below) instead of using the new key.

From a Windows PC with a `lokyxd.exe` built from this tree (`cargo build --release --bin lokyxd`), if
there's no ARM or x64 Linux binary to hand:

```bat
target\release\lokyxd.exe --network testnet --datadir C:\lokyx-seed-key --node-key
scp C:\lokyx-seed-key\node.key root@testnet.lokyx.xyz:/var/lib/lokyx/node/node.key
ssh root@testnet.lokyx.xyz "chown lokyx:lokyx /var/lib/lokyx/node/node.key && chmod 600 /var/lib/lokyx/node/node.key"
```

and then keep that copy only as the backup. For a key that has to be trusted on mainnet, make
it on the server and don't let it travel.

**Back it up** the moment it exists, somewhere other than the server (the file is 96 bytes):

```bash
sudo base64 -w0 /var/lib/lokyx/node/node.key        # store the text in a password manager
```

To restore it on a rebuilt server, before the node first starts:

```bash
sudo mkdir -p /var/lib/lokyx/node && echo '<the text>' | base64 -d | sudo tee /var/lib/lokyx/node/node.key >/dev/null
sudo chown lokyx:lokyx /var/lib/lokyx/node/node.key && sudo chmod 600 /var/lib/lokyx/node/node.key
```

The restored node has the same public key, so every release that pins it keeps working. An
install with `RESET=1` keeps `node.key`; deleting the data directory by hand does not.

#### Replacing a seed's key

A pin is a list: `testnet.lokyx.xyz:27701#<old>,<new>` accepts a seed showing either key. That is
what makes a planned replacement possible without anyone being locked out. Do these in order and
don't skip the waiting.

1. **Make the new key** away from the live one, and back it up as above. Note its public key, `P2`
   (the old one is `P1`):
   `sudo ./lokyxd --network testnet --datadir /root/next-key --node-key`
2. **Release N** with the seed entry `testnet.lokyx.xyz:27701#P1,P2`. The seed still runs `P1`.
   The release notes name both keys. Nothing changes for anyone yet.
3. **Wait until the nodes that matter are on release N**: every seed and every operator I know
   of. Don't swap early. A node on an older release pins only `P1`, and once the seed shows `P2` it
   can't connect to the seed, and a fresh install of an old release can't bootstrap at all.
4. **Swap the key on the seed:**
   ```bash
   sudo systemctl stop lokyxd
   sudo cp -p /var/lib/lokyx/node/node.key /root/node.key.P1      # keep it until step 6
   sudo cp /root/next-key/node.key /var/lib/lokyx/node/node.key
   sudo chown lokyx:lokyx /var/lib/lokyx/node/node.key && sudo chmod 600 /var/lib/lokyx/node/node.key
   sudo systemctl start lokyxd
   ```
5. **Check it:** `lyx_netHealth` (above) shows `P2`; `lyx_getPeers` shows peers coming back;
   `journalctl -u lokyxd` has no `showed a different key than the one pinned` lines from my own
   seeds. To undo it, put `node.key.P1` back and restart: every release up to N works with it.
6. **Release N+1** with `testnet.lokyx.xyz:27701#P2` only, and then delete `P1` from the backup.

If the key is **lost or stolen**, there is no overlap to give. A pinned node refuses any other key
at that address, and a stolen key lets someone answer as the seed. In that case make the new key at
once, install it (the commands in step 4), and put out a release with `#P2` as fast as possible.
Until a node updates it can't reach the seed by its pin, though it still finds peers it has seen
before through its saved address tables. Anyone stuck can add the seed with its new key by hand:
`lokyxd --peer testnet.lokyx.xyz:27701#<P2>`. This is why a second, independent seed
(with its own key, in the same `seeds` list) is worth having before mainnet: losing one key then
strands nobody.

### Upgrading to protocol 7

Protocol 7 encrypts every connection, makes the address tables, and changes nothing about blocks
or state: the chain, balances and wallets carry over. A 0.3.0 node and a 0.4.0 node can't talk (the
old one logs that it needs updating), so as with 0.3.0 the whole network moves in one window. The
plan, with what to check at each step:

1. **Make and back up the seed's key** (above) and put its `seed entry:` line in `seeds` in
   `src/params.rs`. Set `min_chain_work` and `assume_valid` as in "Release values".
2. **Rehearse on a local devnet:** one 0.3.0 node and two 0.4.0 nodes (`scripts/devnet.sh`). The
   old one has to log the update message; the new two have to sync and mine, and each shows the
   other's key in `lyx_getPeers`. Run `lokyxd --node-key` against a fresh directory twice and
   check it prints the same key.
3. **Announce** at least 48 hours ahead: the version (0.4.0), the window, that miners stop at its
   start, and the seed's public key, so people can compare it against `lyx_netHealth`.
4. **At the start of the window:** copy `node.key` off the seed as a backup if it isn't already,
   then install the 0.4.0 bundle the normal way (no `RESET`). Check `lyx_netHealth` shows the
   announced key and `"synced": true` in `lyx_chainInfo`.
5. **Other seeds and operators** update. Mining stops by itself until a node has caught up.
6. **After an hour** compare `bestHash` across the nodes I know of, and look in the seed log
   for `runs protocol 6` to see who hasn't moved.
7. **Write down** below what went wrong and how long each step took, as for 0.3.0.

### Moving to 0.5.0 (protocol 8, a reset)

0.5.0 freezes the transaction, header and state formats (PHASE4.md). Nothing carries over:
a new genesis (chain id 77703, dated 12 Nov 2026 09:00 UTC), balances start again from zero, and
0.4.x and older nodes can't connect (the connection preamble is `LYX8`, and genesis differs).

1. **Rehearse first.** The one-machine run is done (12 Nov); the two-machine run is steps in REHEARSAL.md.
   One-machine run: one node mining, a second following it over
   the network, then `cargo run --release --example rehearse -- <A rpc> <B rpc>`, which sends a
   batch, a timelock lock and claim, a token create, transfer and burn, a vault create and a key
   rotation with a cancel by the recovery address, and checks that the second node ends on the same
   blocks and accounts. A rotation's release can't be seen on a devnet in minutes (the delay is a
   day for a plain account, an hour at the least for a vault); `tests/rotation.rs` covers it.
2. **Announce** at least 48 hours ahead: the version (0.5.0), that the chain restarts from zero, and
   the window. Spoke's relay keeps its own record of payments (a `payments` table), so names and
   storage people paid for survive; nothing in it refers to old transaction hashes except to refuse
   reusing them.
3. **At the start of the window** install the 0.5.0 bundle with `RESET=1` (it wipes the chain and
   keeps the faucet wallet and the node key, so the pinned seed keeps its identity), then set
   `min_chain_work` and `assume_valid` from the new chain once it is a few hundred blocks long
   (below). Until then they stay at 0.
4. **Update** the faucet, the explorer and the web wallet in the same window; the web wallet, the
   Snap, the phone wallet and Spoke are on the v2 transaction format and will not work against an
   older node.
5. **After an hour** compare `bestHash` across the nodes I know of.

### Release values

Each release sets two values for testnet in `src/params.rs`, so new nodes sync quickly and can't
be stalled by a fake chain: `min_chain_work` and `assume_valid`. They're taken from a seed node
when the release is cut, and printed in the release notes so anyone can check them.

To pick them, take a block about 1,000 below the seed's tip (deep enough that it won't be
reorged) and read its hash and cumulative work:

```bash
curl -s https://testnet.lokyx.xyz/rpc -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"lyx_getBlock","params":{"height":12000}}'
```

`assume_valid` is that height and `hash`. `min_chain_work` is its `cumulativeWork`.

To check a release's values yourself, run the same command against your own node with the height
from the release notes. The hash and work should match exactly. If they don't, don't run that
release, and tell me. Neither value can make a node accept an invalid block: a wrong
`assume_valid` only means more headers get their full check, and a wrong `min_chain_work` only
delays syncing.

## Known limits

See [SECURITY.md](SECURITY.md) for the full list. The ones you'll notice on a testnet: faucet
cooldowns reset when it restarts, and mining is light-mode RandomX only, so expect tens of hashes
per second per core.
