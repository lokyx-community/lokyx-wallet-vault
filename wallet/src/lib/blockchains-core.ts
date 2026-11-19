/** Networks the wallet could add later. None of them can be used yet: each needs its own address and signing code. */
export interface Blockchain { id: string; name: string; note: string; letter: string; tint: [string, string]; logo?: 'doge' | 'ltc' }

export const BLOCKCHAINS: Blockchain[] = [
  { id: 'doge', name: 'Dogecoin', note: 'Proof of work', letter: 'Ð', tint: ['#E0C14B', '#A8860F'], logo: 'doge' },
  { id: 'ltc', name: 'Litecoin', note: 'Proof of work', letter: 'Ł', tint: ['#C9C9CF', '#7F7F88'], logo: 'ltc' },
  { id: 'xmr', name: 'Monero', note: 'Private by default', letter: 'M', tint: ['#FF8A3D', '#E55A00'] },
  { id: 'bch', name: 'Bitcoin Cash', note: 'Proof of work', letter: 'B', tint: ['#34D399', '#0A8F5A'] },
  { id: 'ada', name: 'Cardano', note: 'Proof of stake', letter: '₳', tint: ['#2A5BD7', '#0A2A8A'] },
  { id: 'xrp', name: 'XRP Ledger', note: 'Payments', letter: 'X', tint: ['#3B4048', '#15181C'] },
  { id: 'ton', name: 'TON', note: 'Proof of stake', letter: 'T', tint: ['#35B3FF', '#0075C4'] },
];

/** Blockchains whose name or note starts a word with what was typed. */
export function searchChains(q: string): Blockchain[] {
  const t = q.trim().toLowerCase();
  if (!t) return BLOCKCHAINS;
  return BLOCKCHAINS.filter((b) => `${b.name} ${b.id}`.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)));
}
