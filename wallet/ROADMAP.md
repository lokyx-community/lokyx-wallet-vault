# Roadmap

What is built is in the app today, on test networks. What is not built is listed here, in the order I plan to do it.

## Milestone 1: run it on real phones
- [ ] Test the vault flow end to end on Base Sepolia and Arbitrum Sepolia
- [ ] Test Solana (devnet) and Tron (Nile) sending
- [ ] Test the encrypted backup file: save, restore, wrong password
- [ ] Deploy two watchtowers and register them in the app
- [ ] Ethereum and token history in Activity (ERC-20 transfers are missing)

## Milestone 2: WalletConnect
- [ ] Pair by QR or link
- [ ] Session proposal screen with the site, networks and permissions
- [ ] Send, sign message and sign typed data go through the same approval sheet and contract check
- [ ] Connected sites list with disconnect

## Milestone 3: safer signing
- [ ] Decode typed data (Permit2, Seaport orders) instead of showing raw fields
- [ ] Contract check for LOKYX-chain contracts, with a verified-source registry
- [ ] Longer, updatable list of audited contracts with report links
- [ ] Cancel from a second device
- [ ] Air-gapped signer on a second phone

## Milestone 4: review and mainnet
- [ ] Independent security review of the vault, the guards and the signing code
- [ ] Fix what the review finds
- [ ] Closed beta with real users on test networks
- [ ] Decide on mainnet, starting with Base and a low default allowance

## Later
- Bitcoin vault protection with timelocked recovery
- Hardware wallet support (Ledger)
- Cancel tickets in the LOKYX chain (needs a testnet reset)
