# LOKYX Snap

A MetaMask Snap that lets MetaMask hold a LOKYX key. It does two things:

- `lyx_getAddress` returns the `lyx1` address for the user's MetaMask recovery phrase. It uses the
  same path as the LOKYX wallets (`m/44'/7701'/0'/0/i`), so the same phrase gives the same address
  everywhere.
- `lyx_signTransfer` shows the transfer in a MetaMask dialog (network, from, to, amount, fee,
  total). It signs only if the user approves. The web app then broadcasts the signed transaction to
  a node.

The key never leaves MetaMask. The Snap has no network access.

```bash
npm install
npm run build    # dist/bundle.js, and updates the manifest checksum
npm test         # runs the Snap in MetaMask's simulator against ../testdata/vectors.json
npm run serve    # serves it at http://localhost:8080 for local development
```

To try it with the web app locally, run `npm run serve` here and `npm run dev` in `../app`. Then use
a browser with **MetaMask Flask** and click Connect MetaMask on the Wallet page.

## Publishing

1. Bump `version` in both `package.json` and `snap.manifest.json`, run `npm run build`, then
   `npm publish`. The package name is `lokyx-snap`; change it in both files first if you want a
   different one.
2. The web app connects to `npm:lokyx-snap` by default. Set `VITE_SNAP_ID` at build time to use
   another id.

Regular MetaMask only installs Snaps that are on its allowlist. Because this Snap manages keys
(`snap_getBip44Entropy`), getting listed needs:

- a third-party security audit from one of MetaMask's approved auditors;
- a submission through MetaMask's Snaps Directory form.

See "Get allowlisted" in MetaMask's Snaps documentation. Until then, it installs in MetaMask Flask.

## Permissions

| Permission | Why |
|---|---|
| `snap_getBip44Entropy` (coin type 7701) | derive the LOKYX key from the MetaMask recovery phrase |
| `snap_dialog` | ask the user to approve each transfer |
| `endowment:rpc` (websites only) | let the LOKYX web app ask for the address and signatures |
