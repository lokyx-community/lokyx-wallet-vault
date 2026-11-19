# Vault protection on Ethereum (design, Step 1)

Status: **design only, waiting for approval.** Networks: **Base Sepolia (84532) first, then Arbitrum Sepolia
(421614)**. Ethereum Sepolia stays as it is. Mainnets stay behind the existing off-by-default setting and pre-sign guard.

## 1. Approach and contracts

**Choice: a Safe smart account with three audited, existing modules. No new Solidity.**

| Part | Contract, version | Address (deterministic, same on every chain listed) | Audits | On Base Sep. / Arb Sep. |
|---|---|---|---|---|
| Account | Safe L2 **v1.4.1** (`SafeL2`) + `SafeProxyFactory` | singleton `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`, MultiSendCallOnly `0x9641d764fc13c8B624c04430C7356C1C7C8102e2`, fallback handler `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` | Ackee (v1.4.x); older versions by G0 Group / Runtime Verification | **official on both** |
| Daily allowance | Safe **Allowance Module v0.1.1** | `0xAA46724893dedD72658219405185Fb0Fc91e091C` (Base, Arbitrum, ...); v0.1.0 `0xCFbF…3134` on Ethereum/Sepolia | Safe audit 2020; Ackee 2024 | **not deployed** |
| Delay + cancel | Zodiac **Delay Modifier v1.0.1** (mastercopy) behind a minimal proxy | `0xd54895B1121A2eE3f37b502F507631FA1331BED6`; module factory `0x000000000000aDdB49795b0f9bA5BC298cDda236` | G0 Group (Zodiac) | **not deployed** |
| Phone-side cancel | Zodiac **Roles Modifier v1.1.0** (one narrow permission) | `0xD8DfC1d938D7D163C5231688341e9635E9011889` | G0 Group (Zodiac) | **not deployed** |

Addresses come from `@safe-global/safe-deployments` 1.37.67, `@safe-global/safe-modules-deployments` 3.0.14 and
`@gnosis-guild/zodiac` 5.0.1. Safe v1.5.0 is not used: it is not deployed on Arbitrum Sepolia.

**Two findings that shape the design:**
- **None of the modules is officially deployed on Base Sepolia or Arbitrum Sepolia.** All three were deployed through
  deterministic factories, so the same audited bytecode can be deployed to the **same addresses** on those testnets.
  The wallet would then check each module's code hash against the official mainnet deployment (Base or Arbitrum)
  before trusting it, and refuse to use it otherwise (decision 2).
- **On 1 June 2026, Gnosis Pay lost about $1.5M through Zodiac Delay v1.1.0.** Delay v1.1.0 and Roles v2.1.0/2.1.1
  accepted a reverting ERC-1271 "signature" as a module's approval. Safe lists Delay v1.0.x and Roles v1 as not
  affected; they predate signature support entirely. That is why v1.0.1 and Roles v1 are chosen here, and why
  1.1.x and Roles v2 are out until a fixed release is published and confirmed.

**Why not an ERC-4337 account (Kernel/Nexus + ERC-7579 modules)?**
- The closest module set, Rhinestone Core Modules (ColdStorageHook for the delay, DeadmanSwitch for an heir), came
  out of Ackee's 2024 audit with 7 high-severity findings and an explicit "do not deploy until fixed". Its current
  status would need re-checking.
- 4337 also adds a bundler, a third-party relay, for no benefit here: the phone's key can submit transactions itself.
- Safe is the most used and audited smart account, and its addresses are the same on all the target networks.

## 2. How each vault feature maps

The vault is a Safe. **The phone's key is not a Safe owner.** If it were, it could call `execTransaction` and skip every
module. Instead the phone key has three limited roles:

- **Daily allowance:** the phone key is the Allowance Module's *delegate*, with one allowance per token. The reset period
  is 1,440 minutes (a day). `token = 0x0` means ETH; USDC, and USDT where it exists, are listed by contract address.
  Spends go straight through up to the allowance. Tokens without an allowance can't be spent instantly at all.
