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

/** What the receipt's QR code carries: the block explorer link when there is one, else the network and transaction id. */
export function slipQrValue(s: SlipInput): string {
  return s.url ?? `${s.network} ${s.hash}`;
}

export type QrCellsLike = { n: number; cells: [number, number][] };

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

// ---------- the receipt as a picture ----------
// The share sheet gets a PNG of the receipt. The layout is worked out here, as plain numbers, so it can be tested without a phone;
// `ReceiptImageHost` (ui/Slip.tsx) only draws these items with react-native-svg.

export type ImgItem =
  | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { k: 'text'; x: number; y: number; s: string; size: number; weight: 'regular' | 'medium' | 'semibold'; fill: string; anchor: 'start' | 'middle' | 'end'; mono?: boolean }
  | { k: 'line'; x1: number; x2: number; y: number; stroke: string; w: number; dash?: string }
  | { k: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { k: 'path'; d: string; stroke?: string; fill?: string; w?: number };

export type ReceiptImage = { width: number; height: number; items: ImgItem[] };

const GOOD = '#3DD68C';
const WAIT = '#F5B83D';
const INK = '#F5F5F7';
const SUB = '#9A9AA3';
const FAINT = '#5C5C63';
const RULE = '#34343A';

/** A torn bottom edge as one closed path, from the paper's left edge to its right edge and back along `y`. */
export function tornPath(x: number, y: number, w: number, tooth = 10, depth = 6): string {
  const n = Math.max(1, Math.round(w / tooth));
  const step = w / n;
  let d = `M${x} ${y}`;
  for (let i = 0; i < n; i++) d += `L${+(x + i * step + step / 2).toFixed(2)} ${y + depth}L${+(x + (i + 1) * step).toFixed(2)} ${y}`;
  return `${d}Z`;
}

/** Where everything on the shared picture goes. Mirrors the receipt on screen: seal and state, amount, dotted rows, transaction. */
export function receiptImage(s: SlipInput, done: boolean, qr?: QrCellsLike): ReceiptImage {
  const W = 390;
  const X0 = 24;
  const PW = W - X0 * 2;
  const L = X0 + 22;
  const R = X0 + PW - 22;
  const TOP = 40;
  const items: ImgItem[] = [];
  const tint = done ? GOOD : WAIT;

  let y = TOP + 22;
  // state: a small seal and a word on the left, the time on the right
  items.push({ k: 'circle', cx: L + 11, cy: y + 10, r: 11, fill: tint });
  items.push({ k: 'path', d: `M${L + 6} ${y + 10.5}l3.6 3.6 6.4-7.2`, stroke: '#06210F', w: 2.4 });
  items.push({ k: 'text', x: L + 28, y: y + 16, s: done ? 'Sent' : 'On its way', size: 16, weight: 'semibold', fill: INK, anchor: 'start' });
  items.push({ k: 'text', x: R, y: y + 15, s: slipTime(s.at), size: 12, weight: 'regular', fill: SUB, anchor: 'end' });

  y += 64;
  items.push({ k: 'text', x: W / 2, y: y + 40, s: `${s.amount} ${s.unit}`, size: s.amount.length > 9 ? 34 : 46, weight: 'semibold', fill: INK, anchor: 'middle' });
  y += 62;
  const sub = `to ${s.toName ?? shortAddr(s.to, 8, 6)}${s.testnet ? ' · test network' : ''}`;
  items.push({ k: 'text', x: W / 2, y: y + 12, s: sub, size: 14, weight: 'regular', fill: SUB, anchor: 'middle' });

  y += 36;
  items.push({ k: 'line', x1: L, x2: R, y, stroke: RULE, w: 1, dash: '5 4' });
  y += 10;
  const row = (label: string, value: string, strong = false) => {
    const mid = y + 20;
    items.push({ k: 'text', x: L, y: mid, s: label, size: 14, weight: 'regular', fill: SUB, anchor: 'start' });
    items.push({ k: 'text', x: R, y: mid, s: value, size: 14, weight: strong ? 'semibold' : 'medium', fill: INK, anchor: 'end' });
    // the dotted leader between them; text widths are estimated, which is plenty for a dotted line
    const a = L + label.length * 7.3 + 8;
    const b = R - value.length * 7.7 - 8;
    if (b - a > 12) items.push({ k: 'line', x1: a, x2: b, y: mid - 4, stroke: '#3A3A41', w: 1.5, dash: '1.5 4' });
    y += 30;
  };
  for (const r of slipRows(s)) row(r.label, r.value);
  y += 6;
  items.push({ k: 'line', x1: L, x2: R, y, stroke: RULE, w: 1, dash: '5 4' });
  y += 10;
  row('Transaction', shortAddr(s.hash, 8, 6));
  y += 14;
  items.push({ k: 'circle', cx: W / 2 - 62, cy: y + 5, r: 4, fill: tint });
  items.push({ k: 'text', x: W / 2 - 50, y: y + 10, s: done ? `Confirmed on ${s.network}` : 'Confirming…', size: 13, weight: 'medium', fill: tint, anchor: 'start' });
  y += 22;
  if (qr && qr.n > 0) {
    // a small white tile with the code, centred, so a scanner reads it straight off the picture
    const tile = 104;
    const pad = 2;
    const cell = tile / (qr.n + pad * 2);
    const tx = W / 2 - tile / 2;
    items.push({ k: 'rect', x: tx, y, w: tile, h: tile, r: 8, fill: '#FFFFFF' });
    for (const [cx, cy] of qr.cells) items.push({ k: 'rect', x: tx + (cx + pad) * cell, y: y + (cy + pad) * cell, w: cell + 0.3, h: cell + 0.3, r: 0, fill: '#000000' });
    y += tile + 16;
    items.push({ k: 'text', x: W / 2, y, s: 'Scan to look this payment up', size: 12, weight: 'regular', fill: SUB, anchor: 'middle' });
    y += 22;
  } else y += 12;
  items.push({ k: 'text', x: W / 2, y, s: 'LOKYX Wallet', size: 12, weight: 'medium', fill: FAINT, anchor: 'middle' });
  y += 24;

  const paperH = y - TOP;
  items.unshift({ k: 'rect', x: X0, y: TOP, w: PW, h: paperH, r: 0, fill: '#131315' });
  items.push({ k: 'path', d: tornPath(X0, TOP + paperH, PW), fill: '#131315' });
  return { width: W, height: TOP + paperH + 6 + 40, items };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 text to bytes (no atob needed). Ignores whitespace and a data-URL prefix. */
export function b64ToBytes(input: string): Uint8Array {
  const s = input.replace(/^data:[^,]*,/, '').replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B64.indexOf(s[i]);
    if (v < 0) throw new Error('Not base64.');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
