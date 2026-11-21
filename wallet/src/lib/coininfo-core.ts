// What the wallet can say about a coin without guessing: the text, numbers and links the price feed gives. Pure, tested.
import type { Currency } from './prices-core';

export interface CoinInfo {
  about: string;
  cap: number | null;
  volume: number | null;
  rank: number | null;
  ath: number | null;
  athDrop: number | null;
  circulating: number | null;
  maxSupply: number | null;
  links: { label: string; url: string }[];
}

export const infoPath = (id: string) =>
  `/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`;
export const infoUrl = (id: string) => `https://api.coingecko.com${infoPath(id)}`;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const url = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v.trim()) ? v.trim() : null);

/** The first two sentences of the description, with any markup removed. */
export function plainAbout(html: unknown): string {
  if (typeof html !== 'string') return '';
  const t = html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const parts = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  const out = parts.slice(0, 2).map((x) => x.trim()).join(' ');
  return out.length > 320 ? `${out.slice(0, 317).trimEnd()}…` : out;
}

export function parseInfo(json: unknown, cur: Currency): CoinInfo | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, any>;
  const m = o.market_data ?? {};
  const links: { label: string; url: string }[] = [];
  const home = url(o.links?.homepage?.find?.((x: unknown) => url(x)));
  if (home) links.push({ label: 'Website', url: home });
  const site = url(o.links?.blockchain_site?.find?.((x: unknown) => url(x)));
  if (site) links.push({ label: 'Explorer', url: site });
  const paper = url(o.links?.whitepaper);
  if (paper) links.push({ label: 'Whitepaper', url: paper });
  const tw = typeof o.links?.twitter_screen_name === 'string' && /^\w{1,15}$/.test(o.links.twitter_screen_name) ? o.links.twitter_screen_name : null;
  if (tw) links.push({ label: 'X', url: `https://x.com/${tw}` });
  return {
    about: plainAbout(o.description?.en),
    cap: num(m.market_cap?.[cur]),
    volume: num(m.total_volume?.[cur]),
    rank: num(o.market_cap_rank),
    ath: num(m.ath?.[cur]),
    athDrop: typeof m.ath_change_percentage?.[cur] === 'number' ? m.ath_change_percentage[cur] : null,
    circulating: num(m.circulating_supply),
    maxSupply: num(m.max_supply),
    links,
  };
}

/** "$1.91T", "$38.2B", "$420M", "19.8M": big numbers short. */
export function compact(n: number, prefix = ''): string {
  const a = Math.abs(n);
  const [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  const v = n / d;
  return `${prefix}${v >= 100 || d === 1 ? Math.round(v).toLocaleString('en-US') : v.toFixed(v >= 10 ? 1 : 2)}${s}`;
}
