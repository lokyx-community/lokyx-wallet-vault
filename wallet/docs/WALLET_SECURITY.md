# LOKYX Wallet: how security works

Beta, test networks only. This is what the wallet does today, what an attacker can and cannot do,
and what is still missing. Read "Known limitations" before trusting it with anything that matters.

## Where keys live

- **The 24 words and each LYX account key** are stored with `expo-secure-store` using
  `requireAuthentication: true` and `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`
  (`src/lib/secrets-core.ts`, `src/lib/secrets.ts`). Reading one makes the phone itself ask for Face ID,
  a fingerprint or the device passcode. They are not in iCloud/Google backups and do not move to another
  device. On an Android phone with no biometric enrolled the wallet stores them this-device-only without
  the per-read prompt and relies on the wallet's own passcode; the phone's lock screen is then the only
  hardware-backed gate.
- **Bitcoin and Ethereum keys are not stored.** They are derived from the 24 words for one signing
  (BIP84 `m/84'/coin'/0'/0/i`, Ethereum `m/44'/60'/0'/0/i`) and wiped. Only their public addresses are cached.
- **The vault recovery phrase** (12 words) is shown once at setup, never stored by the app, and must be
  confirmed back before the vault can be created.
- In memory a key exists only while signing; buffers are zeroed afterwards (best effort in JavaScript:
  the runtime may keep copies I cannot reach).
- The 24-word and recovery-phrase screens block screenshots and recording (Android `FLAG_SECURE`, iOS
  capture prevention) and are covered when the app leaves the foreground.

### If the phone's biometrics change
**Face unlock on Android.** Android lets only a strong biometric (in practice the fingerprint) release a key that is
bound to the phone's biometric check; most face unlocks are not strong enough. So by default an Android phone asks for the
fingerprint on every payment. In Security there is an optional "Unlock with your face" switch. Turning it on moves the keys
to device-only secure storage (still hardware backed, never in backups) and the wallet itself asks for your face or the
passcode before it reads them. That is a weaker guarantee than the phone's own check, which is why it is off by default.
Turning it off moves the keys back, and needs a fingerprint set up.

Adding or removing a fingerprint or face can permanently invalidate the stored keys (the phone does this
on purpose). A failed read can also be a passing Android Keystore error that looks the same, so the
keys-lost screen never erases anything:
- **Try again** reads once more; a clean read returns to the wallet with nothing changed.
- **Restore** asks for the 24 words first, derives account 0 (and every other stored account) and compares
  them with the public addresses already on the phone. Only if they all match are the stored words and keys
  replaced. Wrong words change nothing. The rest of the wallet (accounts, passcode, settings) is kept.
Without the words, and if the keys stay locked, the money is gone: nobody can reset this.

### Screen lock and storage mode
- Keys are not stored at all on a phone with no screen lock (expo-local-authentication security level
  NONE); create and restore show a clear message instead.
