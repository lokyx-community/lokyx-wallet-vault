# LOKYX risk relay

A small Cloudflare Worker. Every 6 hours it downloads public scam lists (phishing sites and scam addresses), boils them
down to a compact file of fingerprints and hands the same file to every phone. The phone checks sites and addresses itself.
**The relay never sees which site or contract anyone is looking at.** It stores no accounts and keeps no logs of who asks.

| Question | Answer |
| --- | --- |
| `/lists/meta` | when the lists were built, how many entries, and whether each source worked |
| `/lists/domains.bin` | fingerprints of scam sites (6 bytes each, sorted) |
| `/lists/addresses.bin` | fingerprints of scam addresses |

Sources (see `SOURCES` in `worker.mjs`): MetaMask's phishing list, ScamSniffer's public scam database and MyEtherWallet's
ethereum-lists darklists. If one source breaks, its last good copy is kept and `/lists/meta` says which one failed.

## Put it online (about 10 minutes, free plan is enough)

1. In this folder: `npx wrangler login`
2. Make the storage: `npx wrangler kv namespace create LISTS`. It prints an `id`; paste it into `wrangler.toml`.
3. `npx wrangler deploy`. It prints an address like `https://lokyx-risk.<you>.workers.dev`.
4. Build the lists once now instead of waiting up to 6 hours: `npx wrangler secret put ADMIN_KEY` (type any long random text),
   then `curl -X POST -H "x-admin: <that text>" https://lokyx-risk.<you>.workers.dev/admin/refresh`.
   Skip this and the first build happens at the next 6-hour mark.
5. Open `<address>/lists/meta`. Every source should say `"ok": true`. A source with `"ok": false` has a wrong address or changed
   its format; the error says why.
6. Put the address in `wallet/src/lib/risk-lists.ts` as `DEFAULT_RISK` and make a new build.

Read each list's terms before launch: ScamSniffer says its public database is free for commercial use, ethereum-lists is MIT,
and MetaMask's repository carries its own licence. This file does not replace reading them.
