# LOKYX Wallet

The phone wallet for LOKYX. Android and iPhone, built with Expo.

**Testnet beta.** Test coins only, no value. Not audited. Mainnets are switched off.
Security notes: `docs/WALLET_SECURITY.md`.

- Keys are made on the phone and kept in its secure storage, locked behind Face ID, a fingerprint or the
  device passcode, this device only. Nothing is sent anywhere.
- **Vaults:** a daily allowance, a delay on anything bigger, a 12-word recovery key on paper, an optional
  heir, key rotation with a cancel. Every action is described in words before you sign.
- **Alerts:** the wallet checks for withdrawals, settings changes and key rotations it didn't start, and
  lets you cancel with one slide. (A server-side watchtower for when the phone is off is a possible later,
  paid feature; the app is built to register with one.)
- **Bitcoin and Ethereum** (test networks) from the same 24 words: native segwit and Ethereum accounts,
  fee speeds, ERC-20 tokens by contract address, QR codes, a warning for look-alike addresses.
- **Nodes:** a list with automatic fallback; each node's chain and first block are checked.
- Payments are slide to pay, then Face ID, a fingerprint, or a 6-digit passcode.
- Every address has its signet: 24 spikes drawn from the address, the same as on the website.
- Rings instead of QR codes: your address drawn as a ring of arcs. The scanner reads rings
  (and QR codes) through a round window.
- Send and receive LYX and tokens, see activity, save people you pay.
- Several accounts from one set of 24 words.
- **Solana and Tron** (devnet, Nile) and 10 Ethereum-style test networks, from the same words. One Activity list shows payments from every coin.
- **Contract check:** before a website's contract call is approved, the app shows what it does, whether the contract and the spender have public source code, and whether it is on a short list of audited contracts. Unknown ones keep the approve slide locked until you tick that you read it.
- **Backup file:** an encrypted file (scrypt + XChaCha20-Poly1305) you can save anywhere and restore by choosing it. A QR code is optional.
- Time capsules: seal LYX and a note for yourself or someone else until a day you pick.
  Nobody can open it early, and the note is locked with time-based encryption (drand), so
  nobody can read it early either. Each capsule has its own ring, so you can hand it over by scanning.
- Make your own token, lock LYX in a savings jar, follow your mining rewards.
- A browser for LOKYX apps. Sites get `window.lokyx` and every payment is shown to you first.

## Supported chains

| Chain | Networks | Notes |
|---|---|---|
| LOKYX | testnet (chain 77703) | transaction format v2 |
| Bitcoin | signet (default), testnet | BIP84 `m/84'/1'/0'/0/i`, Esplora API |
| Ethereum | Sepolia and 9 other test networks | `m/44'/60'/0'/0/i`, EIP-1559, ERC-20 |
| Solana | devnet, testnet | SLIP-0010 `m/44'/501'/i'/0'` |
| Tron | Nile, Shasta | `m/44'/195'/0'/0/i` |
| Ethereum vault | Base Sepolia, Arbitrum Sepolia | Safe 1.4.1 + Allowance Module + Zodiac Delay 1.0.1 + Roles v1, no custom contracts; see `docs/ETH_VAULT.md` |

Mainnet for Bitcoin and Ethereum is switched off and not selectable in this beta. The Ethereum vault is test-network only, and has a hard blocker before any mainnet (recovery option B, see `docs/ETH_VAULT.md`).

## Tests

    npm run typecheck
    npm test        # node --test; checks signing against the chain's testdata/vectors.json in the repo root

## Run it

    npm install
    npx expo start

Scan the code with Expo Go, or press `w` for the web preview (no camera scanning or
browser there).

## Build the Android app (APK)

You need a free Expo account.

    npm install -g eas-cli
    eas login
    eas build -p android --profile apk

When it's done, EAS gives you a link to the `.apk`. To offer it from your site, put it on the
server and install with `APK=/path/to/lokyx-wallet.apk`, or copy it to
`/var/www/lokyx/download/`.

For the Play Store use `--profile production` (makes an `.aab`).

## On an iPhone, from a Windows PC (Expo Go)

1. On the iPhone, install **Expo Go** from the App Store and sign up / log in (avatar icon).
2. On the PC, install Node.js LTS from nodejs.org.
3. Double-click `start-iphone.bat`. Log in with the same Expo account when asked.
4. Scan the QR code with the iPhone camera. The wallet opens in Expo Go.

Keep the PC on while you use it this way. Face ID isn't available inside Expo Go, so the
wallet uses your passcode instead; everything else works. Your wallet lives inside Expo Go,
so write down your 24 words: deleting Expo Go deletes the wallet from the phone.

## Try it on an iPhone with Face ID

Face ID doesn't work inside the Expo Go app, so build the wallet itself.

With a Mac (free): install Xcode, then

    npx expo run:ios            # opens in the iPhone simulator
    npx expo run:ios --device   # on your iPhone over USB, signed with your Apple ID

In the simulator, turn Face ID on with Features > Face ID > Enrolled, then answer the prompt
with Features > Face ID > Matching Face (or Non-matching Face to see it fall back to the passcode).

Without a Mac (needs an Apple developer account):

    eas device:create              # register your iPhone, open the link on it
    eas build -p ios --profile iphone

Open the link EAS gives you on the iPhone to install it.

## Websites: window.lokyx

    const [address] = await lokyx.request({ method: 'lyx_requestAccounts' });
    const hash = await lokyx.request({ method: 'lyx_sendTransaction', params: { to, value } });
    const hash = await lokyx.request({ method: 'lyx_callContract', params: { to, method: 'transfer', args: [to, '1.5'] } });
    const { signature } = await lokyx.request({ method: 'lyx_signMessage', params: { message } });

`value` is in base units (1 LYX = 10^18) as a string. Read methods such as `lyx_call` and
`lyx_getAccount` go straight to the node. See `src/lib/provider.ts`.

## Rings

`src/lib/ring.ts`. 4 rings of 64 slots around a frame circle, each set slot drawn as a spike
pointing out from the centre (the address signet sits in the middle). One type byte, the 20-byte
address and 10 Reed-Solomon check bytes, so up to 5 damaged bytes are repaired. A fixed start
mark on the outer ring gives the rotation, and the reader fits an ellipse so tilted rings
read too.

    npm test                                          # Reed-Solomon
    node --experimental-strip-types tools/ring-check.mts   # 160 distorted rings

## Roadmap

See `ROADMAP.md`.

## Licence

MIT. See `LICENSE`.