- A phone with a screen lock but no biometric stores keys in 'device' mode (hardware-backed,
  this-device-only, guarded by the wallet passcode). After the next successful unlock on which a biometric
  is enrolled, the words and keys are re-stored in 'auth' mode (the phone's own check on every read). If any
  write fails, everything is put back in 'device' mode and nothing becomes unreadable.

## What an attacker can do

| Attacker has | Can do | Cannot do |
|---|---|---|
| A **locked** stolen phone | Nothing useful: keys are behind the lock screen and biometrics. | Read keys, sign. |
| An **unlocked** phone, wallet closed | Open the wallet only with Face ID/fingerprint/passcode. With a **vault**, a thief who gets in can spend at most today's allowance; bigger withdrawals wait, in the open. | Move more than the allowance quickly. |
| The **24 words** (phished, photographed) | Take everything on non-vault accounts at once. On a vault account, same as a stolen key: the allowance, and withdrawals that you can cancel. | Cancel or sweep without the 12-word recovery key; change the vault's recovery key or safe address without waiting out the delay. |
| The **12 recovery words** only | Cancel your pending withdrawals (a nuisance) and **sweep the vault to its safe address**. With the default safe address (derived from the same 12 words) that moves everything to an address the thief controls. | Spend normally. Use a separate wallet as the safe address so the recovery words alone can only send money to you. |
| **Both** word sets | Everything. | |
| A malicious website in the in-app browser | Ask for payments; each one is shown in words and needs your confirmation. | Sign silently. |
| A fake or poisoned address in your history | Trick you into paying it if you do not compare it. The wallet warns when a destination starts and ends like an address you have used but is different. | |

**Key stolen? Rotation won't save your funds. Sweep your vault or move your funds now.** A key rotation
waits its delay (the vault's delay, or one day) and the thief can start one too; it is for planned key
changes and lost devices, not for theft.

## Vaults

A vault is an account with a daily allowance and a delay on anything bigger (see the chain repo's
`docs/VAULTS.md`). The wallet's screens: set up (allowance, wait, recovery key shown once and
confirmed, safe address, optional heir with an inactivity period), allowance left today, waiting items with
countdowns, start a large withdrawal, cancel any pending item, sweep with the recovery key, heir claim, and
key rotation with cancel. Every signing screen first says in words what will happen.

## Alerts

A background task (about every 15 minutes at best; the OS decides, and it may run less when the battery is
low) and the app opening both check your accounts for vault withdrawals, setting changes, heir claims and
key rotations **this phone did not start**. A local notification opens a screen with a one-slide cancel
(signed by the account's key; the recovery key is one more tap away). A red banner shows on every screen
while something is waiting.

**Not built yet: a watchtower.** When the phone is off, nothing cancels for you. A server-side watchtower
that cancels while the phone is off is a possible later, paid feature. The app is designed to register with
one (`Watchtower` in `src/lib/watch-core.ts`: the person would sign a cancel authorisation once; the key
itself would never leave the phone). No server exists and nothing is sent anywhere today.

## Nodes

Every node (the built-in one and any you add) must report the chain id this wallet expects and the same
genesis hash as the first node it trusted, or it is refused. If one stops answering, the next is used.
After an announced network reset, "The network was reset" on the Network screen lets the wallet learn the
new first block.

## Bitcoin and Ethereum

Test networks (Bitcoin signet/testnet, Ethereum Sepolia) only. A real-money setting exists but is off,
there is no way to pick a mainnet yet, and a last check in front of signing refuses a mainnet send while it
is off. Tokens are identified by chain and contract address, never by name. Sends show the amount,
recipient, fee, change and (for tokens) the contract in words before you can slide to sign. Block explorer
and RPC endpoints are public, need no key, and can be changed in Settings; the Ethereum endpoint is checked
to be the right chain.

## Ethereum vault (test networks only): experimental

**Experimental.** Labelled so in the app until it has been run on a live testnet and on a real phone (runbook: `docs/ETH_VAULT_RUNBOOK.md`). Do not rely on it, and use test coins only.

Base Sepolia and Arbitrum Sepolia. The vault is a Safe whose only owner is a 12-word recovery key; the phone's
everyday address can spend a per-coin daily allowance, queue anything bigger behind a wait of 24 hours or more
(default 2 days), and cancel what is waiting. No contract of my own: Safe 1.4.1, the Safe Allowance Module,
Zodiac Delay 1.0.1 and Zodiac Roles v1. Details and the threat table are in `docs/ETH_VAULT.md`.

- **Keys.** Everything is signed on the phone. The recovery words are shown once at setup and never stored; the
  app keeps only the recovery *address*. No server holds a key, and there are no hidden fees (the everyday address
  pays the network fee).
- **Gas starvation.** A thief who empties the everyday address cannot stop a cancel: the recovery key signs a
  cancel or sweep offline (`lokyx-eth-action:...`) that any account can submit and pay for. The vault screen also
  shows the recovery address's ETH balance with a low-fuel warning. Tested: everyday address emptied, cancel still works.
- **Clear signing.** Every vault action is described in words before the slide, including a queued item you did not
  start. A delegatecall, an unlimited approval, a Permit or a message signature is flagged as dangerous.
- **Refused outright.** The app never builds a delegatecall, an unlimited ERC-20 approval, a Permit/Permit2 or any
  `personal_sign` / typed-data request for the vault, whatever a site asks.
- **Live check on every app open.** The owners, threshold, modules, guard, fallback handler, Delay wait and expiry,
  Roles wiring, allowance delegates and amounts and the contracts' code hashes are read from the network and
  compared with the settings stored for *that network* (the same vault address has separate settings on each
  network). Anything unexpected is shown and sent as an alert, not only events. A contract whose code hash is not
  pinned yet is reported as not verified.
- **Known limits.** Roles v1 can only scope by target address, so it cannot stop the phone key from *queueing* a
  delegatecall to an arbitrary address; the defence is the wait, the alert and the cancel (tested), and the app
  never builds one. Recovery is option B: the Safe's owner is a dead address, and the recovery key can only cancel and send to the safe
  address (tested on the real bytecode; vaults made before that build still have option A). It has not run on a live
  network yet. New vaults have a gate (a second Roles module in front of the Delay), so the phone can queue only sends to the safe address and the rules cannot be changed afterwards. Older vaults still let the phone queue anything behind the wait.
  The Zodiac exploit of 1 June 2026 hit Delay 1.1.x and Roles 2.1.x; this vault uses Delay 1.0.1 and Roles v1, and
  the app refuses the affected versions. See the advisory and audit links in `docs/ETH_VAULT.md`.
- **Not run live.** The contracts are tested in an EVM test harness with the real bytecode; nothing has run against
  a live network or on a device yet, and the Allowance Module, Delay and Roles are not deployed on the two testnets.

## Known limitations

- A beta. No independent audit of the wallet or the chain yet.
- Keys stored by an older build without per-read authentication are not migrated; re-create or restore.
- JavaScript cannot guarantee wiping every copy of a key from memory.
- Background checks are not guaranteed to run on time; there is no watchtower.
- The web build keeps keys in browser storage and is for trying the wallet only.
- Prices: none. Test coins have no value, so there is no portfolio total in fiat.
- The wallet signs LOKYX transactions in format v2 and a vault/rotation action by a non-owner key needs the
  right `from`; the unit tests check bytes against the chain's own test vectors.
- Public Bitcoin/Ethereum endpoints can see your addresses and IP address. Use your own endpoint if that matters.
- Opt-in usage counts are designed (`src/lib/usage-core.ts`) but off and wired to nothing.
