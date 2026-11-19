# Milestones to mainnet

This puts the gaps I know about in one order, each with a way to tell it is done. Nothing here has a date. A milestone
is finished when its exit line is true, not when time has passed. The wallet's own list is `wallet/ROADMAP.md`; this one
also covers the chain and the website.

Where things stand: the vault gate is built and tested on the real bytecode; nothing has run on a live network or a
phone; the website and the app have not been compared by running the app; the site deploy is failing until Pages is
switched on.

## M0. What I say matches what is there
- [ ] Switch on Pages (Settings, Pages, Source: GitHub Actions) and confirm the site workflow goes green
- [ ] Fix the Direct swap sentence: LOKYX with Bitcoin and Ethereum today, other pairs later
- [ ] Say on the vault section that the fixed rules and the gate apply to vaults made from this build on
- [ ] Replace the old card images in the Solana, Tron, home and portfolio screens with phone screenshots
- [ ] Keep "not audited yet" until the report is published; then link the report and name the auditor and date

Exit: every sentence on the site can be shown in the app on a phone, or says it is not there yet.

## M1. A build I can trust
- [ ] APK from the current `main`, installed on at least three different phones
- [ ] Reproducible build: the same commit gives the same APK hash twice
- [ ] Release signing key instead of the debug key, kept offline
- [ ] arm64 CI job actually run once; the failing Spoke test fixed

Exit: someone who is not me can rebuild the APK and get the same hash.

## M2. Real phones, real test networks
- [ ] Vault end to end on Base Sepolia and Arbitrum Sepolia: make, spend within the allowance, queue to the safe address, cancel, recovery sweep
- [ ] A vault made before the gate and one made after, side by side
- [ ] Solana devnet and Tron Nile sending; Bitcoin signet send and receive
- [ ] Ring in dim light and at a slant; send animation on each coin; tap to pay between two phones
- [ ] Encrypted backup: save, restore, wrong password
- [ ] Two watchtowers deployed and registered
- [ ] Ethereum and token history in Activity (ERC-20 transfers)

Exit: each line has been done on a phone and the result written in `docs/REHEARSAL.md`.

## M3. Vault review
- [ ] Pin the code hashes of the Safe, Allowance, Delay and Roles contracts (`scripts/pin-eth-vault-hashes.mjs`, needs network)
- [ ] Independent review of the gate: the Roles scoping, the Delay wiring, the dead owner
- [ ] Review of the wallet's signing, guards and contract check
- [ ] Fix what the review finds, then run the mutation checks again

Exit: the report is in `docs/` and every finding is fixed or explained.

## M4. Chain decisions
- [ ] Emission schedule and the numbers behind it
- [ ] Chain id (7701 is a placeholder)
- [ ] SLIP-44 coin type
- [ ] Token creation burn (5 LYX is a placeholder)
- [ ] Fuzz block processing and the p2p layer, not only the decoders
- [ ] Testnet reset as 0.5.0 with these values

Exit: no placeholder left in the chain or the wallet.

## M5. Public testnet with outsiders
- [ ] At least three months running after the 0.5.0 reset, with miners other than me
- [ ] Assume-valid checkpoint
- [ ] Bug reports answered in public; a list of what was found and fixed

Exit: three months with no consensus failure and no loss of test funds that was not fixed.

## M6. Wallet ready for real money
- [ ] WalletConnect through the same approval sheet and contract check
- [ ] Typed data decoded (Permit2, Seaport) instead of raw fields
- [ ] Cancel from a second device
- [ ] Limits and warnings for the first real-money week, with a low default allowance
- [ ] Closed beta with real users on test networks

Exit: closed beta ran for a month and nobody lost funds because of the wallet.

## M7. Mainnet
- [ ] Base first, low daily limit
- [ ] LOKYX mainnet only after M4 and M5
- [ ] A way to stop: what I do if something breaks in the first week, written down before launch

Exit: the first month on mainnet with no loss traced to the wallet or the chain.

## After mainnet
- Instant swap through a trade service, with the fee shown on screen
- Direct swap for more pairs, one chain at a time
- One-sheet payments: amount, fee and Face ID on one sheet, then a slide
- More coins and swaps between them
- Bitcoin vault protection with a timelocked recovery
- Ledger support
- iPhone app, once there is an Apple developer account
