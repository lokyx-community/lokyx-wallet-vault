import { contactFor } from './data';
import { wallet } from './wallet';

export const shortAddr = (a: string, head = 8, tail = 5) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

/** A name for an address if we know one: a contact, or one of your own accounts. */
export function nameFor(address?: string): string | undefined {
  if (!address) return undefined;
  const c = contactFor(address);
  if (c) return c.name;
  const mine = wallet.get().accounts.find((a) => a.address === address);
  return mine ? `${mine.name} (you)` : undefined;
}
export const labelFor = (address?: string) => (address ? nameFor(address) ?? shortAddr(address) : 'someone');

export function timeAgo(unixSecs: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.round(now - unixSecs));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(unixSecs * 1000);
  const days = Math.floor(h / 24);
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function dayLabel(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "1,248.503" from "1248.50300000": thousands commas, at most `frac` decimals, trailing zeros off. */
export function niceLyx(lyx: string | undefined, frac = 4): string {
  if (!lyx) return '0';
  const [w, f = ''] = lyx.replace(/,/g, '').split('.');
  const whole = BigInt(w || '0').toLocaleString('en-US');
  const ff = f.slice(0, frac).replace(/0+$/, '');
  if (!ff && whole === '0' && /[1-9]/.test(f)) return `<0.${'0'.repeat(frac - 1)}1`; // tiny but not zero
  return ff ? `${whole}.${ff}` : whole;
}
