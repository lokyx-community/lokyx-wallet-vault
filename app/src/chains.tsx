import { useState } from 'react';
import { LogoMark } from './visuals';

export type ChainKey = 'lyx' | 'btc' | 'eth';

export const CHAIN_NAME: Record<ChainKey, string> = { lyx: 'LOKYX', btc: 'Bitcoin', eth: 'Ethereum' };
export const CHAIN_SYMBOL: Record<ChainKey, string> = { lyx: 'LYX', btc: 'BTC', eth: 'ETH' };

/**
 * Coin icons. Bitcoin's logo is public domain. For Ethereum, drop the official mark from
 * ethereum.org's brand assets into public/chains/eth.svg and it's used automatically; until then a
 * plain badge stands in.
 */
export function ChainIcon({ chain, size = 22 }: { chain: ChainKey; size?: number }) {
  const [noFile, setNoFile] = useState(false);
  if (chain === 'lyx') {
    return (
      <span className="chain-icon" style={{ width: size, height: size }}>
        <LogoMark size={Math.round(size * 0.78)} />
      </span>
    );
  }
  if (chain === 'btc') {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Bitcoin" role="img">
        <circle cx="16" cy="16" r="16" fill="#F7931A" />
        <g transform="rotate(14 16 16)" fill="#fff">
          <path d="M11 8.5h6.2c2.6 0 4.1 1.3 4.1 3.3 0 1.4-.8 2.4-2 2.8 1.6.3 2.7 1.5 2.7 3.2 0 2.4-1.8 3.7-4.6 3.7H11zm3 2.4v3.1h2.7c1.1 0 1.8-.6 1.8-1.6s-.7-1.5-1.8-1.5zm0 5.4v3.3h3c1.2 0 2-.6 2-1.7 0-1-.8-1.6-2-1.6z" />
          <rect x="13" y="6.3" width="1.8" height="2.6" rx=".4" />
          <rect x="16" y="6.3" width="1.8" height="2.6" rx=".4" />
          <rect x="13" y="21.2" width="1.8" height="2.6" rx=".4" />
          <rect x="16" y="21.2" width="1.8" height="2.6" rx=".4" />
        </g>
      </svg>
    );
  }
  if (!noFile) {
    return <img src="/chains/eth.svg" width={size} height={size} alt="Ethereum" onError={() => setNoFile(true)} style={{ display: 'block' }} />;
  }
  return (
    <span className="chain-icon badge" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-label="Ethereum">
      ETH
    </span>
  );
}

/** "LYX → BTC" style pair with icons. */
export function Pair({ from, to, size = 22 }: { from: ChainKey; to: ChainKey; size?: number }) {
  return (
    <span className="chain-pair">
      <ChainIcon chain={from} size={size} />
      <ChainIcon chain={to} size={size} />
    </span>
  );
}
