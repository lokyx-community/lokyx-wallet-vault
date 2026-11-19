# lokyx-web

Wallet, explorer and mining controls for LOKYX, in the browser. It talks directly to a
`lokyxd` node over JSON-RPC; there's no server of its own.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # checks the wallet against testdata/vectors.json from the Rust node
npm run build      # static files in dist/
```

The node has to allow the app's origin:

```bash
lokyxd --rpc-cors http://localhost:5173
```

The node address can be changed in Settings (default `http://127.0.0.1:18701`).

## How the wallet works

- Keys are generated in the browser (BIP-39, 24 words) and derived on the same path as the CLI
  wallet, so a phrase restores to the same address in both.
- The phrase is stored in `localStorage`, encrypted with XChaCha20-Poly1305 under an Argon2id key
  from your password. The unlocked key lives in memory only and is dropped after 15 idle minutes.
- Transactions are signed locally and sent as raw bytes. `src/lib/lokyx.test.ts` makes sure the
  encoding and signatures match the node byte for byte.

## Layout

```
src/lib/lokyx.ts   addresses, keys, transaction encoding and signing
src/lib/vault.ts   encrypted storage
src/lib/rpc.ts     RPC client and polling hooks
src/state.tsx      chain and wallet state
src/ui.tsx         shared components and the pixel fingerprints
src/pages/         one file per screen
```
