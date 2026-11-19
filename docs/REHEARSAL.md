# 0.5.0 two-machine rehearsal (devnet)

Goal: prove two real machines agree on one chain, every web-app operation works, a key rotation is
released live, and a protocol 7 node is refused. Uses the devnet with a time scale, so a "day" (the
plain-account rotation delay and the vault allowance window) is **5 minutes** (20 blocks of 15 s).
The scale is devnet-only (`LOKYX_DEVNET_TIME_SCALE`); testnet and mainnet are unaffected. Both
machines must use the same value, or they disagree on when a rotation is released.

Machine S = the server (public IP `S_IP`, port 17701 open). Machine P = your PC.

## 1. Build and start

On both, from a checkout at the 0.5.0 commit:

```bash
cargo build --release
export LOKYX_DEVNET_TIME_SCALE=288
export LOKYX_WALLET_PASSWORD=devnet-password
```

Wallets (once each): on S `./target/release/lokyx-wallet --network devnet --wallet s.json new`, on P `... --wallet p.json new`
and a second one for the rotation target, `p2.json`. Note their addresses (`address`).

On S (mines):

```bash
./target/release/lokyxd --network devnet --datadir ./dev-s --p2p-port 17701 --rpc-port 18701 \
  --mine --coinbase $(./target/release/lokyx-wallet --network devnet --wallet s.json address) --threads 2
```

On P (follows; also mines a little so both sides produce blocks):

```bash
./target/release/lokyxd --network devnet --datadir ./dev-p --no-seeds --peer S_IP:17701 \
  --rpc-cors http://localhost:5173 --mine --coinbase $(./target/release/lokyx-wallet --network devnet --wallet p.json address) --threads 1
```

Devnet has `--no-seeds` semantics anyway; the pinned `--peer` is the only link.

## 2. Same chain on both

```bash
curl -s -X POST http://127.0.0.1:18701 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"lyx_chainInfo","params":[]}'
```

Run it on S and on P (P's RPC port is the default 18701 as well). **Pass:** after the two have been
connected a few minutes, `height` and `bestHash` are identical when read at the same height (if they
differ by one block, read again). Also `lyx_netHealth` on each shows one peer.

## 3. Every Op from the web app

```bash
cd app && npm install && VITE_DEFAULT_NODE=http://127.0.0.1:18701 npm run dev
```

Open http://localhost:5173 on P (network 77701 / devnet, node = P's RPC). Wait for ~12 blocks so a
coinbase is mature. The web app has screens for transfer, swap, vault, contracts and post-quantum
commit. **It has no UI yet for batch, timelock, token or starting a rotation** (known gaps in
STATUS.md); do those from the CLI (below) and mark them as checked there.

| Op | Web app | Pass |
|---|---|---|
| Transfer | Send | appears on both nodes, same balance |
| Vault (create, withdraw, cancel) | Vault | state on both nodes |
| Swap lock | Swap | listed on both |
| Deploy / Call | Contracts | receipt and `receiptsRoot` match on both |
| PQ commit | Security | `getAccount` shows it on both |
| Batch, Timelock, Token | CLI | tx confirmed, balance on both nodes |

After each, compare `lyx_getAccount` for the same address on S and P.

## 4. A rotation released live

On P (a plain account's delay is one day = 5 minutes here):

```bash
W="./target/release/lokyx-wallet --network devnet --wallet p.json --rpc http://127.0.0.1:18701"
NEW=$(./target/release/lokyx-wallet --network devnet --wallet p2.json address)
$W rotate --new-key $NEW
curl -s -X POST http://S_IP:18701 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"lyx_getAccount","params":{"address":"<p address>"}}'
```

**Pass 1:** `pendingRotation` shows `newKey` and a `releaseHeight` ~20 blocks ahead, on both nodes.
**Pass 2 (before release):** `$W send ...` still works with p.json and sending with p2.json for that
account fails. **Pass 3 (after ~5 minutes, once height ≥ releaseHeight):** `controller` in `getAccount`
is the new key on both nodes, `pendingRotation` is gone, and the old key is refused. Run a second
rotation and `cancel-rotate` it before release: it must disappear and the controller stay put.

## 5. A protocol 7 node is refused

Build the last protocol 7 release on P in another directory:

```bash
git worktree add ../lokyx-p7 3e99986 && (cd ../lokyx-p7 && cargo build --release --bin lokyxd)
../lokyx-p7/target/release/lokyxd --network devnet --datadir ./dev-p7 --no-seeds --peer S_IP:17701 \
  --p2p-port 17711 --rpc-port 18711
```

**Pass:** S's log shows a refusal (`not a LOKYX protocol 8 connection` / `protocol 7 is not
supported`), the p7 node never reaches S's height, and `lyx_netHealth` on S still lists only P.

## 6. Clean up

`pkill lokyxd` on both; delete `dev-s`, `dev-p`, `dev-p7`.
