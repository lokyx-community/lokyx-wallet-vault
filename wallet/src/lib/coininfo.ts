// A coin's About, Market and Links. From the price feed's free coin page; the last answer is kept for offline.
import { useEffect, useState } from 'react';
import { getItem, setItem } from './kv';
import { fetchT } from './multichain';
import { infoUrl, parseInfo, type CoinInfo } from './coininfo-core';
import type { Currency } from './prices-core';

export function useCoinInfo(id: string | undefined, cur: Currency): { info: CoinInfo | null; loading: boolean } {
  const [info, setInfo] = useState<CoinInfo | null>(null);
  const [loading, setLoading] = useState(!!id);
  useEffect(() => {
    if (!id) { setInfo(null); setLoading(false); return; }
    let live = true;
    const key = `w.coininfo.${id}.${cur}`;
    setLoading(true);
    (async () => {
      try {
        const r = await fetchT(infoUrl(id), undefined, 12_000);
        if (!r.ok) throw new Error(String(r.status));
        const raw = await r.json();
        const v = parseInfo(raw, cur);
        if (v) { setItem(key, JSON.stringify(v)).catch(() => {}); if (live) setInfo(v); return; }
      } catch {}
      try {
        const c = await getItem(key);
        if (c && live) setInfo(JSON.parse(c) as CoinInfo);
      } catch {}
    })().finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [id, cur]);
  return { info, loading };
}
