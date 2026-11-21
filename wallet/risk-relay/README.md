# LOKYX risk relay

A small Cloudflare Worker plus a script that runs on your own server. The script (`build-lists.mjs`) downloads public scam lists
(phishing sites and scam addresses) every 6 hours, boils them down to a compact file of fingerprints and uploads it. The Worker
hands the same file to every phone. (The building is too heavy for a free-plan Worker, which gets only 10 ms of CPU per run.) The phone checks sites and addresses itself.
**The relay never sees which site or contract anyone is looking at.** It stores no accounts and keeps no logs of who asks.

| Question | Answer |
| --- | --- |
| `/lists/meta` | when the lists were built, how many entries, and whether each source worked |
| `/lists/domains.bin` | fingerprints of scam sites (6 bytes each, sorted) |
| `/lists/addresses.bin` | fingerprints of scam addresses |
| `/risk/address?chain=1&address=0x…` | what GoPlus says about an address or contract (danger / caution / ok / unknown) |
| `/risk/token?chain=1&address=0x…` | what GoPlus says about a token (can it be sold, hidden code, big fees) |

Sources (see `SOURCES` in `build-core.mjs`): MetaMask's phishing list, ScamSniffer's public scam database and MyEtherWallet's
ethereum-lists darklists. If one source breaks, its last good copy is kept and `/lists/meta` says which one failed.

## Put it online (about 10 minutes, free plan is enough)

1. In this folder: `npx wrangler login` (or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in your terminal).
2. Make the storage: `npx wrangler kv namespace create LISTS`. It prints an `id`; paste it into `wrangler.toml`.
3. `npx wrangler deploy`. It prints an address like `https://lokyx-risk.<you>.workers.dev`.
4. Build the lists on your server. Put the three settings in a private file, never in chat:
   ```
   umask 077
   cat > ~/.lokyx-risk.env <<'X'
   export CLOUDFLARE_API_TOKEN=...      # a token allowed to edit Workers KV Storage
   export CLOUDFLARE_ACCOUNT_ID=...
   export KV_NAMESPACE_ID=...           # the id from step 2
   X
   . ~/.lokyx-risk.env && node --experimental-strip-types build-lists.mjs
   ```
   It prints one line per source. Then repeat it every 6 hours with cron:
   `0 */6 * * * . $HOME/.lokyx-risk.env && cd <this folder> && node --experimental-strip-types build-lists.mjs >> $HOME/lokyx-risk.log 2>&1`
5. Open `<address>/lists/meta`. Every source should say `"ok": true`. A source with `"ok": false` has a wrong address or changed
   its format; the error says why.
6. Put the address in `wallet/src/lib/risk-lists.ts` as `DEFAULT_RISK` and make a new build.

## The security service (GoPlus)

The phone asks `/risk/…` only about a contract that its own lists and checks could not judge. The relay asks GoPlus once per
contract and keeps the answer for 6 hours, so the free plan goes a long way. The relay and GoPlus see the contract address
and nothing else; the screen says so.

Put your GoPlus key in as secrets, from your own terminal, **never in chat or in a file**:

```
npx wrangler secret put GOPLUS_APP_KEY
npx wrangler secret put GOPLUS_APP_SECRET
```

Without them the relay still asks GoPlus without a key (lower limits). If a key is wrong it falls back to that, so a bad key never
switches the check off. GoPlus's licence asks for a "Powered by Go+ Security" mention outside personal use, so the sheet shows exactly that
wherever its answer is used. Their free plan is about 30 calls a minute, so the relay keeps each answer for 6 hours and
refuses more than 12 new questions a minute from one phone (25 for everyone together). Read their licence before launch.

Read each list's terms before launch: ScamSniffer says its public database is free for commercial use, ethereum-lists is MIT,
and MetaMask's repository carries its own licence. This file does not replace reading them.