- **Larger withdrawals:** the phone key is a module **on the Delay Modifier**, which is itself a module on the Safe.
  Anything beyond the allowance is queued with `execTransactionFromModule` (event `TransactionAdded`). It can only run
  after `txCooldown` (the vault's wait), via `executeNextTx`, and it expires after `txExpiration` (7 days) so a forgotten
  queue can't fire later.
- **Cancel:** `Delay.setTxNonce` (owner = the Safe) skips everything queued up to a nonce.
  - The **recovery key** can always do this.
  - The **phone key** can do it in one slide through a Roles v1 role that allows exactly `setTxNonce` on the Delay
    address and nothing else (decision 5). The worst a thief can do with it is cancel your own queued withdrawals.
- **Sweep by the recovery key:** the recovery key is the Safe's owner, threshold 1 (decision 4, option A). It signs a
  `MultiSendCallOnly` batch that moves ETH and each listed token to the safe address.
- **Heir after inactivity:** no audited Safe module does this. The closest is Candide's Social Recovery Module (v0.1.0,
  Ackee audit; v0.2.0 fixes Certora's findings). There, a guardian requests an owner swap that runs after a fixed period
  unless cancelled. It is not deployed on the testnets I use and its semantics differ from the LYX heir. **Proposal: no heir on
  Ethereum in this step** (decision 7).
- **Changing settings is delayed:** every configuration change is a call by the Safe to itself, or to modules it owns.
  That covers adding or removing modules or the guard, owners and threshold, allowances and delegates, Delay
  cooldown and expiry, and Roles permissions. The phone can only reach these through the Delay queue, so they wait,
  raise an alert, and can be cancelled like any withdrawal. Turning the protection off takes the full wait.

## 3. Threats

| Attacker has | Can do | Cannot do |
|---|---|---|
| **Stolen phone, unlocked** (or the phone key) | Spend up to today's allowance per token, every day, until you sweep. Queue anything, which waits in the open. Cancel your queued withdrawals (nuisance only). | Spend more than the allowance before the wait ends; change any setting without waiting; sign approvals, permits or orders. |
| **Stolen 24 words** | The same as the phone key (they derive it). | The same. |
| **Stolen recovery words** | Option A: **everything, at once**, anywhere: they are the Safe's owner. Option B: only cancel, and sweep to *your* safe address. | Option B: send anywhere else. |
| **24 words and recovery words** | Everything, at once. | Nothing stops this. Keep them apart. |
| **Malicious dapp** | Ask the phone to sign. Instant paths can only transfer within the allowance. | Get an approval or permit from the vault (see §4). |
| **Malicious module or upgrade** | If one is added, everything. But adding it is a delayed, alerted change, and so is changing the Safe singleton. Delay and Roles are non-upgradeable minimal proxies. | Install it without waiting out the delay, if you act on the alert. |

Plainly: protection only holds if someone cancels within the wait. Phone background checks are not instant (iOS can
defer them for hours), so the minimum wait should be 24 h (decision 8).

## 4. Owner-key bypass attempts and what blocks each

1. **Add a module, change the guard, change owners or threshold, swap the singleton:** these are Safe self-calls (`authorized`).
   The phone's only route to them is the Delay queue: delayed and alerted.
2. **Lower the Delay cooldown or expiry, or remove the Delay:** these are owner-only on the Delay, and the owner is the
   Safe. Same route, and the current cooldown applies to the change itself.
3. **Delegatecall:** the Delay allows `operation = 1` from its modules, so a thief can queue one. It is delayed, decoded as
   "can rewrite the vault: cancel unless you did this", and the app never builds one itself. The Allowance Module and the
   cancel role cannot delegatecall.
4. **ERC-20 `approve` or `increaseAllowance`:** the Allowance Module only performs `transfer`, so an approval can only be
   queued. The app refuses to build unlimited approvals. A queued approval from elsewhere gets the strongest warning.
5. **EIP-2612 `permit`, Permit2, Seaport and other off-chain signatures:** a Safe "signs" through ERC-1271 (owner
   signatures, or `signedMessages` set by a `SignMessageLib` delegatecall). The phone key is not an owner, and a
   `signMessage` call is a delegatecall through the Delay. **So the vault cannot produce a valid off-chain signature
   instantly.** Permit2 additionally needs an on-chain approval to Permit2 first, which is delayed under item 4.
6. **Abusing the allowance:** limited to the per-token amount per day. The gas `payment` field also counts against it. A
   token with no allowance can't move instantly.
7. **Racing the cancel:** after the cooldown anyone can call `executeNextTx`. The defence is cancelling *before* it ends,
   hence the 24 h minimum and alerts.
8. **Swapping module addresses in the app:** module addresses are fixed per chain in the app and checked by code hash
   (decision 2).

## 5. Costs (estimates; Step 2 measures them on a fork)

| Action | Gas (estimate) | Base / Arbitrum at ~0.01–0.1 gwei | Ethereum L1 at 10 gwei |
|---|---|---|---|
| Create vault: Safe proxy, Delay proxy, Roles proxy, enable modules, 3 allowances | 0.9–1.3 M | ~0.00001–0.0001 ETH, plus a small L1 data fee | ~0.01 ETH |
| Spend within allowance (vs 21 k ETH / ~50 k ERC-20 plain) | 70–90 k | negligible | ~0.0008 ETH |
| Delayed withdrawal (queue + execute) | 120–160 k | negligible | ~0.0015 ETH |

- **Who pays:** the phone's plain Ethereum address pays gas. Nothing else is involved: no relayer, no paymaster, no fee to
  LOKYX.
- **Counterfactual creation works:** the Safe address comes from CREATE2 (factory, setup data and salt), and so do the
  module proxies. The vault address can be shown and receive funds before it exists. It is deployed with the first
  outgoing action or "Activate".

**Trusted list + delay (Argent's current model) vs a price-based daily limit:**
- **Argent today:** since February 2025, Argent Vault dropped daily limits. Trusted addresses get instant transfers of any
  amount, everything else needs guardians, and trusting a new address waits 36 h. Argent gave a reason for dropping
  daily limits: some assets couldn't be covered because the limits relied on on-chain price oracles.
- **The trusted list:** buildable from audited parts. A Roles scope allows "transfer to an address on this list", and
  editing the list is a delayed setting. It costs about 30–60 k more gas per transfer and nothing else. The risk is that
  a thief queues their own address as trusted, but that is visible and cancellable.
- **A USD daily limit:** needs a **custom guard or module** (against the hard rule) that reads Chainlink on every spend.
  - Reading is free apart from gas: about 10–20 k gas per price, plus an L2 sequencer-uptime check and a "spent today"
    write. That adds roughly 25–50 k gas per spend, negligible on L2 and about 0.0003–0.0005 ETH at 10 gwei on L1.
  - The real costs are elsewhere: stale or manipulated prices, sequencer downtime, tokens with no price feed (which then
    can't be limited at all), thin testnet feed coverage, and an independent audit before mainnet.
- **Recommendation:** keep per-token allowances (audited, no oracle). Add an Argent-style trusted list later as an option.
  Don't build a price-based limit.

## 6. Alerts and one-slide cancel

The existing background task gets an Ethereum watcher per network. It calls `eth_getLogs` on:
- the Delay proxy: `TransactionAdded(queueNonce, txHash, to, value, data, operation)`;
- the Safe: `EnabledModule`, `DisabledModule`, `ChangedGuard`, `AddedOwner`, `RemovedOwner`, `ChangedThreshold`,
  `ChangedFallbackHandler`;
- the Allowance Module: `ExecuteAllowanceTransfer` (for information).

A queued item whose `txHash` this phone didn't record as started raises the same alert and banner as on LYX. The
alert shows the countdown (`txCreatedAt + txCooldown`) and a clear-signing line. **Slide to cancel** sends the
Roles-scoped `setTxNonce(queueNonce)` from the phone key. Because the Delay is first-in-first-out, it skips **everything**
still waiting, and the screen says so. Delay v1.0.1 has no cancel event, so a cancel is confirmed by reading `txNonce`.

## 7. Migration and the two addresses

The Ethereum screen shows two rows:
- **"Everyday address":** the plain address from the 24 words, which pays gas.
- **"Vault":** the Safe. Each row has its own sun ring and QR. The vault's ring is centred on the Ethereum mark with a
  small lock.

"Move to vault" is an ordinary transfer from the everyday address, and the vault can receive before it is activated.
Copy under the vault: *"Money here is protected by your allowance and wait. Keep a little ETH on your everyday address
to pay network fees."* The same vault address works on Base Sepolia and Arbitrum Sepolia, because the same factory,
setup and salt give the same address. The app still shows the network on every screen.

## 8. Bitcoin (later; not built)

- **Possible with miniscript:** spending paths that open only after a relative timelock, e.g.
  `or(pk(owner), and(pk(recovery), older(26280)))`. This gives recovery or inheritance after about 6 months without
  movement. Liana is an existing wallet built on this.
- **Not possible today:** a daily allowance, or a delay that starts when a withdrawal is *requested*. Bitcoin timelocks
  count from when a coin was received. Requested-withdrawal delays need covenants (CTV, OP_VAULT) that aren't active,
  or pre-signed "unvault" transactions with deleted keys, which are fragile on a phone.
- **Realistic later step:** an optional timelocked recovery or heir path on Bitcoin, and nothing more.

## 9. Decisions for you

1. **Networks and account:** Safe v1.4.1 L2, Base Sepolia first, then Arbitrum Sepolia. **Recommend: yes.**
2. **Module deployments on these testnets:** deploy the identical audited bytecode at the canonical deterministic
   addresses ourselves, and have the app verify code hashes against Base and Arbitrum mainnet. The alternative is to
   use Ethereum Sepolia, where the Allowance Module is official. **Recommend: self-deploy and verify.**
3. **Delay version:** v1.0.1 (not affected by the June 2026 exploit). Never v1.1.0, and v1.1.1 only after a confirmed fix.
   **Recommend: v1.0.1.**
4. **Recovery key powers:**
   - **A:** Safe owner, so it can do anything instantly. Simplest, audited-only.
   - **B:** the Safe owned by an unspendable address, with the recovery key limited by Roles to cancel and sweep to the
     safe address. This matches LYX.

   **Recommend: A for the Sepolia build, with the threat table saying so. Move to B after a test round.**
5. **Phone one-slide cancel** via one Roles v1 permission (`setTxNonce` only), rather than cancelling with the recovery
   key only. **Recommend: Roles v1, after I confirm its audit report in Step 2.**
6. **Spending model:** per-token allowances now, a trusted list as a later option, and no USD/oracle limit.
   **Recommend: yes.**
7. **Heir on Ethereum:** leave it out for now. **Recommend: leave out.**
8. **Minimum wait:** 24 h, with 48 h as the default. **Recommend: yes.**
9. **Approvals and permits from the vault:** block unlimited approvals and every off-chain signature request. Allow
   exact-amount approvals only through the delay, with a warning. **Recommend: yes.**
10. **USDT:** neither testnet has an official USDT. Use Circle's testnet USDC, and test USDT behaviour (no return value)
    with a mock token on a fork. **Recommend: yes.**
11. **Gas** is paid by the everyday address, with no relayer or paymaster. **Recommend: yes.**

Still to verify in Step 2:
- the audit report links for Delay and Roles v1;
- that the deterministic deployers exist on both testnets;
- Allowance Module handling of no-return tokens;
- Circle USDC testnet addresses;
- that Chainlink feed coverage on these testnets matches what is assumed above.

## 10. Step 2 results (build)

Approved with decisions 1-3 and 5-11 as recommended and decision 4 = option A on testnets only.

**Gas starvation.** The recovery key signs a Safe transaction (`execTransaction`, gas price 0) that is bound to the
chain, the Safe and the Safe nonce. Any account can submit it and pay the fee, so a thief who emptied the everyday
address cannot stop it. This is native Safe behaviour, no extra contract. The vault screen also shows the recovery
address's ETH balance with a low-fuel warning. Test: everyday address emptied, cancel still possible.

**Recovery option B is built.** The recovery key is limited to cancel and sweep to the safe address, and the Safe's owner is
a dead address. Tests in `test/ethvault.test.ts` (option B cases) run it on the real bytecode. Not yet run on a live
network or a phone, and the code hashes are not pinned. Recorded in `STATUS.md`.

**Delegatecall scope (investigated, not buildable with audited parts).** Roles v1 scopes a role by target address and
function and has no wildcard, so it cannot say "any address, plain calls only" in front of the Delay. Roles v2 can,
but v2.1.x is the version hit by the June 2026 exploit. What is built instead: the wait, an alert that names a
delegatecall as dangerous, one-slide cancel, and the app never builds one. Test: a queued delegatecall is flagged
danger and can be cancelled before it runs; the phone key cannot cancel-bypass or execute early. Options for you:
accept this; wait for a fixed Roles v2 release and re-audit; or an allow-list of recipients (a Roles scope per
trusted recipient), which makes sending to new addresses a recovery-key action.

**Per-network settings.** Stored and checked per network. Changes queued from the phone take effect in the stored
settings only after they have run.

**Live config.** Read on every app open and by the background task: owners, threshold, modules, guard, fallback
handler, singleton, Delay cooldown/expiry/modules/owner/avatar/target, Roles wiring, allowance delegates, tokens and
amounts, and code hashes.

**Advisory and audits.**
- Zodiac exploit post-mortem: https://www.gnosis.io/blog/post-mortem-gnosis-pay-vulnerability-exploit
- Safe's advisory: https://help.safe.global/articles/3569845223-zodiac-module-vulnerability
- Affected: Zodiac Delay v1.1.0 and Roles v2.1.0 / v2.1.1 (the staticcall success flag of ERC-1271 validation was
  ignored, introduced in zodiac 3.4.0). Not affected: Delay v1.0.x and Roles v1. The app refuses the affected versions.
- Delay audit: `ZodiacDelayModuleSep2021.pdf` (G0 Group), in the zodiac-modifier-delay repository.
- Roles v1 audit: `ZodiacRolesModifierJan2022.pdf` (G0 Group), in the zodiac-modifier-roles repository.

**Not verified.** Code hashes of the Allowance Module, Delay, Roles and the module factory are not pinned yet
(`scripts/pin-eth-vault-hashes.mjs` prints them from a mainnet RPC; it could not be run without network access).
The modules are not deployed on Base Sepolia / Arbitrum Sepolia yet; vault creation refuses to start until they are.
Circle USDC testnet addresses are from Circle's docs and not checked on chain from here. Nothing was run against a
live network or on a device.

**The gate (decision: fixed settings).** New vaults deploy a second Roles v1 proxy, the gate, with the Delay as its target and the
Safe as its owner. The Delay's only queuer is the gate, and the phone is a member of one gate role. That role allows ETH to the
safe address and a listed token's `transfer` to the safe address, and nothing else: no other target, no delegatecall, no
setting. Because the owner is the Safe, which has no signer, nobody can change the gate, the Delay or the allowances after the
vault is made. Anything above the daily allowance can only go to the safe address, and to change the rules you make a new vault.
Tests: `test/ethvault.test.ts`, the cases starting `gate:`. Each protection (phone not a Delay module, no delegatecall option,
recipient scoped, gate target the Delay) was removed once and a test failed. Vaults made before this build have no gate
(`NetVault.gated` unset) and keep the old behaviour. Not run on a live network or a phone, and not independently reviewed.

**Earlier decision (user):** the delegatecall limit is accepted for testnets. Before mainnet it must be closed by either a fixed and re-audited Roles v2 or a recipient allow-list, decided at mainnet time. Recorded as a mainnet blocker in `STATUS.md`. The vault is labelled experimental in the app until it has run on a live testnet and a real phone.
