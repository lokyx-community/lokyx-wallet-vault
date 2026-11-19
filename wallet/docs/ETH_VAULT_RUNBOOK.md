# Ethereum vault runbook (Windows, PowerShell)

Goal: run the experimental Ethereum vault on a live testnet (Base Sepolia) and a real phone, and write down what breaks.
**Test coins and a throwaway wallet only.** Nothing here touches real money.

Unverified by me (I had no internet): every command below that talks to a network or to the deploy repos. If one fails,
go to section 4.

## 0. Once: tools

```powershell
node -v          # need 18 or newer; if missing install from nodejs.org
cd $HOME\Downloads\lokyx-wallet
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned   # only if PowerShell says scripts are disabled
npm install --legacy-peer-deps
npm test         # expect: tests 143+, fail 0
```

## 1. Pin the code hashes (mainnet is the reference)

The audited contracts live on Ethereum mainnet. Their hashes are the truth the app will compare against.

```powershell
node scripts/pin-eth-vault-hashes.mjs https://ethereum-rpc.publicnode.com | Tee-Object mainnet-hashes.txt
```

Each line is `name  address  hash`. All nine must show a hash, none `NOT DEPLOYED`. The five Safe lines must equal the
hashes already in `src/lib/ethvault-core.ts` (if not: STOP, section 4). Now paste the four missing ones: open
`src/lib/ethvault-core.ts`, find the lines for `allowanceModule`, `delayMastercopy`, `rolesMastercopy`,
`moduleProxyFactory` and replace `codeHash: null as Hex | null` with `codeHash: '0x<hash from the output>' as Hex | null`.

```powershell
npm run typecheck
npm test
```

## 2. Base Sepolia: test ETH, then the module contracts

### 2a. Test ETH (for the deploying account)

Make a throwaway deployer key and fund it. In PowerShell:

```powershell
node -e "const {generatePrivateKey,privateKeyToAccount}=require('viem/accounts');const k=generatePrivateKey();console.log('KEY',k);console.log('ADDRESS',privateKeyToAccount(k).address)"
```

Save both lines. Get Base Sepolia ETH to ADDRESS from a faucet: search "Base Sepolia faucet" (Coinbase Developer Platform,
Alchemy and QuickNode all run one; some need a free account). 0.05 ETH is plenty. Do the same later for the phone.

### 2b. Is anything already deployed there?

```powershell
node scripts/pin-eth-vault-hashes.mjs https://sepolia.base.org | Tee-Object basesepolia-hashes.txt
```

Compare with `mainnet-hashes.txt`. Any line saying `NOT DEPLOYED` needs deploying. A line with a hash **different** from
mainnet: STOP, section 4. (Safe's five contracts and the Zodiac module factory are usually already on Base Sepolia.)

### 2c. Deploy what is missing

The canonical addresses come from deterministic deployment of the official release builds, so deploy from the official repos,
not from my test bytecode (my compiled copies would land on different addresses). I could not check the exact deploy
commands offline; treat these as the starting point and follow each repo's README if a command has changed.

```powershell
cd $HOME\Downloads
git clone https://github.com/safe-global/safe-modules
cd safe-modules\modules\allowances     # Allowance Module v0.1.1: use the tag for that release
git tag --list | Select-String "allowance"
npm install
$env:PK = "<KEY from 2a, without 0x if the repo asks>"
$env:NODE_URL = "https://sepolia.base.org"
npx hardhat --network custom deploy    # or the repo's documented deploy script; it prints the address
```

```powershell
cd $HOME\Downloads
git clone https://github.com/gnosisguild/zodiac-modifier-delay
cd zodiac-modifier-delay
git checkout v1.0.1                    # NOT 1.1.x
npm install
# follow the README "deploy mastercopy" step for a custom RPC (https://sepolia.base.org) with your key
```

```powershell
cd $HOME\Downloads
git clone https://github.com/gnosisguild/zodiac-modifier-roles
cd zodiac-modifier-roles
git checkout v1                        # the v1 line (mastercopy 1.1.0), NOT v2
npm install
# follow the README mastercopy deploy step for https://sepolia.base.org
```

### 2d. Check the result

```powershell
cd $HOME\Downloads\lokyx-wallet
node scripts/pin-eth-vault-hashes.mjs https://sepolia.base.org
```

Pass = every address in `src/lib/ethvault-core.ts` shows a hash **identical to the same line in `mainnet-hashes.txt`**.
If the deploy landed on a different address but the hash matches, write the new address down and send it to me (do not
edit `CONTRACTS` addresses yourself). If the hash differs, the code is not the audited build: do not use it.
Arbitrum Sepolia is a later round; do Base Sepolia first.

## 3. Run the vault on a real phone

Use a **fresh wallet made for this test** (not your real one).

```powershell
cd $HOME\Downloads\lokyx-wallet
npm install -g eas-cli
eas login
eas build -p android --profile apk      # download the .apk from the link, install it on the phone
```

(Emulator instead: install Android Studio's emulator and drag the .apk onto it.)

On the phone, in order. Write the result of each step (OK / what happened / the exact message).

1. Create a wallet. Open **Ethereum**, copy the address (the everyday address). Send Base Sepolia ETH to it from the faucet (0.05).
2. **Ethereum, then Vault protection (experimental)**, choose Base Sepolia, **Set up a vault**. Write the 12 words on paper, answer the check, keep the defaults (ETH 0.01, USDC 10, wait 24 hours), set a separate safe address if you have one, slide to create. Expect the steps: checking, creating, switching on, verifying, then the vault screen with no warnings.
3. Fund the vault: copy its address from the vault screen and send it 0.05 ETH from the faucet (faucet can send to any address). USDC: optional, from Circle's faucet (faucet.circle.com, Base Sepolia).
4. **Spend within allowance:** Send 0.005 ETH to any address. Expect "goes out straight away", then Sent.
5. **Queue a large withdrawal:** Send 0.02 ETH (over the 0.01 allowance). Expect "waits 24 hours". It appears under Waiting with a countdown.
6. **Cancel it:** slide to cancel all waiting. Expect the Waiting list to empty.
7. **Alert from outside:** queue another, close the app fully, wait 15–30 minutes. Expect a notification only if the phone did not start it, so this step mainly checks the app-open check: reopen the app, the Waiting screen should not duplicate your own item.
8. **Sweep with the recovery key:** Use my recovery key, type the 12 words, "Sign a sweep", then "Send it now from this phone". Expect ETH to arrive at the safe address.
9. **Gas starvation:** start a new queue first (repeat step 5; fund the vault again if swept). Then empty the everyday address: put the phone's 24 words into MetaMask on a throwaway profile, add Base Sepolia, send all its ETH away (leave 0). In the LOKYX app: Use my recovery key, "Sign a cancel", **Copy it**. On a second device (or a second fresh LOKYX wallet that has faucet ETH), open Use my Ethereum recovery key, paste into "Have a signed action?" and send. Expect the queue to be cancelled even though the first phone has no ETH.
10. Open the Waiting screen on the first phone: no items, no warnings.

## 4. If anything fails: write down

- Step number and the exact on-screen message (screenshot).
- Phone model and Android version, or emulator name.
- The transaction hash, if there is one (look it up on https://sepolia.basescan.org), and the network.
- The vault address, everyday address, recovery address (public addresses are fine to share; **never the words**).
- Output of `node scripts/pin-eth-vault-hashes.mjs <rpc>` for both mainnet and Base Sepolia (the two .txt files).
- Whether the problem repeats after closing and reopening the app.
- For a build or script error: the full PowerShell text, and `node -v`.

Send me those and I will pick it up from there. Until then nothing more is built.
