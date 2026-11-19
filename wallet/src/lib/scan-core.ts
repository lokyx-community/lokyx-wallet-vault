// What a scanned QR code means. Pure, so it is tested (test/scan.test.ts); scan.ts adds the camera side.

import { isAddress } from './lokyx.ts';
import { btcAddressOk, ethAddressOk } from './multichain-core.ts';
import { tronAddressOk } from './tron-core.ts';
import { solAddressOk } from './sol-core.ts';

export interface Found {
  address: string;
  amount?: string;
  how: 'ring' | 'qr';
  /** a time capsule's ring, rather than someone to pay */
  capsule?: boolean;
  /** a Bitcoin or Ethereum ring: `address` is that chain's address, not a lyx1… one */
  chain?: 'btc' | 'eth' | 'sol' | 'trx';
  /** a token request: the token's contract, and the amount in its smallest units (decimals come from the token) */
  token?: string;
  units?: string;
}

/** A LOKYX address or link, a Bitcoin or Ethereum address or payment URI; anything else is null. */
export function parsePayload(text: string): Found | null {
  const t = text.trim();
  const other = otherChain(t);
  if (other) return other;
  const cap = t.match(/capsule[/=:](lyx1[02-9ac-hj-np-z]{20,90})/i);
  if (cap && isAddress(cap[1].toLowerCase())) return { address: cap[1].toLowerCase(), how: 'qr', capsule: true };
  if (isAddress(t.toLowerCase())) return { address: t.toLowerCase(), how: 'qr' };
  const m = t.match(/(lyx1[02-9ac-hj-np-z]{20,90})(?:[?&](.*))?$/i);
  if (m && isAddress(m[1].toLowerCase())) {
    const amount = new URLSearchParams(m[2] ?? '').get('amount') ?? undefined;
    return { address: m[1].toLowerCase(), amount: amount && /^\d*\.?\d+$/.test(amount) ? amount : undefined, how: 'qr' };
  }
  return null;
}

/** bitcoin:ADDR?amount=0.01, a bare bc1/tb1/legacy address, ethereum:0x…(@chain)(/transfer?…), or a bare 0x address. */
function otherChain(t: string): Found | null {
  const btcUri = t.match(/^bitcoin:([^?]+)(?:\?(.*))?$/i);
  const btcAddr = (btcUri ? btcUri[1] : t).trim();
  if ((['signet', 'testnet', 'mainnet'] as const).some((n) => btcAddressOk(btcAddr, n))) {
    const amount = new URLSearchParams(btcUri?.[2] ?? '').get('amount') ?? undefined;
    return { address: btcAddr, how: 'qr', chain: 'btc', amount: amount && /^\d*\.?\d+$/.test(amount) ? amount : undefined };
  }
  const eth = t.match(/^(?:ethereum:)?(?:pay-)?(0x[0-9a-fA-F]{40})(?:@\d+)?(\/[a-zA-Z]+)?(?:\?(.*))?$/);
  if (eth && ethAddressOk(eth[1])) {
    // EIP-681 token request: the target is the token contract; the person to pay is address=, never the target.
    if (eth[2]) {
      if (eth[2].toLowerCase() !== '/transfer') return null;
      const q = new URLSearchParams(eth[3] ?? '');
      const to = q.get('address') ?? '';
      if (!ethAddressOk(to)) return null;
      const units = q.get('uint256') ?? '';
      return { address: to, how: 'qr', chain: 'eth', token: eth[1], ...(/^\d+$/.test(units) && units !== '0' ? { units } : {}) };
    }
    // a plain payment carries value= in wei
    const v = new URLSearchParams(eth[3] ?? '').get('value');
    const amount = v ? weiToEth(v) : undefined;
    return amount ? { address: eth[1], how: 'qr', chain: 'eth', amount } : { address: eth[1], how: 'qr', chain: 'eth' };
  }
  // Solana and Tron have no payment link here: just the address
  if (tronAddressOk(t)) return { address: t, how: 'qr', chain: 'trx' };
  if (solAddressOk(t)) return { address: t, how: 'qr', chain: 'sol' };
  return null;
}

/** "1.5e18" or "1500000000000000000" wei as ETH, or undefined when it isn't a whole number of wei. */
export function weiToEth(v: string): string | undefined {
  let w: bigint;
  const e = v.match(/^(\d+)(?:\.(\d+))?e(\d+)$/i);
  if (e) {
    const frac = e[2] ?? '';
    const exp = Number(e[3]);
    if (frac.length > exp) return undefined;
    w = BigInt(e[1] + frac.padEnd(exp, '0'));
  } else if (/^\d+$/.test(v)) w = BigInt(v);
  else return undefined;
  if (w === 0n) return undefined;
  const base = 10n ** 18n;
  const f = (w % base).toString().padStart(18, '0').replace(/0+$/, '');
  return f ? `${w / base}.${f}` : `${w / base}`;
}

/** The text for a payment request QR on Bitcoin (BIP 21) or Ethereum (EIP-681). Amount in BTC or ETH. */
export function requestUri(chain: 'btc' | 'eth', address: string, amount?: string, chainId?: number): string {
  if (chain === 'btc') return amount ? `bitcoin:${address}?amount=${amount}` : `bitcoin:${address}`;
  if (!amount) return address;
  const [w, f = ''] = amount.split('.');
  const wei = BigInt(w || '0') * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18) || '0');
  return `ethereum:${address}${chainId ? `@${chainId}` : ''}?value=${wei}`;
}

/**
 * A request for a token (EIP-681): the token contract is the target and the transfer names the person and
 * the amount in the token's smallest units. Without an amount it is just the address, like a plain receive.
 */
export function tokenRequestUri(p: { contract: string; decimals: number; to: string; amount?: string; chainId: number }): string {
  if (!p.amount) return p.to;
  const [w, f = ''] = p.amount.split('.');
  if (f.length > p.decimals) throw new Error(`At most ${p.decimals} decimal places`);
  const units = BigInt(w || '0') * 10n ** BigInt(p.decimals) + BigInt((f + '0'.repeat(p.decimals)).slice(0, p.decimals) || '0');
  return `ethereum:${p.contract}@${p.chainId}/transfer?address=${p.to}&uint256=${units}`;
}
