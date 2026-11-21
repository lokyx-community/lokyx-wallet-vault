# LOKYX market relay

A small Cloudflare Worker. The wallet asks it for prices, a coin's page and price charts; it asks CoinGecko once,
keeps the answer for a while, and hands the same answer to every phone. If CoinGecko is busy or down it hands out the
last good answer (up to a day old). It stores no accounts and no user data.

| Question | Kept for |
| --- | --- |
| `/api/v3/coins/markets` (prices) | 1 minute |
| `/api/v3/coins/<id>` (about, market, links) | 15 minutes |
| `/api/v3/coins/<id>/market_chart` (graph) | 5 minutes |

Anything else is refused. Only `usd` and `inr` and a short list of chart spans are accepted, so nobody can use it as a free proxy.

## Put it online (about 10 minutes, free plan is enough to start)

1. Make a free Cloudflare account.
2. Make a free CoinGecko "Demo" API key (coingecko.com/en/api). Optional but gives CoinGecko more room for us.
3. In this folder:
   ```
   npx wrangler login
   npx wrangler secret put CG_KEY      # paste the CoinGecko key (skip if you have none)
   npx wrangler deploy
   ```
4. It prints an address like `https://lokyx-market.<you>.workers.dev`. Open `<address>/health` in a browser: it should say `{"ok":true,...}`.
5. Put that address in `wallet/src/lib/market.ts` as `DEFAULT_MARKET` and make a new build. (Done: https://lokyx-market.lokyx.workers.dev)

Until step 5 the wallet asks CoinGecko directly, as before. If the relay ever stops answering, the wallet quietly does the same.

CoinGecko's free terms ask for a credit where its data is shown. The wallet shows "Market data from CoinGecko" under Market.
Read their current terms before launch; this file does not replace that.
