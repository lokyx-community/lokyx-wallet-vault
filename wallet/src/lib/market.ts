// Where prices, charts and coin pages come from. The wallet asks LOKYX's market relay first (one shared, cached
// copy of CoinGecko's free feed, so many phones cost CoinGecko one call, not thousands). If the relay is not set up, is
// down, or does not know the coin, the phone asks CoinGecko directly. If that fails too, callers fall back to the last saved answer.

import { getItem } from './kv';
import { fetchT } from './multichain';

export const GECKO = 'https://api.coingecko.com';

/** Where the market relay lives. Empty until it is deployed (market-relay/README.md); then put its https address here. */
export const DEFAULT_MARKET = 'https://lokyx-market.lokyx.workers.dev';

/** The relay to use: `w.marketUrl` if it is a proper https address, otherwise the default. Empty means "none". */
export async function marketBase(): Promise<string> {
  let v = DEFAULT_MARKET;
  try {
    const s = ((await getItem('w.marketUrl')) ?? '').trim().replace(/\/+$/, '');
    if (/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(s)) v = s;
  } catch {}
  return v.replace(/\/+$/, '');
}

/** `path` starts with /api/v3/…. The relay first, then CoinGecko. Returns the first answer that is ok; otherwise throws. */
export async function fetchMarket(path: string, ms = 12_000): Promise<Response> {
  const relay = await marketBase();
  if (relay) {
    try {
      const r = await fetchT(`${relay}${path}`, undefined, ms);
      if (r.ok) return r;
    } catch {}
  }
  return fetchT(`${GECKO}${path}`, undefined, ms);
}
