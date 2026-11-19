const shortAddr = (a: string, head: number, tail: number) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

export type SlipInput = {
  amount: string;
  unit: string;
  to: string;
  toName?: string;
  from?: string;
  fromName?: string;
  network: string;
  /** a short line such as "0.00008 ETH" */
  fee?: string;
  /** milliseconds since 1970 */
  at: number;
  hash: string;
  /** set on test networks */
  testnet?: boolean;
  /** a link to the payment on a block explorer */
  url?: string;
};

export type SlipRow = { label: string; value: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "18 Nov 2026, 12:41" in the phone's own time zone. */
export function slipTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The fee out of a "Network fee: …" line, without the bracket of extra detail. Undefined when there is none. */
export function feeFromLines(lines: string[]): string | undefined {
  const l = lines.find((x) => /^Network fee:/i.test(x));
  if (!l) return undefined;
  return l.replace(/^Network fee:\s*/i, '').replace(/\s*\(.*$/, '').replace(/\.$/, '').trim() || undefined;
}

/** The rows of the slip, in order. Rows with nothing to show are left out. */
export function slipRows(s: SlipInput): SlipRow[] {
  const who = (name: string | undefined, a: string) => (name ? `${name} · ${shortAddr(a, 6, 4)}` : shortAddr(a, 8, 6));
  const rows: SlipRow[] = [{ label: 'To', value: who(s.toName, s.to) }];
  if (s.from) rows.push({ label: 'From', value: who(s.fromName, s.from) });
  rows.push({ label: 'Network', value: s.network });
  if (s.fee) rows.push({ label: 'Fee', value: s.fee });
  rows.push({ label: 'Time', value: slipTime(s.at) });
  return rows;
}

/** The slip as plain text, for sharing. Carries the full address and transaction id. */
export function slipText(s: SlipInput): string {
  const out = [`Sent ${s.amount} ${s.unit}`, s.testnet ? 'Test network, no market value' : '', ''].filter((x, i) => x || i === 2);
  out.push(`To: ${s.toName ? `${s.toName} ` : ''}${s.to}`);
  if (s.from) out.push(`From: ${s.fromName ? `${s.fromName} ` : ''}${s.from}`);
  out.push(`Network: ${s.network}`);
  if (s.fee) out.push(`Fee: ${s.fee}`);
  out.push(`Time: ${slipTime(s.at)}`, `Transaction: ${s.hash}`);
  if (s.url) out.push(s.url);
  return out.join('\n');
}

/** A payment as plain text, for sharing from the history page. `pairs` carry the full addresses, not shortened ones. */
export function receiptText(head: string, pairs: [string, string][], hash: string, url?: string, note?: string): string {
  const out = [head];
  if (note) out.push(note);
  out.push('');
  for (const [k, v] of pairs) out.push(`${k}: ${v}`);
  out.push(`Transaction: ${hash}`);
  if (url) out.push(url);
  return out.join('\n');
}
